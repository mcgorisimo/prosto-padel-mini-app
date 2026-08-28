\set ON_ERROR_STOP on
select current_database() as database_name,
  pg_catalog.to_regclass(
    'backend_auth.account_notification_preferences'
  ) is not null as preferences_ready,
  pg_catalog.to_regclass(
    'backend_auth.telegram_notification_destinations'
  ) is not null as destinations_ready,
  pg_catalog.to_regclass(
    'backend_reservation.court_reservations'
  ) is not null as reservations_ready,
  pg_catalog.to_regnamespace('backend_notification') is null
    as target_schema_absent;

select pg_catalog.count(*) as pending_legacy_outbox
from backend_match.telegram_notification_outbox
where status='pending';
