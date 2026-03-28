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

        // Try v2 Elos (at_elo_current via bridge) first, fall back to v1
        const eloV2 = await pool.query(
          `SELECT e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass,
                  e.match_count, e.hard_count, e.clay_count, e.grass_count
           FROM at_player_bridge b
           JOIN at_elo_current e ON e.at_player_key = b.at_player_key
           WHERE b.sackmann_id = $1
           LIMIT 1`, [player.id]
        ).catch(() => ({ rows: [] }));

        if (eloV2.rows[0]) {
          player.elo = eloV2.rows[0];
        } else {
          // Fallback: try matching by name through bridge
          const eloByName = await pool.query(
            `SELECT e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass,
                    e.match_count, e.hard_count, e.clay_count, e.grass_count
             FROM at_player_bridge b
             JOIN at_elo_current e ON e.at_player_key = b.at_player_key
             WHERE b.at_full_name ILIKE $1 OR b.at_name ILIKE $1
             LIMIT 1`, [`%${q}%`]
          ).catch(() => ({ rows: [] }));

          if (eloByName.rows[0]) {
            player.elo = eloByName.rows[0];
          } else {
            // Last resort: old v1 table (may have bad surface Elos)
            const eloV1 = await pool.query(
              `SELECT elo_overall FROM tennis_elo_current WHERE player_id = $1`, [player.id]
            ).catch(() => ({ rows: [] }));
            if (eloV1.rows[0]) player.elo = { elo_overall: eloV1.rows[0].elo_overall };
          }
        }
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
