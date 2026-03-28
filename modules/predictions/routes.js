const express = require('express');
const router = express.Router();

const THRESHOLD = 15;
const EXCLUDED_TOURS = ['ATP-ITF', 'WTA-ITF', 'ITF'];
const MIN_ODDS = 1.30;
const MAX_ODDS = 8.00;

router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    // Default to IST date
    let date = req.query.date;
    if (!date) {
      const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      date = ist.toISOString().slice(0, 10);
    }

    // Read from tennis_daily_odds — populated by step10 at 8 AM IST
    // All values already in human-readable units:
    //   model_p1/p2  = percentage  e.g. 85.0
    //   implied_p1/2 = percentage  e.g. 53.0  (overround-removed)
    //   edge_p1/p2   = percentage pts e.g. 31.8
    //   p1_elo/p2_elo = raw Elo    e.g. 1722.3
    //   odds_p1/p2   = decimal     e.g. 1.88
    const result = await pool.query(
      `SELECT * FROM tennis_daily_odds WHERE scan_date = $1
       AND p1_conf != 'miss' AND p2_conf != 'miss'
       ORDER BY
         CASE WHEN tour ILIKE '%ATP%' AND tour NOT ILIKE '%ITF%' THEN 0
              WHEN tour ILIKE '%WTA%' AND tour NOT ILIKE '%ITF%' THEN 1
              WHEN tour ILIKE '%Challenger%' THEN 2
              ELSE 5 END,
         GREATEST(ABS(COALESCE(edge_p1,0)), ABS(COALESCE(edge_p2,0))) DESC`,
      [date]
    );

    const rows = result.rows;

    // Enrich with surface Elos from at_elo_current and serve stats from tennis_player_stats
    // tennis_daily_odds stores at_player_key for p1/p2 if available
    // We join via player name stored in at_player_bridge
    let eloMap = {}, statsMap2 = {};
    try {
      const playerNames = [...new Set(rows.flatMap(r => [r.player1, r.player2]).filter(Boolean))];
      if (playerNames.length > 0) {
        const placeholders = playerNames.map((_,i) => `$${i+1}`).join(',');
        const [eloRows, statRows] = await Promise.all([
          pool.query(
            `SELECT b.at_player_name, e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass
             FROM at_player_bridge b
             JOIN at_elo_current e ON e.at_player_key = b.at_player_key
             WHERE b.at_player_name = ANY($1)`,
            [playerNames]
          ),
          pool.query(
            `SELECT player_name, serve_hold_pct, break_rate
             FROM tennis_player_stats WHERE surface = 'Overall'
             AND player_name = ANY($1)`,
            [playerNames]
          ).catch(() => ({ rows: [] })),
        ]);
        for (const r of eloRows.rows) eloMap[r.at_player_name] = r;
        for (const r of statRows.rows) statsMap2[r.player_name] = r;
      }
    } catch(e) { /* enrichment optional */ }

    const predictions = rows.map(r => {
      const p1elo = eloMap[r.player1] || {};
      const p2elo = eloMap[r.player2] || {};
      const p1stats = statsMap2[r.player1] || {};
      const p2stats = statsMap2[r.player2] || {};
      const p1data = {
        elo_overall: r.p1_elo,
        elo_hard:  p1elo.elo_hard  || null,
        elo_clay:  p1elo.elo_clay  || null,
        elo_grass: p1elo.elo_grass || null,
        serve_hold_pct: p1stats.serve_hold_pct || null,
        break_rate:     p1stats.break_rate     || null,
      };
      const p2data = {
        elo_overall: r.p2_elo,
        elo_hard:  p2elo.elo_hard  || null,
        elo_clay:  p2elo.elo_clay  || null,
        elo_grass: p2elo.elo_grass || null,
        serve_hold_pct: p2stats.serve_hold_pct || null,
        break_rate:     p2stats.break_rate     || null,
      };
      const e1 = parseFloat(r.edge_p1) || 0;
      const e2 = parseFloat(r.edge_p2) || 0;
      const bestEdge = Math.max(e1, e2);
      const betOn   = e1 > e2 ? r.player1 : r.player2;
      const betOdds = e1 > e2 ? r.odds_p1 : r.odds_p2;

      // implied already in % from step10
      const implied_bet_pct = e1 > e2
        ? (r.implied_p1 != null ? Math.round(r.implied_p1) : null)
        : (r.implied_p2 != null ? Math.round(r.implied_p2) : null);

      // Convert UTC time to IST
      let time_ist = 'TBD';
      if (r.time_utc && r.scan_date) {
        try {
          const d = new Date(`${r.scan_date}T${r.time_utc}:00Z`);
          const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
          const h = ist.getUTCHours(), m2 = ist.getUTCMinutes();
          time_ist = `${h % 12 || 12}:${String(m2).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'} IST`;
        } catch(e) {}
      }

      return {
        ...r,
        e1, e2, bestEdge, betOn, betOdds, implied_bet_pct, time_ist,
        p1data, p2data,
        has_odds: !!(r.odds_p1 && r.odds_p2),
        // Already percentages — use directly as strings for template
        model_p1_pct: r.model_p1 != null ? parseFloat(r.model_p1).toFixed(1) : '50.0',
        model_p2_pct: r.model_p2 != null ? parseFloat(r.model_p2).toFixed(1) : '50.0',
        implied_p1_pct: r.implied_p1 != null ? Math.round(r.implied_p1) : null,
        implied_p2_pct: r.implied_p2 != null ? Math.round(r.implied_p2) : null,
        p1_elo: r.p1_elo != null ? Math.round(r.p1_elo) : 1500,
        p2_elo: r.p2_elo != null ? Math.round(r.p2_elo) : 1500,
      };
    });

    const valueBets = predictions.filter(m => {
      if (!m.has_odds) return false;
      if (EXCLUDED_TOURS.some(t => (m.tour || '').includes(t))) return false;
      if (!m.betOdds || m.betOdds < MIN_ODDS || m.betOdds > MAX_ODDS) return false;
      return m.bestEdge >= THRESHOLD;
    });

    const tradeable = predictions.filter(m => {
      if (EXCLUDED_TOURS.some(t => (m.tour || '').includes(t))) return false;
      return Math.abs(m.p1_elo - m.p2_elo) > 100;
    }).map(m => ({
      ...m,
      elo_gap: Math.abs(m.p1_elo - m.p2_elo),
      strategies: buildStrategies(m),
    })).filter(m => m.strategies.length > 0);

    const scheduleMap = {};
    for (const m of predictions) {
      const key = (m.tour || '') + '|' + (m.tournament || '');
      if (!scheduleMap[key]) scheduleMap[key] = {
        tour: m.tour, tournament: m.tournament, surface: m.surface, matches: []
      };
      scheduleMap[key].matches.push(m);
    }
    const schedule = Object.values(scheduleMap);

    const stats = {
      total: predictions.length,
      with_odds: predictions.filter(m => m.has_odds).length,
      value_bets: valueBets.length,
      tradeable: tradeable.length,
    };

    res.render('predictions', {
      predictions, valueBets, tradeable, schedule, stats, date,
      noData: predictions.length === 0,
      page: 'predictions',
    });
  } catch (err) {
    console.error('Predictions route error:', err.message);
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    res.render('predictions', {
      predictions: [], valueBets: [], tradeable: [], schedule: [],
      stats: { total: 0, with_odds: 0, value_bets: 0, tradeable: 0 },
      date: ist.toISOString().slice(0, 10),
      noData: true, page: 'predictions',
    });
  }
});

function buildStrategies(m) {
  const strats = [];
  const eloGap = Math.abs(m.p1_elo - m.p2_elo);
  if (eloGap > 150) strats.push({ type: 'T1', desc: 'Back after break — wait for break-back', confidence: eloGap > 250 ? 'High' : 'Medium' });
  if (eloGap > 200) strats.push({ type: 'T4', desc: 'Lay at 1.02–1.08 after double break', confidence: 'Low-Med' });
  if (m.has_odds && m.bestEdge >= 20) strats.push({ type: 'T6', desc: `Value bet — ${m.bestEdge.toFixed(0)}% edge`, confidence: 'High' });
  return strats;
}

module.exports = router;
