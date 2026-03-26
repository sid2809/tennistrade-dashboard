const apiTennis = require('../api-tennis/client');
const { findPlayerByName, formatIST } = require('../../config/nameMatch');

async function getLivePredictions(db, date, req) {
  try {
    const nameIndex = req && req.app.locals.nameIndex;
    const appStatsMap = req && req.app.locals.statsMap || {};
    if (!nameIndex) { console.error('Name index not ready'); return []; }

    const [events, oddsData] = await Promise.all([
      apiTennis.getTodaysEvents(date),
      apiTennis.getTodaysOdds(date),
    ]);
    const oddsMap = {};
    for (const o of oddsData) oddsMap[o.event_key] = o;

    const singles = events.filter(e => {
      const t = (e.type || '').toLowerCase();
      return t.includes('single') && !t.includes('double');
    });

    // Build name->match map for all players
    const nameToMatch = {};
    for (const name of [...new Set(singles.flatMap(m => [m.player1, m.player2]))]) {
      const m = findPlayerByName(name, nameIndex);
      if (m) nameToMatch[name] = m;
    }

    const getStats = (name) => {
      const m = nameToMatch[name];
      if (!m) return null;
      const stats = appStatsMap[m.row.player_id];
      if (stats) return { ...m.row, ...stats, name_confidence: m.confidence };
      return { ...m.row, name_confidence: m.confidence };
    };

    const enriched = [];
    for (const match of singles) {
      const p1Stats = getStats(match.player1);
      const p2Stats = getStats(match.player2);
      const p1Elo = p1Stats?.elo_overall || 1500;
      const p2Elo = p2Stats?.elo_overall || 1500;
      const eloProbP1 = 1 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400));
      const odds = oddsMap[match.event_key] || {};
      const oddsP1 = odds.odds_p1;
      const oddsP2 = odds.odds_p2;
      const impliedP1 = oddsP1 ? 1 / oddsP1 : null;
      const impliedP2 = oddsP2 ? 1 / oddsP2 : null;
      const edgeP1 = impliedP1 ? ((eloProbP1 - impliedP1) * 100) : null;
      const edgeP2 = impliedP2 ? (((1 - eloProbP1) - impliedP2) * 100) : null;
      enriched.push({
        ...match,
        time_ist: formatIST(match.time),
        p1_name_conf: p1Stats?.name_confidence || 'miss',
        p2_name_conf: p2Stats?.name_confidence || 'miss',
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

    const rated = enriched.filter(m =>
      m.p1_name_conf !== 'miss' && m.p2_name_conf !== 'miss' &&
      m.p1_elo !== 1500 && m.p2_elo !== 1500
    );

    const tourOrder = { 'ATP': 0, 'WTA': 1, 'Challenger': 2, 'WTA-ITF': 3, 'ATP-ITF': 4, 'Other': 5 };
    rated.sort((a, b) => {
      if (a.has_odds !== b.has_odds) return a.has_odds ? -1 : 1;
      return (tourOrder[a.tour] || 5) - (tourOrder[b.tour] || 5);
    });
    return rated;
  } catch (e) {
    console.error('Live predictions error:', e.message);
    return [];
  }
}

async function getValueBets(db, date, req) {
  const all = await getLivePredictions(db, date, req);
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

async function getTradeableMatches(db, date, req) {
  const all = await getLivePredictions(db, date, req);
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
    const favS = m.p1_elo > m.p2_elo ? m.p1_stats : m.p2_stats;
    const udS = m.p1_elo > m.p2_elo ? m.p2_stats : m.p1_stats;
    if (eloGap > 150 && udS && (udS.break_rate || 0) > 0.2)
      strats.push({ type: 'T1', desc: 'Back after break — wait for break-back', confidence: eloGap > 250 ? 'High' : 'Medium' });
    if (favS && (favS.serve_hold_pct || 0) < 0.80)
      strats.push({ type: 'T3', desc: 'Serving for set — break probability elevated', confidence: 'Medium' });
    if (eloGap > 200)
      strats.push({ type: 'T4', desc: 'Lay at 1.02-1.08 after double break', confidence: 'Low-Med' });
    if (m.has_odds) {
      const e1 = parseFloat(m.edge_p1) || 0;
      const e2 = parseFloat(m.edge_p2) || 0;
      if (e1 >= 20 || e2 >= 20)
        strats.push({ type: 'T6', desc: 'Value bet — ' + Math.max(e1, e2).toFixed(0) + '% edge', confidence: 'High' });
    }
    return { ...m, strategies: strats, favorite: fav, elo_gap: eloGap };
  }).filter(m => m.strategies.length > 0)
    .sort((a, b) => b.elo_gap - a.elo_gap);
}

async function getTodaysSchedule(db, date, req) {
  const events = await getLivePredictions(db, date, req);
  const grouped = {};
  for (const e of events) {
    const key = e.tour + ' — ' + e.tournament;
    if (!grouped[key]) grouped[key] = { tour: e.tour, tournament: e.tournament, surface: e.surface, matches: [] };
    grouped[key].matches.push(e);
  }
  const tourOrder = { 'ATP': 0, 'WTA': 1, 'Challenger': 2, 'WTA-ITF': 3, 'ATP-ITF': 4, 'Other': 5 };
  return Object.values(grouped).sort((a, b) => (tourOrder[a.tour] || 5) - (tourOrder[b.tour] || 5));
}

module.exports = { getLivePredictions, getValueBets, getTradeableMatches, getTodaysSchedule };
