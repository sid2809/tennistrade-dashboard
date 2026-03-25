const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const predictions = await pool.query(`
      SELECT ep.winner_name, ep.loser_name, ep.surface,
             ep.p1_elo, ep.p2_elo, ep.predicted_prob,
             o.odds_pin_w, o.odds_pin_l, o.odds_b365_w, o.odds_b365_l,
             o.odds_avg_w, o.odds_avg_l, o.tournament, o.match_date
      FROM tennis_elo_predictions ep
      LEFT JOIN tennis_odds o ON (
        ep.winner_name = o.winner AND ep.loser_name = o.loser
        AND ep.tourney_date = REPLACE(o.match_date, '-', '')
      )
      WHERE ep.tourney_date >= TO_CHAR(NOW() - INTERVAL '7 days', 'YYYYMMDD')
        AND o.odds_pin_w IS NOT NULL
      ORDER BY ep.tourney_date DESC
      LIMIT 50
    `).catch(() => ({ rows: [] }));

    const withEdge = predictions.rows.map(p => {
      const bestOdds = parseFloat(p.odds_pin_w) || parseFloat(p.odds_b365_w) || parseFloat(p.odds_avg_w);
      const impliedProb = bestOdds > 0 ? 1 / bestOdds : 0;
      const eloProbW = parseFloat(p.predicted_prob) || 0.5;
      const edge = impliedProb > 0 ? ((eloProbW - impliedProb) / impliedProb * 100).toFixed(1) : '0.0';
      return { ...p, bestOdds, impliedProb, eloProbW, edge: parseFloat(edge) };
    });

    const valueBets = withEdge.filter(p => p.edge >= 10).sort((a, b) => b.edge - a.edge);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const tradeable = withEdge.filter(p => p.edge >= 5 && p.bestOdds >= 1.5 && p.bestOdds <= 4.0);
    res.render('predictions', { page: 'predictions', predictions: withEdge.slice(0, 30), valueBets, tradeable, date });
  } catch (err) {
    console.error('Predictions error:', err);
    res.render('predictions', { predictions: [], valueBets: [], tradeable: [], date: new Date().toISOString().slice(0, 10), page: 'predictions' });
  }
});
module.exports = router;
