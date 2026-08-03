# Migration 031: backend player profile photos

## Purpose

This storage-only migration prepares backend-owned profile photo metadata. It
does not upload image bytes, configure an object-storage bucket, change an
existing Telegram photo URL, create profile photo rows, modify Supabase, or
expose a new HTTP endpoint.

Image bytes must live in an S3-compatible object store. PostgreSQL keeps only
the immutable asset identity, normalized rendition metadata and the current
account-owned pointer.

## Ownership boundary

`backend_auth.player_profile_photo_assets` is an append-only asset ledger. An
asset is bound to one immutable backend account and generation. Its
`storage_prefix` must exactly contain that account ID, generation and asset ID.

`backend_auth.player_profile_photo_states` contains the current custom photo
pointer. The composite foreign key
`(account_id, version, active_asset_id) -> (account_id, generation, asset_id)`
makes it impossible to point one player's state at another player's asset.

The runtime upload and delete endpoints must never accept an account or player
ID from the JSON body, multipart fields, filename, object metadata or query
string. Ownership comes only from the authenticated backend session.

State creation starts at version 1 with equal creation and update timestamps.
Later updates are monotonic: the trigger preserves `account_id` and
`created_at`, requires `version + 1`, rejects unchanged pointers and prevents
time from moving backwards. Assets cannot be updated or deleted by the
application role.

## Photo resolution contract

The later runtime slice will normalize each accepted upload before activation:

- decode and validate real image bytes rather than trusting a filename or MIME
  header;
- crop to a square without stretching;
- strip EXIF, GPS and other source metadata;
- publish fixed WebP renditions below the recorded `storage_prefix`;
- activate the new asset only after every required rendition is stored;
- retain the previous pointer until activation commits;
- use versioned immutable URLs so caches cannot show another player's or an
  older player's image.

The database records only the normalized full rendition metadata. It never
stores source or normalized image bytes.

## Legacy Telegram photo behavior

The existing `backend_auth.player_profile_details.photo_url` remains the
Telegram-provided fallback and stays outside ordinary profile PATCH access.

- no custom state row: the reader may use the Telegram fallback;
- active custom asset: the reader uses versioned object-storage renditions;
- state row with `active_asset_id = null`: the player explicitly removed the
  custom photo and the UI uses initials rather than restoring the Telegram
  fallback.

## Privilege contract

`backend_auth_app` receives:

- table-level `SELECT` on the asset and state tables;
- column-level `INSERT` for immutable assets and initial state;
- column-level `UPDATE` only for the state pointer, version and update time;
- no table-level insert/update, asset update, delete, truncate, references,
  trigger, function execute, schema create, owner membership or grant option.

## Files

- `031_backend_player_profile_photos_PRECHECK.sql` — read-only baseline.
- `031_backend_player_profile_photos.sql` — creates empty metadata storage.
- `031_backend_player_profile_photos_POSTCHECK.sql` — validates ownership,
  composite binding, trigger, catalog and ACL boundaries.
- `031_backend_player_profile_photos_ROLLBACK.sql` — removes only unused empty
  storage.
- `031_backend_player_profile_photos_README.md` — this runbook.

## Test rollout

1. Confirm the test repository is clean and at the reviewed commit.
2. Stop the backend so no future photo writer can run during migration checks.
3. Create and publish a database backup.
4. Run PRECHECK and save its JSON object and checksum.
5. Apply migration 031 with `ON_ERROR_STOP=1`.
6. Run POSTCHECK and save its JSON object and checksum.
7. Confirm pre-existing counts and fingerprints match PRECHECK and both new
   tables are empty.
8. Restart the unchanged backend and verify health only.

## Rollback

Rollback is allowed only while both tables are empty and no photo writer is
deployed. After the first asset or explicit empty state exists, rollback must
refuse and a reviewed forward migration must preserve the history.

## Next slice

After migration review and test rollout:

1. add an object-storage adapter with fail-closed configuration;
2. add authenticated upload, replace and remove operations using only the
   session account ID;
3. add a backend public player profile reader with completed-match history;
4. expose versioned photo renditions in own, public and match participant
   responses;
5. add cross-account regression tests before frontend integration.
