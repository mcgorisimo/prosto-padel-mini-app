-- 044_backend_match_waitlist_offers.sql
-- Adds durable, owner-scoped 15-minute FIFO waitlist offers.

begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $preconditions$
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;
  if not pg_catalog.pg_has_role(
       current_user,'backend_auth_owner','MEMBER'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: owner role unavailable';
  end if;
  if pg_catalog.to_regclass('backend_match.matches') is null
     or pg_catalog.to_regclass('backend_match.match_participants') is null
     or pg_catalog.to_regclass('backend_match.match_invitations') is null
     or pg_catalog.to_regclass('backend_match.match_waitlist_entries') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required match relations are missing';
  end if;
  if pg_catalog.to_regclass('backend_match.match_waitlist_offers') is not null
     or pg_catalog.to_regclass(
       'backend_match.match_waitlist_offer_commands'
     ) is not null then
    raise exception 'MIGRATION_CONFLICT: migration 044 target exists';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_match.match_waitlist_offers (
  id uuid not null,
  entry_id uuid not null,
  match_id uuid not null,
  account_id uuid not null,
  slot_number smallint not null,
  status text not null,
  offered_at bigint not null,
  expires_at bigint not null,
  updated_at bigint not null,
  resolved_at bigint,
  version bigint not null,
  constraint match_waitlist_offers_pkey primary key (id),
  constraint match_waitlist_offers_identity_key
    unique (id, match_id, account_id),
  constraint match_waitlist_offers_entry_key unique (entry_id),
  constraint match_waitlist_offers_entry_binding_fkey
    foreign key (entry_id, match_id, account_id)
    references backend_match.match_waitlist_entries (
      id, match_id, account_id
    )
    on update no action on delete no action not deferrable,
  constraint match_waitlist_offers_slot_check
    check (slot_number=2 or slot_number=3 or slot_number=4),
  constraint match_waitlist_offers_status_check
    check (status=any(array[
      'active','accepted','declined','expired','cancelled'
    ]::text[])),
  constraint match_waitlist_offers_time_check check (
    offered_at between 0 and 9007199254740991
    and expires_at between offered_at+1 and 9007199254740991
    and updated_at between offered_at and 9007199254740991
    and (
      resolved_at is null
      or resolved_at between offered_at and updated_at
    )
  ),
  constraint match_waitlist_offers_version_check check (version=1 or version=2),
  constraint match_waitlist_offers_lifecycle_shape_check check (
    (status='active' and resolved_at is null and version=1)
    or
    (status<>'active' and resolved_at is not null and version=2)
  )
);

create unique index match_waitlist_offers_one_active_match
  on backend_match.match_waitlist_offers (match_id)
  where status='active';

create unique index match_waitlist_offers_one_active_slot
  on backend_match.match_waitlist_offers (match_id,slot_number)
  where status='active';

create index match_waitlist_offers_due_idx
  on backend_match.match_waitlist_offers (expires_at,match_id,id)
  where status='active';

create index match_waitlist_offers_account_history_idx
  on backend_match.match_waitlist_offers (
    account_id,offered_at desc,id
  );

create table backend_match.match_waitlist_offer_commands (
  command_id uuid not null,
  offer_id uuid not null,
  match_id uuid not null,
  actor_account_id uuid not null,
  request_digest bytea not null,
  command_type text not null,
  result_type text not null,
  applied_at bigint not null,
  offer_status text not null,
  offer_version bigint not null,
  constraint match_waitlist_offer_commands_pkey primary key (command_id),
  constraint match_waitlist_offer_commands_offer_binding_fkey
    foreign key (offer_id,match_id,actor_account_id)
    references backend_match.match_waitlist_offers (
      id,match_id,account_id
    )
    on update no action on delete no action not deferrable,
  constraint match_waitlist_offer_commands_digest_check
    check (pg_catalog.octet_length(request_digest)=32),
  constraint match_waitlist_offer_commands_type_check
    check (command_type='accept' or command_type='decline'),
  constraint match_waitlist_offer_commands_result_check
    check (result_type='accepted' or result_type='declined'),
  constraint match_waitlist_offer_commands_shape_check check (
    (command_type='accept' and result_type='accepted'
      and offer_status='accepted' and offer_version=2)
    or
    (command_type='decline' and result_type='declined'
      and offer_status='declined' and offer_version=2)
  ),
  constraint match_waitlist_offer_commands_applied_check
    check (applied_at between 0 and 9007199254740991)
);

create index match_waitlist_offer_commands_offer_idx
  on backend_match.match_waitlist_offer_commands (
    offer_id,applied_at,command_id
  );

revoke all on table
  backend_match.match_waitlist_offers,
  backend_match.match_waitlist_offer_commands
from public,backend_auth_app;

grant select on table
  backend_match.match_waitlist_offers,
  backend_match.match_waitlist_offer_commands
to backend_auth_app;

grant insert (
  id,entry_id,match_id,account_id,slot_number,status,
  offered_at,expires_at,updated_at,version
) on backend_match.match_waitlist_offers to backend_auth_app;

grant update (
  status,updated_at,resolved_at,version
) on backend_match.match_waitlist_offers to backend_auth_app;

grant insert (
  command_id,offer_id,match_id,actor_account_id,request_digest,
  command_type,result_type,applied_at,offer_status,offer_version
) on backend_match.match_waitlist_offer_commands to backend_auth_app;

do $comments$
declare
  offers_relation pg_catalog.regclass :=
    'backend_match.match_waitlist_offers'::pg_catalog.regclass;
  commands_relation pg_catalog.regclass :=
    'backend_match.match_waitlist_offer_commands'::pg_catalog.regclass;
begin
  execute pg_catalog.format(
    'comment on table %s is %L',
    offers_relation,
    '044_backend_match_waitlist_offers:'
      || backend_auth.relation_fingerprint(offers_relation)
  );
  execute pg_catalog.format(
    'comment on table %s is %L',
    commands_relation,
    '044_backend_match_waitlist_offers:'
      || backend_auth.relation_fingerprint(commands_relation)
  );
end;
$comments$;

do $assertions$
begin
  if (select pg_catalog.count(*)
      from backend_match.match_waitlist_offers)<>0
     or (select pg_catalog.count(*)
         from backend_match.match_waitlist_offer_commands)<>0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: new relations are not empty';
  end if;
end;
$assertions$;

reset role;
commit;

select '044_backend_match_waitlist_offers applied; run POSTCHECK'
  as result;
