# Production Rollout 001-005

Safe manual rollout plan for the reviewed Supabase changes:

- `001_profiles_security_additive`
- `002_match_leave_rpc`
- `003_match_join_rpc`
- `004_profiles_read_api_additive`
- `005_profiles_read_lockdown`

Do not apply `001_security_and_atomic_join.sql` as part of this rollout. It is a legacy/draft file and is not part of the staged 001-005 chain below.

This plan does not include secrets, user rows, match rows, message rows, or automated production execution.

## Golden Rule

Apply additive SQL first, deploy the frontend that uses the new safe APIs second, and apply the profiles read lockdown last.

Safe high-level order:

1. Production checkpoint.
2. SQL 001.
3. SQL 002.
4. SQL 003.
5. SQL 004.
6. Reload PostgREST schema after each SQL stage.
7. Deploy production frontend that calls `get_my_profile`, `update_my_profile`, `admin_list_profiles`, `player_public_profiles`, `join_match`, and `leave_match`.
8. Smoke-check production frontend.
9. SQL 005 lockdown.
10. Final smoke-check.

Do not remove `profiles_select_authenticated` before the production frontend is confirmed to use the safe profile APIs.

## Local Migration File Hashes

Use these only as a release-note checkpoint. For existing production functions, compare actual `pg_get_functiondef(...)` output, not just hashes.

- `001_profiles_security_additive.sql`: `F8213F921C31D0FD78D5CF9FE85F9C61ED0BCACA8BC6AA56C81F7F768E9981E8`
- `002_match_leave_rpc.sql`: `95A4840F9EFF159CB392C25C1F4A8E60E517FC8BC3C1F308B4E65E803FF192F2`
- `003_match_join_rpc.sql`: `2C54052657F83FC43CC7A1E069914A23E1F45D6806BDF64AE8E914FB3F614565`
- `004_profiles_read_api_additive.sql`: `8C19A4AC881E0D0AAD24F63CEB2A87FFEF9462E209BF00E559FC6D25CA9AFCCE`
- `005_profiles_read_lockdown.sql`: `51678E33E750B00B8584DE0982A6488A4FBABD4643538034758C56CCF4032D5F`

## Production Checkpoint Before Any Change

Run read-only catalog/count checks and save the results outside the database. Do not export user, match, or message rows.

### Policies

```sql
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  permissive,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'matches', 'messages')
order by tablename, policyname;
```

### Relevant Function Definitions

```sql
select
  n.nspname as schema,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as config,
  pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_admin',
    'get_my_profile',
    'update_my_profile',
    'admin_update_profile_security',
    'admin_list_profiles',
    'join_match',
    'leave_match',
    'profiles_security_is_privileged',
    'profiles_security_guard_insert',
    'profiles_security_guard_update',
    'confirm_rating_match_score'
  )
order by function_name, identity_arguments;
```

### Existing Overloads For New RPC Names

```sql
select
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('join_match', 'leave_match', 'admin_list_profiles')
order by function_name, identity_arguments;
```

### Grants On Relevant Tables, Views, And Functions

```sql
with relation_acl as (
  select
    'relation' as object_type,
    n.nspname as schema,
    c.relname as object_name,
    null::text as identity_arguments,
    coalesce(r.rolname, 'PUBLIC') as grantee,
    a.privilege_type
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where n.nspname = 'public'
    and c.relname in ('profiles', 'matches', 'messages', 'player_public_profiles')
),
function_acl as (
  select
    'function' as object_type,
    n.nspname as schema,
    p.proname as object_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    coalesce(r.rolname, 'PUBLIC') as grantee,
    a.privilege_type
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where n.nspname = 'public'
    and p.proname in (
      'is_admin',
      'get_my_profile',
      'update_my_profile',
      'admin_update_profile_security',
      'admin_list_profiles',
      'join_match',
      'leave_match'
    )
)
select *
from relation_acl
union all
select *
from function_acl
order by object_type, object_name, identity_arguments, grantee, privilege_type;
```

### Row Counts Only

```sql
select 'profiles' as table_name, count(*) as row_count from public.profiles
union all
select 'matches' as table_name, count(*) as row_count from public.matches
union all
select 'messages' as table_name, count(*) as row_count from public.messages;
```

### Current Objects That May Already Exist

Before starting, explicitly check whether these already exist:

- `public.player_public_profiles`
- `public.get_my_profile()`
- `public.update_my_profile(...)`
- `public.admin_update_profile_security(uuid, text, numeric, boolean)`
- `public.admin_list_profiles(text, text)`
- `public.join_match(uuid)`
- `public.leave_match(uuid)`
- `profiles_security_guard_insert` trigger on `public.profiles`
- `profiles_security_guard_update` trigger on `public.profiles`
- `profiles_select_own` policy

If any object exists before its stage, treat that stage as partially applied and follow the conflict rules below.

## Special Conflict Rule For `public.leave_match(uuid)`

`leave_match` has a higher collision risk because older drafts may have used the same name.

Before 002:

1. Save `pg_get_functiondef('public.leave_match(uuid)'::regprocedure)` if it exists.
2. Compare it with `docs/migrations/002_match_leave_rpc.sql`.
3. If the production definition fully matches the 002 version, mark stage 002 as partially applied and run only `002_match_leave_rpc_POSTCHECK.sql` plus schema reload.
4. If the definition differs, stop the rollout and record a conflict.
5. Do not run `DROP FUNCTION`, rollback, or replacement without explicit human approval.

Read-only check:

```sql
select
  to_regprocedure('public.leave_match(uuid)') is not null as leave_match_exists,
  case
    when to_regprocedure('public.leave_match(uuid)') is not null
    then pg_catalog.pg_get_functiondef('public.leave_match(uuid)'::regprocedure)
    else null
  end as leave_match_definition;
```

## Schema Reload

After every migration and successful POSTCHECK, reload PostgREST schema manually.

Preferred options:

- Supabase Dashboard API settings: reload schema cache.
- Or SQL Editor:

```sql
notify pgrst, 'reload schema';
```

Wait briefly after reload before testing RPCs from the frontend or REST client.

## Stage 001 - Profiles Security Additive

Files:

- `001_profiles_security_additive_PRECHECK.sql`
- `001_profiles_security_additive.sql`
- `001_profiles_security_additive_POSTCHECK.sql`
- `001_profiles_security_additive_ROLLBACK.sql`

Order:

1. Run `001_profiles_security_additive_PRECHECK.sql`.
2. Stop unless `migration_can_be_reviewed = true`.
3. Apply `001_profiles_security_additive.sql`.
4. Run `001_profiles_security_additive_POSTCHECK.sql`.
5. Stop unless `postcheck.postcheck_ok = true`.
6. Reload schema.

Dependencies:

- Baseline `public.profiles` exists with RLS enabled.
- Existing policies `profiles_insert_own`, `profiles_select_authenticated`, `profiles_update_own_or_admin`.
- Existing `public.is_admin()` SECURITY DEFINER function.

Creates or replaces:

- `public.player_public_profiles`
- `public.profiles_security_is_privileged()`
- `public.profiles_security_guard_insert()`
- `public.profiles_security_guard_update()`
- triggers `profiles_security_guard_insert`, `profiles_security_guard_update`
- `public.get_my_profile()`
- `public.update_my_profile(...)`
- `public.admin_update_profile_security(...)`

Expected result:

- Registration still works, but role/is_verified are normalized.
- Own full profile read/update RPCs exist.
- Public player projection exists and exposes only public fields.
- Admin protected update RPC exists.
- Broad `profiles_select_authenticated` still remains.

Stop criteria:

- PRECHECK does not confirm baseline columns/checks.
- `public.is_admin()` is missing or not SECURITY DEFINER.
- POSTCHECK is not true.
- `player_public_profiles` exposes private columns.

Data touched:

- No existing rows are updated or deleted.
- Triggers affect future `profiles` INSERT/UPDATE operations.

Rollback:

- Run `001_profiles_security_additive_ROLLBACK.sql`.
- It drops only 001 triggers, functions, and view. It does not delete profile data.

Frontend deployment:

- Not required before 001.
- Production frontend can continue old behavior because 001 is additive and keeps broad SELECT.

Minimal smoke-check:

- Existing admin/test account can load app.
- New registration can still create a profile if a production test account process exists.
- Do not create throwaway real users unless production operations already allow this.

## Stage 002 - Atomic `leave_match`

Files:

- `002_match_leave_rpc.sql`
- `002_match_leave_rpc_POSTCHECK.sql`
- `002_match_leave_rpc_ROLLBACK.sql`

Manual PRECHECK:

1. Run the `leave_match` conflict query above.
2. Check no unexpected overloads exist:

```sql
select
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as config
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'leave_match';
```

Order:

1. Manual PRECHECK.
2. If no conflicting existing function, apply `002_match_leave_rpc.sql`.
3. Run `002_match_leave_rpc_POSTCHECK.sql`.
4. Stop unless `postcheck.postcheck_ok = true`.
5. Reload schema.

Dependencies:

- `public.matches` exists with columns `id`, `owner_id`, `status`, `type`, `"isPrivate"`, `"dateISO"`, `"time"`, `"filledSlots"`, `participants`, `updated_at`.
- It does not require 001, but in the rollout it follows 001 for cleaner API sequencing.

Creates or replaces:

- `public.leave_match(p_match_id uuid)`

Expected result:

- Authenticated users can call `leave_match`.
- Public and anon cannot execute it.
- Function locks the match row and atomically removes only `auth.uid()` from `filledSlots` and `participants`.

Stop criteria:

- Existing `leave_match(uuid)` differs from 002.
- POSTCHECK is not true.
- Any extra `leave_match` overload exists.

Data touched:

- No rows are changed by installing the function.
- Future RPC calls can update one `matches` row per call.

Rollback:

- Run `002_match_leave_rpc_ROLLBACK.sql`.
- It revokes and drops only `public.leave_match(uuid)`.
- If production had a different pre-existing function, do not use this rollback without confirming what should be restored.

Frontend deployment:

- Not required before 002.
- Required before users can benefit from server-side leave.

Minimal smoke-check:

- Schema-level POSTCHECK only is enough immediately after SQL.
- Avoid performing real leave actions on production matches unless using an approved internal test match.

## Stage 003 - Atomic `join_match`

Files:

- `003_match_join_rpc.sql`
- `003_match_join_rpc_POSTCHECK.sql`
- `003_match_join_rpc_ROLLBACK.sql`

Manual PRECHECK:

```sql
select
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as config,
  pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'join_match'
order by identity_arguments;
```

Order:

1. Manual PRECHECK.
2. If no conflicting existing overload exists, apply `003_match_join_rpc.sql`.
3. Run `003_match_join_rpc_POSTCHECK.sql`.
4. Stop unless `postcheck.postcheck_ok = true`.
5. Reload schema.

Dependencies:

- `public.matches` exists with compact `"filledSlots"` jsonb and `participants text[]`.
- `public.profiles.rating` exists and uses the baseline numeric rating.
- `public.profiles` remains readable to SECURITY DEFINER function owner.

Creates or replaces:

- `public.join_match(p_match_id uuid)`

Expected result:

- Authenticated users can call `join_match`.
- Public and anon cannot execute it.
- Function locks a public match row and atomically appends one server-built slot.
- Concurrent last-slot joins serialize on `SELECT ... FOR UPDATE`.

Stop criteria:

- Existing `join_match` overload exists and is not expected.
- POSTCHECK is not true.
- Return type is not `matches`/`public.matches`.

Data touched:

- No rows are changed by installing the function.
- Future RPC calls can update one `matches` row per call.

Rollback:

- Run `003_match_join_rpc_ROLLBACK.sql`.
- It revokes and drops only `public.join_match(uuid)`.

Frontend deployment:

- Not required before 003.
- Must happen after 003 and schema reload, otherwise frontend calls to `join_match` will fail.

Minimal smoke-check:

- Schema-level POSTCHECK immediately after SQL.
- Avoid creating/concurrent joining real production matches unless an internal test match is explicitly approved.

## Stage 004 - Admin Read API Additive

Files:

- `004_profiles_read_api_PRECHECK.sql`
- `004_profiles_read_api_additive.sql`
- `004_profiles_read_api_POSTCHECK.sql`
- `004_profiles_read_api_ROLLBACK.sql`

Order:

1. Run `004_profiles_read_api_PRECHECK.sql`.
2. Stop unless `precheck.precheck_ok = true`.
3. Apply `004_profiles_read_api_additive.sql`.
4. Run `004_profiles_read_api_POSTCHECK.sql`.
5. Stop unless `postcheck.postcheck_ok = true`.
6. Reload schema.

Dependencies:

- 001 must be applied: `player_public_profiles` must exist with the safe public column list.
- `public.is_admin()` must exist.
- `profiles_select_authenticated` must still exist before 005.

Creates or replaces:

- `public.admin_list_profiles(p_search text, p_filter text)`

Expected result:

- Admin list RPC exists.
- It checks admin through `public.is_admin()`.
- Public and anon cannot execute it.
- Authenticated can execute it, but non-admin users receive RPC rejection.
- Broad `profiles_select_authenticated` still remains.

Stop criteria:

- `player_public_profiles` exposes private fields.
- `admin_list_profiles` already exists before 004 PRECHECK.
- POSTCHECK is not true.
- Broad select policy is already missing before the frontend migration.

Data touched:

- No rows are changed.

Rollback:

- Run `004_profiles_read_api_ROLLBACK.sql`.
- It drops only `public.admin_list_profiles(text, text)`.

Frontend deployment:

- Required after 004 and before 005.
- AdminPlayersScreen must call `admin_list_profiles`.
- Public player search must use `player_public_profiles`.

Minimal smoke-check:

- Admin account opens players list.
- Non-admin call to `admin_list_profiles` is rejected.
- Normal player search by public fields still works.

## Frontend Production Deployment Gate

Deploy production frontend only after stages 001-004 have passed POSTCHECK and schema reload.

Required frontend behavior before 005:

- Own profile read uses `get_my_profile`.
- Own profile update uses `update_my_profile`.
- Admin protected profile changes use `admin_update_profile_security`.
- Admin player list uses `admin_list_profiles`.
- Public player search uses `player_public_profiles`.
- Self-join uses `join_match`.
- Self-leave uses `leave_match`.
- Registration may still do `profiles.insert(...).select('id')`.

Do not deploy frontend that calls RPCs before their SQL stages exist and PostgREST schema has been reloaded.

After deploy and before 005, do minimal production smoke:

- Existing user opens own profile.
- Existing user updates a harmless allowed profile field only if operations approve.
- Admin opens player list and searches by name/phone.
- A normal user cannot call admin list.
- Existing player public search works.
- No full production live suite.

## Stage 005 - Profiles Read Lockdown

Files:

- `005_profiles_read_lockdown_PRECHECK.sql`
- `005_profiles_read_lockdown.sql`
- `005_profiles_read_lockdown_POSTCHECK.sql`
- `005_profiles_read_lockdown_ROLLBACK.sql`

Order:

1. Confirm production frontend with safe API calls is deployed.
2. Run `005_profiles_read_lockdown_PRECHECK.sql`.
3. Stop unless `precheck.precheck_ok = true`.
4. Apply `005_profiles_read_lockdown.sql`.
5. Run `005_profiles_read_lockdown_POSTCHECK.sql`.
6. Stop unless `postcheck.postcheck_ok = true`.
7. Reload schema.

Dependencies:

- 001: `get_my_profile`, `update_my_profile`, `player_public_profiles`.
- 004: `admin_list_profiles`.
- Production frontend is already migrated off broad direct `profiles.select`.
- `profiles_insert_own` and `profiles_update_own_or_admin` still exist.
- `profiles_select_authenticated` still exists immediately before 005.

Changes:

- Drops only `profiles_select_authenticated`.
- Creates only `profiles_select_own` with `auth.uid() = id`.

Expected result:

- Normal authenticated users can directly read only their own `profiles` row.
- Admin broad read goes only through `admin_list_profiles`.
- Public player read goes only through `player_public_profiles`.
- AuthGate `insert(...).select('id')` continues to work for own inserted row.

Stop criteria:

- Frontend safe API deployment is not confirmed.
- PRECHECK is not true.
- POSTCHECK is not true.
- Registration smoke fails after lockdown.
- Own profile read/update fails after lockdown.

Data touched:

- No rows are changed.
- Only RLS policies on `public.profiles` change.

Rollback:

- Run `005_profiles_read_lockdown_ROLLBACK.sql`.
- It drops `profiles_select_own` and restores:

```sql
profiles_select_authenticated
for select
to authenticated
using (true)
```

Minimal smoke-check:

- Existing user opens own profile.
- Registration flow still creates profile and receives id.
- Normal user cannot directly read another profile row.
- Public player search still works.
- Admin player list still works for admin and fails for non-admin.

## Dependency Matrix

| Stage | Depends On | Must Exist Before Next Step |
| --- | --- | --- |
| 001 | baseline `profiles`, `matches`, `messages`, `public.is_admin()` | `player_public_profiles`, `get_my_profile`, `update_my_profile`, `admin_update_profile_security`, profile guard triggers |
| 002 | `public.matches` baseline columns | `leave_match(uuid)` before frontend self-leave deployment |
| 003 | `public.matches`, `public.profiles.rating` | `join_match(uuid)` before frontend self-join deployment |
| 004 | 001, `public.is_admin()`, broad profile SELECT still present | `admin_list_profiles(text, text)` before admin frontend and 005 |
| Frontend | 001-004 applied and schema reloaded | frontend uses safe RPC/view paths |
| 005 | migrated frontend, 001, 004 | `profiles_select_own`; no `profiles_select_authenticated` |

## Final Checklist

- Production checkpoint saved.
- No personal data exported.
- Legacy `001_security_and_atomic_join.sql` was not applied.
- `leave_match(uuid)` conflict check completed.
- If `leave_match(uuid)` existed, its definition was compared with 002.
- All PRECHECK results required for the stage are true.
- All POSTCHECK results are true.
- PostgREST schema reloaded after each stage.
- Production frontend uses `join_match` and `leave_match`.
- Production frontend uses safe profile APIs/views.
- `profiles_select_authenticated` removed only after frontend rollout.
- Normal users cannot directly read other users' private `profiles` fields.
- `admin_list_profiles` works for admins and rejects non-admins.
- Rollback files for 001-005 are available before starting.
- No full live suite was run against production.

## Potential Conflicts To Watch

- `public.leave_match(uuid)` already exists and differs from 002: stop rollout.
- `public.join_match(uuid)` already exists: stop unless definition is intentionally identical and POSTCHECK passes.
- `public.admin_list_profiles(text, text)` already exists before 004: stop and compare.
- `player_public_profiles` exists with private columns: stop.
- `profiles_select_own` exists before 005: stop and inspect whether lockdown was already partially applied.
- `profiles_select_authenticated` is missing before frontend deployment: stop, because old production frontend may still rely on broad direct profile reads.
