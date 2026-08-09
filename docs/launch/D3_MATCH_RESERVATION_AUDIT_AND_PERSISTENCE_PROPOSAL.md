# D3 Match ↔ Reservation — audit and persistence proposal

Status: `migration_review_checkpoint_prepared`

SQL/migration: `034 prepared_for_review`, `not_applied`

Runtime wiring: `not_started`; the pure domain files are not imported by Nest

## Scope and fixed product rules

- A match may exist without a booked court.
- A selected date, time or desired court is planning data, not booking proof.
- A court is confirmed only when the linked D2 reservation is `confirmed` and
  has the complete persisted YCLIENTS binding.
- App-originated YCLIENTS cancel/reschedule remains forbidden. Those actions
  are performed by a club administrator.
- Canonical admin move/cancellation is reflected only through the existing D2
  exact read path. `unknown` or stale reads do not change the match guarantee.
- Cancellation of the reservation does not delete the match.
- Payment fields and payment truth are outside D3.

## Current implementation

### Backend matches

- `POST /matches` creates `community`, `social` and direct API `private`
  records. `social` is created with match status `confirmed`; `private` is
  created with `upcoming`. Neither path reads or links a D2 reservation.
- Match persistence requires non-empty `court_id`, `court_name` and
  `court_type`. A community match without a selected court receives a synthetic
  `unassigned:<matchId>` court.
- `matches_no_active_court_overlap` treats `open`, `searching`, `confirmed` and
  `upcoming` match rows as court holds. Thus a desired court in an unbooked
  match can block another match even though YCLIENTS has no booking.
- Backend match routes implement create, public/mine feed, detail, join, leave
  and description update. There is no backend match cancellation, owner
  participant removal, private ↔ public conversion or training command.
- Public feed already requires `visibility = public` and `kind = match`.
  Backend/D2 private reservations are not read from this repository.

### Frontend matches

- `getMatchBookingStatus` currently infers a booked court from any of:
  `scenario = social`, a private scenario, legacy booked flags/statuses or
  `paymentStatus = full`. None is canonical D2 reservation proof.
- Match creation describes `social` as guaranteed/reserved, submits status
  `confirmed`, and populates legacy `ownerPaid`/`holdAmount`, although the
  backend match request only creates a match.
- Cards, feed filters and match details all consume this inferred booking
  status, so the same false guarantee is repeated in several screens.
- Backend-owned match cancellation and participant removal controls are hidden
  behind the legacy-extension boundary. Join/leave and description update use
  backend contracts. Private match creation is disabled in the current UI,
  but the backend create contract still accepts it.
- Legacy cancel, participant removal, private/public conversion and training
  handlers remain unreachable Supabase-era consumers and are not valid backend
  flows.

### D2 reservations and notifications

- D2 persists owner, target interval/resource, state, version and the complete
  YCLIENTS binding. Owner-scoped create/read/list and exact refresh are wired.
- A confirmed D2 reservation is not linked to any match. Migration 033
  intentionally contains no `match_id`.
- Exact D2 refresh already distinguishes canonical move, canonical deletion
  and stale/unknown results. It updates/release holds safely and does no
  provider write.
- Existing `backend_match.match_notifications` is structurally limited to
  `waitlist_promoted` and requires a waitlist entry. It cannot safely store a
  court-confirmed, court-moved or court-cancelled event.
- Existing Telegram outbox accepts only a waitlist notification or invitation;
  it cannot be reused for D3 without a separate reviewed extension.

## Severity gaps

### P0

1. Booking truth is fabricated from match scenario/status/payment-shaped
   fields. A user can see “court booked” without a YCLIENTS record.
2. There is no durable match ↔ reservation relation, so ownership, one-to-one
   active binding and canonical provider confirmation cannot be enforced.
3. D2 move/cancellation updates only the reservation. Match schedule, court
   guarantee and participant notifications cannot change atomically with it.

### P1

1. The match overlap exclusion reserves desired/unbooked courts and conflicts
   with D2 as the canonical slot-hold authority.
2. Match status mixes participation lifecycle with booking semantics:
   `social -> confirmed` is not CRM confirmation, while `searching` is sticky
   across join/leave transitions.
3. Direct backend `private` match creation can create an owner-visible record
   that the current frontend would label booked without D2 proof.
4. Court identity differs between the static match catalog (`p1`…`p8`) and D2
   YCLIENTS numeric resource IDs. The projection needs one explicit canonical
   identifier/display mapping.
5. The durable notification model and client adapter only understand
   `waitlist_promoted`; repeated refresh deduplication for D3 events does not
   exist.
6. Backend owner participant removal and match cancellation are absent.
   Private/public conversion and training are legacy-only and must not be
   treated as implemented.

## Proposed truth model

Keep match lifecycle and court booking lifecycle separate.

- Match `status` describes whether the match can accept participants or is
  terminal. It must not be used as booking proof.
- Match planning fields (`starts_at`, `duration_minutes`, desired court) remain
  organizer intent when no active link exists.
- API responses expose an explicit court projection:
  - `unbooked`: no active link; show “Корт не забронирован” and, if present,
    the desired schedule/court only as a plan;
  - `confirmed`: active link to a D2 `confirmed` reservation with complete
    YCLIENTS binding; effective court/date/time come from that reservation;
  - `unknown`: never produced as a booked match state. If the D2 refresh is
    uncertain, retain the last confirmed projection and mark it stale without
    releasing the link or generating a cancellation event.
- `scenario`, legacy payment fields, price snapshots and selected court values
  never promote the court projection to `confirmed`.

## Persistence proposal

Prepare a new reviewed migration only after explicit approval. The preferred
shape is an association/history table instead of a nullable reservation column
on `matches`.

### `backend_match.match_reservation_links`

Conceptual fields:

- immutable `link_id`;
- `match_id`, `reservation_id`, `owner_account_id`;
- state `active | released`;
- immutable YCLIENTS appointment/record identity observed at activation (no
  client PII or record hash duplication);
- reservation version observed at link/projection time;
- created/updated/released timestamps and a bounded release reason
  (`canonical_reservation_cancelled | match_terminal`);
- version for optimistic concurrency.

Required database invariants:

- composite ownership foreign key from `(match_id, owner_account_id)` to a
  unique match owner key;
- composite ownership foreign key from `(reservation_id, owner_account_id)` to
  migration 033's reservation owner key;
- at most one active link per match;
- at most one active link per reservation;
- an active link is valid only for a non-terminal match and a `confirmed`
  reservation with all YCLIENTS binding fields present;
- append/history rows are retained when a link is released;
- no cascade deletes.

Migration review must also remove the match-level active-court exclusion as a
booking lock. D2 reservation slot holds remain the only canonical court
collision authority. Existing match planning columns can remain non-null in
the first migration to avoid a broad match rewrite; the synthetic unassigned
court remains planning-only.

### Lifecycle notifications

Add a separate generic match lifecycle event/recipient ledger rather than
weakening the waitlist-specific foreign key:

- event types: `court_confirmed`, `court_moved`, `court_cancelled`;
- event references match, link and observed reservation version;
- immutable old/new target snapshots contain only non-PII court/time data;
- one recipient row per organizer/active participant;
- uniqueness on `(event type, link, reservation version, recipient)` prevents
  duplicates on repeated no-churn refresh;
- unread/read lifecycle is independent per recipient.

Telegram delivery is not required for the first D3 slice. Extending the
Telegram outbox is a separate migration/runtime review; in-app durable
notifications are sufficient for D3 acceptance unless the owner expands scope.

## Transaction and concurrency contract

Cross-domain operations must run through one coordinator and one PostgreSQL
transaction:

1. Acquire a deterministic cross-domain lock, then lock/re-read reservation,
   match and active link in one documented order.
2. Revalidate owner identity, match non-terminal state, reservation version,
   `confirmed` status and complete provider binding.
3. Insert/update/release the active link and append recipient notifications in
   the same transaction.
4. A concurrent join may change participants, so notification recipients and
   match version are re-read under the match lock before commit.
5. A stale version, ownership mismatch, duplicate active link, terminal match,
   provider uncertainty or incomplete binding fails closed with no partial
   link and no notification.

For exact refresh:

- unchanged confirmed target: no match/link/notification churn;
- canonical move: keep the same active link, advance its observed reservation
  version, project the new target and append one `court_moved` event;
- canonical deletion/cancellation: release the active link, keep the match
  alive/unbooked and append one `court_cancelled` event;
- unknown/stale read: preserve the prior confirmed link and generate nothing.

App-originated provider PUT/DELETE remains absent in every branch.

## API and UI plan

- Add owner-only `POST /matches/:matchId/reservation-link` accepting a request
  key and reservation ID. The backend reads the owner-scoped D2 reservation;
  clients cannot assert provider IDs or confirmation.
- The action “Забронировать корт” opens the existing D2 create flow with match
  context. Only a canonical `booking_created` response is then linked.
- Match feed/detail responses include explicit `courtBookingStatus`, stale
  state and effective/planned schedule fields. Strict frontend validators must
  reject malformed confirmed projections.
- Replace `getMatchBookingStatus` inference with that explicit projection.
  Remove `scenario`, private and payment-field fallbacks.
- Update creation copy so both public scenarios create an unbooked match until
  D2 confirms and links a reservation. Do not write or reinterpret legacy
  payment fields.
- Resolve D2 numeric court resource names through an explicit trusted court
  catalog projection with a safe non-guaranteeing fallback.
- Public feed remains restricted to public matches; D2 private reservations
  remain Home/Bookings data and never enter match feed queries.

## Slice plan and gates

1. **Complete:** code-only pure link/projection types and state-machine tests,
   runtime disabled. Full-binding, ownership, stale-version, all four move
   shapes, canonical cancellation and unknown/stale preservation are covered.
2. **Complete for review:** migration 034 SQL, read-only PRE/POSTCHECK,
   fail-closed rollback, runbook and static contract tests are prepared. The
   migration is not applied and runtime remains disconnected.
3. After a separate apply approval, add repository/coordinator and owner link
   endpoint; integrate with D2 exact refresh transaction.
4. Update strict match response adapters and minimally change creation,
   feed/cards/details plus the D2-create-to-link handoff.
5. Add durable in-app lifecycle notifications and concurrency tests for
   link/join/canonical cancellation.
6. Run all required test/build gates, integrate to `main`, deploy exact commit
   to Selectel test, then verify unbooked/create-link/admin move/admin cancel,
   private feed exclusion, health and logs before D3 can be `done`.

## Explicitly outside D3

- Payment provider, payment/refund decisions and edits to `paymentStatus`,
  `ownerPaid`, `holdAmount`, `prepay`.
- YCLIENTS webhook.
- App/backend provider reschedule or cancel writes.
- Support contact selection (D5).
- Production deployment.
