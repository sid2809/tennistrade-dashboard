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

    // Read from tennis_daily_odds — populated by step10 each morning at 8 AM IST
    // This is the single source of truth. No separate API-Tennis calls here.
    const result = await pool.query(
      `SELECT * FROM tennis_daily_odds WHERE scan_date = $1
       ORDER BY
         CASE WHEN tour ILIKE '%ATP%' AND tour NOT ILIKE '%ITF%' THEN 0
              WHEN tour ILIKE '%WTA%' AND tour NOT ILIKE '%ITF%' THEN 1
              WHEN tour ILIKE '%Challenger%' THEN 2
              ELSE 5 END,
         GREATEST(ABS(COALESCE(edge_p1,0)), ABS(COALESCE(edge_p2,0))) DESC`,
      [date]
    );

    const rows = result.rows;

    const predictions = rows.map(r => {
      const e1 = parseFloat(r.edge_p1) || 0;
      const e2 = parseFloat(r.edge_p2) || 0;
      const bestEdge = Math.max(e1, e2);
      const betOn  = e1 > e2 ? r.player1 : r.player2;
      const betOdds = e1 > e2 ? r.odds_p1 : r.odds_p2;

      // implied_p1 in DB is already overround-normalised (from step10)
      const implied_p1_pct = r.implied_p1 ? (r.implied_p1 * 100).toFixed(0) : null;
      const implied_p2_pct = r.implied_p1 ? ((1 - r.implied_p1) * 100).toFixed(0) : null;
      const implied_bet_pct = e1 > e2 ? implied_p1_pct : implied_p2_pct;

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
        e1, e2, bestEdge, betOn, betOdds,
        implied_p1_pct, implied_p2_pct, implied_bet_pct,
        time_ist,
        has_odds: !!(r.odds_p1 && r.odds_p2),
        model_p1_pct: r.model_p1 ? (r.model_p1 * 100).toFixed(1) : '50.0',
        model_p2_pct: r.model_p2 ? (r.model_p2 * 100).toFixed(1) : '50.0',
      };
    });

    const valueBets = predictions.filter(m => {
      if (!m.has_odds) return false;
      if (EXCLUDED_TOURS.some(t => (m.tour || '').includes(t))) return false;
      if (!m.betOdds || m.betOdds < MIN_ODDS || m.betOdds > MAX_ODDS) return false;
      return m.bestEdge >= THRESHOLD;
    });

    const tradeable = predictions.filter(m => {
      if (m.p1_conf === 'miss' || m.p2_conf === 'miss') return false;
      if (EXCLUDED_TOURS.some(t => (m.tour || '').includes(t))) return false;
      return Math.abs((m.p1_elo || 1500) - (m.p2_elo || 1500)) > 100;
    }).map(m => ({
      ...m,
      elo_gap: Math.abs((m.p1_elo || 1500) - (m.p2_elo || 1500)),
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
  const eloGap = Math.abs((m.p1_elo || 1500) - (m.p2_elo || 1500));
  if (eloGap > 150) strats.push({ type: 'T1', desc: 'Back after break — wait for break-back', confidence: eloGap > 250 ? 'High' : 'Medium' });
  if (eloGap > 200) strats.push({ type: 'T4', desc: 'Lay at 1.02–1.08 after double break', confidence: 'Low-Med' });
  if (m.has_odds && m.bestEdge >= 20) strats.push({ type: 'T6', desc: `Value bet — ${m.bestEdge.toFixed(0)}% edge`, confidence: 'High' });
  return strats;
}

module.exports = router;
