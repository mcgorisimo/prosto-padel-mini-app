-- 015_backend_auth_foundation.sql
-- PostgreSQL-only persistence foundation for backend authentication.
-- Creates no roles, extensions, users, accounts, seed data, or secrets.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
begin
  select * into v_owner from pg_catalog.pg_roles where rolname = 'backend_auth_owner';
  select * into v_app from pg_catalog.pg_roles where rolname = 'backend_auth_app';

  if not found or v_app.rolname is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app is missing';
  end if;
  if v_owner.rolname is null
     or v_owner.rolcanlogin
     or v_owner.rolsuper
     or v_owner.rolcreaterole
     or v_owner.rolcreatedb
     or v_owner.rolreplication
     or v_owner.rolbypassrls then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_owner must be a non-privileged NOLOGIN owner';
  end if;
  if not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app role attributes are unsafe';
  end if;
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;
  if pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app must not inherit the owner role';
  end if;
  if pg_catalog.has_database_privilege(
    'backend_auth_app', pg_catalog.current_database(), 'CREATE'
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app must not have database CREATE';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) acl
    where d.defaclrole = 'backend_auth_owner'::pg_catalog.regrole
      and acl.grantee = 'backend_auth_app'::pg_catalog.regrole
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: owner default ACL grants access to backend_auth_app';
  end if;
  if not pg_catalog.has_database_privilege(
    'backend_auth_owner', pg_catalog.current_database(), 'CREATE'
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_owner lacks database CREATE';
  end if;
  if pg_catalog.to_regnamespace('backend_auth') is not null then
    raise exception 'MIGRATION_CONFLICT: schema backend_auth already exists';
  end if;
end;
$$;

set local role backend_auth_owner;

create schema backend_auth authorization backend_auth_owner;
revoke all on schema backend_auth from public, backend_auth_app;

-- Migration 015 changes privileges only on its concrete objects. It does not
-- alter backend_auth_owner defaults for future objects in this or any schema.

create table backend_auth.accounts (
  id uuid not null,
  role text not null default 'player'::text,
  status text not null default 'active'::text,
  created_at bigint not null,
  updated_at bigint not null,
  constraint accounts_pkey primary key (id),
  constraint accounts_role_check check (role = any (array['player', 'club_admin']::text[])),
  constraint accounts_status_check check (
    status = any (array['active', 'blocked', 'pending_deletion', 'anonymized']::text[])
  ),
  constraint accounts_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
  )
);

create table backend_auth.player_profiles (
  account_id uuid not null,
  constraint player_profiles_pkey primary key (account_id),
  constraint player_profiles_account_id_fkey foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable
);

create table backend_auth.external_identities (
  id uuid not null,
  account_id uuid not null,
  provider text not null,
  namespace text not null,
  status text not null,
  is_primary boolean not null,
  constraint external_identities_pkey primary key (id),
  constraint external_identities_binding_key unique (id, provider, namespace),
  constraint external_identities_account_id_fkey foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint external_identities_provider_check check (
    provider = any (array['telegram', 'apple', 'google', 'phone']::text[])
  ),
  constraint external_identities_namespace_check check (
    char_length(namespace) between 1 and 128
    and pg_catalog.btrim(namespace) = namespace
    and namespace !~ '[[:cntrl:]]'
  ),
  constraint external_identities_state_check check (
    (status = 'linked')
    or (status = 'unlinked' and not is_primary)
  )
);

create table backend_auth.external_identity_lookup_digests (
  identity_id uuid not null,
  algorithm text not null,
  provider text not null,
  namespace text not null,
  digest bytea not null,
  digest_version bigint not null,
  pepper_version bigint not null,
  created_at bigint not null,
  constraint external_identity_lookup_digests_pkey
    primary key (identity_id, digest_version, pepper_version),
  constraint external_identity_lookup_digests_global_key
    unique (provider, namespace, digest),
  constraint external_identity_lookup_digests_identity_fkey
    foreign key (identity_id, provider, namespace)
    references backend_auth.external_identities (id, provider, namespace)
    on update no action on delete no action not deferrable,
  constraint external_identity_lookup_digests_algorithm_check
    check (algorithm = 'hmac-sha-256'),
  constraint external_identity_lookup_digests_provider_check check (
    provider = any (array['telegram', 'apple', 'google', 'phone']::text[])
  ),
  constraint external_identity_lookup_digests_namespace_check check (
    char_length(namespace) between 1 and 128
    and pg_catalog.btrim(namespace) = namespace
    and namespace !~ '[[:cntrl:]]'
  ),
  constraint external_identity_lookup_digests_digest_check
    check (pg_catalog.octet_length(digest) = 32),
  constraint external_identity_lookup_digests_version_check check (
    digest_version between 1 and 9007199254740991
    and pepper_version between 1 and 9007199254740991
  ),
  constraint external_identity_lookup_digests_created_at_check
    check (created_at between 0 and 9007199254740991)
);

create table backend_auth.authentication_operations (
  id uuid not null,
  intent text not null,
  identity_provider text not null,
  identity_namespace text not null,
  identity_lookup_digest bytea not null,
  proof_type text not null,
  telegram_proof_fingerprint bytea,
  otp_challenge_id uuid,
  created_at bigint not null,
  expires_at bigint not null,
  idempotency_key text not null,
  request_digest text not null,
  status text not null default 'pending'::text,
  resolution_type text,
  resolution_account_id uuid,
  resolution_account_status text,
  resolution_initial_role text,
  resolution_reason text,
  failure_reason text,
  terminal_command_id uuid,
  terminal_command_type text,
  terminal_applied_at bigint,
  constraint authentication_operations_pkey primary key (id),
  constraint authentication_operations_idempotency_key_key unique (idempotency_key),
  constraint authentication_operations_telegram_fingerprint_key
    unique (telegram_proof_fingerprint),
  constraint authentication_operations_otp_challenge_key unique (otp_challenge_id),
  constraint authentication_operations_resolution_account_fkey
    foreign key (resolution_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint authentication_operations_intent_check check (
    intent = any (array[
      'sign_in', 'sign_up', 'link_identity', 'fresh_authentication', 'account_recovery'
    ]::text[])
  ),
  constraint authentication_operations_identity_provider_check check (
    identity_provider = any (array['telegram', 'apple', 'google', 'phone']::text[])
  ),
  constraint authentication_operations_identity_namespace_check check (
    char_length(identity_namespace) between 1 and 128
    and pg_catalog.btrim(identity_namespace) = identity_namespace
    and identity_namespace !~ '[[:cntrl:]]'
  ),
  constraint authentication_operations_identity_digest_check
    check (pg_catalog.octet_length(identity_lookup_digest) = 32),
  constraint authentication_operations_proof_check check (
    (proof_type = 'telegram_proof'
      and telegram_proof_fingerprint is not null
      and pg_catalog.octet_length(telegram_proof_fingerprint) = 32
      and otp_challenge_id is null)
    or
    (proof_type = 'otp_challenge'
      and telegram_proof_fingerprint is null
      and otp_challenge_id is not null)
  ),
  constraint authentication_operations_window_check check (
    created_at between 0 and 9007199254740991
    and expires_at between 0 and 9007199254740991
    and created_at < expires_at
  ),
  constraint authentication_operations_idempotency_key_check check (
    char_length(idempotency_key) between 1 and 256
    and pg_catalog.btrim(idempotency_key) = idempotency_key
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint authentication_operations_request_digest_check check (
    char_length(request_digest) between 1 and 256
    and pg_catalog.btrim(request_digest) = request_digest
    and request_digest !~ '[[:cntrl:]]'
  ),
  constraint authentication_operations_status_check check (
    status = any (array['pending', 'completed', 'failed', 'expired']::text[])
  ),
  constraint authentication_operations_resolution_values_check check (
    (resolution_type is null or resolution_type = any (array[
      'existing_account', 'new_account_required', 'blocked', 'conflict'
    ]::text[]))
    and (resolution_account_status is null or resolution_account_status = any (array[
      'active', 'blocked', 'pending_deletion'
    ]::text[]))
    and (resolution_initial_role is null or resolution_initial_role = 'player')
    and (resolution_reason is null or resolution_reason = any (array[
      'account_blocked', 'account_pending_deletion',
      'identity_already_linked_incompatibly', 'ambiguous_account_resolution',
      'account_anonymized', 'intent_incompatible_with_current_binding'
    ]::text[]))
    and (failure_reason is null or failure_reason = any (array[
      'proof_validation_unavailable', 'account_resolution_unavailable',
      'internal_dependency_unavailable', 'operation_cancelled'
    ]::text[]))
  ),
  constraint authentication_operations_resolution_shape_check check (
    (resolution_type is null
      and resolution_account_id is null
      and resolution_account_status is null
      and resolution_initial_role is null
      and resolution_reason is null)
    or
    (resolution_type = 'existing_account'
      and resolution_account_id is not null
      and resolution_account_status = 'active'
      and resolution_initial_role is null
      and resolution_reason is null)
    or
    (resolution_type = 'new_account_required'
      and resolution_account_id is null
      and resolution_account_status is null
      and resolution_initial_role = 'player'
      and resolution_reason is null)
    or
    (resolution_type = 'blocked'
      and resolution_account_id is not null
      and resolution_initial_role is null
      and ((resolution_account_status = 'blocked' and resolution_reason = 'account_blocked')
        or (resolution_account_status = 'pending_deletion'
          and resolution_reason = 'account_pending_deletion')))
    or
    (resolution_type = 'conflict'
      and resolution_account_id is null
      and resolution_account_status is null
      and resolution_initial_role is null
      and resolution_reason = any (array[
        'identity_already_linked_incompatibly', 'ambiguous_account_resolution',
        'account_anonymized', 'intent_incompatible_with_current_binding'
      ]::text[]))
  ),
  constraint authentication_operations_intent_resolution_check check (
    resolution_type is null
    or resolution_type <> 'new_account_required'
    or intent = 'sign_up'
  ),
  constraint authentication_operations_terminal_check check (
    (status = 'pending'
      and resolution_type is null
      and failure_reason is null
      and terminal_command_id is null
      and terminal_command_type is null
      and terminal_applied_at is null)
    or
    (status = 'completed'
      and resolution_type is not null
      and failure_reason is null
      and terminal_command_id is not null
      and terminal_command_type = 'complete'
      and terminal_applied_at >= created_at
      and terminal_applied_at < expires_at)
    or
    (status = 'failed'
      and resolution_type is null
      and failure_reason is not null
      and terminal_command_id is not null
      and terminal_command_type = 'fail'
      and terminal_applied_at >= created_at
      and terminal_applied_at < expires_at)
    or
    (status = 'expired'
      and resolution_type is null
      and failure_reason is null
      and terminal_command_id is not null
      and terminal_command_type = 'expire'
      and terminal_applied_at >= expires_at
      and terminal_applied_at <= 9007199254740991)
  )
);

create table backend_auth.telegram_proof_consumptions (
  proof_fingerprint bytea not null,
  proof_expires_at bigint not null,
  intent text not null,
  idempotency_key text not null,
  request_digest text not null,
  operation_id uuid not null,
  consumed_at bigint not null,
  constraint telegram_proof_consumptions_pkey primary key (proof_fingerprint),
  constraint telegram_proof_consumptions_idempotency_key_key unique (idempotency_key),
  constraint telegram_proof_consumptions_operation_id_key unique (operation_id),
  constraint telegram_proof_consumptions_operation_id_fkey foreign key (operation_id)
    references backend_auth.authentication_operations (id)
    on update no action on delete no action not deferrable,
  constraint telegram_proof_consumptions_fingerprint_check
    check (pg_catalog.octet_length(proof_fingerprint) = 32),
  constraint telegram_proof_consumptions_intent_check check (
    intent = any (array[
      'sign_in', 'sign_up', 'link_identity', 'fresh_authentication', 'account_recovery'
    ]::text[])
  ),
  constraint telegram_proof_consumptions_idempotency_key_check check (
    char_length(idempotency_key) between 1 and 256
    and pg_catalog.btrim(idempotency_key) = idempotency_key
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint telegram_proof_consumptions_request_digest_check check (
    char_length(request_digest) between 1 and 256
    and pg_catalog.btrim(request_digest) = request_digest
    and request_digest !~ '[[:cntrl:]]'
  ),
  constraint telegram_proof_consumptions_time_check check (
    consumed_at between 0 and 9007199254740991
    and proof_expires_at between 0 and 9007199254740991
    and consumed_at < proof_expires_at
  )
);

create table backend_auth.auth_session_families (
  id uuid not null,
  account_id uuid not null,
  authentication_operation_id uuid not null,
  status text not null default 'active'::text,
  current_credential_generation bigint not null,
  created_at bigint not null,
  expires_at bigint not null,
  terminal_command_id uuid,
  terminal_reason text,
  terminal_at bigint,
  terminal_reuse_generation bigint,
  terminal_reuse_digest bytea,
  constraint auth_session_families_pkey primary key (id),
  constraint auth_session_families_operation_id_key unique (authentication_operation_id),
  constraint auth_session_families_id_account_key unique (id, account_id),
  constraint auth_session_families_account_id_fkey foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint auth_session_families_operation_id_fkey
    foreign key (authentication_operation_id)
    references backend_auth.authentication_operations (id)
    on update no action on delete no action not deferrable,
  constraint auth_session_families_status_check check (
    status = any (array['active', 'revoked', 'expired', 'reuse_detected']::text[])
  ),
  constraint auth_session_families_generation_check check (
    current_credential_generation between 1 and 9007199254740991
    and (terminal_reuse_generation is null
      or terminal_reuse_generation between 1 and 9007199254740991)
  ),
  constraint auth_session_families_window_check check (
    created_at between 0 and 9007199254740991
    and expires_at between 0 and 9007199254740991
    and created_at < expires_at
  ),
  constraint auth_session_families_reason_check check (
    terminal_reason is null or terminal_reason = any (array[
      'user_sign_out', 'administrator', 'account_blocked',
      'security_event', 'superseded'
    ]::text[])
  ),
  constraint auth_session_families_reuse_digest_check check (
    terminal_reuse_digest is null
    or pg_catalog.octet_length(terminal_reuse_digest) = 32
  ),
  constraint auth_session_families_terminal_check check (
    (status = 'active'
      and terminal_command_id is null and terminal_reason is null
      and terminal_at is null and terminal_reuse_generation is null
      and terminal_reuse_digest is null)
    or
    (status = 'revoked'
      and terminal_command_id is not null and terminal_reason is not null
      and terminal_at between created_at and expires_at - 1
      and terminal_reuse_generation is null and terminal_reuse_digest is null)
    or
    (status = 'expired'
      and terminal_command_id is not null and terminal_reason is null
      and terminal_at between expires_at and 9007199254740991
      and terminal_reuse_generation is null and terminal_reuse_digest is null)
    or
    (status = 'reuse_detected'
      and terminal_command_id is not null and terminal_reason is null
      and terminal_at between created_at and 9007199254740991
      and terminal_reuse_generation is not null
      and terminal_reuse_digest is not null)
  )
);

create table backend_auth.auth_session_credentials (
  family_id uuid not null,
  generation bigint not null,
  digest bytea not null,
  issued_at bigint not null,
  consumed_at bigint,
  consumed_by_command_id uuid,
  constraint auth_session_credentials_pkey primary key (family_id, generation),
  constraint auth_session_credentials_family_digest_key unique (family_id, digest),
  constraint auth_session_credentials_family_id_fkey foreign key (family_id)
    references backend_auth.auth_session_families (id)
    on update no action on delete no action not deferrable,
  constraint auth_session_credentials_generation_check
    check (generation between 1 and 9007199254740991),
  constraint auth_session_credentials_digest_check
    check (pg_catalog.octet_length(digest) = 32),
  constraint auth_session_credentials_time_check check (
    issued_at between 0 and 9007199254740991
    and (consumed_at is null or consumed_at between issued_at and 9007199254740991)
  ),
  constraint auth_session_credentials_consumption_check check (
    (consumed_at is null and consumed_by_command_id is null)
    or (consumed_at is not null and consumed_by_command_id is not null)
  )
);

create table backend_auth.auth_session_commands (
  family_id uuid not null,
  command_id uuid not null,
  command_sequence bigint not null,
  request_digest text not null,
  command_type text not null,
  applied_at bigint not null,
  presented_generation bigint,
  presented_digest bytea,
  next_generation bigint,
  next_digest bytea,
  reason text,
  result_type text not null,
  constraint auth_session_commands_pkey primary key (family_id, command_id),
  constraint auth_session_commands_family_sequence_key unique (family_id, command_sequence),
  constraint auth_session_commands_family_id_fkey foreign key (family_id)
    references backend_auth.auth_session_families (id)
    on update no action on delete no action not deferrable,
  constraint auth_session_commands_sequence_check
    check (command_sequence between 1 and 9007199254740991),
  constraint auth_session_commands_request_digest_check check (
    char_length(request_digest) between 1 and 256
    and pg_catalog.btrim(request_digest) = request_digest
    and request_digest !~ '[[:cntrl:]]'
  ),
  constraint auth_session_commands_applied_at_check
    check (applied_at between 0 and 9007199254740991),
  constraint auth_session_commands_credential_reference_check check (
    (presented_generation is null and presented_digest is null
      and next_generation is null and next_digest is null)
    or
    (presented_generation between 1 and 9007199254740991
      and pg_catalog.octet_length(presented_digest) = 32
      and next_generation between 1 and 9007199254740991
      and pg_catalog.octet_length(next_digest) = 32)
  ),
  constraint auth_session_commands_reason_check check (
    reason is null or reason = any (array[
      'user_sign_out', 'administrator', 'account_blocked',
      'security_event', 'superseded'
    ]::text[])
  ),
  constraint auth_session_commands_variant_check check (
    (command_type = 'rotate_credential'
      and presented_generation is not null and presented_digest is not null
      and next_generation is not null and next_digest is not null
      and reason is null
      and result_type = any (array['credential_rotated', 'reuse_detected']::text[]))
    or
    (command_type = 'revoke_session'
      and presented_generation is null and presented_digest is null
      and next_generation is null and next_digest is null
      and reason is not null and result_type = 'session_revoked')
    or
    (command_type = 'expire_session'
      and presented_generation is null and presented_digest is null
      and next_generation is null and next_digest is null
      and reason is null and result_type = 'session_expired')
  )
);

create table backend_auth.fresh_authentication_evidence (
  id uuid not null,
  account_id uuid not null,
  family_id uuid not null,
  verification_method text not null,
  authenticated_at bigint not null,
  expires_at bigint not null,
  constraint fresh_authentication_evidence_pkey primary key (id),
  constraint fresh_authentication_evidence_binding_key unique (id, account_id, family_id),
  constraint fresh_authentication_evidence_family_account_fkey
    foreign key (family_id, account_id)
    references backend_auth.auth_session_families (id, account_id)
    on update no action on delete no action not deferrable,
  constraint fresh_authentication_evidence_method_check check (
    verification_method = any (array['external_identity', 'otp', 'admin_totp']::text[])
  ),
  constraint fresh_authentication_evidence_window_check check (
    authenticated_at between 0 and 9007199254740991
    and expires_at between 0 and 9007199254740991
    and authenticated_at < expires_at
  )
);

create table backend_auth.reauthentication_grants (
  id uuid not null,
  evidence_id uuid not null,
  account_id uuid not null,
  family_id uuid not null,
  scope text not null,
  resource_digest bytea not null,
  created_at bigint not null,
  expires_at bigint not null,
  status text not null default 'active'::text,
  terminal_command_id uuid,
  terminal_command_type text,
  terminal_request_digest bytea,
  terminal_applied_at bigint,
  terminal_reason text,
  constraint reauthentication_grants_pkey primary key (id),
  constraint reauthentication_grants_evidence_binding_fkey
    foreign key (evidence_id, account_id, family_id)
    references backend_auth.fresh_authentication_evidence (id, account_id, family_id)
    on update no action on delete no action not deferrable,
  constraint reauthentication_grants_scope_check check (
    scope = any (array[
      'link_identity', 'unlink_identity', 'revoke_other_sessions',
      'begin_account_deletion', 'change_primary_identity'
    ]::text[])
  ),
  constraint reauthentication_grants_resource_digest_check
    check (pg_catalog.octet_length(resource_digest) = 32),
  constraint reauthentication_grants_window_check check (
    created_at between 0 and 9007199254740991
    and expires_at between 0 and 9007199254740991
    and created_at < expires_at
  ),
  constraint reauthentication_grants_status_check check (
    status = any (array['active', 'consumed', 'revoked', 'expired']::text[])
  ),
  constraint reauthentication_grants_terminal_digest_check check (
    terminal_request_digest is null
    or pg_catalog.octet_length(terminal_request_digest) = 32
  ),
  constraint reauthentication_grants_reason_check check (
    terminal_reason is null or terminal_reason = any (array[
      'user_cancelled', 'session_revoked', 'security_event', 'superseded'
    ]::text[])
  ),
  constraint reauthentication_grants_terminal_check check (
    (status = 'active'
      and terminal_command_id is null and terminal_command_type is null
      and terminal_request_digest is null and terminal_applied_at is null
      and terminal_reason is null)
    or
    (status = 'consumed'
      and terminal_command_id is not null and terminal_command_type = 'consume_grant'
      and terminal_request_digest is not null
      and terminal_applied_at between created_at and expires_at - 1
      and terminal_reason is null)
    or
    (status = 'revoked'
      and terminal_command_id is not null and terminal_command_type = 'revoke_grant'
      and terminal_request_digest is not null
      and terminal_applied_at between created_at and expires_at - 1
      and terminal_reason is not null)
    or
    (status = 'expired'
      and terminal_command_id is not null and terminal_command_type = 'expire_grant'
      and terminal_request_digest is not null
      and terminal_applied_at between expires_at and 9007199254740991
      and terminal_reason is null)
  )
);

create table backend_auth.otp_challenges (
  id uuid not null,
  intent text not null,
  identity_provider text not null,
  identity_namespace text not null,
  identity_lookup_digest bytea not null,
  operation_id uuid not null,
  request_digest bytea not null,
  verifier_digest bytea not null,
  created_at bigint not null,
  expires_at bigint not null,
  max_attempts bigint not null,
  attempts_remaining bigint not null,
  status text not null default 'pending'::text,
  terminal_command_id uuid,
  terminal_at bigint,
  terminal_reason text,
  constraint otp_challenges_pkey primary key (id),
  constraint otp_challenges_operation_id_key unique (operation_id),
  constraint otp_challenges_operation_id_fkey foreign key (operation_id)
    references backend_auth.authentication_operations (id)
    on update no action on delete no action not deferrable,
  constraint otp_challenges_intent_check check (
    intent = any (array[
      'sign_in', 'sign_up', 'link_identity', 'fresh_authentication', 'account_recovery'
    ]::text[])
  ),
  constraint otp_challenges_identity_check check (
    identity_provider = 'phone'
    and char_length(identity_namespace) between 1 and 128
    and pg_catalog.btrim(identity_namespace) = identity_namespace
    and identity_namespace !~ '[[:cntrl:]]'
    and pg_catalog.octet_length(identity_lookup_digest) = 32
  ),
  constraint otp_challenges_digest_check check (
    pg_catalog.octet_length(request_digest) = 32
    and pg_catalog.octet_length(verifier_digest) = 32
  ),
  constraint otp_challenges_window_check check (
    created_at between 0 and 9007199254740991
    and expires_at between 0 and 9007199254740991
    and created_at < expires_at
  ),
  constraint otp_challenges_attempts_check check (
    max_attempts between 1 and 10
    and attempts_remaining between 0 and max_attempts
  ),
  constraint otp_challenges_status_check check (
    status = any (array[
      'pending', 'verified', 'expired', 'attempts_exhausted', 'cancelled'
    ]::text[])
  ),
  constraint otp_challenges_reason_check check (
    terminal_reason is null or terminal_reason = any (array[
      'user_cancelled', 'superseded', 'security_event'
    ]::text[])
  ),
  constraint otp_challenges_terminal_check check (
    (status = 'pending'
      and attempts_remaining >= 1
      and terminal_command_id is null and terminal_at is null and terminal_reason is null)
    or
    (status = 'verified'
      and attempts_remaining >= 1
      and terminal_command_id is not null
      and terminal_at between created_at and expires_at - 1
      and terminal_reason is null)
    or
    (status = 'attempts_exhausted'
      and attempts_remaining = 0
      and terminal_command_id is not null
      and terminal_at between created_at and expires_at - 1
      and terminal_reason is null)
    or
    (status = 'expired'
      and attempts_remaining >= 1
      and terminal_command_id is not null
      and terminal_at between expires_at and 9007199254740991
      and terminal_reason is null)
    or
    (status = 'cancelled'
      and attempts_remaining >= 1
      and terminal_command_id is not null
      and terminal_at between created_at and expires_at - 1
      and terminal_reason is not null)
  )
);

create table backend_auth.otp_commands (
  challenge_id uuid not null,
  command_id uuid not null,
  command_sequence bigint not null,
  request_digest bytea not null,
  command_type text not null,
  applied_at bigint not null,
  presented_digest bytea,
  reason text,
  result_type text not null,
  result_attempts_remaining bigint,
  constraint otp_commands_pkey primary key (challenge_id, command_id),
  constraint otp_commands_challenge_sequence_key unique (challenge_id, command_sequence),
  constraint otp_commands_challenge_id_fkey foreign key (challenge_id)
    references backend_auth.otp_challenges (id)
    on update no action on delete no action not deferrable,
  constraint otp_commands_sequence_check
    check (command_sequence between 1 and 9007199254740991),
  constraint otp_commands_request_digest_check
    check (pg_catalog.octet_length(request_digest) = 32),
  constraint otp_commands_applied_at_check
    check (applied_at between 0 and 9007199254740991),
  constraint otp_commands_presented_digest_check check (
    presented_digest is null or pg_catalog.octet_length(presented_digest) = 32
  ),
  constraint otp_commands_reason_check check (
    reason is null or reason = any (array[
      'user_cancelled', 'superseded', 'security_event'
    ]::text[])
  ),
  constraint otp_commands_result_attempts_check check (
    result_attempts_remaining is null
    or result_attempts_remaining between 1 and 10
  ),
  constraint otp_commands_variant_check check (
    (command_type = 'submit_otp'
      and presented_digest is not null and reason is null
      and result_type = any (array[
        'otp_verified', 'incorrect_code', 'otp_attempts_exhausted'
      ]::text[])
      and ((result_type = 'incorrect_code' and result_attempts_remaining is not null)
        or (result_type <> 'incorrect_code' and result_attempts_remaining is null)))
    or
    (command_type = 'cancel_otp'
      and presented_digest is null and reason is not null
      and result_type = 'otp_cancelled' and result_attempts_remaining is null)
    or
    (command_type = 'expire_otp'
      and presented_digest is null and reason is null
      and result_type = 'otp_expired' and result_attempts_remaining is null)
  )
);

create table backend_auth.security_audit_events (
  event_order bigint generated always as identity,
  event_id uuid not null,
  event_type text not null,
  outcome text not null,
  occurred_at bigint not null,
  account_id uuid,
  role text,
  previous_status text,
  next_status text,
  identity_id uuid,
  provider text,
  reserved_account_id uuid,
  attempted_account_id uuid,
  operation_id uuid,
  attempted_operation_id uuid,
  intent text,
  terminal_status text,
  challenge_id uuid,
  otp_status text,
  session_id uuid,
  session_status text,
  generation bigint,
  evidence_id uuid,
  verification_method text,
  grant_id uuid,
  scope text,
  grant_status text,
  aggregate_type text,
  aggregate_id uuid,
  constraint security_audit_events_pkey primary key (event_id),
  constraint security_audit_events_event_order_key unique (event_order),
  constraint security_audit_events_account_id_fkey foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint security_audit_events_identity_id_fkey foreign key (identity_id)
    references backend_auth.external_identities (id)
    on update no action on delete no action not deferrable,
  constraint security_audit_events_reserved_account_id_fkey
    foreign key (reserved_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint security_audit_events_operation_id_fkey foreign key (operation_id)
    references backend_auth.authentication_operations (id)
    on update no action on delete no action not deferrable,
  constraint security_audit_events_challenge_id_fkey foreign key (challenge_id)
    references backend_auth.otp_challenges (id)
    on update no action on delete no action not deferrable,
  constraint security_audit_events_session_id_fkey foreign key (session_id)
    references backend_auth.auth_session_families (id)
    on update no action on delete no action not deferrable,
  constraint security_audit_events_evidence_id_fkey foreign key (evidence_id)
    references backend_auth.fresh_authentication_evidence (id)
    on update no action on delete no action not deferrable,
  constraint security_audit_events_grant_id_fkey foreign key (grant_id)
    references backend_auth.reauthentication_grants (id)
    on update no action on delete no action not deferrable,
  constraint security_audit_events_event_type_check check (
    event_type = any (array[
      'account_created', 'account_status_changed', 'external_identity_linked',
      'external_identity_unlinked', 'external_identity_transfer_blocked',
      'authentication_operation_terminal', 'telegram_proof_consumption',
      'otp_challenge_transition', 'session_family_created',
      'session_family_transition', 'session_credential_rotation',
      'fresh_authentication_issued', 'reauthentication_grant_issued',
      'reauthentication_grant_transition', 'persisted_auth_state_rejected'
    ]::text[])
  ),
  constraint security_audit_events_outcome_check check (
    outcome = any (array[
      'success', 'idempotent_retry', 'denied', 'expired', 'replay_detected',
      'conflict', 'invalid_state', 'dependency_failure'
    ]::text[])
  ),
  constraint security_audit_events_occurred_at_check
    check (occurred_at between 0 and 9007199254740991),
  constraint security_audit_events_metadata_values_check check (
    (role is null or role = any (array['player', 'club_admin']::text[]))
    and (previous_status is null or previous_status = any (array[
      'active', 'blocked', 'pending_deletion', 'anonymized'
    ]::text[]))
    and (next_status is null or next_status = any (array[
      'active', 'blocked', 'pending_deletion', 'anonymized'
    ]::text[]))
    and (provider is null or provider = any (array[
      'telegram', 'apple', 'google', 'phone'
    ]::text[]))
    and (intent is null or intent = any (array[
      'sign_in', 'sign_up', 'link_identity', 'fresh_authentication', 'account_recovery'
    ]::text[]))
    and (terminal_status is null or terminal_status = any (array[
      'completed', 'failed', 'expired'
    ]::text[]))
    and (otp_status is null or otp_status = any (array[
      'verified', 'incorrect_code', 'attempts_exhausted', 'expired', 'cancelled'
    ]::text[]))
    and (session_status is null or session_status = any (array[
      'active', 'revoked', 'expired', 'reuse_detected'
    ]::text[]))
    and (generation is null or generation between 1 and 9007199254740991)
    and (verification_method is null or verification_method = any (array[
      'external_identity', 'otp', 'admin_totp'
    ]::text[]))
    and (scope is null or scope = any (array[
      'link_identity', 'unlink_identity', 'revoke_other_sessions',
      'begin_account_deletion', 'change_primary_identity'
    ]::text[]))
    and (grant_status is null or grant_status = any (array[
      'active', 'consumed', 'revoked', 'expired'
    ]::text[]))
    and (aggregate_type is null or aggregate_type = any (array[
      'account', 'external_identity', 'authentication_operation',
      'telegram_proof_consumption', 'otp_challenge', 'session_family',
      'fresh_authentication_evidence', 'reauthentication_grant'
    ]::text[]))
  ),
  constraint security_audit_events_metadata_shape_check check (
    (event_type = 'account_created'
      and account_id is not null and role is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 2)
    or
    (event_type = 'account_status_changed'
      and account_id is not null and previous_status is not null and next_status is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 3)
    or
    (event_type = any (array['external_identity_linked', 'external_identity_unlinked']::text[])
      and identity_id is not null and account_id is not null and provider is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 3)
    or
    (event_type = 'external_identity_transfer_blocked'
      and identity_id is not null and reserved_account_id is not null
      and attempted_account_id is not null and provider is not null
      and reserved_account_id <> attempted_account_id
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 4)
    or
    (event_type = 'authentication_operation_terminal'
      and operation_id is not null and intent is not null and terminal_status is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 3)
    or
    (event_type = 'telegram_proof_consumption'
      and ((operation_id is not null and attempted_operation_id is null)
        or (operation_id is null and attempted_operation_id is not null
          and outcome = any (array[
            'replay_detected', 'conflict', 'dependency_failure'
          ]::text[])))
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 1)
    or
    (event_type = 'otp_challenge_transition'
      and challenge_id is not null and otp_status is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 2)
    or
    (event_type = 'session_family_created'
      and session_id is not null and account_id is not null and operation_id is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 3)
    or
    (event_type = 'session_family_transition'
      and session_id is not null and session_status is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 2)
    or
    (event_type = 'session_credential_rotation'
      and session_id is not null and generation is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 2)
    or
    (event_type = 'fresh_authentication_issued'
      and evidence_id is not null and account_id is not null and session_id is not null
      and verification_method is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 4)
    or
    (event_type = 'reauthentication_grant_issued'
      and grant_id is not null and account_id is not null and session_id is not null
      and scope is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 4)
    or
    (event_type = 'reauthentication_grant_transition'
      and grant_id is not null and grant_status is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 2)
    or
    (event_type = 'persisted_auth_state_rejected'
      and aggregate_type is not null and aggregate_id is not null
      and pg_catalog.num_nonnulls(
        account_id, role, previous_status, next_status, identity_id, provider,
        reserved_account_id, attempted_account_id, operation_id, attempted_operation_id,
        intent, terminal_status, challenge_id, otp_status, session_id, session_status,
        generation, evidence_id, verification_method, grant_id, scope, grant_status,
        aggregate_type, aggregate_id
      ) = 2)
  )
);

-- Candidate keys exist before these cyclic and same-aggregate foreign keys.
alter table backend_auth.authentication_operations
  add constraint authentication_operations_telegram_proof_fkey
  foreign key (telegram_proof_fingerprint)
  references backend_auth.telegram_proof_consumptions (proof_fingerprint)
  on update no action on delete no action deferrable initially deferred,
  add constraint authentication_operations_otp_challenge_fkey
  foreign key (otp_challenge_id)
  references backend_auth.otp_challenges (id)
  on update no action on delete no action deferrable initially deferred;

alter table backend_auth.auth_session_families
  add constraint auth_session_families_current_credential_fkey
  foreign key (id, current_credential_generation)
  references backend_auth.auth_session_credentials (family_id, generation)
  on update no action on delete no action deferrable initially deferred,
  add constraint auth_session_families_terminal_command_fkey
  foreign key (id, terminal_command_id)
  references backend_auth.auth_session_commands (family_id, command_id)
  on update no action on delete no action not deferrable;

alter table backend_auth.auth_session_credentials
  add constraint auth_session_credentials_consuming_command_fkey
  foreign key (family_id, consumed_by_command_id)
  references backend_auth.auth_session_commands (family_id, command_id)
  on update no action on delete no action not deferrable;

alter table backend_auth.otp_challenges
  add constraint otp_challenges_terminal_command_fkey
  foreign key (id, terminal_command_id)
  references backend_auth.otp_commands (challenge_id, command_id)
  on update no action on delete no action not deferrable;

create unique index external_identities_one_linked_primary_uidx
  on backend_auth.external_identities (account_id)
  where status = 'linked' and is_primary;

create index external_identities_account_status_id_idx
  on backend_auth.external_identities (account_id, status, id);

create index authentication_operations_pending_expiry_idx
  on backend_auth.authentication_operations (expires_at, id)
  where status = 'pending';

create index auth_session_families_account_status_id_idx
  on backend_auth.auth_session_families (account_id, status, id);

create unique index auth_session_credentials_one_unconsumed_uidx
  on backend_auth.auth_session_credentials (family_id)
  where consumed_at is null;

create index reauthentication_grants_active_account_family_idx
  on backend_auth.reauthentication_grants (account_id, family_id, expires_at, id)
  where status = 'active';

create index otp_challenges_pending_expiry_idx
  on backend_auth.otp_challenges (expires_at, id)
  where status = 'pending';

create index security_audit_events_time_order_idx
  on backend_auth.security_audit_events (occurred_at, event_order);

create index security_audit_events_account_time_idx
  on backend_auth.security_audit_events (account_id, occurred_at, event_order)
  where account_id is not null;

create index security_audit_events_session_time_idx
  on backend_auth.security_audit_events (session_id, occurred_at, event_order)
  where session_id is not null;

create index security_audit_events_operation_time_idx
  on backend_auth.security_audit_events (operation_id, occurred_at, event_order)
  where operation_id is not null;

-- Catalog-only helper used by POSTCHECK and the fail-closed rollback.
create function backend_auth.relation_fingerprint(p_relation pg_catalog.regclass)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select pg_catalog.md5(pg_catalog.jsonb_build_object(
    'relation', pg_catalog.jsonb_build_object(
      'name', rel.oid::pg_catalog.regclass::text,
      'kind', rel.relkind,
      'owner', rel.relowner,
      'acl', rel.relacl
    ),
    'columns', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'number', a.attnum,
        'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'not_null', a.attnotnull,
        'identity', a.attidentity,
        'generated', a.attgenerated,
        'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false),
        'acl', a.attacl
      ) order by a.attnum)
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
    ), '[]'::pg_catalog.jsonb),
    'constraints', coalesce((
      -- Keep this portable across a PostgreSQL 14 dump/restore round-trip:
      -- resolve physical catalog identifiers to names and normalize deparse output.
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', c.conname,
        'type', c.contype,
        'deferrable', c.condeferrable,
        'deferred', c.condeferred,
        'validated', c.convalidated,
        'table', c.conrelid::pg_catalog.regclass::text,
        'keys', coalesce((
          select pg_catalog.jsonb_agg(a.attname::text order by
            case when c.contype = 'c' then a.attname::text collate "C" end,
            case when c.contype <> 'c' then k.key_position end)
          from pg_catalog.unnest(c.conkey)
            with ordinality k(attnum, key_position)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.conrelid and a.attnum = k.attnum
        ), '[]'::pg_catalog.jsonb),
        'backing_index', case when c.conindid = 0 then null
          else c.conindid::pg_catalog.regclass::text end,
        'referenced_table', case when c.confrelid = 0 then null
          else c.confrelid::pg_catalog.regclass::text end,
        'referenced_keys', coalesce((
          select pg_catalog.jsonb_agg(a.attname::text order by k.key_position)
          from pg_catalog.unnest(c.confkey)
            with ordinality k(attnum, key_position)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.confrelid and a.attnum = k.attnum
        ), '[]'::pg_catalog.jsonb),
        'match_type', c.confmatchtype,
        'on_update', c.confupdtype,
        'on_delete', c.confdeltype,
        'definition', pg_catalog.pg_get_constraintdef(c.oid, true)
      ) order by c.conname::text collate "C")
      from pg_catalog.pg_constraint c where c.conrelid = rel.oid
    ), '[]'::pg_catalog.jsonb),
    'indexes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', idx.relname,
        'unique', i.indisunique,
        'primary', i.indisprimary,
        'valid', i.indisvalid,
        'ready', i.indisready,
        'definition', pg_catalog.pg_get_indexdef(i.indexrelid, 0, false),
        'predicate', pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)
      ) order by idx.relname)
      from pg_catalog.pg_index i
      join pg_catalog.pg_class idx on idx.oid = i.indexrelid
      where i.indrelid = rel.oid
    ), '[]'::pg_catalog.jsonb),
    'triggers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', t.tgname,
        'enabled', t.tgenabled,
        'definition', pg_catalog.pg_get_triggerdef(t.oid, false)
      ) order by t.tgname)
      from pg_catalog.pg_trigger t
      where t.tgrelid = rel.oid and not t.tgisinternal
    ), '[]'::pg_catalog.jsonb)
  )::text)
  from pg_catalog.pg_class rel
  where rel.oid = p_relation
$$;

create function backend_auth.reject_immutable_mutation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'BACKEND_AUTH_IMMUTABLE_RELATION',
    detail = pg_catalog.format('%s is append-only/immutable', tg_table_name);
end;
$$;

create function backend_auth.guard_account_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '55000', message = 'BACKEND_AUTH_ACCOUNT_BINDING_IMMUTABLE';
    end if;
    if new.updated_at < old.updated_at then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_ACCOUNT_TIME_REVERSED';
    end if;
  end if;
  return new;
end;
$$;

create function backend_auth.guard_external_identity_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'linked' then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_IDENTITY_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.account_id is distinct from old.account_id
     or new.provider is distinct from old.provider
     or new.namespace is distinct from old.namespace then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_IDENTITY_HISTORICAL_BINDING_IMMUTABLE';
  end if;
  return new;
end;
$$;

create function backend_auth.guard_authentication_operation_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_OPERATION_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.intent is distinct from old.intent
     or new.identity_provider is distinct from old.identity_provider
     or new.identity_namespace is distinct from old.identity_namespace
     or new.identity_lookup_digest is distinct from old.identity_lookup_digest
     or new.proof_type is distinct from old.proof_type
     or new.telegram_proof_fingerprint is distinct from old.telegram_proof_fingerprint
     or new.otp_challenge_id is distinct from old.otp_challenge_id
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_digest is distinct from old.request_digest then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_OPERATION_BINDING_IMMUTABLE';
  end if;

  if old.status <> 'pending' and new is distinct from old then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_OPERATION_TERMINAL';
  end if;
  if old.status = 'pending' and new.status = 'pending' and new is distinct from old then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_OPERATION_PENDING_MUTATION_INVALID';
  end if;
  return new;
end;
$$;

create function backend_auth.guard_session_family_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.current_credential_generation <> 1 then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_SESSION_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.account_id is distinct from old.account_id
     or new.authentication_operation_id is distinct from old.authentication_operation_id
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_SESSION_BINDING_IMMUTABLE';
  end if;
  if new is not distinct from old then
    return new;
  end if;

  if old.status = 'active' and new.status = 'active' then
    if new.current_credential_generation <> old.current_credential_generation + 1 then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_SESSION_GENERATION_TRANSITION_INVALID';
    end if;
  elsif old.status = 'active'
        and new.status = any (array['revoked', 'expired', 'reuse_detected']::text[]) then
    if new.current_credential_generation <> old.current_credential_generation then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_SESSION_TERMINAL_GENERATION_CHANGED';
    end if;
  elsif old.status = 'revoked' and new.status = 'reuse_detected' then
    if new.current_credential_generation <> old.current_credential_generation then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_SESSION_REUSE_GENERATION_CHANGED';
    end if;
  else
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_SESSION_TRANSITION_FORBIDDEN';
  end if;
  return new;
end;
$$;

create function backend_auth.guard_session_credential_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.consumed_at is not null or new.consumed_by_command_id is not null then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_CREDENTIAL_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;

  if new.family_id is distinct from old.family_id
     or new.generation is distinct from old.generation
     or new.digest is distinct from old.digest
     or new.issued_at is distinct from old.issued_at then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_CREDENTIAL_BINDING_IMMUTABLE';
  end if;
  if new is not distinct from old then
    return new;
  end if;
  if old.consumed_at is not null and new is distinct from old then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_CREDENTIAL_ALREADY_CONSUMED';
  end if;
  if old.consumed_at is null
     and (new.consumed_at is null or new.consumed_by_command_id is null) then
    raise exception using errcode = '22023', message = 'BACKEND_AUTH_CREDENTIAL_CONSUMPTION_INCOMPLETE';
  end if;
  return new;
end;
$$;

create function backend_auth.guard_reauthentication_grant_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_GRANT_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.evidence_id is distinct from old.evidence_id
     or new.account_id is distinct from old.account_id
     or new.family_id is distinct from old.family_id
     or new.scope is distinct from old.scope
     or new.resource_digest is distinct from old.resource_digest
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_GRANT_BINDING_IMMUTABLE';
  end if;
  if old.status <> 'active' and new is distinct from old then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_GRANT_TERMINAL';
  end if;
  if old.status = 'active' and new.status = 'active' and new is distinct from old then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_GRANT_ACTIVE_MUTATION_INVALID';
  end if;
  return new;
end;
$$;

create function backend_auth.guard_otp_challenge_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.attempts_remaining <> new.max_attempts then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_OTP_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.intent is distinct from old.intent
     or new.identity_provider is distinct from old.identity_provider
     or new.identity_namespace is distinct from old.identity_namespace
     or new.identity_lookup_digest is distinct from old.identity_lookup_digest
     or new.operation_id is distinct from old.operation_id
     or new.request_digest is distinct from old.request_digest
     or new.verifier_digest is distinct from old.verifier_digest
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or new.max_attempts is distinct from old.max_attempts then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_OTP_BINDING_IMMUTABLE';
  end if;
  if new is not distinct from old then
    return new;
  end if;
  if old.status <> 'pending' and new is distinct from old then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_OTP_TERMINAL';
  end if;
  if old.status = 'pending' and new.status = 'pending' then
    if new.attempts_remaining <> old.attempts_remaining - 1 then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_OTP_ATTEMPT_TRANSITION_INVALID';
    end if;
  elsif old.status = 'pending' and new.status = 'attempts_exhausted' then
    if old.attempts_remaining <> 1 or new.attempts_remaining <> 0 then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_OTP_EXHAUSTION_TRANSITION_INVALID';
    end if;
  elsif old.status = 'pending'
        and new.status = any (array['verified', 'expired', 'cancelled']::text[]) then
    if new.attempts_remaining <> old.attempts_remaining then
      raise exception using errcode = '22023', message = 'BACKEND_AUTH_OTP_TERMINAL_ATTEMPTS_CHANGED';
    end if;
  elsif new is distinct from old then
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_OTP_TRANSITION_FORBIDDEN';
  end if;
  return new;
end;
$$;

create function backend_auth.assert_player_profile_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account_id uuid;
  v_role text;
  v_has_profile boolean;
begin
  v_account_id := case
    when tg_table_name = 'accounts' and tg_op = 'DELETE' then old.id
    when tg_table_name = 'accounts' then new.id
    when tg_op = 'DELETE' then old.account_id
    else new.account_id
  end;

  select a.role into v_role
  from backend_auth.accounts a
  where a.id = v_account_id
  for update;

  if not found then
    return null;
  end if;

  select exists (
    select 1 from backend_auth.player_profiles p where p.account_id = v_account_id
  ) into v_has_profile;

  if (v_role = 'player') is distinct from v_has_profile then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_PLAYER_PROFILE_INCONSISTENT';
  end if;
  return null;
end;
$$;

create function backend_auth.assert_external_identity_aliases()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_identity_id uuid;
begin
  v_identity_id := case
    when tg_table_name = 'external_identities' and tg_op = 'DELETE' then old.id
    when tg_table_name = 'external_identities' then new.id
    when tg_op = 'DELETE' then old.identity_id
    else new.identity_id
  end;

  perform 1 from backend_auth.external_identities i
  where i.id = v_identity_id
  for update;

  if not found then
    return null;
  end if;

  if not exists (
    select 1 from backend_auth.external_identity_lookup_digests d
    where d.identity_id = v_identity_id
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_IDENTITY_ALIAS_REQUIRED';
  end if;
  return null;
end;
$$;

create function backend_auth.assert_active_account_has_login_method()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account_ids uuid[];
  v_account_id uuid;
  v_status text;
  v_linked_count bigint;
begin
  if tg_table_name = 'accounts' then
    select pg_catalog.array_agg(distinct x order by x) into v_account_ids
    from pg_catalog.unnest(array[case when tg_op <> 'INSERT' then old.id end,
      case when tg_op <> 'DELETE' then new.id end]::uuid[]) x
    where x is not null;
  else
    select pg_catalog.array_agg(distinct x order by x) into v_account_ids
    from pg_catalog.unnest(array[case when tg_op <> 'INSERT' then old.account_id end,
      case when tg_op <> 'DELETE' then new.account_id end]::uuid[]) x
    where x is not null;
  end if;

  foreach v_account_id in array coalesce(v_account_ids, array[]::uuid[]) loop
    select a.status into v_status
    from backend_auth.accounts a
    where a.id = v_account_id
    for update;

    if not found then
      continue;
    end if;

    -- This is deliberately a separate statement after a possible lock wait.
    -- Under READ COMMITTED it receives a fresh snapshot of committed identities.
    select pg_catalog.count(*) into v_linked_count
    from backend_auth.external_identities i
    where i.account_id = v_account_id and i.status = 'linked';

    if v_status = 'active' and v_linked_count = 0 then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_ACTIVE_ACCOUNT_LOGIN_METHOD_REQUIRED';
    end if;
  end loop;
  return null;
end;
$$;

create function backend_auth.assert_primary_unlink_replacement()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_current_status text;
begin
  if old.status <> 'linked' or not old.is_primary then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status = 'linked' and new.is_primary then
    return null;
  end if;

  perform 1 from backend_auth.accounts a where a.id = old.account_id for update;
  if not found then
    return null;
  end if;

  select i.status into v_current_status
  from backend_auth.external_identities i
  where i.id = old.id;

  -- A linked non-primary final row is an ordinary demotion and needs no replacement.
  if found and v_current_status = 'linked' then
    return null;
  end if;

  if not exists (
    select 1 from backend_auth.external_identities i
    where i.account_id = old.account_id
      and i.id <> old.id
      and i.status = 'linked'
      and i.is_primary
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_REPLACEMENT_PRIMARY_REQUIRED';
  end if;
  return null;
end;
$$;

create function backend_auth.assert_authentication_proof_binding()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_operation_id uuid;
  v_operation backend_auth.authentication_operations%rowtype;
  v_consumption backend_auth.telegram_proof_consumptions%rowtype;
  v_challenge backend_auth.otp_challenges%rowtype;
begin
  if tg_table_name = 'authentication_operations' then
    v_operation_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_operation_id := case when tg_op = 'DELETE' then old.operation_id else new.operation_id end;
  end if;

  select o.* into v_operation
  from backend_auth.authentication_operations o
  where o.id = v_operation_id;

  if not found then
    return null;
  end if;

  if v_operation.proof_type = 'telegram_proof' then
    select c.* into v_consumption
    from backend_auth.telegram_proof_consumptions c
    where c.proof_fingerprint = v_operation.telegram_proof_fingerprint;

    if not found
       or v_consumption.operation_id <> v_operation.id
       or v_consumption.intent <> v_operation.intent
       or v_consumption.idempotency_key <> v_operation.idempotency_key
       or v_consumption.request_digest <> v_operation.request_digest then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_TELEGRAM_PROOF_BINDING_INCONSISTENT';
    end if;
  else
    select c.* into v_challenge
    from backend_auth.otp_challenges c
    where c.id = v_operation.otp_challenge_id;

    if not found
       or v_challenge.operation_id <> v_operation.id
       or v_challenge.intent <> v_operation.intent
       or v_challenge.identity_provider <> v_operation.identity_provider
       or v_challenge.identity_namespace <> v_operation.identity_namespace
       or v_challenge.identity_lookup_digest <> v_operation.identity_lookup_digest then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_PROOF_BINDING_INCONSISTENT';
    end if;
  end if;
  return null;
end;
$$;

create function backend_auth.assert_session_family_operation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_operation backend_auth.authentication_operations%rowtype;
  v_account_status text;
  v_identity_id uuid;
  v_matching_identity_count bigint;
begin
  select o.* into v_operation
  from backend_auth.authentication_operations o
  where o.id = new.authentication_operation_id
  for update;

  if not found
     or v_operation.status <> 'completed'
     or v_operation.resolution_type not in ('existing_account', 'new_account_required') then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_OPERATION_NOT_ELIGIBLE';
  end if;

  select a.status into v_account_status
  from backend_auth.accounts a
  where a.id = new.account_id
  for update;

  if not found or v_account_status <> 'active' then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_ACCOUNT_NOT_ACTIVE';
  end if;

  if v_operation.resolution_type = 'existing_account' then
    if v_operation.resolution_account_id <> new.account_id then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_OPERATION_ACCOUNT_MISMATCH';
    end if;
    return null;
  end if;

  for v_identity_id in
    select i.id
    from backend_auth.external_identities i
    join backend_auth.external_identity_lookup_digests d on d.identity_id = i.id
    where d.provider = v_operation.identity_provider
      and d.namespace = v_operation.identity_namespace
      and d.digest = v_operation.identity_lookup_digest
    order by i.id
  loop
    perform 1 from backend_auth.external_identities i
    where i.id = v_identity_id
    for update;
  end loop;

  -- Authoritative reread after operation/account/identity locks.
  select pg_catalog.count(distinct i.id) into v_matching_identity_count
  from backend_auth.external_identities i
  join backend_auth.external_identity_lookup_digests d on d.identity_id = i.id
  where d.provider = v_operation.identity_provider
    and d.namespace = v_operation.identity_namespace
    and d.digest = v_operation.identity_lookup_digest
    and i.account_id = new.account_id;

  if v_matching_identity_count <> 1 then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_NEW_ACCOUNT_IDENTITY_MISMATCH';
  end if;
  return null;
end;
$$;

create function backend_auth.assert_session_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_family_id uuid;
  v_family backend_auth.auth_session_families%rowtype;
  v_credential_count bigint;
  v_min_generation bigint;
  v_max_generation bigint;
  v_last_command backend_auth.auth_session_commands%rowtype;
  v_previous_command backend_auth.auth_session_commands%rowtype;
begin
  v_family_id := case
    when tg_table_name = 'auth_session_families'
      then case when tg_op = 'DELETE' then old.id else new.id end
    else case when tg_op = 'DELETE' then old.family_id else new.family_id end
  end;

  select f.* into v_family
  from backend_auth.auth_session_families f
  where f.id = v_family_id
  for update;

  if not found then
    return null;
  end if;

  if not exists (
    select 1 from backend_auth.auth_session_credentials c
    where c.family_id = v_family.id
      and c.generation = v_family.current_credential_generation
      and c.consumed_at is null
      and c.consumed_by_command_id is null
      and c.issued_at >= v_family.created_at
      and c.issued_at < v_family.expires_at
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_CURRENT_CREDENTIAL_INVALID';
  end if;

  select pg_catalog.count(*), pg_catalog.min(c.generation), pg_catalog.max(c.generation)
  into v_credential_count, v_min_generation, v_max_generation
  from backend_auth.auth_session_credentials c
  where c.family_id = v_family.id;

  if v_credential_count <> v_family.current_credential_generation
     or v_min_generation <> 1
     or v_max_generation <> v_family.current_credential_generation then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_CREDENTIAL_SEQUENCE_INVALID';
  end if;

  if exists (
    select 1
    from backend_auth.auth_session_credentials c
    left join backend_auth.auth_session_credentials p
      on p.family_id = c.family_id and p.generation = c.generation - 1
    where c.family_id = v_family.id
      and (
        c.issued_at < v_family.created_at
        or c.issued_at >= v_family.expires_at
        or (c.generation = 1 and c.issued_at < v_family.created_at)
        or (c.generation > 1 and (
          p.generation is null
          or p.consumed_at is null
          or p.consumed_at is distinct from c.issued_at
        ))
        or (c.generation < v_family.current_credential_generation and (
          c.consumed_at is null
          or c.consumed_at >= v_family.expires_at
          or c.consumed_by_command_id is null
        ))
        or (c.generation = v_family.current_credential_generation
          and (c.consumed_at is not null or c.consumed_by_command_id is not null))
      )
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_CREDENTIAL_HISTORY_INVALID';
  end if;

  if exists (
    select 1
    from (
      select c.applied_at,
             pg_catalog.lag(c.applied_at) over (order by c.command_sequence) as previous_at
      from backend_auth.auth_session_commands c
      where c.family_id = v_family.id
    ) ordered
    where ordered.applied_at < v_family.created_at
       or (ordered.previous_at is not null and ordered.applied_at < ordered.previous_at)
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_COMMAND_TIME_ORDER_INVALID';
  end if;

  if (
    select pg_catalog.count(*)
    from backend_auth.auth_session_commands c
    where c.family_id = v_family.id and c.result_type = 'credential_rotated'
  ) <> v_family.current_credential_generation - 1 then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_ROTATION_COUNT_INVALID';
  end if;

  if exists (
    select 1
    from backend_auth.auth_session_commands c
    where c.family_id = v_family.id
      and c.result_type = 'credential_rotated'
      and (
        c.command_type <> 'rotate_credential'
        or c.applied_at >= v_family.expires_at
        -- Successful rotations must replay the generation chain in command
        -- sequence order. Reuse commands are deliberately excluded.
        or c.presented_generation <> (
          select pg_catalog.count(*)
          from backend_auth.auth_session_commands ordered_rotation
          where ordered_rotation.family_id = c.family_id
            and ordered_rotation.result_type = 'credential_rotated'
            and ordered_rotation.command_sequence <= c.command_sequence
        )
        or c.next_generation <> c.presented_generation + 1
        or not exists (
          select 1 from backend_auth.auth_session_credentials old_credential
          where old_credential.family_id = c.family_id
            and old_credential.generation = c.presented_generation
            and old_credential.digest = c.presented_digest
            and old_credential.consumed_at = c.applied_at
            and old_credential.consumed_by_command_id = c.command_id
        )
        or not exists (
          select 1 from backend_auth.auth_session_credentials next_credential
          where next_credential.family_id = c.family_id
            and next_credential.generation = c.next_generation
            and next_credential.digest = c.next_digest
            and next_credential.issued_at = c.applied_at
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_ROTATION_INCONSISTENT';
  end if;

  if exists (
    select 1
    from backend_auth.auth_session_commands c
    where c.family_id = v_family.id
      and c.result_type = 'reuse_detected'
      and not exists (
        select 1 from backend_auth.auth_session_credentials consumed
        where consumed.family_id = c.family_id
          and consumed.generation = c.presented_generation
          and consumed.digest = c.presented_digest
          and consumed.consumed_at is not null
          and consumed.consumed_at <= c.applied_at
      )
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_REUSE_SOURCE_INVALID';
  end if;

  select c.* into v_last_command
  from backend_auth.auth_session_commands c
  where c.family_id = v_family.id
  order by c.command_sequence desc
  limit 1;

  if v_family.status = 'active' then
    if exists (
      select 1 from backend_auth.auth_session_commands c
      where c.family_id = v_family.id and c.result_type <> 'credential_rotated'
    ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_ACTIVE_HISTORY_INVALID';
    end if;
  elsif v_family.status = 'revoked' then
    if v_last_command.result_type is distinct from 'session_revoked'
       or v_last_command.command_id is distinct from v_family.terminal_command_id
       or v_last_command.applied_at is distinct from v_family.terminal_at
       or v_last_command.reason is distinct from v_family.terminal_reason
       or exists (
         select 1 from backend_auth.auth_session_commands c
         where c.family_id = v_family.id
           and c.command_sequence < v_last_command.command_sequence
           and c.result_type <> 'credential_rotated'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_REVOCATION_INVALID';
    end if;
  elsif v_family.status = 'expired' then
    if v_last_command.result_type is distinct from 'session_expired'
       or v_last_command.command_id is distinct from v_family.terminal_command_id
       or v_last_command.applied_at is distinct from v_family.terminal_at
       or exists (
         select 1 from backend_auth.auth_session_commands c
         where c.family_id = v_family.id
           and c.command_sequence < v_last_command.command_sequence
           and c.result_type <> 'credential_rotated'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_EXPIRATION_INVALID';
    end if;
  else
    if v_last_command.result_type is distinct from 'reuse_detected'
       or v_last_command.command_id is distinct from v_family.terminal_command_id
       or v_last_command.applied_at is distinct from v_family.terminal_at
       or v_last_command.presented_generation is distinct from v_family.terminal_reuse_generation
       or v_last_command.presented_digest is distinct from v_family.terminal_reuse_digest
       or exists (
         select 1 from backend_auth.auth_session_commands c
         where c.family_id = v_family.id
           and c.command_sequence < v_last_command.command_sequence
           and c.result_type not in ('credential_rotated', 'session_revoked')
       )
       or (
         select pg_catalog.count(*) from backend_auth.auth_session_commands c
         where c.family_id = v_family.id and c.result_type = 'session_revoked'
       ) > 1 then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_REUSE_INVALID';
    end if;

    select c.* into v_previous_command
    from backend_auth.auth_session_commands c
    where c.family_id = v_family.id
      and c.command_sequence < v_last_command.command_sequence
    order by c.command_sequence desc
    limit 1;

    if exists (
      select 1 from backend_auth.auth_session_commands c
      where c.family_id = v_family.id and c.result_type = 'session_revoked'
    ) and v_previous_command.result_type is distinct from 'session_revoked' then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_REVOKED_REUSE_ORDER_INVALID';
    end if;
  end if;
  return null;
end;
$$;

create function backend_auth.assert_reauthentication_grant_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account_status text;
  v_family backend_auth.auth_session_families%rowtype;
  v_evidence backend_auth.fresh_authentication_evidence%rowtype;
begin
  if tg_op = 'UPDATE' and new.status <> 'consumed' then
    return null;
  end if;

  select a.status into v_account_status
  from backend_auth.accounts a where a.id = new.account_id for update;
  if not found or v_account_status <> 'active' then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_GRANT_ACCOUNT_NOT_ACTIVE';
  end if;

  select f.* into v_family
  from backend_auth.auth_session_families f where f.id = new.family_id for update;
  if not found or v_family.account_id <> new.account_id or v_family.status <> 'active' then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_GRANT_SESSION_NOT_ACTIVE';
  end if;

  select e.* into v_evidence
  from backend_auth.fresh_authentication_evidence e where e.id = new.evidence_id;
  if not found
     or v_evidence.account_id <> new.account_id
     or v_evidence.family_id <> new.family_id
     or new.created_at < v_family.created_at
     or new.created_at >= v_family.expires_at
     or new.created_at < v_evidence.authenticated_at
     or new.created_at >= v_evidence.expires_at
     or new.expires_at > v_family.expires_at
     or new.expires_at > v_evidence.expires_at then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_GRANT_EVIDENCE_WINDOW_INVALID';
  end if;
  return null;
end;
$$;

create function backend_auth.assert_otp_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_challenge_id uuid;
  v_challenge backend_auth.otp_challenges%rowtype;
  v_last backend_auth.otp_commands%rowtype;
  v_incorrect_count bigint;
begin
  v_challenge_id := case when tg_table_name = 'otp_challenges'
    then case when tg_op = 'DELETE' then old.id else new.id end
    else case when tg_op = 'DELETE' then old.challenge_id else new.challenge_id end
  end;

  select c.* into v_challenge
  from backend_auth.otp_challenges c
  where c.id = v_challenge_id
  for update;
  if not found then
    return null;
  end if;

  if exists (
    select 1 from (
      select c.applied_at,
             pg_catalog.lag(c.applied_at) over (order by c.command_sequence) as previous_at
      from backend_auth.otp_commands c where c.challenge_id = v_challenge.id
    ) ordered
    where ordered.applied_at < v_challenge.created_at
       or (ordered.previous_at is not null and ordered.applied_at < ordered.previous_at)
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_COMMAND_TIME_ORDER_INVALID';
  end if;

  if exists (
    select 1 from backend_auth.otp_commands c
    where c.challenge_id = v_challenge.id
      and (
        (c.result_type = 'incorrect_code' and (
          c.presented_digest = v_challenge.verifier_digest
          or c.applied_at >= v_challenge.expires_at
          or c.result_attempts_remaining <> v_challenge.max_attempts - (
            select pg_catalog.count(*) from backend_auth.otp_commands prior
            where prior.challenge_id = c.challenge_id
              and prior.result_type = 'incorrect_code'
              and prior.command_sequence <= c.command_sequence
          )
        ))
        or (c.result_type = 'otp_verified' and (
          c.presented_digest <> v_challenge.verifier_digest
          or c.applied_at >= v_challenge.expires_at
        ))
        or (c.result_type = 'otp_attempts_exhausted' and (
          c.presented_digest = v_challenge.verifier_digest
          or c.applied_at >= v_challenge.expires_at
          or (
            select pg_catalog.count(*) from backend_auth.otp_commands prior
            where prior.challenge_id = c.challenge_id
              and prior.result_type = 'incorrect_code'
              and prior.command_sequence < c.command_sequence
          ) <> v_challenge.max_attempts - 1
        ))
        or (c.result_type = 'otp_cancelled' and c.applied_at >= v_challenge.expires_at)
        or (c.result_type = 'otp_expired' and c.applied_at < v_challenge.expires_at)
      )
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_COMMAND_RESULT_INVALID';
  end if;

  select pg_catalog.count(*) into v_incorrect_count
  from backend_auth.otp_commands c
  where c.challenge_id = v_challenge.id and c.result_type = 'incorrect_code';

  select c.* into v_last
  from backend_auth.otp_commands c
  where c.challenge_id = v_challenge.id
  order by c.command_sequence desc
  limit 1;

  if v_challenge.status = 'pending' then
    if v_challenge.attempts_remaining <> v_challenge.max_attempts - v_incorrect_count
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_PENDING_HISTORY_INVALID';
    end if;
  elsif v_challenge.status = 'verified' then
    if v_last.result_type is distinct from 'otp_verified'
       or v_last.command_id is distinct from v_challenge.terminal_command_id
       or v_last.applied_at is distinct from v_challenge.terminal_at
       or v_challenge.attempts_remaining <> v_challenge.max_attempts - v_incorrect_count
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id
           and c.command_sequence < v_last.command_sequence
           and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_VERIFIED_HISTORY_INVALID';
    end if;
  elsif v_challenge.status = 'attempts_exhausted' then
    if v_last.result_type is distinct from 'otp_attempts_exhausted'
       or v_last.command_id is distinct from v_challenge.terminal_command_id
       or v_last.applied_at is distinct from v_challenge.terminal_at
       or v_challenge.attempts_remaining <> 0
       or v_incorrect_count <> v_challenge.max_attempts - 1
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id
           and c.command_sequence < v_last.command_sequence
           and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_EXHAUSTED_HISTORY_INVALID';
    end if;
  elsif v_challenge.status = 'expired' then
    if v_last.result_type is distinct from 'otp_expired'
       or v_last.command_id is distinct from v_challenge.terminal_command_id
       or v_last.applied_at is distinct from v_challenge.terminal_at
       or v_challenge.attempts_remaining <> v_challenge.max_attempts - v_incorrect_count
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id
           and c.command_sequence < v_last.command_sequence
           and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_EXPIRED_HISTORY_INVALID';
    end if;
  else
    if v_last.result_type is distinct from 'otp_cancelled'
       or v_last.command_id is distinct from v_challenge.terminal_command_id
       or v_last.applied_at is distinct from v_challenge.terminal_at
       or v_last.reason is distinct from v_challenge.terminal_reason
       or v_challenge.attempts_remaining <> v_challenge.max_attempts - v_incorrect_count
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id
           and c.command_sequence < v_last.command_sequence
           and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_CANCELLED_HISTORY_INVALID';
    end if;
  end if;
  return null;
end;
$$;

create function backend_auth.reject_audit_mutation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception using errcode = '55000', message = 'BACKEND_AUTH_AUDIT_APPEND_ONLY';
end;
$$;

create function backend_auth.assert_fresh_authentication_evidence_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account_status text;
  v_family backend_auth.auth_session_families%rowtype;
begin
  select a.status into v_account_status
  from backend_auth.accounts a
  where a.id = new.account_id
  for update;

  if not found or v_account_status <> 'active' then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_EVIDENCE_ACCOUNT_NOT_ACTIVE';
  end if;

  select f.* into v_family
  from backend_auth.auth_session_families f
  where f.id = new.family_id
  for update;

  if not found
     or v_family.account_id <> new.account_id
     or v_family.status <> 'active'
     or new.authenticated_at < v_family.created_at
     or new.authenticated_at >= v_family.expires_at
     or new.expires_at > v_family.expires_at then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_EVIDENCE_SESSION_WINDOW_INVALID';
  end if;
  return null;
end;
$$;

-- Runtime transition guards. Defaults are only initial-state defaults; the backend
-- still supplies every UUID, domain timestamp, expiry, digest, and binding.
create trigger accounts_transition_guard
before insert or update on backend_auth.accounts
for each row execute function backend_auth.guard_account_transition();

create trigger external_identities_transition_guard
before insert or update on backend_auth.external_identities
for each row execute function backend_auth.guard_external_identity_transition();

create trigger authentication_operations_transition_guard
before insert or update on backend_auth.authentication_operations
for each row execute function backend_auth.guard_authentication_operation_transition();

create trigger auth_session_families_transition_guard
before insert or update on backend_auth.auth_session_families
for each row execute function backend_auth.guard_session_family_transition();

create trigger auth_session_credentials_transition_guard
before insert or update on backend_auth.auth_session_credentials
for each row execute function backend_auth.guard_session_credential_transition();

create trigger reauthentication_grants_transition_guard
before insert or update on backend_auth.reauthentication_grants
for each row execute function backend_auth.guard_reauthentication_grant_transition();

create trigger otp_challenges_transition_guard
before insert or update on backend_auth.otp_challenges
for each row execute function backend_auth.guard_otp_challenge_transition();

-- Relations that are immutable or append-only at the persistence boundary.
create trigger player_profiles_immutable_guard
before update or delete on backend_auth.player_profiles
for each row execute function backend_auth.reject_immutable_mutation();

create trigger external_identity_lookup_digests_immutable_guard
before update or delete on backend_auth.external_identity_lookup_digests
for each row execute function backend_auth.reject_immutable_mutation();

create trigger telegram_proof_consumptions_immutable_guard
before update or delete on backend_auth.telegram_proof_consumptions
for each row execute function backend_auth.reject_immutable_mutation();

create trigger auth_session_commands_immutable_guard
before update or delete on backend_auth.auth_session_commands
for each row execute function backend_auth.reject_immutable_mutation();

create trigger fresh_authentication_evidence_immutable_guard
before update or delete on backend_auth.fresh_authentication_evidence
for each row execute function backend_auth.reject_immutable_mutation();

create trigger otp_commands_immutable_guard
before update or delete on backend_auth.otp_commands
for each row execute function backend_auth.reject_immutable_mutation();

-- Cross-row invariants that must observe the final transaction state.
create constraint trigger accounts_player_profile_consistency
after insert or update or delete on backend_auth.accounts
deferrable initially deferred
for each row execute function backend_auth.assert_player_profile_consistency();

create constraint trigger player_profiles_account_consistency
after insert or update or delete on backend_auth.player_profiles
deferrable initially deferred
for each row execute function backend_auth.assert_player_profile_consistency();

create constraint trigger external_identities_alias_required
after insert or update or delete on backend_auth.external_identities
deferrable initially deferred
for each row execute function backend_auth.assert_external_identity_aliases();

create constraint trigger external_identity_lookup_digests_identity_required
after insert or update or delete on backend_auth.external_identity_lookup_digests
deferrable initially deferred
for each row execute function backend_auth.assert_external_identity_aliases();

create constraint trigger accounts_active_login_method_required
after insert or update or delete on backend_auth.accounts
deferrable initially deferred
for each row execute function backend_auth.assert_active_account_has_login_method();

create constraint trigger external_identities_active_login_method_required
after insert or update or delete on backend_auth.external_identities
deferrable initially deferred
for each row execute function backend_auth.assert_active_account_has_login_method();

create constraint trigger external_identities_primary_unlink_replacement
after update or delete on backend_auth.external_identities
deferrable initially deferred
for each row execute function backend_auth.assert_primary_unlink_replacement();

create constraint trigger authentication_operations_proof_binding
after insert or update or delete on backend_auth.authentication_operations
deferrable initially deferred
for each row execute function backend_auth.assert_authentication_proof_binding();

create constraint trigger telegram_proof_consumptions_operation_binding
after insert or update or delete on backend_auth.telegram_proof_consumptions
deferrable initially deferred
for each row execute function backend_auth.assert_authentication_proof_binding();

create constraint trigger otp_challenges_operation_binding
after insert or update or delete on backend_auth.otp_challenges
deferrable initially deferred
for each row execute function backend_auth.assert_authentication_proof_binding();

create trigger auth_session_families_operation_consistency
after insert on backend_auth.auth_session_families
for each row execute function backend_auth.assert_session_family_operation();

create constraint trigger auth_session_families_state_consistency
after insert or update or delete on backend_auth.auth_session_families
deferrable initially deferred
for each row execute function backend_auth.assert_session_consistency();

create constraint trigger auth_session_credentials_state_consistency
after insert or update or delete on backend_auth.auth_session_credentials
deferrable initially deferred
for each row execute function backend_auth.assert_session_consistency();

create constraint trigger auth_session_commands_state_consistency
after insert or update or delete on backend_auth.auth_session_commands
deferrable initially deferred
for each row execute function backend_auth.assert_session_consistency();

create trigger fresh_authentication_evidence_state_consistency
after insert on backend_auth.fresh_authentication_evidence
for each row execute function backend_auth.assert_fresh_authentication_evidence_consistency();

create trigger reauthentication_grants_state_consistency
after insert or update on backend_auth.reauthentication_grants
for each row execute function backend_auth.assert_reauthentication_grant_consistency();

create constraint trigger otp_challenges_state_consistency
after insert or update or delete on backend_auth.otp_challenges
deferrable initially deferred
for each row execute function backend_auth.assert_otp_consistency();

create constraint trigger otp_commands_state_consistency
after insert or update or delete on backend_auth.otp_commands
deferrable initially deferred
for each row execute function backend_auth.assert_otp_consistency();

create trigger security_audit_events_update_delete_guard
before update or delete on backend_auth.security_audit_events
for each row execute function backend_auth.reject_audit_mutation();

create trigger security_audit_events_truncate_guard
before truncate on backend_auth.security_audit_events
for each statement execute function backend_auth.reject_audit_mutation();

-- Explicit privilege boundary. No role or login is created here.
revoke all on schema backend_auth from public, backend_auth_app;
grant usage on schema backend_auth to backend_auth_app;

revoke all on all tables in schema backend_auth from public, backend_auth_app;
grant select on all tables in schema backend_auth to backend_auth_app;

grant insert (id, created_at, updated_at)
  on backend_auth.accounts to backend_auth_app;
grant update (status, updated_at)
  on backend_auth.accounts to backend_auth_app;

grant insert (account_id)
  on backend_auth.player_profiles to backend_auth_app;

grant insert (id, account_id, provider, namespace, status, is_primary)
  on backend_auth.external_identities to backend_auth_app;
grant update (status, is_primary)
  on backend_auth.external_identities to backend_auth_app;

grant insert (
  identity_id, algorithm, provider, namespace, digest,
  digest_version, pepper_version, created_at
) on backend_auth.external_identity_lookup_digests to backend_auth_app;

grant insert (
  id, intent, identity_provider, identity_namespace, identity_lookup_digest,
  proof_type, telegram_proof_fingerprint, otp_challenge_id,
  created_at, expires_at, idempotency_key, request_digest
) on backend_auth.authentication_operations to backend_auth_app;
grant update (
  status, resolution_type, resolution_account_id, resolution_account_status,
  resolution_initial_role, resolution_reason, failure_reason,
  terminal_command_id, terminal_command_type, terminal_applied_at
) on backend_auth.authentication_operations to backend_auth_app;

grant insert (
  proof_fingerprint, proof_expires_at, intent, idempotency_key,
  request_digest, operation_id, consumed_at
) on backend_auth.telegram_proof_consumptions to backend_auth_app;

grant insert (
  id, account_id, authentication_operation_id,
  current_credential_generation, created_at, expires_at
) on backend_auth.auth_session_families to backend_auth_app;
grant update (
  status, current_credential_generation, terminal_command_id,
  terminal_reason, terminal_at, terminal_reuse_generation, terminal_reuse_digest
) on backend_auth.auth_session_families to backend_auth_app;

grant insert (family_id, generation, digest, issued_at)
  on backend_auth.auth_session_credentials to backend_auth_app;
grant update (consumed_at, consumed_by_command_id)
  on backend_auth.auth_session_credentials to backend_auth_app;

grant insert (
  family_id, command_id, command_sequence, request_digest, command_type,
  applied_at, presented_generation, presented_digest, next_generation,
  next_digest, reason, result_type
) on backend_auth.auth_session_commands to backend_auth_app;

grant insert (
  id, account_id, family_id, verification_method, authenticated_at, expires_at
) on backend_auth.fresh_authentication_evidence to backend_auth_app;

grant insert (
  id, evidence_id, account_id, family_id, scope, resource_digest,
  created_at, expires_at
) on backend_auth.reauthentication_grants to backend_auth_app;
grant update (
  status, terminal_command_id, terminal_command_type,
  terminal_request_digest, terminal_applied_at, terminal_reason
) on backend_auth.reauthentication_grants to backend_auth_app;

grant insert (
  id, intent, identity_provider, identity_namespace, identity_lookup_digest,
  operation_id, request_digest, verifier_digest, created_at, expires_at,
  max_attempts, attempts_remaining
) on backend_auth.otp_challenges to backend_auth_app;
grant update (
  attempts_remaining, status, terminal_command_id, terminal_at, terminal_reason
) on backend_auth.otp_challenges to backend_auth_app;

grant insert (
  challenge_id, command_id, command_sequence, request_digest, command_type,
  applied_at, presented_digest, reason, result_type, result_attempts_remaining
) on backend_auth.otp_commands to backend_auth_app;

grant insert (
  event_id, event_type, outcome, occurred_at,
  account_id, role, previous_status, next_status,
  identity_id, provider, reserved_account_id, attempted_account_id,
  operation_id, attempted_operation_id, intent, terminal_status,
  challenge_id, otp_status, session_id, session_status, generation,
  evidence_id, verification_method, grant_id, scope, grant_status,
  aggregate_type, aggregate_id
) on backend_auth.security_audit_events to backend_auth_app;

revoke all on all sequences in schema backend_auth from public, backend_auth_app;
grant usage on sequence backend_auth.security_audit_events_event_order_seq
  to backend_auth_app;

revoke all on all functions in schema backend_auth from public, backend_auth_app;

-- Object fingerprints are calculated after constraints, indexes, and triggers.
do $$
declare
  v_name text;
  v_function pg_catalog.regprocedure;
begin
  foreach v_name in array array[
    'accounts', 'player_profiles', 'external_identities',
    'external_identity_lookup_digests', 'authentication_operations',
    'telegram_proof_consumptions', 'auth_session_families',
    'auth_session_credentials', 'auth_session_commands',
    'fresh_authentication_evidence', 'reauthentication_grants',
    'otp_challenges', 'otp_commands', 'security_audit_events'
  ]::text[] loop
    execute pg_catalog.format(
      'comment on table backend_auth.%I is %L',
      v_name,
      '015_backend_auth_foundation:' ||
        backend_auth.relation_fingerprint(
          pg_catalog.to_regclass('backend_auth.' || v_name)
        )
    );
  end loop;

  for v_function in
    select p.oid::pg_catalog.regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'backend_auth'
  loop
    execute pg_catalog.format(
      'comment on function %s is %L',
      v_function,
      '015_backend_auth_foundation:' ||
        pg_catalog.md5(pg_catalog.pg_get_functiondef(v_function::oid))
    );
  end loop;

  execute 'comment on sequence backend_auth.security_audit_events_event_order_seq '
    || 'is ''015_backend_auth_foundation:audit_storage_order''';
end;
$$;

-- Fail closed before commit if the foundation or ACL surface is incomplete.
do $$
declare
  v_table_count bigint;
  v_deferred_fk_count bigint;
  v_bad_fk_count bigint;
  v_unmarked_count bigint;
begin
  select pg_catalog.count(*) into v_table_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';
  if v_table_count <> 14 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 14 tables, found %', v_table_count;
  end if;

  select pg_catalog.count(*) into v_deferred_fk_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class r on r.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'backend_auth'
    and c.contype = 'f' and c.condeferrable and c.condeferred;
  if v_deferred_fk_count <> 3 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 3 deferred foreign keys, found %',
      v_deferred_fk_count;
  end if;

  select pg_catalog.count(*) into v_bad_fk_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class r on r.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'backend_auth' and c.contype = 'f'
    and (c.confupdtype <> 'a' or c.confdeltype <> 'a');
  if v_bad_fk_count <> 0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: every FK must use NO ACTION';
  end if;

  select pg_catalog.count(*) into v_unmarked_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r'
    and coalesce(pg_catalog.obj_description(c.oid, 'pg_class'), '')
      !~ '^015_backend_auth_foundation:[0-9a-f]{32}$';
  if v_unmarked_count <> 0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: table fingerprints are incomplete';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_namespace n
       cross join lateral pg_catalog.aclexplode(
         coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
       ) acl
       where n.nspname = 'backend_auth' and acl.grantee = 0
     )
     or pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE')
     or pg_catalog.has_table_privilege('backend_auth_app', 'backend_auth.accounts', 'INSERT')
     or pg_catalog.has_table_privilege('backend_auth_app', 'backend_auth.accounts', 'UPDATE')
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.accounts', 'role', 'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.accounts', 'role', 'UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: privilege boundary is unsafe';
  end if;

  if not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.accounts', 'id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.accounts', 'created_at', 'INSERT'
     )
     or not pg_catalog.has_sequence_privilege(
       'backend_auth_app',
       'backend_auth.security_audit_events_event_order_seq',
       'USAGE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: required application privileges are missing';
  end if;

end;
$$;

reset role;
commit;

select '015_backend_auth_foundation applied; run POSTCHECK before use' as result;
