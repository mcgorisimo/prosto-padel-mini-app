begin;

-- 004_profiles_read_api_additive.sql
-- Additive read API for profile lockdown preparation.
-- Does not remove or change profiles_select_authenticated.

grant usage on schema public to authenticated;

create or replace function public.admin_list_profiles(
  p_search text default null,
  p_filter text default 'all'
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  phone text,
  rating numeric,
  is_verified boolean,
  role text,
  side_preference text,
  created_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_filter text := coalesce(nullif(trim(p_filter), ''), 'all');
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if v_filter not in ('all', 'verified', 'unverified') then
    raise exception 'Invalid profile filter';
  end if;

  return query
  select
    p.id,
    p.first_name,
    p.last_name,
    p.phone,
    p.rating,
    p.is_verified,
    p.role,
    p.side_preference,
    p.created_at
  from public.profiles p
  where (
      v_filter = 'all'
      or (v_filter = 'verified' and p.is_verified is true)
      or (v_filter = 'unverified' and p.is_verified is not true)
    )
    and (
      v_search is null
      or p.first_name ilike ('%' || v_search || '%')
      or p.last_name ilike ('%' || v_search || '%')
      or p.phone ilike ('%' || v_search || '%')
    )
  order by p.created_at desc, p.id asc
  limit 200;
end;
$$;

revoke all on function public.admin_list_profiles(text, text) from public, anon;
grant execute on function public.admin_list_profiles(text, text) to authenticated;

comment on function public.admin_list_profiles(text, text) is
  'Admin-only read API for the current AdminPlayersScreen fields. Does not replace profiles_select_authenticated by itself.';

commit;
