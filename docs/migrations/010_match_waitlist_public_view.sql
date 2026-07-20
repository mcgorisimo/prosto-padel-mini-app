-- 010_match_waitlist_public_view.sql
-- Additive, read-only RPC for the safe public-match waitlist projection.
-- Migration 009 tables, policies, RPCs and FIFO promotion are not changed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_profile_columns_ok boolean;
  v_waitlist_columns_ok boolean;
  v_match_columns_ok boolean;
begin
  if pg_catalog.to_regclass('public.matches') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.match_waitlist') is null then
    raise exception using errcode = 'P0001',
      message = 'MIGRATION_PRECONDITION_FAILED: installed migration 009 tables are required';
  end if;

  if coalesce(pg_catalog.obj_description('public.match_waitlist'::pg_catalog.regclass, 'pg_class'), '')
       not like 'migration=009_match_waitlist_notifications;%' then
    raise exception using errcode = 'P0001',
      message = 'MIGRATION_PRECONDITION_FAILED: match_waitlist is not the audited 009 table';
  end if;

  if pg_catalog.to_regprocedure('auth.uid()') is null
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    raise exception using errcode = 'P0001',
      message = 'MIGRATION_PRECONDITION_FAILED: Supabase auth adapter or API roles are missing';
  end if;

  select count(*) = 5 into v_profile_columns_ok
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.profiles'::pg_catalog.regclass
    and a.attnum > 0 and not a.attisdropped
    and (
      (a.attname = 'id' and a.atttypid = 'uuid'::pg_catalog.regtype)
      or (a.attname = 'first_name' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'last_name' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'photo_url' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'rating' and a.atttypid = 'numeric'::pg_catalog.regtype)
    );

  select count(*) = 5 into v_waitlist_columns_ok
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.match_waitlist'::pg_catalog.regclass
    and a.attnum > 0 and not a.attisdropped
    and (
      (a.attname = 'id' and a.atttypid = 'uuid'::pg_catalog.regtype)
      or (a.attname = 'match_id' and a.atttypid = 'uuid'::pg_catalog.regtype)
      or (a.attname = 'user_id' and a.atttypid = 'uuid'::pg_catalog.regtype)
      or (a.attname = 'status' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'joined_at' and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype)
    );

  select count(*) = 3 into v_match_columns_ok
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.matches'::pg_catalog.regclass
    and a.attnum > 0 and not a.attisdropped
    and (
      (a.attname = 'id' and a.atttypid = 'uuid'::pg_catalog.regtype)
      or (a.attname = 'type' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'isPrivate' and a.atttypid = 'boolean'::pg_catalog.regtype)
    );

  if not v_profile_columns_ok or not v_waitlist_columns_ok or not v_match_columns_ok then
    raise exception using errcode = 'P0001',
      message = 'MIGRATION_PRECONDITION_FAILED: matches, match_waitlist or safe profile columns differ from the audited shape';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'public.match_waitlist'::pg_catalog.regclass
      and c.relrowsecurity
  ) or (
    select count(*)
    from pg_catalog.pg_policy pol
    where pol.polrelid = 'public.match_waitlist'::pg_catalog.regclass
  ) <> 1 or not exists (
    select 1
    from pg_catalog.pg_policy pol
    where pol.polrelid = 'public.match_waitlist'::pg_catalog.regclass
      and pol.polname = 'match_waitlist_select_own'
      and pol.polcmd = 'r'
      and lower(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)) like '%auth.uid()%'
  ) or exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) a
    left join pg_catalog.pg_roles r on r.oid = a.grantee
    where c.oid = 'public.match_waitlist'::pg_catalog.regclass
      and (
        (a.privilege_type = 'SELECT' and (a.grantee = 0 or r.rolname = 'anon'))
        or (
          a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
          and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
        )
      )
  ) or not exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) a
    join pg_catalog.pg_roles r on r.oid = a.grantee
    where c.oid = 'public.match_waitlist'::pg_catalog.regclass
      and r.rolname = 'authenticated'
      and a.privilege_type = 'SELECT'
  ) then
    raise exception using errcode = 'P0001',
      message = 'MIGRATION_PRECONDITION_FAILED: migration 009 direct waitlist access is broader than audited';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.get_my_match_waitlist_position(uuid)')::oid
      and coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '')
        like 'migration=009_match_waitlist_notifications;%'
      and regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g')
        like '%order by w.joined_at, w.id%'
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.get_match_waitlist_count(uuid)')::oid
      and coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '')
        like 'migration=009_match_waitlist_notifications;%'
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('prosto_padel_internal.promote_match_waitlist(uuid)')::oid
      and coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '')
        like 'migration=009_match_waitlist_notifications;%'
      and regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g')
        like '%order by w.joined_at, w.id%'
  ) then
    raise exception using errcode = 'P0001',
      message = 'MIGRATION_PRECONDITION_FAILED: audited 009 waitlist RPCs or FIFO promotion are missing';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_match_waitlist'
  ) then
    raise exception using errcode = '42723',
      message = 'MIGRATION_CONFLICT: public.get_match_waitlist already exists';
  end if;
end;
$$;

create function public.get_match_waitlist(p_match_id uuid)
returns table (
  waitlist_id uuid,
  user_id uuid,
  queue_position bigint,
  first_name text,
  last_name text,
  photo_url text,
  rating numeric,
  joined_at timestamp with time zone,
  is_current_user boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_type text;
  v_is_private boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'WAITLIST_AUTH_REQUIRED';
  end if;

  select m.type, coalesce(m."isPrivate", false)
  into v_match_type, v_is_private
  from public.matches m
  where m.id = p_match_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'WAITLIST_MATCH_NOT_FOUND';
  end if;

  if v_match_type is distinct from 'match' or v_is_private then
    raise exception using errcode = 'P0001', message = 'WAITLIST_PUBLIC_MATCH_ONLY';
  end if;

  return query
  with ranked as (
    select
      w.id as waitlist_id,
      w.user_id,
      pg_catalog.row_number() over (order by w.joined_at, w.id) as queue_position,
      p.first_name,
      p.last_name,
      p.photo_url,
      p.rating,
      w.joined_at
    from public.match_waitlist w
    join public.profiles p on p.id = w.user_id
    where w.match_id = p_match_id and w.status = 'waiting'
  )
  select
    r.waitlist_id,
    r.user_id,
    r.queue_position,
    pg_catalog.btrim(r.first_name) as first_name,
    case
      when nullif(pg_catalog.btrim(r.last_name), '') is null then null::text
      else pg_catalog.left(pg_catalog.btrim(r.last_name), 1) || '.'
    end as last_name,
    nullif(pg_catalog.btrim(r.photo_url), '') as photo_url,
    r.rating,
    r.joined_at,
    r.user_id = v_user_id as is_current_user
  from ranked r
  order by r.queue_position;
end;
$$;

revoke all on function public.get_match_waitlist(uuid)
  from public, anon, authenticated;
grant execute on function public.get_match_waitlist(uuid)
  to authenticated;

comment on function public.get_match_waitlist(uuid) is
  'migration=010_match_waitlist_public_view;rollback=drop; authenticated safe FIFO projection for public matches only; last_name is abbreviated';

commit;
