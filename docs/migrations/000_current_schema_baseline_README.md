# 000_current_schema_baseline

`000_current_schema_baseline.sql` recreates the empty database structure captured in `mini-app/docs/supabase-schema-baseline.json`.
It does not connect to Supabase and was not executed by Codex.

## What It Creates

- `public.profiles`
- `public.matches`
- `public.messages`
- Column types, nullability, generated columns, and default values from baseline.
- Primary keys, foreign keys, and check constraints from baseline.
- Non-primary indexes from baseline.
- User-defined public functions captured in baseline:
  - `public.set_updated_at()`
  - `public.is_admin()`
  - `public.confirm_rating_match_score(uuid, uuid, jsonb)`
  - `public.rls_auto_enable()`
- Table triggers captured in baseline:
  - `set_profiles_updated_at`
  - `set_matches_updated_at`
- RLS enabled on `profiles`, `matches`, `messages`.
- Existing RLS policies from baseline.
- `pg_trgm` extension dependency required by the trigram indexes/functions seen in baseline.

This is the state before the additive `001_profiles_security_additive` work. It does not include the new `001` profile triggers/RPCs/view.

## What Is Not Migrated

- No rows from `profiles`, `matches`, or `messages`.
- No auth users.
- No secrets, tokens, or environment variables.
- No objects from excluded schemas: `auth`, `extensions`, `storage`, `realtime`, `vault`, `supabase_functions`, `pg_catalog`, `information_schema`.
- No Supabase project settings or dashboard settings.

## Known Limitations

- Baseline JSON does not contain ACL/grant metadata for tables, functions, schemas, or roles. Because of that, `000_current_schema_baseline.sql` does not invent grants/revokes beyond policy role targets.
- Baseline JSON includes `public.rls_auto_enable()` function but does not include event trigger metadata. The function is recreated, but the event trigger binding cannot be restored exactly from this baseline.
- Baseline JSON does not include extension metadata. `pg_trgm` is restored as an extension dependency because trigram functions/types and `gin_trgm_ops` indexes are present in baseline.
- `auth.users` is referenced by `profiles_id_fkey` but is not created here. Run this on a Supabase project where `auth.users` already exists.
- Supabase roles such as `authenticated` must exist on the target project.

## Staging Deployment Order

On an empty staging Supabase project:

1. Confirm the project has Supabase Auth and the `authenticated` role.
2. Run `000_current_schema_baseline.sql`.
3. Run `001_profiles_security_additive_PRECHECK.sql`.
4. Run `001_profiles_security_additive.sql`.
5. Run `001_profiles_security_additive_POSTCHECK.sql`.
6. Test registration, profile update, match creation, match chat, and rating confirmation on staging.

## Rollback

For the `001` additive stage, use `001_profiles_security_additive_ROLLBACK.sql`.

For `000_current_schema_baseline.sql`, rollback on an empty staging database is normally done by recreating the staging project or using a disposable database. This file intentionally does not include destructive rollback SQL because it would require dropping baseline tables and related objects.

Do not run destructive rollback against production.

## Validation Checklist

- SQL contains no user data inserts.
- SQL does not create or alter `auth.users`.
- SQL does not include secrets.
- Tables and column definitions are copied from `supabase-schema-baseline.json`.
- RLS policies reflect the baseline state, including the currently broad `profiles_select_authenticated` and `matches_select_authenticated` policies.
