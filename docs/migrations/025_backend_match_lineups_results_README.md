# Migration 025: backend match lineups and results

## Purpose

This storage-only migration prepares the backend-owned lifecycle for:

- a visible four-cell lineup: team 1/team 2 and left/right court side;
- atomic claiming of a free cell;
- consented changes when an occupied cell or an established pair is affected;
- locking the lineup before score submission;
- best-of-three padel score submission, confirmation, and dispute;
- idempotent lineup and result commands.

It does not add an HTTP API, change the frontend, calculate ratings, or modify
`backend_auth.player_rating_states`.

## Relations

- `backend_match.match_lineups` — one versioned lineup aggregate per match.
- `backend_match.match_lineup_assignments` — assignment history for the four
  unique cells. Partial unique indexes prevent two active players in one cell
  and one active player in two cells.
- `backend_match.match_lineup_change_requests` — one pending change proposal
  per match, bound to the lineup version on which it was created.
- `backend_match.match_lineup_change_members` — the exact before/after cell and
  approval state of every affected player. Partners whose cell does not move
  can still be included and required to approve a cross-pair change.
- `backend_match.match_lineup_commands` — immutable idempotency records for
  claim, release, proposal, response, cancellation, and lock operations.
- `backend_match.match_results` — the locked four-player snapshot, score,
  winner, and submitted/confirmed/disputed lifecycle.
- `backend_match.match_result_commands` — immutable idempotency records for
  score submission, confirmation, and dispute.

## Product invariants for the later API

The API must lock `match_lineups` first and then affected assignment/request
rows in a stable identifier order inside a short transaction.

- A player may claim only a free active cell.
- A player may move to a free cell while the lineup is `draft`.
- A free-cell move is one idempotent transaction: release the previous
  assignment, insert the new assignment, and record `move_lineup_slot`.
- An occupied cell is never overwritten directly.
- A proposed occupied-cell or cross-pair change remains unapplied until every
  member recorded in `match_lineup_change_members` has approved it.
- Applying an approved change releases the old assignment rows and inserts new
  ones; it never overwrites the historical team/side coordinates.
- A rejection, cancellation, stale base version, player leave, or match state
  change closes the proposal without changing the current lineup.
- Score submission requires four active, distinct players and locks the lineup.
- Submitted player identities and set scores are immutable; runtime UPDATE is
  limited to confirmation/dispute lifecycle fields.
- Confirmation must come from the opposite team.
- Rating calculation is intentionally deferred to a separate server-owned
  migration/API slice after confirmed results exist.

The database unique indexes are the final concurrency guard; the API must map a
unique violation caused by a simultaneous claim to a deterministic conflict,
not retry into another cell silently.

## Score contract

The stored result is best of three sets. The first two sets are required; the
third is present only when needed. A set is valid at `6:0` through `6:4`,
`7:5`, or `7:6` (and the mirrored score). The declared winner must have exactly
two won sets. A later product decision is required before supporting a match
tiebreak or another competition format.

## Runtime privileges

`backend_auth_app` receives table-level `SELECT` and explicit column-level
`INSERT`/`UPDATE` only. It receives no `DELETE`, schema `CREATE`, ownership,
rating update, or grant option. Command rows are insert-only.

## Manual rollout

Do not apply this migration automatically during application startup.

1. Create and publish a database backup.
2. Run `025_backend_match_lineups_results_PRECHECK.sql` and save its JSON.
3. Apply `025_backend_match_lineups_results.sql` manually with
   `ON_ERROR_STOP=1`.
4. Run `025_backend_match_lineups_results_POSTCHECK.sql` and save its JSON.
5. Compare the PRECHECK and POSTCHECK snapshots. Existing relation row counts
   and fingerprints must be unchanged; all seven new relations must be empty.
6. Only after a successful POSTCHECK may the backend lineup/result API be
   rolled out.

## Rollback

`025_backend_match_lineups_results_ROLLBACK.sql` acquires all seven relations
in a fixed `ACCESS EXCLUSIVE` order before checking them. It refuses rollback
if any lineup, proposal, command, or result row exists. On an unused migration
it removes only migration 025 relations and leaves migrations 020–024 intact.

Once any migration 025 row exists, use a reviewed forward migration instead of
deleting player lineup or result history.
