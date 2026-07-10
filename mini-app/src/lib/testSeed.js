// Test data for Rating Engine validation: 3 bots + match simulation.
// Bots persist in localStorage; their ratings update after each finished match.

import {
  calculateRatingChange,
  getLevelForRating,
  HISTORY_KEY,
  MAX_RATING,
  MIN_RATING,
} from './ratingEngine';

const BOTS_KEY = 'dp_test_bots';
const RATINGS  = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];

const round3 = (n)         => Math.round(n * 1000) / 1000;
const clamp  = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ratingToIdx = (r)    => Math.max(0, RATINGS.indexOf(getLevelForRating(r).label));

const DEFAULT_BOTS = [
  { id: 'bot_pro', firstName: 'Мастер',     lastName: 'Падела',   numericRating: 6.2 },
  { id: 'bot_avg', firstName: 'Стабильный', lastName: 'Любитель', numericRating: 3.1 },
  { id: 'bot_beg', firstName: 'Новичок',    lastName: '',         numericRating: 1.8 },
];

const enrich = (b) => ({
  ...b,
  ratingIdx:  ratingToIdx(b.numericRating),
  isVerified: true,
  isBot:      true,
  matchCount: 0,
});

export const DEFAULT_USER = {
  id: 'me',
  firstName: 'Гор',
  lastName: 'Бахшян',
  rating: 3.0,
  isBot: false,
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function seedTestPlayers() {
  try {
    const stored = localStorage.getItem(BOTS_KEY);
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.length === DEFAULT_BOTS.length) return arr;
    }
  } catch {}
  const seeded = DEFAULT_BOTS.map(enrich);
  try { localStorage.setItem(BOTS_KEY, JSON.stringify(seeded)); } catch {}
  return seeded;
}

export function getTestBots() {
  try {
    const stored = localStorage.getItem(BOTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return seedTestPlayers();
}

export function getAvailableBots(usedIds = []) {
  return getTestBots().filter(b => !usedIds.includes(b.id));
}

function saveBots(bots) {
  try { localStorage.setItem(BOTS_KEY, JSON.stringify(bots)); } catch {}
}

/**
 * Apply ELO deltas with manually-chosen teams and an explicit outcome.
 *
 * SOURCE-OF-TRUTH: rating numbers are persisted (per-player numericRating).
 * For the human — appended to dp_rating_history (auxiliary chart log; matchId
 * embedded so a chart point can navigate to the match in allMatches).
 * For bots — written to dp_test_bots.
 *
 * Per-match record (pairs, score, ratingChanges) lives on the match object
 * itself in allMatches, NOT in any per-user history blob.
 *
 * @param {Array}   team1Players  exactly 2 player objects
 * @param {Array}   team2Players  exactly 2 player objects
 * @param {boolean} isTeam1Win
 * @param {string|number} [matchId]  attached to the user's history entry for future chart→match lookups
 */
export function applyMatchOutcome(team1Players, team2Players, isTeam1Win, matchId = null) {
  if (!Array.isArray(team1Players) || team1Players.length !== 2 ||
      !Array.isArray(team2Players) || team2Players.length !== 2) {
    return { userDelta: 0, ratingChanges: {} };
  }

  let userRating = 3.0;
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (stored) {
      const h = JSON.parse(stored);
      if (Array.isArray(h) && h.length) userRating = h[h.length - 1].rating;
    }
  } catch {}

  const ratingFor = (p) => (p?.isBot ? p.numericRating : userRating);
  const t1Ratings = team1Players.map(ratingFor);
  const t2Ratings = team2Players.map(ratingFor);

  const t1Deltas = team1Players.map(p => {
    const mc = p?.isBot ? (p.matchCount ?? 0) : 0;
    return calculateRatingChange(t1Ratings, t2Ratings, isTeam1Win, mc).team1Delta;
  });
  const t2Deltas = team2Players.map(p => {
    const mc = p?.isBot ? (p.matchCount ?? 0) : 0;
    return calculateRatingChange(t1Ratings, t2Ratings, isTeam1Win, mc).team2Delta;
  });

  const ratingChanges = {};

  // Bot updates → dp_test_bots, recorded in ratingChanges
  const bots = getTestBots();
  const updateBot = (p, delta) => {
    if (!p?.isBot) return;
    const idx = bots.findIndex(b => b.id === p.id);
    if (idx < 0) return;
    const before    = bots[idx].numericRating;
    const after     = round3(clamp(before + delta, MIN_RATING, MAX_RATING));
    bots[idx] = {
      ...bots[idx],
      numericRating: after,
      ratingIdx:  ratingToIdx(after),
      matchCount: (bots[idx].matchCount ?? 0) + 1,
    };
    ratingChanges[p.id] = { before: round3(before), after, delta: round3(delta) };
  };
  team1Players.forEach((p, i) => updateBot(p, t1Deltas[i]));
  team2Players.forEach((p, i) => updateBot(p, t2Deltas[i]));
  saveBots(bots);

  // Human update → dp_rating_history (chart) + ratingChanges['me']
  const userInT1 = team1Players.findIndex(p => p && !p.isBot);
  const userInT2 = team2Players.findIndex(p => p && !p.isBot);
  let userDelta  = 0;
  if (userInT1 >= 0) userDelta = t1Deltas[userInT1];
  else if (userInT2 >= 0) userDelta = t2Deltas[userInT2];

  if (userInT1 >= 0 || userInT2 >= 0) {
    const before     = userRating;
    const after      = round3(clamp(before + userDelta, MIN_RATING, MAX_RATING));
    const oppRatings = userInT1 >= 0 ? t2Ratings : t1Ratings;
    const oppAvg     = (oppRatings[0] + oppRatings[1]) / 2;
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      const h      = stored ? JSON.parse(stored) : [];
      h.push({
        date:          Date.now(),
        rating:        after,
        change:        round3(userDelta),
        opponentLevel: getLevelForRating(oppAvg).label,
        matchId,
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    } catch {}
    ratingChanges['me'] = { before: round3(before), after, delta: round3(userDelta) };
  }

  return { userDelta: round3(userDelta), ratingChanges };
}
