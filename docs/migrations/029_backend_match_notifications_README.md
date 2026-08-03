# Migration 029: backend match notifications

## Purpose

This storage-only migration adds a durable backend-owned notification for a
player promoted from a backend match waitlist. It does not create a notification
for existing history, modify Supabase `public.notifications`, expose an HTTP
endpoint, start polling, or change frontend behavior.

Backend match invitations remain their own durable records and are already
rendered directly by the frontend. Migration 029 intentionally does not create
a duplicate invitation notification stream.

## Storage contract

`backend_match.match_notifications` initially supports only
`waitlist_promoted`. Each notification stores identifiers, lifecycle times and
version only. It stores no title, body, profile name, Telegram identifier,
Supabase identifier, email, phone, session credential, or arbitrary JSON.

The composite foreign key binds `(waitlist_entry_id, match_id,
recipient_account_id)` to the exact waitlist entry, so a notification cannot be
written for a different match or recipient. One waitlist entry can produce at
most one notification. The future promotion writer must insert it in the same
transaction that closes the waiting entry and creates the participant.

Unread rows have `read_at IS NULL, version=1`. A read transition sets
`read_at` and `version=2`. Repeating the same read operation is naturally
idempotent and requires no separate command ledger.

Unix epoch seconds remain `bigint` to match the established backend HTTP and
storage contract. Values are restricted to JavaScript's exact integer range.

## Query and privilege contract

The recipient feed uses keyset ordering `(created_at DESC, id DESC)`, backed by
`match_notifications_recipient_feed_idx`. Unread badge queries use the smaller
partial `match_notifications_recipient_unread_idx`.

`backend_auth_app` receives:

- table-level `SELECT`;
- column-level `INSERT` excluding `read_at`;
- column-level `UPDATE` only for `read_at` and `version`;
- no table-wide insert/update, delete, truncate, references, trigger, schema
  create, owner membership, or grant option.

The application must always derive `recipient_account_id`, `match_id`,
`waitlist_entry_id`, notification ID and timestamps from trusted backend state.
No client request may supply those values for promotion notification creation.

## Files

- `029_backend_match_notifications_PRECHECK.sql` — read-only baseline.
- `029_backend_match_notifications.sql` — creates empty storage.
- `029_backend_match_notifications_POSTCHECK.sql` — exact catalog, constraint,
  index and ACL validation.
- `029_backend_match_notifications_ROLLBACK.sql` — removes only unused empty
  storage.
- `029_backend_match_notifications_README.md` — this runbook.

## Test rollout

1. Confirm the test repository is clean and at the reviewed commit.
2. Freeze backend match writers or stop the backend for the migration window.
3. Create and publish a database backup.
4. Run PRECHECK and save its JSON object and checksum.
5. Apply migration 029 with `ON_ERROR_STOP=1`.
6. Run POSTCHECK and save its JSON object and checksum.
7. Confirm pre-existing row counts and fingerprints match the PRECHECK snapshot,
   the new table is empty, and the backend remains unchanged.
8. Restart the unchanged backend and verify health only. Do not expect
   notification API behavior before the next reviewed slice.

## Rollback

Rollback is allowed only while `match_notifications` is empty and no writer is
deployed. It locks the referenced waitlist table before the notification table,
checks emptiness under the lock and drops only migration 029 storage. After the
first notification exists, rollback must refuse and a reviewed forward migration
must preserve the history.

## Next slice

After migration review and rollout:

1. add repository and bearer-protected API for keyset reading and idempotent
   marking as read;
2. insert `waitlist_promoted` atomically inside FIFO promotion;
3. add frontend polling and merge backend promotion notifications with direct
   backend invitations;
4. keep Supabase notifications only for concrete legacy matches until their
   provider is retired.
