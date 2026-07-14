// Pure rating engine: ELO for doubles, level lookup, inactivity decay.
// History format: [{ date: ms, rating: number, change: number, opponentLevel: string|null, reason?: string }]

export const RATING_CONFIG = {
  levels: [
    { min: 0,    max: 1.50,  label: 'D',  color: 'rgba(245,241,232,0.62)' },
    { min: 1.51, max: 2.20,  label: 'D+', color: 'rgba(245,241,232,0.72)' },
    { min: 2.21, max: 3.20,  label: 'C',  color: '#D8F34A' },
    { min: 3.21, max: 5.00,  label: 'C+', color: '#D8F34A' },
    { min: 5.01, max: 6.50,  label: 'B',  color: '#FF6F61' },
    { min: 6.51, max: 7.50,  label: 'B+', color: '#FF6F61' },
    { min: 7.51, max: 10.00, label: 'A',  color: '#D8F34A' },
  ],
  decayPerDay:         0.01,
  inactivityThreshold: 14, // days
};

export const START_RATING = 3.0;
export const MAX_RATING   = 10.0;
export const MIN_RATING   = 0.0;
export const HISTORY_KEY  = 'dp_rating_history';

const DAY_MS = 24 * 60 * 60 * 1000;

const round3 = (n) => Math.round(n * 1000) / 1000;
const clamp  = (n, min, max) => Math.max(min, Math.min(max, n));

// ─── Level lookup ─────────────────────────────────────────────────────────────

export function getLevelForRating(rating) {
  for (const lvl of RATING_CONFIG.levels) {
    if (rating <= lvl.max) return lvl;
  }
  return RATING_CONFIG.levels[RATING_CONFIG.levels.length - 1];
}

export function getNextLevelInfo(rating) {
  const current = getLevelForRating(rating);
  const idx = RATING_CONFIG.levels.indexOf(current);
  const next = RATING_CONFIG.levels[idx + 1];
  if (!next) return null;
  return {
    nextLabel:  next.label,
    nextColor:  next.color,
    pointsToGo: round3(Math.max(0, next.min - rating)),
  };
}

// ─── ELO for doubles ──────────────────────────────────────────────────────────

/**
 * @param {[number, number]} team1Ratings
 * @param {[number, number]} team2Ratings
 * @param {boolean} isTeam1Win
 * @param {number} playerMatchCount  matches played by the player whose K-factor we apply
 * @returns {{ team1Delta: number, team2Delta: number }}  deltas per player on each team
 */
export function calculateRatingChange(team1Ratings, team2Ratings, isTeam1Win, playerMatchCount = 0) {
  const r1 = (team1Ratings[0] + team1Ratings[1]) / 2;
  const r2 = (team2Ratings[0] + team2Ratings[1]) / 2;
  const E1 = 1 / (1 + Math.pow(10, (r2 - r1) / 4));
  const outcome = isTeam1Win ? 1 : 0;
  const K = playerMatchCount < 10 ? 0.4 : 0.1;
  const delta = K * (outcome - E1);
  return {
    team1Delta: round3(delta),
    team2Delta: round3(-delta),
  };
}

// ─── Inactivity decay ─────────────────────────────────────────────────────────

/**
 * Pure: returns updated history with a single decay entry appended if inactive long enough.
 * @param {Array} history
 * @param {number} now  current ms timestamp
 * @returns {{ history: Array, didDecay: boolean }}
 */
export function applyInactivityDecay(history, now = Date.now()) {
  if (!Array.isArray(history) || history.length === 0) {
    return { history: history || [], didDecay: false };
  }
  const last = history[history.length - 1];
  const daysSince = Math.floor((now - last.date) / DAY_MS);
  const inactiveDays = daysSince - RATING_CONFIG.inactivityThreshold;
  if (inactiveDays <= 0) return { history, didDecay: false };

  const decayAmount = inactiveDays * RATING_CONFIG.decayPerDay;
  const newRating   = clamp(last.rating - decayAmount, MIN_RATING, MAX_RATING);
  const entry = {
    date:          now,
    rating:        round3(newRating),
    change:        round3(newRating - last.rating),
    opponentLevel: null,
    reason:        'inactivity',
  };
  return { history: [...history, entry], didDecay: true };
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function isOldFormat(history) {
  if (!Array.isArray(history) || history.length === 0) return false;
  const first = history[0];
  return first && 'ts' in first && 'value' in first && !('rating' in first);
}

// TODO: Replace with real match-completion deltas. For now, mock a 25-day random walk.
function seedHistory() {
  const now = Date.now();
  const out = [];
  let rating = START_RATING;
  let prev   = rating;
  for (let i = 24; i >= 0; i--) {
    const date = now - i * DAY_MS;
    const change = i === 24 ? 0 : round3(rating - prev);
    out.push({
      date,
      rating: round3(rating),
      change,
      opponentLevel: null,
    });
    prev = rating;
    const delta = Math.random() < 0.58 ? 0.012 : -0.012;
    rating = clamp(rating + delta, 1.0, 7.99);
  }
  return out;
}

/**
 * Loads history from localStorage. Migrates old format and applies inactivity decay.
 * Persists any changes back to storage. Returns up-to-date history.
 */
export function loadHistory() {
  let history = null;
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (stored) history = JSON.parse(stored);
  } catch {}

  if (!Array.isArray(history) || history.length === 0 || isOldFormat(history)) {
    history = seedHistory();
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
    return history;
  }

  const { history: decayed, didDecay } = applyInactivityDecay(history);
  if (didDecay) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(decayed)); } catch {}
    return decayed;
  }
  return history;
}

export function getCurrentRating() {
  const h = loadHistory();
  return h.length > 0 ? h[h.length - 1].rating : START_RATING;
}
