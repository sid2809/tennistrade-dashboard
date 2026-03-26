const https = require('https');
const http = require('http');

const API_KEY = process.env.API_TENNIS_KEY || '';
const BASE_URL = 'https://api.api-tennis.com/tennis/';

// Cache API responses for 30 minutes
const _cache = {};
function getCached(key) {
  const c = _cache[key];
  if (c && Date.now() - c.ts < 30 * 60 * 1000) return c.data;
  return null;
}
function setCache(key, data) { _cache[key] = { data, ts: Date.now() }; }

function fetch(params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ APIkey: API_KEY, ...params }).toString();
    const url = `${BASE_URL}?${qs}`;

    https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('JSON parse error'));
        }
      });
    }).on('error', reject);
  });
}

// Get today's pre-match odds from multiple bookmakers
async function getTodaysOdds(date) {
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const cacheKey = 'odds_' + dateStr;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const data = await fetch({
    method: 'get_odds',
    date_start: dateStr,
    date_stop: dateStr,
  });

  if (!data.success || !data.result) return [];

  const result = data.result;
  const matches = [];

  // Result is an object keyed by event_key
  if (typeof result === 'object' && !Array.isArray(result)) {
    for (const [eventKey, markets] of Object.entries(result)) {
      if (typeof markets !== 'object') continue;

      // Extract match winner odds from "Home/Away" market
      const homeAway = markets['Home/Away'];
      let oddsP1 = null, oddsP2 = null;

      if (homeAway) {
        const home = homeAway.Home || {};
        const away = homeAway.Away || {};

        // Pick best odds: Pinnacle > Bet365 > Betfair > first available
        oddsP1 = parseFloat(home.Pncl || home.bet365 || home.Betfair || home['1xBet'] || Object.values(home)[0]) || null;
        oddsP2 = parseFloat(away.Pncl || away.bet365 || away.Betfair || away['1xBet'] || Object.values(away)[0]) || null;
      }

      // First set odds
      const firstSet = markets['Home/Away (1st Set)'];
      let setOddsP1 = null, setOddsP2 = null;
      if (firstSet) {
        const home = firstSet.Home || {};
        const away = firstSet.Away || {};
        setOddsP1 = parseFloat(home.Pncl || home.bet365 || Object.values(home)[0]) || null;
        setOddsP2 = parseFloat(away.Pncl || away.bet365 || Object.values(away)[0]) || null;
      }

      matches.push({
        event_key: eventKey,
        odds_p1: oddsP1,
        odds_p2: oddsP2,
        set_odds_p1: setOddsP1,
        set_odds_p2: setOddsP2,
        markets: Object.keys(markets),
        all_bookmakers: homeAway ? { home: homeAway.Home, away: homeAway.Away } : null,
      });
    }
  }

  setCache(cacheKey, matches);
  return matches;
}

// Get today's scheduled events (matches) with player names
async function getTodaysEvents(date) {
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const cacheKey = 'events_' + dateStr;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const data = await fetch({
    method: 'get_fixtures',
    date_start: dateStr,
    date_stop: dateStr,
  });

  if (!data.success || !data.result) return [];

  let events = data.result;
  if (typeof events === 'object' && !Array.isArray(events)) {
    events = Object.values(events);
  }

  const result = events.map(e => ({
    event_key: String(e.event_key || ''),
    player1: e.event_first_player || '',
    player2: e.event_second_player || '',
    tournament: e.tournament_name || '',
    round: e.tournament_round || e.event_round || '',
    time: e.event_time || '',
    date: e.event_date || dateStr,
    type: e.event_type_type || '',
    status: e.event_status || 'Not started',
    surface: detectSurface(e.tournament_name || ''),
    tour: detectTour(e.event_type_type || ''),
  }));
  setCache(cacheKey, result);
  return result;
}

// Get live matches
async function getLiveMatches() {
  const data = await fetch({ method: 'get_livescore' });

  if (!data.success || !data.result) return [];

  let matches = data.result;
  if (typeof matches === 'object' && !Array.isArray(matches)) {
    matches = Object.values(matches);
  }

  return matches.map(m => ({
    event_key: String(m.event_key || ''),
    player1: m.event_first_player || '',
    player2: m.event_second_player || '',
    tournament: m.tournament_name || '',
    status: m.event_status || '',
    serving: m.event_serve || '',
    game_score: m.event_game_result || '',
    type: m.event_type_type || '',
    scores: m.scores || [],
    live_odds: m.live_odds || [],
    statistics: m.statistics || [],
    pointbypoint: m.pointbypoint || [],
    surface: detectSurface(m.tournament_name || ''),
    tour: detectTour(m.event_type_type || ''),
  }));
}

function detectSurface(tournament) {
  const t = tournament.toLowerCase();
  const clay = ['roland garros', 'french open', 'madrid', 'rome', 'monte carlo',
    'barcelona', 'buenos aires', 'rio', 'hamburg', 'bastad', 'umag', 'gstaad',
    'kitzbuhel', 'clay'];
  const grass = ['wimbledon', 'halle', 'queen', 'eastbourne', 'newport',
    'mallorca', 'stuttgart grass', 'grass'];
  for (const kw of clay) if (t.includes(kw)) return 'Clay';
  for (const kw of grass) if (t.includes(kw)) return 'Grass';
  return 'Hard';
}

function detectTour(eventType) {
  const t = (eventType || '').toLowerCase();
  if (t.includes('wta')) return 'WTA';
  if (t.includes('atp')) return 'ATP';
  if (t.includes('itf women') || t.includes('w15') || t.includes('w25') ||
      t.includes('w35') || t.includes('w50') || t.includes('w75') || t.includes('w100')) return 'WTA-ITF';
  if (t.includes('itf men') || t.includes('m15') || t.includes('m25')) return 'ATP-ITF';
  if (t.includes('challenger')) return 'Challenger';
  return 'Other';
}

module.exports = {
  getTodaysOdds,
  getTodaysEvents,
  getLiveMatches,
};
