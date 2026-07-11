// Canonical shape of domain objects in this app.
// Single source of truth — when in doubt about a field, look here first.
//
// We don't do runtime validation (no Zod/Yup) — JSDoc + readable constants
// are enough for an MVP. The localStorage keys this app writes to:
//   matches             -> Match[]               (status lifecycle, filledSlots, ratingChanges)
//   dp_test_bots        → Player[] (isBot=true) (bots' rolling rating + matchCount)
//   dp_rating_history   → RatingHistoryEntry[]  (auxiliary chart log; matchId links to a Match)
//   dp_firstName / dp_lastName / dp_preferredSide → free-form profile bits

// ─── Constants ───────────────────────────────────────────────────────────────

export const ME_ID = 'me';

export const RATING_LEVELS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];

export const MATCH_STATUS = Object.freeze({
  OPEN:      'open',       // free slots, visible in MatchFeed for everyone
  UPCOMING:  'upcoming',   // 4 slots taken, visible only to participants
  COMPLETED: 'completed',  // rated and recorded, visible only to participants in History
});

export const COURT_TYPES = Object.freeze({
  PANORAMIC: 'panoramic',
});

// ─── JSDoc typedefs ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} Player
 * @property {string}  [id]           'me' for the human user, 'bot_pro' / 'bot_avg' / 'bot_beg' for bots, undefined for anonymous "+1" guests
 * @property {string}  firstName
 * @property {string}  [lastName]
 * @property {number}  [ratingIdx]    0..6 index into RATING_LEVELS — drives rating-range UI
 * @property {number}  [rating]       float 0..10. Bots persist this; the human's live rating lives in dp_rating_history
 * @property {boolean} [isVerified]
 * @property {boolean} [isOrganizer]  true on the slot belonging to the match owner
 * @property {boolean} [isBot]        true only for test bots
 * @property {number}  [matchCount]   bots only — drives ELO K-factor (K=0.4 first 10 matches, K=0.1 after)
 */

/**
 * @typedef {Object} SetScore
 * @property {number} t1   games won by Team 1 in this set
 * @property {number} t2   games won by Team 2 in this set
 */

/**
 * @typedef {Object} RatingChange
 * @property {number} before
 * @property {number} after
 * @property {number} delta
 */

/**
 * Lifecycle states. Transitions:
 *   open → upcoming   when filledSlots.length reaches 4
 *   upcoming → open   when a participant is removed (kick) and count drops below 4
 *   * → completed     when handleCompleteMatch fires with score + ratingChanges
 *
 * @typedef {('open' | 'upcoming' | 'completed')} MatchStatus
 */

/**
 * @typedef {Object} Match
 * @property {number}        id                  Date.now() at creation
 * @property {number}        ownerId             id of the user who created it (currently 1 = the device's human user)
 * @property {{name: string}} host
 * @property {string}        date                human-readable, e.g. "12 января"
 * @property {string}        [dateISO]           '2026-05-10' — used by BookingCalendar to place the match in a day grid
 * @property {string}        time                "HH:MM"
 * @property {number}        duration            hours, e.g. 1.5
 * @property {string}        [courtId]           e.g. 'p3' / 's2'. Required for BookingCalendar visibility
 * @property {string}        [courtName]         display label, e.g. "Корт 3"
 * @property {'panoramic'} courtType
 * @property {boolean}       isPrime
 * @property {number}        ratingMin           0..6
 * @property {number}        ratingMax           0..6
 * @property {string}        scenario            'social' | 'community' | 'private'
 * @property {boolean}       [isRatingMatch]     true only when the match should affect club rating
 * @property {('none'|'pending_confirmation'|'confirmed'|'disputed')} [scoreStatus]
 * @property {string}        [scoreSubmittedBy]
 * @property {string}        [scoreConfirmedBy]
 * @property {string}        [scoreDisputedBy]
 * @property {MatchStatus}   status
 * @property {boolean}       [isPrivate]         true = private booking (not in public feed, not searching for partners)
 * @property {('partial'|'full')} [paymentStatus]  'partial' = 25% paid (open match); 'full' = 100% paid (private)
 * @property {Player[]}      filledSlots         length 0..4; nulls are not stored
 * @property {string[]}      participants        ids of players in filledSlots (anonymous guests excluded)
 *
 * Set on completion:
 * @property {number}        [completedAt]       ms timestamp
 * @property {SetScore[]}    [finalScore]        3 sets; unplayed sets have t1=t2=0
 * @property {boolean}       [isTeam1Win]
 * @property {Player[]}      [team1]             length 2
 * @property {Player[]}      [team2]             length 2
 * @property {Object<string, RatingChange>} [ratingChanges]   keyed by player id ('me' or bot id)
 */

/**
 * @typedef {Object} RatingHistoryEntry  Stored in dp_rating_history (used by RatingChart).
 * @property {number}  date                ms timestamp
 * @property {number}  rating              snapshot of the user's rating after this event
 * @property {number}  change              delta from the previous entry
 * @property {string}  [opponentLevel]     average level of the opposing team for that match
 * @property {string}  [reason]            'inactivity' for decay entries
 * @property {(string|number|null)} [matchId]  links back to a Match in allMatches (for chart→match navigation)
 */

// ─── Readable shape map (for code review / AI assistants) ────────────────────
// Not used at runtime. Keep in sync with the JSDoc above.

export const SCHEMAS = Object.freeze({
  Player: {
    id:          'string?      // ME_ID for human, bot_* for bots, absent for guests',
    firstName:   'string',
    lastName:    'string?',
    ratingIdx:   'number?      // 0..6',
    rating:      'number?      // 0..10 (bots only)',
    isVerified:  'boolean?',
    isOrganizer: 'boolean?',
    isBot:       'boolean?',
    matchCount:  'number?',
  },
  Match: {
    id:            'number',
    ownerId:       'number',
    status:        "'open' | 'upcoming' | 'completed'",
    courtId:       'string?     // e.g. p3 / s2 — required for BookingCalendar slot occupancy',
    courtName:     'string?',
    dateISO:       'string?     // 2026-05-10',
    isPrivate:     'boolean?    // true = private booking, not in public feed',
    paymentStatus: "'partial' | 'full' | undefined  // partial=25% paid, full=100%",
    filledSlots:   'Player[]',
    participants:  'string[]',
    finalScore:    'SetScore[]?',
    team1:         'Player[]?',
    team2:         'Player[]?',
    isTeam1Win:    'boolean?',
    ratingChanges: '{ [playerId]: { before, after, delta } }?',
    isRatingMatch:  'boolean?',
    scoreStatus:    "'none' | 'pending_confirmation' | 'confirmed' | 'disputed'?",
    scoreSubmittedBy: 'string?',
    scoreConfirmedBy: 'string?',
    scoreDisputedBy:  'string?',
    completedAt:   'number?',
  },
  SetScore: {
    t1: 'number',
    t2: 'number',
  },
  RatingHistoryEntry: {
    date:          'number',
    rating:        'number',
    change:        'number',
    opponentLevel: 'string?',
    reason:        "'inactivity'?",
    matchId:       '(string | number | null)?',
  },
});
