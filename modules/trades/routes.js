const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  const { strategy, surface, tour, period, sort } = req.query;

  try {
    let where = ["status = 'CLOSED'"];
    let params = [];
    let idx = 1;

    if (strategy) { where.push(`strategy = $${idx++}`); params.push(strategy); }
    if (surface) { where.push(`surface = $${idx++}`); params.push(surface); }
    if (tour) { where.push(`tour = $${idx++}`); params.push(tour); }
    if (period === 'today') {
      where.push(`exit_time::date = CURRENT_DATE`);
    } else if (period === 'week') {
      where.push(`exit_time >= NOW() - INTERVAL '7 days'`);
    } else if (period === 'month') {
      where.push(`exit_time >= NOW() - INTERVAL '30 days'`);
    }

    const orderBy = sort === 'pnl' ? 'pnl DESC' : sort === 'date_asc' ? 'exit_time ASC' : 'exit_time DESC';

    const trades = await pool.query(
      `SELECT * FROM paper_trades WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT 200`,
      params
    );

    // Summary stats for filtered set
    const summary = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE pnl > 0) as wins,
        COUNT(*) FILTER (WHERE pnl < 0) as losses,
        COALESCE(SUM(pnl), 0) as total_pnl,
        COALESCE(SUM(entry_liability), 0) as total_risked
      FROM paper_trades WHERE ${where.join(' AND ')}`,
      params
    );

    // By strategy breakdown
    const byStrategy = await pool.query(
      `SELECT strategy, COUNT(*) as n, 
        COUNT(*) FILTER (WHERE pnl > 0) as wins,
        COALESCE(SUM(pnl), 0) as pnl
      FROM paper_trades WHERE ${where.join(' AND ')}
      GROUP BY strategy ORDER BY strategy`,
      params
    );

    // Daily P&L (for chart)
    const dailyPnl = await pool.query(
      `SELECT exit_time::date as day, SUM(pnl) as pnl, COUNT(*) as trades
      FROM paper_trades WHERE ${where.join(' AND ')} AND exit_time IS NOT NULL
      GROUP BY exit_time::date ORDER BY day`,
      params
    );

    const stats = summary.rows[0];
    const roi = stats.total_risked > 0
      ? (stats.total_pnl / stats.total_risked * 100).toFixed(1)
      : '0.0';

    const openTrades = await pool.query(
      `SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY entry_time DESC`
    );

    res.render('trades', {
      page: 'trades',
      trades: trades.rows,
      openTrades: openTrades.rows,
      stats: { ...stats, roi },
      byStrategy: byStrategy.rows,
      dailyPnl: dailyPnl.rows,
      filters: { strategy, surface, tour, period, sort },
    });
  } catch (err) {
    console.error('Trades error:', err);
    res.render('trades', {
      page: 'trades',
      trades: [],
      openTrades: [],
      stats: { total: 0, wins: 0, losses: 0, total_pnl: 0, roi: '0.0' },
      byStrategy: [],
      dailyPnl: [],
      filters: {},
    });
  }
});

module.exports = router;
