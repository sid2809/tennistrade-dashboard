const express = require('express');
const { buildNameIndex } = require('./config/nameMatch');
const path = require('path');
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── View engine ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Static assets ──
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Make db pool available to routes ──
app.locals.pool = pool;
app.use((req, res, next) => {
  req.db = pool;
  next();
});

// ── Preload name index and stats at startup ──
async function preloadCache() {
  try {
    const [playerRows, statsRows] = await Promise.all([
      pool.query(
        "SELECT p.player_id, (p.first_name || ' ' || p.last_name) AS player_name, " +
        "e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass " +
        "FROM tennis_players p JOIN tennis_elo_current e ON e.player_id = p.player_id " +
        "WHERE e.elo_overall IS NOT NULL"
      ),
      pool.query("SELECT player_id, serve_hold_pct, break_rate FROM tennis_player_stats WHERE surface = 'Overall'"),
    ]);
    const nameIndex = buildNameIndex(playerRows.rows);
    const statsMap = {};
    for (const r of statsRows.rows) statsMap[r.player_id] = r;
    app.locals.nameIndex = nameIndex;
    app.locals.statsMap = statsMap;
    console.log('  ✓ Name index built (' + playerRows.rows.length + ' players)');
    console.log('  ✓ Stats cache built (' + statsRows.rows.length + ' players)');
  } catch (err) {
    console.error('  Cache preload error:', err.message);
  }
}

// ── Ensure paper_trades tables exist ──
async function ensureTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS paper_trades (
        trade_id TEXT PRIMARY KEY, strategy TEXT, match_id TEXT,
        player1 TEXT, player2 TEXT, tournament TEXT, surface TEXT, tour TEXT,
        entry_side TEXT, entry_player TEXT, entry_odds REAL, entry_stake REAL,
        entry_liability REAL, entry_time TEXT, entry_score TEXT, entry_reason TEXT,
        exit_odds REAL, exit_stake REAL, exit_time TEXT, exit_score TEXT,
        exit_reason TEXT, exit_type TEXT, pnl REAL, pnl_pct REAL,
        status TEXT, confidence REAL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS paper_state (
        key TEXT PRIMARY KEY, value TEXT
      )
    `);
    console.log('  ✓ Tables verified');
  } catch (err) {
    console.error('  Table creation error:', err.message);
  }
}

// ── Load modules ──
app.use('/trades', require('./modules/trades/routes'));
app.use('/players', require('./modules/players/routes'));
app.use('/predictions', require('./modules/predictions/routes'));
app.use('/radar', require('./modules/radar/routes'));

// ── Home route ──
app.get('/', async (req, res) => {
  try {
    const queries = {
      totalMatches: 'SELECT COUNT(*) as c FROM tennis_matches',
      totalPlayers: 'SELECT COUNT(DISTINCT player_id) as c FROM tennis_player_stats',
      totalOdds: 'SELECT COUNT(*) as c FROM tennis_odds',
      paperTrades: `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'CLOSED') as closed,
        COUNT(*) FILTER (WHERE status = 'OPEN') as open,
        COALESCE(SUM(pnl) FILTER (WHERE status = 'CLOSED'), 0) as total_pnl,
        COUNT(*) FILTER (WHERE pnl > 0) as wins,
        COUNT(*) FILTER (WHERE pnl < 0) as losses
      FROM paper_trades`,
      recentTrades: `SELECT trade_id, strategy, player1, player2, entry_side, 
        entry_odds, exit_odds, pnl, pnl_pct, status, entry_time, exit_time,
        tournament, surface
      FROM paper_trades ORDER BY entry_time DESC LIMIT 5`,
      bankroll: `SELECT value FROM paper_state WHERE key = 'bankroll'`,
    };

    const results = {};
    for (const [key, sql] of Object.entries(queries)) {
      try {
        const r = await pool.query(sql);
        results[key] = key === 'recentTrades' ? r.rows : r.rows[0];
      } catch (e) {
        results[key] = key === 'recentTrades' ? [] : null;
      }
    }

    res.render('home', { stats: results, page: 'home' });
  } catch (err) {
    console.error('Home error:', err.message);
    res.render('home', { stats: null, page: 'home' });
  }
});

// ── Health check ──
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

// ── Start server ──
ensureTables().then(() => preloadCache()).then(() => {
  app.listen(PORT, () => {
    console.log(`TennisTrade Dashboard running on port ${PORT}`);
    console.log(`  http://localhost:${PORT}`);
  });
});
