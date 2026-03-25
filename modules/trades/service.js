async function getTrades(db, filters = {}) {
  let where = ['1=1'];
  let params = [];
  let idx = 1;
  if (filters.strategy) { where.push(`strategy = $${idx++}`); params.push(filters.strategy); }
  if (filters.surface) { where.push(`surface = $${idx++}`); params.push(filters.surface); }
  if (filters.tour) { where.push(`tour = $${idx++}`); params.push(filters.tour); }
  if (filters.status) { where.push(`status = $${idx++}`); params.push(filters.status); }
  if (filters.period === 'today') where.push(`entry_time::date = CURRENT_DATE`);
  else if (filters.period === 'week') where.push(`entry_time >= NOW() - INTERVAL '7 days'`);
  else if (filters.period === 'month') where.push(`entry_time >= NOW() - INTERVAL '30 days'`);
  const result = await db.query(`SELECT * FROM paper_trades WHERE ${where.join(' AND ')} ORDER BY entry_time DESC LIMIT 100`, params);
  return result.rows;
}

async function getTradeStats(db, filters = {}) {
  let where = ['1=1']; let params = []; let idx = 1;
  if (filters.strategy) { where.push(`strategy = $${idx++}`); params.push(filters.strategy); }
  if (filters.surface) { where.push(`surface = $${idx++}`); params.push(filters.surface); }
  const result = await db.query(`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='CLOSED') as closed,
      COUNT(*) FILTER (WHERE status='OPEN') as open_count,
      COUNT(*) FILTER (WHERE pnl>0) as wins, COUNT(*) FILTER (WHERE pnl<0) as losses,
      COALESCE(SUM(pnl) FILTER (WHERE status='CLOSED'),0) as total_pnl,
      COALESCE(SUM(entry_liability),0) as total_risked,
      COALESCE(AVG(pnl) FILTER (WHERE pnl>0),0) as avg_win,
      COALESCE(AVG(pnl) FILTER (WHERE pnl<0),0) as avg_loss,
      COALESCE(MAX(pnl),0) as best_trade, COALESCE(MIN(pnl),0) as worst_trade
    FROM paper_trades WHERE ${where.join(' AND ')}`, params);
  const row = result.rows[0];
  const closed = parseInt(row.closed)||0, wins = parseInt(row.wins)||0;
  const totalPnl = parseFloat(row.total_pnl)||0, totalRisked = parseFloat(row.total_risked)||0;
  return { ...row, win_rate: closed > 0 ? ((wins/closed)*100).toFixed(1) : '0.0',
    roi: totalRisked > 0 ? ((totalPnl/totalRisked)*100).toFixed(1) : '0.0' };
}

async function getDailyPnl(db) {
  try {
    const result = await db.query(`SELECT exit_time::date as day, SUM(pnl) as daily_pnl,
      COUNT(*) as trades, COUNT(*) FILTER (WHERE pnl>0) as wins
      FROM paper_trades WHERE status='CLOSED' AND exit_time IS NOT NULL
      GROUP BY exit_time::date ORDER BY day DESC LIMIT 30`);
    return result.rows.reverse();
  } catch { return []; }
}

async function getStrategyBreakdown(db) {
  try {
    const result = await db.query(`SELECT strategy, COUNT(*) as total,
      COUNT(*) FILTER (WHERE pnl>0) as wins, COUNT(*) FILTER (WHERE pnl<0) as losses,
      COALESCE(SUM(pnl),0) as total_pnl, COALESCE(SUM(entry_liability),0) as total_risked,
      COALESCE(AVG(pnl) FILTER (WHERE pnl>0),0) as avg_win,
      COALESCE(AVG(pnl) FILTER (WHERE pnl<0),0) as avg_loss
      FROM paper_trades WHERE status='CLOSED' GROUP BY strategy ORDER BY strategy`);
    return result.rows.map(r => ({ ...r,
      win_rate: r.total > 0 ? ((r.wins/r.total)*100).toFixed(0) : '0',
      roi: r.total_risked > 0 ? ((r.total_pnl/r.total_risked)*100).toFixed(1) : '0' }));
  } catch { return []; }
}

module.exports = { getTrades, getTradeStats, getDailyPnl, getStrategyBreakdown };
