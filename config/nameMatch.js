/**
 * TennisTrade — Player Name Matching Utility
 * 
 * Problem: API-Tennis returns full names like "Carlos Alcaraz" or sometimes
 * "Alcaraz Carlos". Sackmann dataset (tennis_players table) stores names as
 * they appear in his CSVs — usually "Carlos Alcaraz" but with accents stripped,
 * middle initials removed, or ordering flipped for some players.
 *
 * This module provides:
 *  1. normalizeName()       — strips accents, lowercases, standardizes
 *  2. buildNameIndex()      — pre-builds a lookup map from DB player list
 *  3. findPlayerByName()    — fuzzy match API-Tennis name → DB player_id + elo
 */

// ---------------------------------------------------------------------------
// 1. Name normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a player name for comparison.
 * "Carlos Alcaraz" → "carlos alcaraz"
 * "Alcaraz, Carlos" → "carlos alcaraz"
 * "Iga Świątek" → "iga swiatek"
 */
function normalizeName(raw) {
  if (!raw) return '';

  let s = raw
    // Remove titles / seeding brackets like "(1)" or "[WC]"
    .replace(/\s*[\[(][^\])]*[\])]/g, '')
    // Normalize accented characters (NFD decompose, strip combining marks)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Handle "Lastname, Firstname" format
    .replace(/^([^,]+),\s*(.+)$/, '$2 $1')
    .trim()
    .toLowerCase()
    // Collapse multiple spaces
    .replace(/-/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ');

  return s;
}

/**
 * Extract tokens (firstname, lastname) from a normalized name.
 * Used for partial matching when full-name join fails.
 */
function nameTokens(normalized) {
  const parts = normalized.split(' ').filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts[parts.length - 1] || '',
    all: parts,
  };
}

// ---------------------------------------------------------------------------
// 2. Index builder
// ---------------------------------------------------------------------------

/**
 * Build a lookup index from a list of DB rows.
 *
 * Input: array of { player_id, player_name, elo_overall, elo_hard, elo_clay, elo_grass }
 * Returns: { byFullName: Map, byLastName: Map }
 *
 * Call once at startup or route init; cache the result.
 */
function buildNameIndex(playerRows) {
  const byFullName = new Map();  // normalized full name → row
  const byLastName = new Map();  // normalized last name  → [ row, ... ]

  for (const row of playerRows) {
    const norm = normalizeName(row.player_name);
    byFullName.set(norm, row);

    const { last } = nameTokens(norm);
    if (last) {
      if (!byLastName.has(last)) byLastName.set(last, []);
      byLastName.get(last).push({ norm, row });
    }
  }

  return { byFullName, byLastName };
}

// ---------------------------------------------------------------------------
// 3. Fuzzy match
// ---------------------------------------------------------------------------

/**
 * Simple Levenshtein distance (for short strings / names).
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

/**
 * Find the best matching player row for a given API-Tennis player name.
 *
 * Strategy (in order of confidence):
 *  1. Exact normalized full-name match  → confidence: "exact"
 *  2. Last-name match + first-initial match → confidence: "high"
 *  3. Last-name-only match (unique)     → confidence: "medium"
 *  4. Levenshtein ≤ 2 on full name      → confidence: "fuzzy"
 *  5. No match                          → null
 *
 * @param {string} apiName — player name from API-Tennis
 * @param {{ byFullName: Map, byLastName: Map }} index — from buildNameIndex()
 * @returns {{ row, confidence } | null}
 */
function findPlayerByName(apiName, index) {
  const norm = normalizeName(apiName);
  if (!norm) return null;

  // 1. Exact
  if (index.byFullName.has(norm)) {
    return { row: index.byFullName.get(norm), confidence: 'exact' };
  }

  const { first, last } = nameTokens(norm);

  // 2. Last name + first initial
  const lastMatches = index.byLastName.get(last) || [];
  const initialMatches = lastMatches.filter(({ norm: n }) => {
    const { first: dbFirst } = nameTokens(n);
    return first && dbFirst && dbFirst[0] === first[0];
  });
  if (initialMatches.length === 1) {
    return { row: initialMatches[0].row, confidence: 'high' };
  }
  // Multiple initial matches — pick shortest Levenshtein
  if (initialMatches.length > 1) {
    let best = null, bestDist = Infinity;
    for (const { norm: n, row } of initialMatches) {
      const d = levenshtein(norm, n);
      if (d < bestDist) { bestDist = d; best = row; }
    }
    return { row: best, confidence: bestDist <= 2 ? 'high' : 'medium' };
  }

  // 3. Last name only (unique)
  if (lastMatches.length === 1) {
    return { row: lastMatches[0].row, confidence: 'medium' };
  }

  // 4. Full-name Levenshtein scan (capped at 3 edits)
  let bestRow = null, bestDist = 3;
  for (const [key, row] of index.byFullName) {
    const d = levenshtein(norm, key);
    if (d < bestDist) { bestDist = d; bestRow = row; }
  }
  if (bestRow) {
    return { row: bestRow, confidence: 'fuzzy' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 4. IST time helpers  (bonus — keep all time logic in one place)
// ---------------------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30

/**
 * Convert a UTC date string / Date object to IST.
 * Returns a JS Date whose .getHours() etc. reflect IST.
 * (Note: JS Dates are always UTC-based; this shifts the epoch value.)
 */
function toIST(utcInput) {
  const d = utcInput instanceof Date ? utcInput : new Date(utcInput);
  return new Date(d.getTime() + IST_OFFSET_MS);
}

/**
 * Format a UTC time string as human-readable IST.
 * "2026-03-26T07:30:00Z"  →  "1:00 PM IST"
 * Pass null/undefined     →  "TBD"
 */
function formatIST(utcInput, opts = {}) {
  if (!utcInput) return 'TBD';
  try {
    const ist = toIST(utcInput);
    const h = ist.getUTCHours();
    const m = ist.getUTCMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const mm = String(m).padStart(2, '0');
    return opts.date
      ? `${ist.getUTCDate()}/${ist.getUTCMonth()+1} ${h12}:${mm} ${ampm} IST`
      : `${h12}:${mm} ${ampm} IST`;
  } catch {
    return 'TBD';
  }
}

module.exports = { normalizeName, buildNameIndex, findPlayerByName, toIST, formatIST };
