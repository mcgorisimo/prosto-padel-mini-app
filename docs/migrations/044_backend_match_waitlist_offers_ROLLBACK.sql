\set ON_ERROR_STOP on
begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $preconditions$
declare
  relation_name text;
begin
  if not pg_catalog.pg_has_role(
       current_user,'backend_auth_owner','MEMBER'
     ) then
    raise exception 'ROLLBACK_BLOCKED: owner role unavailable';
  end if;
  foreach relation_name in array array[
    'backend_match.match_waitlist_offers',
    'backend_match.match_waitlist_offer_commands'
  ] loop
    if pg_catalog.to_regclass(relation_name) is null
       or pg_catalog.obj_description(
         relation_name::pg_catalog.regclass,'pg_class'
       ) is distinct from '044_backend_match_waitlist_offers:'
         || backend_auth.relation_fingerprint(
           relation_name::pg_catalog.regclass
         ) then
      raise exception 'ROLLBACK_BLOCKED: % schema inventory differs',
        relation_name;
    end if;
  end loop;
  if exists (
    select 1 from backend_match.match_waitlist_offers
  ) or exists (
    select 1 from backend_match.match_waitlist_offer_commands
  ) then
    raise exception 'ROLLBACK_BLOCKED: waitlist offer history exists';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;
drop table backend_match.match_waitlist_offer_commands restrict;
drop table backend_match.match_waitlist_offers restrict;
reset role;
commit;
