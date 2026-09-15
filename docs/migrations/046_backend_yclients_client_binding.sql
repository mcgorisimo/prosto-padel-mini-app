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
select pg_catalog.set_config('prostopadel.expected_database', :'expected_database', true);
do $preconditions$
begin
  if current_database() <> current_setting('prostopadel.expected_database')
    or to_regclass('backend_auth.account_contacts') is null
    or to_regclass('backend_auth.contact_verification_challenges') is null
    or to_regclass('backend_auth.player_profile_details') is null
    or to_regclass('backend_auth.yclients_client_bindings') is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: foundation or target differs';
  end if;
  if not pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: owner role required';
  end if;
end;
$preconditions$;
set local role backend_auth_owner;

-- Existing profile phones are untrusted. Every phone mutation, including A->B->A,
-- advances this fence. Old and same-second challenges cannot authorize a bind.
alter table backend_auth.player_profile_details
  add column crm_phone_revision bigint not null default 1
    check (crm_phone_revision between 1 and 9007199254740991),
  add column crm_phone_changed_at bigint not null
    default floor(extract(epoch from clock_timestamp()))::bigint
    check (crm_phone_changed_at between 0 and 9007199254740991);

create function backend_auth.guard_crm_phone_revision() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $body$
begin
  if TG_OP = 'INSERT' then
    NEW.crm_phone_revision := 1;
    NEW.crm_phone_changed_at := floor(extract(epoch from clock_timestamp()))::bigint;
  elsif NEW.phone is distinct from OLD.phone then
    NEW.crm_phone_revision := OLD.crm_phone_revision + 1;
    NEW.crm_phone_changed_at := greatest(OLD.crm_phone_changed_at,
      floor(extract(epoch from clock_timestamp()))::bigint);
  else
    NEW.crm_phone_revision := OLD.crm_phone_revision;
    NEW.crm_phone_changed_at := OLD.crm_phone_changed_at;
  end if;
  return NEW;
end;
$body$;
create trigger crm_phone_revision_guard before insert or update
on backend_auth.player_profile_details for each row
execute function backend_auth.guard_crm_phone_revision();
revoke all on function backend_auth.guard_crm_phone_revision() from public, backend_auth_app;

-- A narrow privileged read: the app gets no direct access to 042 tables and no
-- UPDATE grant just to obtain row locks. Caller transaction owns all locks.
create function backend_auth.read_crm_phone_proof(p_account_id uuid)
returns table (proof jsonb) language plpgsql security definer
set search_path=pg_catalog,pg_temp as $body$
declare p backend_auth.player_profile_details%rowtype;
begin
  perform 1 from backend_auth.accounts
    where id=p_account_id and role='player' and status='active' for share;
  if not found then return; end if;
  select * into p from backend_auth.player_profile_details
    where account_id=p_account_id for share;
  if not found or p.phone is null then return; end if;
  return query
  select jsonb_build_object(
    'account_id', c.account_id, 'field', c.field, 'contact_version', c.contact_version,
    'subject_digest', encode(c.subject_digest,'hex'), 'digest_key_version', c.subject_digest_key_version,
    'ciphertext', encode(c.value_ciphertext,'hex'), 'nonce', encode(c.value_nonce,'hex'),
    'auth_tag', encode(c.value_auth_tag,'hex'), 'algorithm', c.value_algorithm, 'key_version', c.value_key_version,
    'profile_phone', p.phone, 'profile_revision', p.crm_phone_revision, 'profile_changed_at', p.crm_phone_changed_at,
    'challenge_id', h.challenge_id, 'method', h.method, 'purpose', h.purpose, 'state', h.state,
    'challenge_contact_version', h.contact_version, 'challenge_subject_digest', encode(h.subject_digest,'hex'),
    'challenge_digest_key_version', h.subject_digest_key_version, 'verified_command_id', h.verified_command_id,
    'created_at', h.created_at, 'verified_at', h.verified_at, 'expires_at', h.expires_at,
    'observed_at', floor(extract(epoch from clock_timestamp()))::bigint)
  from backend_auth.account_contacts c
  join backend_auth.contact_verification_challenges h on h.account_id=c.account_id and h.field=c.field
    and h.contact_version=c.contact_version and h.subject_digest=c.subject_digest
    and h.subject_digest_key_version=c.subject_digest_key_version
  where c.account_id=p_account_id and c.field='phone'
    and h.method='phone_sms_otp' and h.purpose='contact_ownership' and h.state='verified'
    and h.verified_command_id is not null and h.verified_at < h.expires_at
    and h.created_at > p.crm_phone_changed_at
  order by h.verified_at desc, h.challenge_id desc limit 1 for share of c,h;
end;
$body$;
revoke all on function backend_auth.read_crm_phone_proof(uuid) from public, backend_auth_app;
grant execute on function backend_auth.read_crm_phone_proof(uuid) to backend_auth_app;

create table backend_auth.yclients_client_bindings (
  account_id uuid not null references backend_auth.accounts(id),
  company_id bigint not null check (company_id between 1 and 9007199254740991),
  client_id bigint not null check (client_id between 1 and 9007199254740991),
  contact_version bigint not null check (contact_version between 1 and 9007199254740991),
  profile_revision bigint not null check (profile_revision between 1 and 9007199254740991),
  challenge_id uuid not null references backend_auth.contact_verification_challenges(challenge_id),
  subject_digest bytea not null check (octet_length(subject_digest)=32),
  digest_key_version integer not null check (digest_key_version > 0),
  linked_at bigint not null check (linked_at between 0 and 9007199254740991),
  primary key (account_id, company_id),
  unique (company_id, client_id)
);
revoke all on table backend_auth.yclients_client_bindings from public, backend_auth_app;
grant select, insert on table backend_auth.yclients_client_bindings to backend_auth_app;

create function backend_auth.guard_crm_binding_immutable() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $body$
begin
  raise exception 'CRM_BINDING_IMMUTABLE';
end;
$body$;
create trigger crm_binding_immutable before update or delete
on backend_auth.yclients_client_bindings for each row
execute function backend_auth.guard_crm_binding_immutable();
create trigger crm_binding_no_truncate before truncate
on backend_auth.yclients_client_bindings for each statement
execute function backend_auth.guard_crm_binding_immutable();
revoke all on function backend_auth.guard_crm_binding_immutable() from public, backend_auth_app;
commit;
