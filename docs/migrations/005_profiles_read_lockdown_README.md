# 005 Profiles Read Lockdown

This migration removes the broad authenticated read policy on `public.profiles` and replaces it with own-row direct reads only.

## Files

- `005_profiles_read_lockdown_PRECHECK.sql` verifies the expected pre-state.
- `005_profiles_read_lockdown.sql` drops `profiles_select_authenticated` and creates `profiles_select_own`.
- `005_profiles_read_lockdown_POSTCHECK.sql` verifies the lockdown state.
- `005_profiles_read_lockdown_ROLLBACK.sql` restores the previous broad SELECT policy.

## Access Model After 005

- Full own profile: `public.get_my_profile()` or a direct `profiles` SELECT where `auth.uid() = id`.
- Own profile updates: `public.update_my_profile(...)`.
- Public player data: `public.player_public_profiles`.
- Admin player list: `public.admin_list_profiles(p_search text, p_filter text)`.
- Admin role/rating/verification changes: `public.admin_update_profile_security(...)`.

Normal authenticated users should no longer be able to directly read another player's private `profiles` fields such as `phone`, `email`, `role`, `birthday`, `gender`, `language`, `created_at`, or `updated_at`.

## AuthGate Compatibility

Current `AuthGate.jsx` creates a profile with:

```js
.from('profiles')
.insert([...])
.select('id')
.single()
```

The new `profiles_select_own` policy uses `auth.uid() = id`, so the newly created user's own `id` row remains readable after insert. This should allow `insert(...).select('id')` to keep working as long as the session user matches the inserted profile id and `profiles_insert_own` remains active.

Local frontend audit result: the only remaining `from('profiles')` in `src` is this AuthGate registration insert. No direct frontend `profiles` SELECT remains in `src`.

## Run Order On Staging

1. Run `005_profiles_read_lockdown_PRECHECK.sql`.
2. Apply `005_profiles_read_lockdown.sql`.
3. Run `005_profiles_read_lockdown_POSTCHECK.sql`.
4. Smoke-test registration, own profile loading, admin players, and player search.

## Rollback

`005_profiles_read_lockdown_ROLLBACK.sql` only removes `profiles_select_own` and recreates:

```sql
profiles_select_authenticated
for select
to authenticated
using (true)
```

It does not modify data, functions, views, table grants, triggers, `profiles_insert_own`, or `profiles_update_own_or_admin`.

## Notes

- This stage does not create new RPCs.
- This stage does not change `player_public_profiles`, `admin_list_profiles`, `get_my_profile`, or `update_my_profile`.
- PRECHECK and POSTCHECK are read-only catalog checks. They cannot inspect frontend source files from Supabase SQL Editor; the frontend check above was done locally before creating this migration.
