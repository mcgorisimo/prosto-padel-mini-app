\set ON_ERROR_STOP on
select current_database() as database_name,
  pg_catalog.to_regclass('backend_match.matches') is not null
    as matches_ready,
  pg_catalog.to_regclass('backend_match.match_participants') is not null
    as participants_ready,
  pg_catalog.to_regclass('backend_match.match_invitations') is not null
    as invitations_ready,
  pg_catalog.to_regclass('backend_match.match_waitlist_entries') is not null
    as waitlist_ready,
  pg_catalog.to_regclass('backend_match.match_waitlist_offers') is null
    as offers_target_absent,
  pg_catalog.to_regclass('backend_match.match_waitlist_offer_commands') is null
    as commands_target_absent;

select status, pg_catalog.count(*)
from backend_match.match_waitlist_entries
group by status
order by status;
