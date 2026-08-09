# Migration 034 — backend match/reservation links

Status: `prepared_for_review`, `not_applied`

Runtime: `disconnected`

This package is review-only. It **must not be run** until the owner separately
approves the exact reviewed commit and the target Selectel test database.
It performs no YCLIENTS call and contains no PII, provider secret or payment
field.

## Product boundary

- A match remains valid without a booked court.
- Desired match court/time remains planning data.
- An active link requires the same owner, a non-terminal match, a D2
  `confirmed` reservation, the complete migration-033 YCLIENTS binding and the
  exact current reservation target/version.
- One match and one reservation can each have at most one active link.
- Admin move/cancellation is still discovered through the D2 exact read path;
  migration 034 adds no provider `PUT` or `DELETE`.
- Reservation cancellation releases the guarantee but does not delete or
  cancel the match.
- A terminal match must release its active link with the bounded storage reason
  `match_terminal`; this is not a provider cancellation and produces no false
  `court_cancelled` event.
- D2 `reservation_slot_holds` remains the only database court-collision
  authority. Migration 034 removes the old match overlap exclusion because an
  unbooked/planned match must not hold a court.

## Created storage

1. `backend_match.match_reservation_links`
   - append/history link state;
   - composite owner foreign keys to match and D2 reservation;
   - immutable provider appointment/record IDs, with no record hash or client
     snapshot duplication;
   - partial unique indexes for one active link per match and reservation;
   - target/version projection and optimistic versioning.
2. `backend_match.match_reservation_events`
   - immutable PII-free `court_confirmed`, `court_moved` and
     `court_cancelled` events;
   - old/current service/resource/time snapshots;
   - uniqueness by link, event type and reservation version.
   - an expected-recipient snapshot count derived from the organizer plus
     active participants under the future coordinator lock.
3. `backend_match.match_reservation_event_recipients`
   - one row per organizer or currently active participant;
   - independent unread/read lifecycle;
   - primary-key deduplication by event and recipient.

Deferred constraint triggers cover the link, match and reservation parents.
They also require the complete event recipient set before commit and reject a
recipient added later to an already complete event.
Activation, a changed target and canonical cancellation additionally require
their matching lifecycle event in the same transaction. Each move/cancellation
old target must continue the preceding immutable event's current target, so a
fabricated or broken notification chain fails closed.
Therefore a future coordinator must update the reservation projection, link
and event recipients in one PostgreSQL transaction. A stale version, ownership
mismatch, incomplete provider binding, terminal match or partial move/cancel
fails closed at commit.

## ACL boundary

- `backend_auth_app` receives only `SELECT` and narrow column-level
  `INSERT`/`UPDATE` grants.
- Link identity/provider fields cannot be updated.
- Events cannot be updated/deleted/truncated.
- Recipient rows can only move once from unread version 1 to read version 2.
- Link/event/recipient history cannot be deleted or truncated.
- Trigger functions are not executable directly by `public` or
  `backend_auth_app`.

## Future execution order (only after separate approval)

1. Confirm exact Git commit and a clean worktree.
2. Create and verify a restorable PostgreSQL backup outside the container.
3. Run `034_backend_match_reservation_links_PRECHECK.sql` read-only and require
   `ready = true`.
4. Apply `034_backend_match_reservation_links.sql` once with
   `ON_ERROR_STOP=1`.
5. Run `034_backend_match_reservation_links_POSTCHECK.sql` read-only and require
   `verified = true`, all three new tables empty and
   `runtime_connected = false`.
6. Record exact output, backup ID, database target and commit in WORKLOG before
   any repository/runtime wiring.

Do not combine migration application with backend deployment. The migration
must be verified while runtime remains disconnected.

## Rollback

`034_backend_match_reservation_links_ROLLBACK.sql` is fail-closed. It locks the
modified parent and new tables, verifies exact fingerprints, and refuses once
any link/event/recipient history exists. It contains no `CASCADE` and restores
the pre-034 relation fingerprints plus the legacy match overlap constraint.

After the first D3 history write, use a reviewed forward migration instead of
rollback. The rollback exists only for a verified storage-only application
before runtime wiring.

## Explicitly unchanged

- Nest modules, controllers, repositories and frontend;
- YCLIENTS runtime/write behavior;
- migration 033 rows and slot holds;
- payment/refund fields and policy;
- webhook, Telegram outbox, secrets and production.
