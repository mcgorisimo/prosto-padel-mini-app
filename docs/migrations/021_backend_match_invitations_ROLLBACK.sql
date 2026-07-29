-- Safe rollback for 021_backend_match_invitations.sql.
-- Refuses to remove either relation when invitation history exists.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
begin
  if not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;

  if pg_catalog.to_regclass(
       'backend_match.match_invitations'
     ) is null
     or pg_catalog.to_regclass(
       'backend_match.match_invitation_commands'
     ) is null then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 021 relations are missing';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table backend_match.match_invitations
  in access exclusive mode;
lock table backend_match.match_invitation_commands
  in access exclusive mode;

do $empty_guard$
begin
  if exists (
       select 1
       from backend_match.match_invitations
       limit 1
     )
     or exists (
       select 1
       from backend_match.match_invitation_commands
       limit 1
     ) then
    raise exception 'ROLLBACK_BLOCKED: migration 021 contains invitation history';
  end if;
end;
$empty_guard$;

drop table backend_match.match_invitation_commands;
drop table backend_match.match_invitations;

reset role;
commit;

select '021_backend_match_invitations rolled back safely' as result;
