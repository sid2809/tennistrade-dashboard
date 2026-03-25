const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const lastTrade = await req.db.query(
      `SELECT entry_time, strategy, player1, player2, status
       FROM paper_trades ORDER BY entry_time DESC LIMIT 1`);
    const openTrades = await req.db.query(
      `SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY entry_time DESC`);
    const todayStats = await req.db.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE pnl > 0) as wins,
       COALESCE(SUM(pnl), 0) as pnl
       FROM paper_trades WHERE entry_time::date = CURRENT_DATE AND status = 'CLOSED'`);
    const bankroll = await req.db.query(
      `SELECT value FROM paper_state WHERE key = 'bankroll'`);
    res.render('radar', {
      lastTrade: lastTrade.rows[0] || null,
      openTrades: openTrades.rows,
      todayStats: todayStats.rows[0],
      bankroll: bankroll.rows[0]?.value || '50000',
      page: 'radar',
    });
  } catch (err) {
    console.error('Radar error:', err.message);
    res.render('radar', {
      lastTrade: null, openTrades: [],
      todayStats: { total: 0, wins: 0, pnl: 0 },
      bankroll: '50000', page: 'radar',
    });
  }
});

module.exports = router;
