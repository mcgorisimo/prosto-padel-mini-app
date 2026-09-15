\set ON_ERROR_STOP on
\if :{?expected_database}
\else
  \echo 'expected_database is required'
  \quit 3
\endif
begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='5s';
set local statement_timeout='60s';
select set_config('prostopadel.expected_database', :'expected_database', true);
do $preconditions$
begin
  if current_database() <> current_setting('prostopadel.expected_database')
    or to_regclass('backend_auth.yclients_client_bindings') is null
    or to_regclass('backend_auth.admin_capability_events') is null
    or to_regclass('backend_auth.manual_crm_binding_drafts') is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED';
  end if;
end;
$preconditions$;
set local role backend_auth_owner;

create table backend_auth.manual_crm_binding_drafts (
  draft_id uuid primary key,
  actor_id uuid not null references backend_auth.accounts(id),
  target_id uuid not null references backend_auth.accounts(id),
  company_id bigint not null check (company_id between 1 and 9007199254740991),
  client_id bigint not null check (client_id between 1 and 9007199254740991),
  profile_revision bigint not null check (profile_revision between 1 and 9007199254740991),
  client_version text not null check (length(client_version) between 19 and 35),
  created_at bigint not null check (created_at >= 0),
  expires_at bigint not null check (expires_at=created_at+300),
  state text not null check (state in ('prepared','committed')),
  confirmed_at bigint,
  check ((state='prepared' and confirmed_at is null) or
    (state='committed' and confirmed_at is not null and confirmed_at >= created_at and confirmed_at < expires_at))
);
create index manual_crm_drafts_actor_time on backend_auth.manual_crm_binding_drafts(actor_id,created_at);
alter table backend_auth.yclients_client_bindings
  alter column contact_version drop not null,
  alter column challenge_id drop not null,
  alter column subject_digest drop not null,
  alter column digest_key_version drop not null,
  add column evidence_method text not null default 'phone_sms_otp',
  add column admin_actor_id uuid references backend_auth.accounts(id),
  add column admin_draft_id uuid references backend_auth.manual_crm_binding_drafts(draft_id),
  add constraint crm_binding_evidence_shape check (
    (evidence_method='phone_sms_otp' and contact_version is not null and challenge_id is not null
      and subject_digest is not null and digest_key_version is not null and admin_actor_id is null and admin_draft_id is null)
    or
    (evidence_method='admin_attested' and contact_version is null and challenge_id is null
      and subject_digest is null and digest_key_version is null and admin_actor_id is not null and admin_draft_id is not null)
  );

-- SECURITY DEFINER supplies only the revision, with no contact data. Locks stop
-- account state changes and capability grant/revoke inserts until short commit.
create function backend_auth.lock_manual_crm_context(actor uuid, target uuid)
returns table(revision bigint) language plpgsql security definer
set search_path=pg_catalog,pg_temp as $body$
begin
  perform id from backend_auth.accounts where id in (actor,target) order by id for update;
  lock table backend_auth.admin_capability_events in share mode;
  if not exists (select 1 from backend_auth.accounts where id=actor and status='active'
    and role in ('player','club_admin')) or
    (select event_type from backend_auth.admin_capability_events where account_id=actor
      and capability='club_admin' order by event_order desc limit 1) is distinct from 'granted' then return; end if;
  if not exists (select 1 from backend_auth.accounts where id=target and status='active' and role='player') then return; end if;
  return query select p.crm_phone_revision from backend_auth.player_profile_details p
    where p.account_id=target for share;
end;
$body$;
revoke all on function backend_auth.lock_manual_crm_context(uuid,uuid) from public, backend_auth_app;
grant execute on function backend_auth.lock_manual_crm_context(uuid,uuid) to backend_auth_app;

create function backend_auth.guard_manual_crm_draft() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $body$
begin
  if TG_OP <> 'UPDATE' then raise exception 'CRM_DRAFT_IMMUTABLE'; end if;
  if OLD.state <> 'prepared' or NEW.state <> 'committed' or
    (to_jsonb(NEW)-'state'-'confirmed_at') is distinct from (to_jsonb(OLD)-'state'-'confirmed_at') then
    raise exception 'CRM_DRAFT_IMMUTABLE';
  end if;
  return NEW;
end;
$body$;
create trigger manual_crm_draft_transition before update or delete
on backend_auth.manual_crm_binding_drafts for each row execute function backend_auth.guard_manual_crm_draft();
create trigger manual_crm_draft_no_truncate before truncate
on backend_auth.manual_crm_binding_drafts for each statement execute function backend_auth.guard_manual_crm_draft();
revoke all on function backend_auth.guard_manual_crm_draft() from public, backend_auth_app;
revoke all on table backend_auth.manual_crm_binding_drafts from public,backend_auth_app;
grant select,insert on table backend_auth.manual_crm_binding_drafts to backend_auth_app;
grant update(state,confirmed_at) on backend_auth.manual_crm_binding_drafts to backend_auth_app;
commit;
