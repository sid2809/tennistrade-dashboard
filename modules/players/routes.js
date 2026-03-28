const express = require('express');
const router = express.Router();

/**
 * Players page
 * 
 * Routes:
 *   /players              → show most active players
 *   /players?q=Muller     → search by name, show matching players in table
 *   /players?pid=124186   → show specific player by sackmann player_id
 */

async function getEloForPlayer(pool, playerId, searchName) {
  // Try v2 Elos (at_elo_current via bridge) first
  const eloV2 = await pool.query(
    `SELECT e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass,
            e.match_count, e.hard_count, e.clay_count, e.grass_count
     FROM at_player_bridge b
     JOIN at_elo_current e ON e.at_player_key = b.at_player_key
     WHERE b.sackmann_id = $1
     LIMIT 1`, [playerId]
  ).catch(() => ({ rows: [] }));

  if (eloV2.rows[0]) return eloV2.rows[0];

  // Fallback: try matching by name through bridge
  if (searchName) {
    const eloByName = await pool.query(
      `SELECT e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass,
              e.match_count, e.hard_count, e.clay_count, e.grass_count
       FROM at_player_bridge b
       JOIN at_elo_current e ON e.at_player_key = b.at_player_key
       WHERE b.at_full_name ILIKE $1 OR b.at_name ILIKE $1
       LIMIT 1`, [`%${searchName}%`]
    ).catch(() => ({ rows: [] }));

    if (eloByName.rows[0]) return eloByName.rows[0];
  }

  // Last resort: old v1 table (overall only, surface Elos are bad)
  const eloV1 = await pool.query(
    `SELECT elo_overall FROM tennis_elo_current WHERE player_id = $1`, [playerId]
  ).catch(() => ({ rows: [] }));

  if (eloV1.rows[0]) return { elo_overall: eloV1.rows[0].elo_overall };

  return null;
}

router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  const { q, pid } = req.query;
  let player = null;
  let allSurfaces = [];
  let searchResults = [];

  try {
    if (pid) {
      // ── Direct player lookup by ID (clicked from search results) ──
      const result = await pool.query(
        `SELECT * FROM tennis_player_stats WHERE player_id = $1 ORDER BY surface`, [pid]
      );
      allSurfaces = result.rows;
      if (allSurfaces.length > 0) {
        player = { name: allSurfaces[0].player_name, id: parseInt(pid) };
        player.elo = await getEloForPlayer(pool, player.id, player.name);
      }

    } else if (q) {
      // ── Search by name ──
      // Find all distinct players matching the query in tennis_player_stats
      const matches = await pool.query(
        `SELECT DISTINCT player_id, player_name, matches_total, matches_won,
                matches_last52w, serve_hold_pct, break_rate, serve_dominance
         FROM tennis_player_stats
         WHERE player_name ILIKE $1 AND surface = 'Overall'
         ORDER BY matches_total DESC`, [`%${q}%`]
      );

      // Also search at_player_bridge for full names (handles "Alexandre Muller" vs "Muller A.")
      const bridgeMatches = await pool.query(
        `SELECT DISTINCT b.sackmann_id, b.at_full_name
         FROM at_player_bridge b
         WHERE (b.at_full_name ILIKE $1 OR b.at_name ILIKE $1)
           AND b.sackmann_id IS NOT NULL`, [`%${q}%`]
      ).catch(() => ({ rows: [] }));

      // Merge: add bridge results that aren't already in stats results
      const statsIds = new Set(matches.rows.map(r => r.player_id));
      const extraIds = bridgeMatches.rows
        .filter(r => r.sackmann_id && !statsIds.has(r.sackmann_id))
        .map(r => r.sackmann_id);

      let extraStats = [];
      if (extraIds.length > 0) {
        const extra = await pool.query(
          `SELECT DISTINCT player_id, player_name, matches_total, matches_won,
                  matches_last52w, serve_hold_pct, break_rate, serve_dominance
           FROM tennis_player_stats
           WHERE player_id = ANY($1) AND surface = 'Overall'
           ORDER BY matches_total DESC`, [extraIds]
        ).catch(() => ({ rows: [] }));
        extraStats = extra.rows || [];
      }

      searchResults = [...matches.rows, ...extraStats];

      if (searchResults.length === 1) {
        // Single match — show player card directly
        player = { name: searchResults[0].player_name, id: searchResults[0].player_id };
        const result = await pool.query(
          `SELECT * FROM tennis_player_stats WHERE player_id = $1 ORDER BY surface`, [player.id]
        );
        allSurfaces = result.rows;
        player.elo = await getEloForPlayer(pool, player.id, q);
        searchResults = []; // clear so bottom table shows default
      }
      // If multiple matches: player stays null, searchResults shown in table
    }

    // Bottom table: search results (if multiple matches) or default most active
    let topPlayers;
    if (searchResults.length > 0) {
      topPlayers = searchResults;
    } else {
      const top = await pool.query(
        `SELECT player_name, player_id, matches_total, matches_won, matches_last52w,
                serve_hold_pct, break_rate, serve_dominance
         FROM tennis_player_stats WHERE surface = 'Overall' AND matches_last52w >= 5
         ORDER BY matches_last52w DESC LIMIT 30`
      ).catch(() => ({ rows: [] }));
      topPlayers = top.rows || [];
    }

    res.render('players', {
      page: 'players',
      q: q || '',
      player,
      allSurfaces,
      topPlayers,
      multipleResults: searchResults.length > 0,
    });
  } catch (err) {
    console.error('Players error:', err);
    res.render('players', {
      page: 'players', q: q || '', player: null,
      allSurfaces: [], topPlayers: [], multipleResults: false,
    });
  }
});

module.exports = router;
