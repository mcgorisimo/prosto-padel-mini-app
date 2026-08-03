# Migration 030: backend Telegram outbound notifications

## Purpose

This storage-only migration prepares reliable outbound Telegram delivery for
backend-owned match events. It does not call the Telegram Bot API, request
write access from a client, enqueue existing history, start a worker, modify
Supabase, or change current in-app notification behavior.

The first runtime slice after this migration will use the storage for two
events already owned by the backend:

- a player is invited to a match;
- a waitlisted player is promoted to a match.

The later 15-minute waitlist offer lifecycle recorded in `TASK.md` will reuse
the same delivery infrastructure.

## Privacy boundary

Backend authentication deliberately persists only an HMAC lookup digest for a
Telegram identity. That digest remains unchanged and is not reversible.

`backend_auth.telegram_notification_destinations` is a separate delivery-only
store. It contains the private Telegram chat identifier only after the signed
Telegram Mini App user data says that private messages are allowed. The value
must never be returned by an HTTP API, written to logs, copied to audit
metadata, or accepted from an ordinary client JSON body.

One account has at most one active destination and one private Telegram chat
can belong to at most one account. A disabled destination is retained for
history and can later be re-enabled only from a newly verified Telegram login.
Rows cannot be deleted by the application role.

## Outbox contract

`backend_match.telegram_notification_outbox` contains delivery state, not
message text. Each row points to exactly one trusted backend source:

- `match_notification_id` for an in-app match notification;
- `invitation_id` for a match invitation.

Partial unique indexes allow each source record to be enqueued only once.
Recipient account, match, player name and message content are derived by the
future worker from the referenced source at send time. They are not duplicated
or client-supplied in the outbox.

Pending deliveries are ordered by `(available_at, created_at, id)`. Retry state
is bounded to 20 attempts and uses a small allowlist of non-sensitive failure
codes. Telegram response bodies and exception messages must not be persisted.

The sender must claim work in one short transaction. It selects one due pending
row with `attempt_count < 20` in queue order with `FOR UPDATE SKIP LOCKED`, increments `attempt_count`,
moves `available_at` to a visibility-lease deadline, updates `updated_at`, and
increments `version`. The transaction commits before any Telegram HTTP call.
The claimed `version` is the ownership token: success, retry, or abandonment
must update only a row whose `id`, pending `status`, and `version` still match,
then increment `version` again. A stale worker must not overwrite a later claim.
The visibility lease must be longer than the sender's bounded HTTP timeout.
A due pending row that already has 20 attempts must instead be changed to
`abandoned` with `retry_exhausted` in a short transaction, without another
Telegram HTTP call.

The Telegram Bot API does not offer an idempotency key for `sendMessage`.
The source uniqueness constraints prevent duplicate enqueue, while the atomic
claim protocol prevents normal concurrent processing. A process crash after
Telegram accepts a message and before the completion update can still produce
a duplicate retry after the visibility lease. The sender must make the message
safe to receive twice and keep this residual at-least-once boundary explicit.

## Privilege contract

`backend_auth_app` receives:

- table-level `SELECT` on both tables;
- column-level insert/update required for destination lifecycle and outbox
  delivery lifecycle;
- no table-wide insert/update, delete, truncate, references, trigger, schema
  create, owner membership, or grant option.

Source identifiers and timestamps must be produced from verified backend state.
No public or bearer-protected endpoint may accept a Telegram chat identifier or
an outbox source identifier directly.

## Files

- `030_backend_telegram_outbound_notifications_PRECHECK.sql` — read-only baseline.
- `030_backend_telegram_outbound_notifications.sql` — creates empty storage.
- `030_backend_telegram_outbound_notifications_POSTCHECK.sql` — exact catalog,
  source binding, index and ACL validation.
- `030_backend_telegram_outbound_notifications_ROLLBACK.sql` — removes only
  unused empty storage.
- `030_backend_telegram_outbound_notifications_README.md` — this runbook.

## Test rollout

1. Confirm the test repository is clean and at the reviewed commit.
2. Stop the backend for the migration window so no destination or outbox writer
   can appear during validation.
3. Create and publish a database backup.
4. Run PRECHECK and save its JSON object and checksum.
5. Apply migration 030 with `ON_ERROR_STOP=1`.
6. Run POSTCHECK and save its JSON object and checksum.
7. Confirm pre-existing row counts and fingerprints match the PRECHECK snapshot
   and both new tables are empty.
8. Restart the unchanged backend and verify health only. No outbound Telegram
   behavior exists until the next reviewed runtime slice.

## Rollback

Rollback is allowed only while both new tables are empty and no writer is
deployed. It locks referenced tables before the two new tables, validates their
fingerprints and emptiness, then drops the outbox before the destination table.
After the first destination or delivery exists, rollback must refuse and a
reviewed forward migration must preserve the history.

## Next slice

After migration review and test rollout:

1. capture `allows_write_to_pm` and the signed Telegram user ID only inside the
   verified Telegram login boundary;
2. persist or disable a destination without exposing its chat ID;
3. enqueue invitation and waitlist-promotion deliveries atomically with their
   source events;
4. add a bounded Telegram sender with retry/backoff and deep-link buttons;
5. verify delivery to two real Telegram accounts before implementing the
   15-minute waitlist offer lifecycle.
