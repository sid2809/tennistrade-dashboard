const apiTennis = require('../api-tennis/client');

async function lookupPlayerStats(db, playerName) {
  if (!playerName) return null;
  try {
    // Try exact match
    let r = await db.query(`
      SELECT s.*, e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass
      FROM tennis_player_stats s
      LEFT JOIN tennis_elo_current e ON s.player_id = e.player_id
      WHERE s.player_name = $1 AND s.surface = 'Overall' LIMIT 1
    `, [playerName]);
    if (r.rows.length > 0) return r.rows[0];

    // Try last name
    const parts = playerName.split(' ');
    const lastName = parts.length > 1 ? parts[0].replace('.', '') : parts[0];
    r = await db.query(`
      SELECT s.*, e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass
      FROM tennis_player_stats s
      LEFT JOIN tennis_elo_current e ON s.player_id = e.player_id
      WHERE s.player_name LIKE $1 AND s.surface = 'Overall'
      ORDER BY s.matches_total DESC LIMIT 1
    `, [`%${lastName}%`]);
    if (r.rows.length > 0) return r.rows[0];

    // Try with initial: "A. Muller" → search "Muller"
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      r = await db.query(`
        SELECT s.*, e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass
        FROM tennis_player_stats s
        LEFT JOIN tennis_elo_current e ON s.player_id = e.player_id
        WHERE s.player_name LIKE $1 AND s.surface = 'Overall'
        ORDER BY s.matches_total DESC LIMIT 1
      `, [`%${last}`]);
      if (r.rows.length > 0) return r.rows[0];
    }

    return null;
  } catch { return null; }
}

async function getLivePredictions(db, date) {
  try {
    // Fetch today's events and odds from API-Tennis simultaneously
    const [events, oddsData] = await Promise.all([
      apiTennis.getTodaysEvents(date),
      apiTennis.getTodaysOdds(date),
    ]);

    // Build odds lookup by event_key
    const oddsMap = {};
    for (const o of oddsData) {
      oddsMap[o.event_key] = o;
    }

    // Filter to singles only
    const singles = events.filter(e => {
      const t = (e.type || '').toLowerCase();
      return t.includes('singles') && !t.includes('doubles');
    });

    // Enrich each match with Elo + odds
    const enriched = [];
    for (const match of singles) {
      const p1Stats = await lookupPlayerStats(db, match.player1);
      const p2Stats = await lookupPlayerStats(db, match.player2);

      const p1Elo = p1Stats?.elo_overall || 1500;
      const p2Elo = p2Stats?.elo_overall || 1500;

      // Elo expected score
      const eloProbP1 = 1 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400));

      // Get odds from API-Tennis
      const odds = oddsMap[match.event_key] || {};
      const oddsP1 = odds.odds_p1;
      const oddsP2 = odds.odds_p2;

      // Implied probability from odds
      const impliedP1 = oddsP1 ? 1 / oddsP1 : null;
      const impliedP2 = oddsP2 ? 1 / oddsP2 : null;

      // Edge calculation
      const edgeP1 = impliedP1 ? ((eloProbP1 - impliedP1) * 100) : null;
      const edgeP2 = impliedP2 ? (((1 - eloProbP1) - impliedP2) * 100) : null;

      enriched.push({
        ...match,
        p1_elo: Math.round(p1Elo),
        p2_elo: Math.round(p2Elo),
        p1_stats: p1Stats,
        p2_stats: p2Stats,
        elo_prob_p1: (eloProbP1 * 100).toFixed(1),
        elo_prob_p2: ((1 - eloProbP1) * 100).toFixed(1),
        odds_p1: oddsP1,
        odds_p2: oddsP2,
        edge_p1: edgeP1?.toFixed(1),
        edge_p2: edgeP2?.toFixed(1),
        has_odds: !!(oddsP1 && oddsP2),
        bookmakers: odds.all_bookmakers || null,
        markets_count: odds.markets?.length || 0,
      });
    }

    // Sort: matches with odds first, then by tour level
    const tourOrder = { 'ATP': 0, 'WTA': 1, 'Challenger': 2, 'WTA-ITF': 3, 'ATP-ITF': 4, 'Other': 5 };
    enriched.sort((a, b) => {
      if (a.has_odds !== b.has_odds) return a.has_odds ? -1 : 1;
      return (tourOrder[a.tour] || 5) - (tourOrder[b.tour] || 5);
    });

    return enriched;
  } catch (e) {
    console.error('Live predictions error:', e.message);
    return [];
  }
}

async function getValueBets(db, date) {
  const all = await getLivePredictions(db, date);

  return all.filter(m => {
    if (!m.has_odds) return false;
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
  const all = await getLivePredictions(db, date);

  return all.filter(m => {
    if (!m.p1_stats && !m.p2_stats) return false;
    const p1H = m.p1_stats?.serve_hold_pct || 0;
    const p2H = m.p2_stats?.serve_hold_pct || 0;
    const eloGap = Math.abs(m.p1_elo - m.p2_elo);
    const p1B = m.p1_stats?.break_rate || 0;
    const p2B = m.p2_stats?.break_rate || 0;
    return p1H > 0.78 || p2H > 0.78 || eloGap > 150 || p1B > 0.25 || p2B > 0.25;
  }).map(m => {
    const strats = [];
    const eloGap = Math.abs(m.p1_elo - m.p2_elo);
    const fav = m.p1_elo > m.p2_elo ? m.player1 : m.player2;
    const ud = m.p1_elo > m.p2_elo ? m.player2 : m.player1;
    const favS = m.p1_elo > m.p2_elo ? m.p1_stats : m.p2_stats;
    const udS = m.p1_elo > m.p2_elo ? m.p2_stats : m.p1_stats;

    if (eloGap > 150 && udS && (udS.break_rate || 0) > 0.2)
      strats.push({ type: 'T1', desc: `If ${fav} broken, odds spike — back and wait for break-back`, confidence: eloGap > 250 ? 'High' : 'Medium' });
    if (favS && (favS.serve_hold_pct || 0) < 0.80)
      strats.push({ type: 'T3', desc: 'Either player serving for set — break probability elevated', confidence: 'Medium' });
    if (eloGap > 200)
      strats.push({ type: 'T4', desc: `If ${fav} goes up double break, lay at 1.02-1.08`, confidence: 'Low-Med' });
    if (m.has_odds) {
      const e1 = parseFloat(m.edge_p1) || 0;
      const e2 = parseFloat(m.edge_p2) || 0;
      if (e1 >= 20 || e2 >= 20) {
        const betOn = e1 > e2 ? m.player1 : m.player2;
        strats.push({ type: 'T6', desc: `Value bet on ${betOn} — ${Math.max(e1, e2).toFixed(0)}% edge vs bookmaker`, confidence: 'High' });
      }
    }

    return { ...m, strategies: strats, favorite: fav, underdog: ud, elo_gap: eloGap };
  }).filter(m => m.strategies.length > 0)
    .sort((a, b) => b.elo_gap - a.elo_gap);
}

async function getTodaysSchedule(db, date) {
  const events = await getLivePredictions(db, date);

  // Group by tournament
  const grouped = {};
  for (const e of events) {
    const key = `${e.tour} — ${e.tournament}`;
    if (!grouped[key]) grouped[key] = { tour: e.tour, tournament: e.tournament, surface: e.surface, matches: [] };
    grouped[key].matches.push(e);
  }

  return Object.values(grouped).sort((a, b) => {
    const tourOrder = { 'ATP': 0, 'WTA': 1, 'Challenger': 2, 'WTA-ITF': 3, 'ATP-ITF': 4, 'Other': 5 };
    return (tourOrder[a.tour] || 5) - (tourOrder[b.tour] || 5);
  });
}

module.exports = { getLivePredictions, getValueBets, getTradeableMatches, getTodaysSchedule };
