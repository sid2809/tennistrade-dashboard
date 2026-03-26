const express = require('express');
const router = express.Router();
const service = require('./service');

router.get('/', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const db = req.app.locals.pool;

    const predictions = await service.getLivePredictions(db, date, req);
    const valueBets = service.getValueBetsFromList(predictions);
    const tradeable = service.getTradeableFromList(predictions);
    const schedule = service.getScheduleFromList(predictions);

    const stats = {
      total: predictions.length,
      with_odds: predictions.filter(p => p.has_odds).length,
      atp_wta: predictions.filter(p => p.tour === 'ATP' || p.tour === 'WTA').length,
      value_bets: valueBets.length,
      tradeable: tradeable.length,
    };

    res.render('predictions', {
      predictions, valueBets, tradeable, schedule, stats, date,
      page: 'predictions',
    });
  } catch (err) {
    console.error('Predictions route error:', err.message);
    res.render('predictions', {
      predictions: [], valueBets: [], tradeable: [], schedule: [],
      stats: { total: 0, with_odds: 0, atp_wta: 0, value_bets: 0, tradeable: 0 },
      date: new Date().toISOString().slice(0, 10),
      page: 'predictions',
    });
  }
});

module.exports = router;
