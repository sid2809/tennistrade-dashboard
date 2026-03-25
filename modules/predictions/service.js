async function getTodaysPredictions(db, date) {
  const sql = `
    SELECT tour, tournament, match_date, surface, round,
      winner as player1, loser as player2,
      w_rank as p1_rank, l_rank as p2_rank,
      odds_b365_w, odds_b365_l, odds_pin_w, odds_pin_l,
      odds_avg_w, odds_avg_l, implied_prob_w, implied_prob_l
    FROM tennis_odds WHERE match_date = $1
    ORDER BY tour, tournament, round
  `;
  try {
    const result = await db.query(sql, [date]);
    const enriched = [];
    for (const match of result.rows) {
      const p1Stats = await lookupPlayerStats(db, match.player1);
      const p2Stats = await lookupPlayerStats(db, match.player2);
      const p1Elo = p1Stats?.elo_overall || 1500;
      const p2Elo = p2Stats?.elo_overall || 1500;
      const eloProbP1 = 1 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400));
      const oddsP1 = match.odds_pin_w || match.odds_b365_w || match.odds_avg_w;
      const oddsP2 = match.odds_pin_l || match.odds_b365_l || match.odds_avg_l;
      const impliedP1 = oddsP1 ? 1 / oddsP1 : null;
      const impliedP2 = oddsP2 ? 1 / oddsP2 : null;
      const edgeP1 = impliedP1 ? ((eloProbP1 - impliedP1) * 100) : null;
      const edgeP2 = impliedP2 ? (((1 - eloProbP1) - impliedP2) * 100) : null;
      enriched.push({
        ...match,
        p1_elo: Math.round(p1Elo), p2_elo: Math.round(p2Elo),
        p1_stats: p1Stats, p2_stats: p2Stats,
        elo_prob_p1: (eloProbP1 * 100).toFixed(1),
        elo_prob_p2: ((1 - eloProbP1) * 100).toFixed(1),
        odds_p1: oddsP1, odds_p2: oddsP2,
        edge_p1: edgeP1?.toFixed(1), edge_p2: edgeP2?.toFixed(1),
      });
    }
    return enriched;
  } catch (e) {
    console.error('Predictions query error:', e.message);
    return [];
  }
}

async function getValueBets(db, date) {
  const all = await getTodaysPredictions(db, date);
  return all.filter(m => {
    const e1 = parseFloat(m.edge_p1) || 0;
    const e2 = parseFloat(m.edge_p2) || 0;
    return e1 >= 15 || e2 >= 15;
  }).map(m => {
    const e1 = parseFloat(m.edge_p1) || 0;
    const e2 = parseFloat(m.edge_p2) || 0;
    return {
      ...m,
      bet_on: e1 > e2 ? m.player1 : m.player2,
      bet_odds: e1 > e2 ? m.odds_p1 : m.odds_p2,
      edge: Math.max(e1, e2).toFixed(1),
      elo_prob: e1 > e2 ? m.elo_prob_p1 : m.elo_prob_p2,
      stake_pct: Math.max(e1, e2) > 25 ? '3%' : '2%',
    };
  }).sort((a, b) => parseFloat(b.edge) - parseFloat(a.edge));
}

async function getTradeableMatches(db, date) {
  const all = await getTodaysPredictions(db, date);
  return all.filter(m => {
    if (!m.p1_stats || !m.p2_stats) return false;
    const p1Hold = m.p1_stats.serve_hold_pct || 0;
    const p2Hold = m.p2_stats.serve_hold_pct || 0;
    const eloGap = Math.abs(m.p1_elo - m.p2_elo);
    const p1Break = m.p1_stats.break_rate || 0;
    const p2Break = m.p2_stats.break_rate || 0;
    return p1Hold > 0.78 || p2Hold > 0.78 || eloGap > 150 || p1Break > 0.25 || p2Break > 0.25;
  }).map(m => {
    const strategies = [];
    const eloGap = Math.abs(m.p1_elo - m.p2_elo);
    const favorite = m.p1_elo > m.p2_elo ? m.player1 : m.player2;
    const underdog = m.p1_elo > m.p2_elo ? m.player2 : m.player1;
    const favStats = m.p1_elo > m.p2_elo ? m.p1_stats : m.p2_stats;
    const udStats = m.p1_elo > m.p2_elo ? m.p2_stats : m.p1_stats;
    if (eloGap > 150 && udStats && (udStats.break_rate || 0) > 0.2) {
      strategies.push({ type: 'T1', desc: `If ${favorite} gets broken → back at spiked odds`, confidence: eloGap > 250 ? 'High' : 'Medium' });
    }
    if (favStats && (favStats.serve_hold_pct || 0) < 0.80) {
      strategies.push({ type: 'T3', desc: `Serving for set — break probability elevated`, confidence: 'Medium' });
    }
    if (eloGap > 200) {
      strategies.push({ type: 'T4', desc: `If ${favorite} goes up double break → lay at 1.02-1.08`, confidence: 'Low-Med' });
    }
    return { ...m, strategies, favorite, underdog, elo_gap: eloGap };
  }).filter(m => m.strategies.length > 0).sort((a, b) => b.elo_gap - a.elo_gap);
}

async function lookupPlayerStats(db, playerName) {
  if (!playerName) return null;
  try {
    let result = await db.query(
      `SELECT s.*, e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass
       FROM tennis_player_stats s LEFT JOIN tennis_elo_current e ON s.player_id = e.player_id
       WHERE s.player_name = $1 AND s.surface = 'Overall' LIMIT 1`, [playerName]);
    if (result.rows.length > 0) return result.rows[0];
    const lastName = playerName.split(' ').pop();
    result = await db.query(
      `SELECT s.*, e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass
       FROM tennis_player_stats s LEFT JOIN tennis_elo_current e ON s.player_id = e.player_id
       WHERE s.player_name LIKE $1 AND s.surface = 'Overall'
       ORDER BY s.matches_total DESC LIMIT 1`, [`%${lastName}%`]);
    return result.rows[0] || null;
  } catch { return null; }
}

module.exports = { getTodaysPredictions, getValueBets, getTradeableMatches };
