async function searchPlayers(db, query) {
  const result = await db.query(`
    SELECT DISTINCT s.player_id, s.player_name, s.matches_total, s.matches_won,
      s.matches_last52w, s.serve_hold_pct, s.break_rate, s.serve_dominance,
      s.serve_hold_pct_52w, s.break_rate_52w,
      e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass
    FROM tennis_player_stats s
    LEFT JOIN tennis_elo_current e ON s.player_id = e.player_id
    WHERE s.surface = 'Overall' AND LOWER(s.player_name) LIKE LOWER($1)
    ORDER BY s.matches_total DESC LIMIT 20`, [`%${query}%`]);
  return result.rows;
}

async function getTopPlayers(db, limit = 30) {
  const result = await db.query(`
    SELECT s.player_id, s.player_name, s.matches_total, s.matches_won,
      s.matches_last52w, s.serve_hold_pct, s.break_rate, s.serve_dominance,
      s.serve_hold_pct_52w, s.break_rate_52w,
      e.elo_overall, e.elo_hard, e.elo_clay, e.elo_grass
    FROM tennis_player_stats s
    LEFT JOIN tennis_elo_current e ON s.player_id = e.player_id
    WHERE s.surface = 'Overall' AND s.matches_last52w >= 5
    ORDER BY e.elo_overall DESC NULLS LAST LIMIT $1`, [limit]);
  return result.rows;
}

async function getPlayerCard(db, playerId) {
  const [statsR, eloR, bioR] = await Promise.all([
    db.query('SELECT * FROM tennis_player_stats WHERE player_id = $1 ORDER BY surface', [playerId]),
    db.query('SELECT * FROM tennis_elo_current WHERE player_id = $1', [playerId]),
    db.query('SELECT * FROM tennis_players WHERE player_id = $1', [playerId]),
  ]);
  if (statsR.rows.length === 0) return null;
  return {
    bio: bioR.rows[0] || {}, elo: eloR.rows[0] || {}, stats: statsR.rows,
    overall: statsR.rows.find(s => s.surface === 'Overall') || {},
    hard: statsR.rows.find(s => s.surface === 'Hard') || {},
    clay: statsR.rows.find(s => s.surface === 'Clay') || {},
    grass: statsR.rows.find(s => s.surface === 'Grass') || {},
  };
}

async function getRecentMatches(db, playerId) {
  const result = await db.query(`
    SELECT tourney_name, surface, tourney_date, round, winner_name, loser_name, score, winner_id
    FROM tennis_matches WHERE (winner_id = $1 OR loser_id = $1)
    ORDER BY tourney_date DESC LIMIT 15`, [playerId]);
  return result.rows.map(r => ({ ...r, won: r.winner_id === parseInt(playerId) }));
}

module.exports = { searchPlayers, getTopPlayers, getPlayerCard, getRecentMatches };
