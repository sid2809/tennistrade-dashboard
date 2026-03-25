const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  const { q } = req.query;
  let player = null;
  let allSurfaces = [];

  try {
    if (q) {
      const result = await pool.query(
        `SELECT * FROM tennis_player_stats WHERE player_name ILIKE $1 ORDER BY surface`, [`%${q}%`]
      );
      allSurfaces = result.rows;
      if (allSurfaces.length > 0) {
        player = { name: allSurfaces[0].player_name, id: allSurfaces[0].player_id };
        const elo = await pool.query(
          `SELECT * FROM tennis_elo_current WHERE player_id = $1`, [player.id]
        ).catch(() => ({ rows: [] }));
        if (elo.rows[0]) player.elo = elo.rows[0];
      }
    }
    const top = await pool.query(
      `SELECT player_name, matches_total, matches_won, matches_last52w, serve_hold_pct, break_rate, serve_dominance
       FROM tennis_player_stats WHERE surface = 'Overall' AND matches_last52w >= 5
       ORDER BY matches_last52w DESC LIMIT 30`
    ).catch(() => ({ rows: [] }));
    res.render('players', { page: 'players', q: q || '', player, allSurfaces, topPlayers: top.rows });
  } catch (err) {
    console.error('Players error:', err);
    res.render('players', { page: 'players', q: q || '', player: null, allSurfaces: [], topPlayers: [] });
  }
});
module.exports = router;
