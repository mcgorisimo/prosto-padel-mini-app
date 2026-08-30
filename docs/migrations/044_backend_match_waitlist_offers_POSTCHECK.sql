\set ON_ERROR_STOP on
select pg_catalog.to_regclass(
    'backend_match.match_waitlist_offers'
  ) is not null as offers_ready,
  pg_catalog.to_regclass(
    'backend_match.match_waitlist_offer_commands'
  ) is not null as commands_ready;

select indexname,indexdef
from pg_catalog.pg_indexes
where schemaname='backend_match'
  and indexname like 'match_waitlist_offer%'
order by indexname;

select status,pg_catalog.count(*)
from backend_match.match_waitlist_offers
group by status
order by status;

do $assertions$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'backend_match.match_waitlist_offers',
    'backend_match.match_waitlist_offer_commands'
  ] loop
    if pg_catalog.obj_description(
         relation_name::pg_catalog.regclass,'pg_class'
       ) is distinct from '044_backend_match_waitlist_offers:'
         || backend_auth.relation_fingerprint(
           relation_name::pg_catalog.regclass
         ) then
      raise exception 'POSTCHECK_FAILED: % fingerprint differs',
        relation_name;
    end if;
    if not pg_catalog.has_table_privilege(
      'backend_auth_app',relation_name,'SELECT'
    ) then
      raise exception 'POSTCHECK_FAILED: app SELECT differs for %',
        relation_name;
    end if;
  end loop;
end;
$assertions$;
