# Migration 038: backend account notification preferences

## Purpose

This storage-only migration prepares one account-owned preference for current
Telegram match notifications. It does not expose an HTTP endpoint, change the
frontend, read or write a preference row, alter enqueue/claim/dispatch runtime,
call Telegram, modify Supabase, or change current delivery behavior.

The initial product setting is:

- Telegram match notifications enabled or disabled.

It covers the two Telegram delivery sources that are currently enqueued:
match invitations and waitlist-promotion match notifications. It does not
control other in-app match/reservation notification types, the in-app feed,
email, SMS, marketing, native push, private-booking notifications, or profile
visibility.

## Effective-state contract

Telegram delivery has independent inputs:

1. the verified Telegram private-message permission and usable destination;
2. the account-owned product preference introduced by this migration.

The later runtime must treat a missing preference row as effective enabled.
This preserves current behavior for existing accounts and avoids a backfill.
An explicit false row must remain false across later Telegram logins; a newly
verified Telegram destination must not overwrite the product preference.

Effective outbound delivery is allowed only when the destination is usable and
the preference is not explicitly false. The in-app feed remains unaffected.

## Storage contract

backend_auth.account_notification_preferences contains one row per backend
account and no Telegram chat ID, external identity, phone, email, message body,
provider response, or other contact snapshot.

The row stores:

- the immutable backend account binding;
- telegram_match_notifications_enabled;
- creation and update times as canonical Unix seconds;
- an optimistic version.

There is deliberately no database default and no migration backfill. Missing
row semantics belong to the later repository/service contract, not to a
synthetic stored consent or permission.

backend_auth_app receives table-level SELECT, column-level INSERT for the five
initial fields, and column-level UPDATE only for the boolean, updated time and
version. It receives no table-wide INSERT/UPDATE, DELETE, TRUNCATE, REFERENCES,
TRIGGER, schema CREATE, owner membership, or grant option.

## Outbox terminal evidence

The migration adds preference_disabled to the terminal failure allowlist of
backend_match.telegram_notification_outbox. It is valid only for an abandoned
delivery. Existing rows are not changed.

The later runtime must check the preference at claim/send time, not only at
enqueue time, so disabling the setting also blocks already queued but unsent
notifications. Such a row becomes terminal preference_disabled without a
Telegram API call. This migration only makes that future terminal evidence
schema-valid.

## Files

- 038_backend_account_notification_preferences_PRECHECK.sql — read-only
  baseline and exact migration-030 dependency check.
- 038_backend_account_notification_preferences.sql — creates empty preference
  storage and extends the outbox terminal failure constraint.
- 038_backend_account_notification_preferences_POSTCHECK.sql — read-only
  catalog, constraint, ownership, ACL, fingerprint and emptiness validation.
- 038_backend_account_notification_preferences_ROLLBACK.sql — restores the
  migration-030 outbox contract and drops only unused preference storage.
- 038_backend_account_notification_preferences_README.md — this runbook.

## Separate test-database gate

This candidate must not be applied as part of local implementation review.
After a reviewed commit is integrated, a separate owner command must identify
the exact commit and Selectel test environment.

That later gate must:

1. confirm the reviewed commit and a clean test-server checkout;
2. stop the backend for the constraint-change window;
3. create and verify a database backup;
4. run PRECHECK and save its JSON result and artifact checksum;
5. apply migration 038 with fail-on-error enabled;
6. run POSTCHECK and save its JSON result and artifact checksum;
7. compare account, destination and outbox row counts with PRECHECK;
8. confirm the preference table is empty;
9. restart the unchanged backend and verify health only.

The exact auth-integration inventory currently models the pre-038 catalog. It
must be updated and reviewed with the later repository/runtime slice before
that integration suite is expected to accept the migrated schema. This
storage-only candidate intentionally does not alter runtime or test inventory.

## Rollback

Rollback is allowed only while the preference table is empty and no outbox row
has terminal failure preference_disabled. It restores the exact migration-030
outbox failure/state constraints and fingerprint before dropping the preference
table.

Rollback also requires that no preference-aware runtime is deployed. If such a
runtime has been deployed, stop and use a reviewed forward migration instead.

After the first preference write or preference-disabled delivery evidence,
rollback must refuse and a reviewed forward migration must preserve history.

## Next runtime slice

Only after migration 038 is separately reviewed, committed, integrated and
verified on the Selectel test database:

1. add a repository with missing-row-as-enabled reads and optimistic writes;
2. add bearer-protected own-account GET/PATCH endpoints with exact bodies;
3. keep Telegram destination synchronization independent from preferences;
4. check the preference again before an outbound Telegram API call;
5. add focused repository/service/HTTP/dispatcher regressions;
6. update the exact auth-integration catalog inventory;
7. integrate a truthful frontend toggle in a later separate slice.

Profile visibility settings remain outside this migration because their exact
field allowlist, consent evidence and legal basis are separate D5.3 decisions.
