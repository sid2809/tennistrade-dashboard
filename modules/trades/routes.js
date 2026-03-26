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

    const openTrades = await pool.query(
      'SELECT * FROM paper_trades WHERE status = $1 ORDER BY entry_time DESC',
      ['OPEN']
    );

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

    res.render('trades', {
      page: 'trades',
      openTrades: openTrades.rows,
      trades: trades.rows,
      stats: { ...stats, roi },
      byStrategy: byStrategy.rows,
      dailyPnl: dailyPnl.rows,
      filters: { strategy, surface, tour, period, sort },
    });
  } catch (err) {
    console.error('Trades error:', err);
    res.render('trades', {
      page: 'trades',
      openTrades: [],
      trades: [],
      stats: { total: 0, wins: 0, losses: 0, total_pnl: 0, roi: '0.0' },
      byStrategy: [],
      dailyPnl: [],
      filters: {},
    });
  }
});

// Log a new paper trade from predictions page
router.post('/log', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const { player1, player2, tournament, surface, tour, bet_on, bet_odds, edge, elo_prob, strategy, stake } = req.body;
    const stakeNum = parseFloat(stake) || 500;
    const oddsNum = parseFloat(bet_odds) || 0;
    const liability = stakeNum; // for value bets, stake = liability
    const tradeId = 'T' + Date.now();
    const entryTime = new Date().toISOString();

    await pool.query(
      `INSERT INTO paper_trades
        (trade_id, strategy, player1, player2, tournament, surface, tour,
         entry_side, entry_player, entry_odds, entry_stake, entry_liability,
         entry_time, entry_reason, status, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [tradeId, strategy || 'T6', player1, player2, tournament, surface, tour,
       'BACK', bet_on, oddsNum, stakeNum, liability,
       entryTime, 'Edge: ' + edge + '% | Model: ' + elo_prob + '%',
       'OPEN', parseFloat(edge) || 0]
    );
    res.redirect('/trades?logged=' + tradeId);
  } catch (err) {
    console.error('Log trade error:', err.message);
    res.redirect('/predictions?error=log_failed');
  }
});

// Close a trade with result
router.post('/:id/close', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const { id } = req.params;
    const { result } = req.body; // 'win' or 'loss'

    const t = await pool.query('SELECT * FROM paper_trades WHERE trade_id = $1', [id]);
    if (!t.rows.length) return res.redirect('/trades?error=not_found');

    const trade = t.rows[0];
    const stake = parseFloat(trade.entry_stake) || 0;
    const odds = parseFloat(trade.entry_odds) || 0;
    const pnl = result === 'win' ? parseFloat((stake * (odds - 1)).toFixed(2)) : -stake;
    const pnlPct = stake > 0 ? parseFloat(((pnl / stake) * 100).toFixed(1)) : 0;
    const exitTime = new Date().toISOString();

    await pool.query(
      `UPDATE paper_trades SET
        status = 'CLOSED', pnl = $1, pnl_pct = $2,
        exit_time = $3, exit_reason = $4, exit_type = $5
       WHERE trade_id = $6`,
      [pnl, pnlPct, exitTime, result === 'win' ? 'Won' : 'Lost', result.toUpperCase(), id]
    );
    res.redirect('/trades');
  } catch (err) {
    console.error('Close trade error:', err.message);
    res.redirect('/trades?error=close_failed');
  }
});

module.exports = router;
