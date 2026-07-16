# 004_profiles_read_api_additive

Additive stage for removing direct frontend reads from `public.profiles` before a future RLS lockdown.

This stage does not remove or change `profiles_select_authenticated`. It adds one admin-only read RPC and moves public training participant search to the existing public profile view.

## Objects

- `public.admin_list_profiles(p_search text, p_filter text)`
  - `SECURITY DEFINER`
  - fixed `search_path = public, pg_temp`
  - uses `auth.uid()` and `public.is_admin()`
  - executable by `authenticated` only
  - no execute for `public` or `anon`

The RPC returns only the fields currently used by `AdminPlayersScreen`:

- `id`
- `first_name`
- `last_name`
- `phone`
- `rating`
- `is_verified`
- `role`
- `side_preference`
- `created_at`

Supported current UI behavior:

- `p_search`: matches `first_name`, `last_name`, or `phone`
- `p_filter`: `all`, `verified`, or `unverified`
- no frontend pagination exists now, so the RPC has an internal `limit 200`
- stable order is `created_at desc, id asc`

## player_public_profiles

`player_public_profiles` is expected to come from `001_profiles_security_additive.sql`.

Expected columns:

- `id`
- `first_name`
- `last_name`
- `username`
- `photo_url`
- `rating`
- `is_verified`
- `side_preference`

It must not expose `phone`, `email`, `role`, `created_at`, `birthday`, `gender`, `language`, or `updated_at`.

The view is intentionally a normal PostgreSQL view because the baseline does not confirm PostgreSQL support for `security_invoker`. That means it may run with owner privileges and bypass base-table RLS. This is safe only while the view keeps the strict public column list above. It does not depend on `profiles_select_authenticated` for privacy because it exposes only non-private columns.

## Frontend Changes

- `profileApi.js`
  - adds `adminListProfiles({ search, filter })`
  - keeps `getPublicPlayerProfiles(...)` for public search

- `AdminPlayersScreen.jsx`
  - replaces direct `profiles.select(...)` with `adminListProfiles(...)`
  - keeps current search and verified/unverified filters

- `TrainingModal.jsx`
  - replaces direct `profiles.select(...)` with `getPublicPlayerProfiles(...)`
  - searches only by name, surname, and username
  - does not request, display, or filter by phone

- `AuthGate.jsx`
  - unchanged
  - registration still inserts into `profiles`

## Checks

Run order on staging:

1. `004_profiles_read_api_PRECHECK.sql`
2. `004_profiles_read_api_additive.sql`
3. `004_profiles_read_api_POSTCHECK.sql`

`PRECHECK` and `POSTCHECK` are read-only.

`POSTCHECK` confirms:

- the function exists with the single expected signature
- `SECURITY DEFINER` is enabled
- `search_path` is fixed
- `public` and `anon` cannot execute it
- `authenticated` can execute it
- returned fields match the current admin UI contract
- `profiles_select_authenticated` still exists

## Rollback

Run `004_profiles_read_api_ROLLBACK.sql`.

Rollback drops only `public.admin_list_profiles(text, text)`, which also removes its grants. It does not delete data, tables, policies, or the public view.

## Compatibility Risks

- Admin list is capped at 200 rows until the UI gets pagination.
- Training participant search no longer searches or displays phone for normal users.
- A future lockdown can remove `profiles_select_authenticated` only after all direct frontend `profiles.select` calls are gone and staging confirms the RPC/view paths.
