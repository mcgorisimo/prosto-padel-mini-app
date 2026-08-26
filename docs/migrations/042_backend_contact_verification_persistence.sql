-- 042_backend_contact_verification_persistence.sql
-- Expand-only, provider-neutral D5.2 contact-verification persistence.
-- Review-only: do not apply or connect runtime without a separate owner gate.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_accounts_oid oid := pg_catalog.to_regclass('backend_auth.accounts')::oid;
  v_immutable_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.reject_immutable_mutation()'
  )::oid;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.has_database_privilege(
       'backend_auth_app',
       pg_catalog.current_database(),
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend role boundary differs';
  end if;

  if v_accounts_oid is null
     or pg_catalog.obj_description(v_accounts_oid, 'pg_class') is distinct from
       '015_backend_auth_foundation:'
         || backend_auth.relation_fingerprint(
           v_accounts_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend accounts foundation differs';
  end if;

  if v_immutable_oid is null
     or pg_catalog.obj_description(v_immutable_oid, 'pg_proc') is distinct from
       '015_backend_auth_foundation:'
         || pg_catalog.md5(pg_catalog.pg_get_functiondef(v_immutable_oid)) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: immutable guard differs';
  end if;

  if pg_catalog.to_regclass('backend_auth.account_contacts') is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_challenges'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_commands'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_dispatches'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_rate_buckets'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_audit'
     ) is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 042 target already exists';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_auth.account_contacts (
  account_id uuid not null,
  field text not null,
  contact_version bigint not null,
  subject_digest bytea not null,
  subject_digest_key_version integer not null,
  value_ciphertext bytea not null,
  value_nonce bytea not null,
  value_auth_tag bytea not null,
  value_algorithm text not null,
  value_key_version integer not null,
  lock_version bigint not null default 1,
  created_at bigint not null,
  changed_at bigint not null,
  updated_at bigint not null,
  constraint account_contacts_pkey primary key (account_id, field),
  constraint account_contacts_account_id_fkey foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint account_contacts_field_check check (
    field = any (array['phone', 'email']::text[])
  ),
  constraint account_contacts_version_check check (
    contact_version between 1 and 9007199254740991
    and lock_version between 1 and 9007199254740991
  ),
  constraint account_contacts_subject_digest_check check (
    pg_catalog.octet_length(subject_digest) = 32
    and subject_digest_key_version between 1 and 2147483647
  ),
  constraint account_contacts_envelope_check check (
    pg_catalog.octet_length(value_ciphertext) between 1 and 4096
    and pg_catalog.octet_length(value_nonce) between 12 and 32
    and pg_catalog.octet_length(value_auth_tag) between 16 and 32
    and value_algorithm ~ '^[a-z][a-z0-9_]{0,63}$'
    and value_key_version between 1 and 2147483647
  ),
  constraint account_contacts_time_check check (
    created_at between 0 and 9007199254740991
    and changed_at between created_at and 9007199254740991
    and updated_at between changed_at and 9007199254740991
  )
);

create table backend_auth.contact_verification_challenges (
  challenge_id uuid not null,
  account_id uuid not null,
  field text not null,
  method text not null,
  purpose text not null,
  contact_version bigint not null,
  subject_digest bytea not null,
  subject_digest_key_version integer not null,
  verifier_digest bytea not null,
  verifier_digest_key_version integer not null,
  proof_ciphertext bytea,
  proof_nonce bytea,
  proof_auth_tag bytea,
  proof_algorithm text,
  proof_key_version integer,
  proof_expires_at bigint,
  create_idempotency_key text not null,
  create_request_digest bytea not null,
  create_request_digest_key_version integer not null,
  ttl_seconds integer not null,
  max_attempts integer not null,
  attempts_remaining integer not null,
  resend_cooldown_seconds integer not null,
  starts_per_15_minutes integer not null,
  starts_per_24_hours integer not null,
  state text not null,
  cancel_reason text,
  verified_command_id uuid,
  verified_at bigint,
  terminal_at bigint,
  last_dispatch_at bigint not null,
  resend_not_before_at bigint not null,
  resend_count integer not null default 0,
  last_command_sequence bigint not null default 0,
  lock_version bigint not null default 1,
  created_at bigint not null,
  expires_at bigint not null,
  status_changed_at bigint not null,
  updated_at bigint not null,
  constraint contact_verification_challenges_pkey primary key (challenge_id),
  constraint contact_verification_challenges_account_fkey
    foreign key (account_id) references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint contact_verification_challenges_target_check check (
    (field = 'phone' and method = 'phone_sms_otp')
    or
    (field = 'email' and method = any (
      array['email_code', 'email_link']::text[]
    ))
  ),
  constraint contact_verification_challenges_purpose_check check (
    purpose = 'contact_ownership'
  ),
  constraint contact_verification_challenges_binding_check check (
    contact_version between 1 and 9007199254740991
    and pg_catalog.octet_length(subject_digest) = 32
    and subject_digest_key_version between 1 and 2147483647
    and pg_catalog.octet_length(verifier_digest) = 32
    and verifier_digest_key_version between 1 and 2147483647
  ),
  constraint contact_verification_challenges_idempotency_check check (
    pg_catalog.length(create_idempotency_key) between 1 and 128
    and pg_catalog.btrim(create_idempotency_key) = create_idempotency_key
    and create_idempotency_key !~ '[[:cntrl:]]'
    and pg_catalog.octet_length(create_request_digest) = 32
    and create_request_digest_key_version between 1 and 2147483647
  ),
  constraint contact_verification_challenges_policy_check check (
    (
      method = any (array['phone_sms_otp', 'email_code']::text[])
      and ttl_seconds between 1 and 600
    )
    or
    (
      method = 'email_link'
      and ttl_seconds between 1 and 900
    )
  ),
  constraint contact_verification_challenges_budget_check check (
    max_attempts between 1 and 5
    and attempts_remaining between 0 and max_attempts
    and resend_cooldown_seconds = 60
    and starts_per_15_minutes = 3
    and starts_per_24_hours = 10
    and resend_count between 0 and 2147483647
    and last_command_sequence between 0 and 9007199254740991
    and lock_version between 1 and 9007199254740991
  ),
  constraint contact_verification_challenges_proof_envelope_check check (
    pg_catalog.num_nonnulls(
      proof_ciphertext,
      proof_nonce,
      proof_auth_tag,
      proof_algorithm,
      proof_key_version,
      proof_expires_at
    ) in (0, 6)
    and (
      proof_ciphertext is null
      or (
        pg_catalog.octet_length(proof_ciphertext) between 1 and 4096
        and pg_catalog.octet_length(proof_nonce) between 12 and 32
        and pg_catalog.octet_length(proof_auth_tag) between 16 and 32
        and proof_algorithm ~ '^[a-z][a-z0-9_]{0,63}$'
        and proof_key_version between 1 and 2147483647
        and proof_expires_at between created_at + 1 and expires_at
      )
    )
  ),
  constraint contact_verification_challenges_state_check check (
    state = any (array[
      'pending',
      'verified',
      'expired',
      'attempts_exhausted',
      'cancelled'
    ]::text[])
  ),
  constraint contact_verification_challenges_terminal_shape_check check (
    (
      state = 'pending'
      and attempts_remaining > 0
      and proof_ciphertext is not null
      and cancel_reason is null
      and verified_command_id is null
      and verified_at is null
      and terminal_at is null
    )
    or
    (
      state = 'verified'
      and proof_ciphertext is null
      and cancel_reason is null
      and verified_command_id is not null
      and verified_at is not null
      and terminal_at = verified_at
      and verified_at < expires_at
    )
    or
    (
      state = 'expired'
      and proof_ciphertext is null
      and cancel_reason is null
      and verified_command_id is null
      and verified_at is null
      and terminal_at is not null
      and terminal_at >= expires_at
    )
    or
    (
      state = 'attempts_exhausted'
      and attempts_remaining = 0
      and proof_ciphertext is null
      and cancel_reason is null
      and verified_command_id is null
      and verified_at is null
      and terminal_at is not null
    )
    or
    (
      state = 'cancelled'
      and proof_ciphertext is null
      and cancel_reason = any (array[
        'user_cancelled',
        'superseded',
        'contact_changed',
        'security_event'
      ]::text[])
      and verified_command_id is null
      and verified_at is null
      and terminal_at is not null
    )
  ),
  constraint contact_verification_challenges_time_check check (
    created_at between 0 and 9007199254740991
    and ttl_seconds = expires_at - created_at
    and status_changed_at between created_at and 9007199254740991
    and last_dispatch_at between created_at and updated_at
    and resend_not_before_at = last_dispatch_at + resend_cooldown_seconds
    and updated_at between status_changed_at and 9007199254740991
    and (
      terminal_at is null
      or terminal_at between status_changed_at and updated_at
    )
    and (
      verified_at is null
      or verified_at between status_changed_at and updated_at
    )
  ),
  constraint contact_verification_challenges_idempotency_key
    unique (account_id, field, create_idempotency_key),
  constraint contact_verification_challenges_audit_binding_key
    unique (challenge_id, account_id, field, method, purpose),
  constraint contact_verification_challenges_dispatch_binding_key
    unique (
      challenge_id,
      account_id,
      field,
      method,
      purpose,
      expires_at
    )
);

create unique index contact_verification_challenges_one_active_uq
  on backend_auth.contact_verification_challenges (account_id, field)
  where state = 'pending';

create index contact_verification_challenges_owner_state_idx
  on backend_auth.contact_verification_challenges (
    account_id,
    field,
    state,
    created_at desc,
    challenge_id
  );

create table backend_auth.contact_verification_commands (
  challenge_id uuid not null,
  command_id uuid not null,
  sequence bigint not null,
  command_type text not null,
  request_digest bytea not null,
  request_digest_key_version integer not null,
  presented_digest bytea,
  presented_digest_key_version integer,
  resend_idempotency_key text,
  rate_limit_decision_id uuid,
  dispatch_id uuid,
  cancel_reason text,
  result_code text not null,
  result_attempts_remaining integer,
  applied_at bigint not null,
  constraint contact_verification_commands_pkey
    primary key (challenge_id, command_id),
  constraint contact_verification_commands_challenge_fkey
    foreign key (challenge_id)
    references backend_auth.contact_verification_challenges (challenge_id)
    on update no action on delete no action not deferrable,
  constraint contact_verification_commands_sequence_key
    unique (challenge_id, sequence),
  constraint contact_verification_commands_dispatch_binding_key
    unique (challenge_id, command_id, dispatch_id),
  constraint contact_verification_commands_digest_check check (
    pg_catalog.octet_length(request_digest) = 32
    and request_digest_key_version between 1 and 2147483647
    and pg_catalog.num_nonnulls(
      presented_digest,
      presented_digest_key_version
    ) in (0, 2)
    and (
      presented_digest is null
      or (
        pg_catalog.octet_length(presented_digest) = 32
        and presented_digest_key_version between 1 and 2147483647
      )
    )
  ),
  constraint contact_verification_commands_type_check check (
    command_type = any (array[
      'submit_proof',
      'expire',
      'reserve_resend',
      'cancel'
    ]::text[])
  ),
  constraint contact_verification_commands_result_check check (
    result_code = any (array[
      'verified',
      'incorrect_proof',
      'resend_reserved',
      'attempts_exhausted',
      'expired',
      'cancelled'
    ]::text[])
  ),
  constraint contact_verification_commands_shape_check check (
    (
      command_type = 'submit_proof'
      and presented_digest is not null
      and resend_idempotency_key is null
      and rate_limit_decision_id is null
      and dispatch_id is null
      and cancel_reason is null
      and result_code = any (array[
        'verified',
        'incorrect_proof',
        'attempts_exhausted',
        'expired'
      ]::text[])
    )
    or
    (
      command_type = 'reserve_resend'
      and presented_digest is null
      and resend_idempotency_key is not null
      and rate_limit_decision_id is not null
      and dispatch_id is not null
      and cancel_reason is null
      and result_code = any (array['resend_reserved', 'expired']::text[])
    )
    or
    (
      command_type = 'expire'
      and presented_digest is null
      and resend_idempotency_key is null
      and rate_limit_decision_id is null
      and dispatch_id is null
      and cancel_reason is null
      and result_code = 'expired'
    )
    or
    (
      command_type = 'cancel'
      and presented_digest is null
      and resend_idempotency_key is null
      and rate_limit_decision_id is null
      and dispatch_id is null
      and cancel_reason = any (array[
        'user_cancelled',
        'superseded',
        'contact_changed',
        'security_event'
      ]::text[])
      and result_code = any (array['cancelled', 'expired']::text[])
    )
  ),
  constraint contact_verification_commands_result_shape_check check (
    (
      result_code = 'incorrect_proof'
      and result_attempts_remaining between 1 and 4
    )
    or
    (
      result_code <> 'incorrect_proof'
      and result_attempts_remaining is null
    )
  ),
  constraint contact_verification_commands_idempotency_check check (
    sequence between 1 and 9007199254740991
    and (
      resend_idempotency_key is null
      or (
        pg_catalog.length(resend_idempotency_key) between 1 and 128
        and pg_catalog.btrim(resend_idempotency_key) = resend_idempotency_key
        and resend_idempotency_key !~ '[[:cntrl:]]'
      )
    )
    and applied_at between 0 and 9007199254740991
  )
);

create unique index contact_verification_commands_resend_key_uq
  on backend_auth.contact_verification_commands (
    challenge_id,
    resend_idempotency_key
  )
  where resend_idempotency_key is not null;

create table backend_auth.contact_verification_dispatches (
  dispatch_id uuid not null,
  challenge_id uuid not null,
  account_id uuid not null,
  field text not null,
  method text not null,
  purpose text not null,
  challenge_expires_at bigint not null,
  dispatch_kind text not null,
  command_id uuid,
  status text not null,
  payload_ciphertext bytea,
  payload_nonce bytea,
  payload_auth_tag bytea,
  payload_algorithm text,
  payload_key_version integer,
  payload_digest bytea,
  payload_digest_key_version integer,
  payload_expires_at bigint,
  reconciliation_ref_ciphertext bytea,
  reconciliation_ref_nonce bytea,
  reconciliation_ref_auth_tag bytea,
  reconciliation_ref_algorithm text,
  reconciliation_ref_key_version integer,
  reconciliation_ref_digest bytea,
  reconciliation_ref_digest_key_version integer,
  reconciliation_ref_expires_at bigint,
  claim_digest bytea,
  claim_digest_key_version integer,
  claimed_at bigint,
  claim_expires_at bigint,
  reconciliation_attempts integer not null default 0,
  last_reconciled_at bigint,
  retry_at bigint,
  reserved_at bigint not null,
  status_changed_at bigint not null,
  outcome_at bigint,
  invalidated_at bigint,
  lock_version bigint not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  constraint contact_verification_dispatches_pkey primary key (dispatch_id),
  constraint contact_verification_dispatches_audit_binding_key unique (
    dispatch_id,
    challenge_id,
    account_id,
    field,
    method,
    purpose
  ),
  constraint contact_verification_dispatches_challenge_fkey foreign key (
    challenge_id,
    account_id,
    field,
    method,
    purpose,
    challenge_expires_at
  ) references backend_auth.contact_verification_challenges (
    challenge_id,
    account_id,
    field,
    method,
    purpose,
    expires_at
  ) on update no action on delete no action not deferrable,
  constraint contact_verification_dispatches_resend_command_fkey foreign key (
    challenge_id,
    command_id,
    dispatch_id
  ) references backend_auth.contact_verification_commands (
    challenge_id,
    command_id,
    dispatch_id
  ) on update no action on delete no action not deferrable,
  constraint contact_verification_dispatches_target_check check (
    purpose = 'contact_ownership'
    and (
      (field = 'phone' and method = 'phone_sms_otp')
      or
      (field = 'email' and method = any (
        array['email_code', 'email_link']::text[]
      ))
    )
  ),
  constraint contact_verification_dispatches_source_check check (
    (dispatch_kind = 'start' and command_id is null)
    or
    (dispatch_kind = 'resend' and command_id is not null)
  ),
  constraint contact_verification_dispatches_status_check check (
    status = any (array[
      'reserved',
      'pending',
      'accepted',
      'unavailable',
      'rate_limited',
      'unknown'
    ]::text[])
  ),
  constraint contact_verification_dispatches_payload_envelope_check check (
    pg_catalog.num_nonnulls(
      payload_ciphertext,
      payload_nonce,
      payload_auth_tag,
      payload_algorithm,
      payload_key_version,
      payload_digest,
      payload_digest_key_version,
      payload_expires_at
    ) in (0, 8)
    and (
      payload_ciphertext is null
      or (
        pg_catalog.octet_length(payload_ciphertext) between 1 and 16384
        and pg_catalog.octet_length(payload_nonce) between 12 and 32
        and pg_catalog.octet_length(payload_auth_tag) between 16 and 32
        and payload_algorithm ~ '^[a-z][a-z0-9_]{0,63}$'
        and payload_key_version between 1 and 2147483647
        and pg_catalog.octet_length(payload_digest) = 32
        and payload_digest_key_version between 1 and 2147483647
        and payload_expires_at between created_at + 1 and challenge_expires_at
      )
    )
  ),
  constraint contact_verification_dispatches_reconciliation_envelope_check check (
    pg_catalog.num_nonnulls(
      reconciliation_ref_ciphertext,
      reconciliation_ref_nonce,
      reconciliation_ref_auth_tag,
      reconciliation_ref_algorithm,
      reconciliation_ref_key_version,
      reconciliation_ref_digest,
      reconciliation_ref_digest_key_version,
      reconciliation_ref_expires_at
    ) in (0, 8)
    and (
      reconciliation_ref_ciphertext is null
      or (
        pg_catalog.octet_length(reconciliation_ref_ciphertext) between 1 and 4096
        and pg_catalog.octet_length(reconciliation_ref_nonce) between 12 and 32
        and pg_catalog.octet_length(reconciliation_ref_auth_tag) between 16 and 32
        and reconciliation_ref_algorithm ~ '^[a-z][a-z0-9_]{0,63}$'
        and reconciliation_ref_key_version between 1 and 2147483647
        and pg_catalog.octet_length(reconciliation_ref_digest) = 32
        and reconciliation_ref_digest_key_version between 1 and 2147483647
        and reconciliation_ref_expires_at between
          created_at + 1 and challenge_expires_at
      )
    )
  ),
  constraint contact_verification_dispatches_claim_check check (
    pg_catalog.num_nonnulls(
      claim_digest,
      claim_digest_key_version,
      claimed_at,
      claim_expires_at
    ) in (0, 4)
    and (
      claim_digest is null
      or (
        pg_catalog.octet_length(claim_digest) = 32
        and claim_digest_key_version between 1 and 2147483647
        and claimed_at between created_at and updated_at
        and claim_expires_at between claimed_at + 1 and challenge_expires_at
      )
    )
  ),
  constraint contact_verification_dispatches_recovery_check check (
    reconciliation_attempts between 0 and 2147483647
    and (
      (reconciliation_attempts = 0 and last_reconciled_at is null)
      or
      (reconciliation_attempts > 0 and last_reconciled_at is not null)
    )
  ),
  constraint contact_verification_dispatches_outcome_shape_check check (
    (
      invalidated_at is not null
      and payload_ciphertext is null
      and reconciliation_ref_ciphertext is null
      and claim_digest is null
      and outcome_at is null
      and retry_at is null
    )
    or
    (
      invalidated_at is null
      and status = any (array['reserved', 'pending', 'unknown']::text[])
      and payload_ciphertext is not null
      and outcome_at is null
      and retry_at is null
    )
    or
    (
      invalidated_at is null
      and status = any (array['accepted', 'unavailable']::text[])
      and payload_ciphertext is null
      and reconciliation_ref_ciphertext is null
      and claim_digest is null
      and outcome_at is not null
      and retry_at is null
    )
    or
    (
      invalidated_at is null
      and status = 'rate_limited'
      and payload_ciphertext is null
      and reconciliation_ref_ciphertext is null
      and claim_digest is null
      and outcome_at is not null
      and retry_at is not null
    )
  ),
  constraint contact_verification_dispatches_time_check check (
    created_at between 0 and 9007199254740991
    and reserved_at = created_at
    and status_changed_at between created_at and 9007199254740991
    and updated_at between status_changed_at and 9007199254740991
    and (
      last_reconciled_at is null
      or last_reconciled_at between created_at and updated_at
    )
    and (
      outcome_at is null
      or outcome_at between status_changed_at and updated_at
    )
    and (
      invalidated_at is null
      or invalidated_at between status_changed_at and updated_at
    )
    and (
      retry_at is null
      or retry_at between outcome_at and challenge_expires_at
    )
    and lock_version between 1 and 9007199254740991
  )
);

create unique index contact_verification_dispatches_start_uq
  on backend_auth.contact_verification_dispatches (challenge_id)
  where dispatch_kind = 'start';

create unique index contact_verification_dispatches_resend_command_uq
  on backend_auth.contact_verification_dispatches (challenge_id, command_id)
  where command_id is not null;

create index contact_verification_dispatches_recovery_idx
  on backend_auth.contact_verification_dispatches (
    status,
    updated_at,
    dispatch_id
  )
  where status = any (array['reserved', 'pending', 'unknown']::text[])
    and invalidated_at is null;

alter table backend_auth.contact_verification_challenges
  add constraint contact_verification_challenges_verified_command_fkey
  foreign key (challenge_id, verified_command_id)
  references backend_auth.contact_verification_commands (
    challenge_id,
    command_id
  ) on update no action on delete no action not deferrable;

create table backend_auth.contact_verification_rate_buckets (
  field text not null,
  method text not null,
  purpose text not null,
  scope text not null,
  subject_digest bytea not null,
  subject_digest_key_version integer not null,
  operation text not null,
  window_started_at bigint not null,
  window_seconds integer not null,
  limit_count integer not null,
  consumed_count integer not null,
  cooldown_until bigint,
  last_decision_id uuid not null,
  lock_version bigint not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  constraint contact_verification_rate_buckets_pkey primary key (
    field,
    method,
    purpose,
    scope,
    subject_digest_key_version,
    subject_digest,
    operation,
    window_started_at,
    window_seconds
  ),
  constraint contact_verification_rate_buckets_target_check check (
    purpose = 'contact_ownership'
    and (
      (field = 'phone' and method = 'phone_sms_otp')
      or
      (field = 'email' and method = any (
        array['email_code', 'email_link']::text[]
      ))
    )
  ),
  constraint contact_verification_rate_buckets_scope_check check (
    scope = any (array['account', 'contact', 'network']::text[])
    and pg_catalog.octet_length(subject_digest) = 32
    and subject_digest_key_version between 1 and 2147483647
  ),
  constraint contact_verification_rate_buckets_policy_check check (
    (
      operation = 'start'
      and (
        (window_seconds = 900 and limit_count = 3)
        or
        (window_seconds = 86400 and limit_count = 10)
      )
      and cooldown_until is null
    )
    or
    (
      operation = 'resend'
      and window_seconds = 60
      and limit_count = 1
      and cooldown_until = window_started_at + 60
    )
    or
    (
      operation = 'submit'
      and limit_count = 5
      and (
        (method = any (array['phone_sms_otp', 'email_code']::text[])
          and window_seconds = 600)
        or
        (method = 'email_link' and window_seconds = 900)
      )
      and cooldown_until is null
    )
  ),
  constraint contact_verification_rate_buckets_count_check check (
    consumed_count between 0 and limit_count
    and lock_version between 1 and 9007199254740991
  ),
  constraint contact_verification_rate_buckets_time_check check (
    created_at between 0 and 9007199254740991
    and window_started_at between 0 and created_at
    and updated_at between created_at and 9007199254740991
  )
);

create index contact_verification_rate_buckets_scope_window_idx
  on backend_auth.contact_verification_rate_buckets (
    scope,
    subject_digest_key_version,
    subject_digest,
    operation,
    window_started_at desc
  );

create table backend_auth.contact_verification_audit (
  event_id uuid not null,
  event_type text not null,
  occurred_at bigint not null,
  account_id uuid not null,
  challenge_id uuid,
  dispatch_id uuid,
  decision_id uuid,
  field text not null,
  method text,
  purpose text not null,
  operation text,
  contact_version bigint,
  outcome text not null,
  constraint contact_verification_audit_pkey primary key (event_id),
  constraint contact_verification_audit_account_fkey foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint contact_verification_audit_challenge_fkey foreign key (
    challenge_id,
    account_id,
    field,
    method,
    purpose
  ) references backend_auth.contact_verification_challenges (
    challenge_id,
    account_id,
    field,
    method,
    purpose
  )
    on update no action on delete no action not deferrable,
  constraint contact_verification_audit_dispatch_fkey foreign key (
    dispatch_id,
    challenge_id,
    account_id,
    field,
    method,
    purpose
  ) references backend_auth.contact_verification_dispatches (
    dispatch_id,
    challenge_id,
    account_id,
    field,
    method,
    purpose
  )
    on update no action on delete no action not deferrable,
  constraint contact_verification_audit_field_check check (
    field = any (array['phone', 'email']::text[])
    and purpose = 'contact_ownership'
  ),
  constraint contact_verification_audit_method_check check (
    method is null
    or (field = 'phone' and method = 'phone_sms_otp')
    or (field = 'email' and method = any (
      array['email_code', 'email_link']::text[]
    ))
  ),
  constraint contact_verification_audit_event_shape_check check (
    (
      event_type = 'challenge_created'
      and challenge_id is not null
      and dispatch_id is null
      and decision_id is null
      and method is not null
      and operation is null
      and contact_version is null
      and outcome = 'created'
    )
    or
    (
      event_type = 'delivery_outcome'
      and challenge_id is not null
      and dispatch_id is not null
      and decision_id is null
      and method is not null
      and operation is null
      and contact_version is null
      and outcome = any (array[
        'accepted',
        'unavailable',
        'rate_limited',
        'unknown'
      ]::text[])
    )
    or
    (
      event_type = 'challenge_transition'
      and challenge_id is not null
      and dispatch_id is null
      and decision_id is null
      and method is not null
      and operation is null
      and contact_version is null
      and outcome = any (array[
        'verified',
        'incorrect_proof',
        'resend_reserved',
        'attempts_exhausted',
        'expired',
        'cancelled',
        'idempotent_retry',
        'conflict',
        'rate_limited'
      ]::text[])
    )
    or
    (
      event_type = 'rate_limit_decision'
      and challenge_id is null
      and dispatch_id is null
      and decision_id is not null
      and method is not null
      and operation = any (array['start', 'resend', 'submit']::text[])
      and contact_version is null
      and outcome = any (array['allowed', 'rate_limited']::text[])
    )
    or
    (
      event_type = 'contact_invalidated'
      and challenge_id is null
      and dispatch_id is null
      and decision_id is null
      and method is null
      and operation is null
      and contact_version between 1 and 9007199254740991
      and outcome = 'invalidated'
    )
  ),
  constraint contact_verification_audit_time_check check (
    occurred_at between 0 and 9007199254740991
  )
);

create index contact_verification_audit_account_time_idx
  on backend_auth.contact_verification_audit (
    account_id,
    occurred_at desc,
    event_id
  );

create index contact_verification_audit_challenge_time_idx
  on backend_auth.contact_verification_audit (
    challenge_id,
    occurred_at,
    event_id
  )
  where challenge_id is not null;

create function backend_auth.guard_account_contact_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_DELETE_REQUIRES_APPROVED_RETENTION_POLICY';
  end if;

  if new.account_id is distinct from old.account_id
     or new.field is distinct from old.field
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_BINDING_IMMUTABLE';
  end if;

  if new.contact_version <> old.contact_version + 1
     or new.lock_version <> old.lock_version + 1
     or new.changed_at < old.changed_at
     or new.updated_at < new.changed_at then
    raise exception using
      errcode = '40001',
      message = 'BACKEND_CONTACT_VERSION_CONFLICT';
  end if;

  if exists (
    select 1
    from backend_auth.contact_verification_challenges challenge
    where challenge.account_id = old.account_id
      and challenge.field = old.field
      and challenge.state = 'pending'
  )
     or exists (
       select 1
       from backend_auth.contact_verification_dispatches dispatch
       where dispatch.account_id = old.account_id
         and dispatch.field = old.field
         and dispatch.invalidated_at is null
         and dispatch.status = any (
           array['reserved', 'pending', 'unknown']::text[]
         )
     ) then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_ACTIVE_VERIFICATION_MUST_BE_INVALIDATED';
  end if;

  return new;
end;
$function$;

create function backend_auth.guard_contact_verification_challenge_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_command backend_auth.contact_verification_commands%rowtype;
begin
  if tg_op = 'INSERT' then
    perform 1
    from backend_auth.account_contacts contact
    where contact.account_id = new.account_id
      and contact.field = new.field
      and contact.contact_version = new.contact_version
      and contact.subject_digest = new.subject_digest
      and contact.subject_digest_key_version = new.subject_digest_key_version
    for share;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'BACKEND_CONTACT_CHALLENGE_CURRENT_CONTACT_MISMATCH';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_CHALLENGE_IMMUTABLE';
  end if;

  if new.challenge_id is distinct from old.challenge_id
     or new.account_id is distinct from old.account_id
     or new.field is distinct from old.field
     or new.method is distinct from old.method
     or new.purpose is distinct from old.purpose
     or new.contact_version is distinct from old.contact_version
     or new.subject_digest is distinct from old.subject_digest
     or new.subject_digest_key_version is distinct from
       old.subject_digest_key_version
     or new.verifier_digest is distinct from old.verifier_digest
     or new.verifier_digest_key_version is distinct from
       old.verifier_digest_key_version
     or new.create_idempotency_key is distinct from old.create_idempotency_key
     or new.create_request_digest is distinct from old.create_request_digest
     or new.create_request_digest_key_version is distinct from
       old.create_request_digest_key_version
     or new.ttl_seconds is distinct from old.ttl_seconds
     or new.max_attempts is distinct from old.max_attempts
     or new.resend_cooldown_seconds is distinct from
       old.resend_cooldown_seconds
     or new.starts_per_15_minutes is distinct from old.starts_per_15_minutes
     or new.starts_per_24_hours is distinct from old.starts_per_24_hours
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_CHALLENGE_BINDING_IMMUTABLE';
  end if;

  if old.state <> 'pending' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_CHALLENGE_TERMINAL_IMMUTABLE';
  end if;

  if new.state <> 'pending'
     and new.state <> all (array[
       'verified',
       'expired',
       'attempts_exhausted',
       'cancelled'
     ]::text[]) then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_CONTACT_CHALLENGE_TRANSITION_INVALID';
  end if;

  if new.lock_version <> old.lock_version + 1
     or new.last_command_sequence <> old.last_command_sequence + 1
     or new.attempts_remaining not in (
       old.attempts_remaining,
       old.attempts_remaining - 1
     )
     or new.updated_at < old.updated_at
     or new.status_changed_at < old.status_changed_at then
    raise exception using
      errcode = '40001',
      message = 'BACKEND_CONTACT_CHALLENGE_VERSION_CONFLICT';
  end if;

  select command.*
  into v_command
  from backend_auth.contact_verification_commands command
  where command.challenge_id = old.challenge_id
    and command.sequence = new.last_command_sequence;

  if v_command.command_id is null
     or v_command.applied_at <> new.updated_at
     or v_command.applied_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_CONTACT_COMMAND_TRANSITION_BINDING_REQUIRED';
  end if;

  if old.proof_ciphertext is null and new.proof_ciphertext is not null then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_PROOF_ENVELOPE_RESTORE_FORBIDDEN';
  end if;

  if new.proof_ciphertext is not null
     and (
       new.proof_ciphertext is distinct from old.proof_ciphertext
       or new.proof_nonce is distinct from old.proof_nonce
       or new.proof_auth_tag is distinct from old.proof_auth_tag
       or new.proof_algorithm is distinct from old.proof_algorithm
       or new.proof_key_version is distinct from old.proof_key_version
       or new.proof_expires_at is distinct from old.proof_expires_at
     ) then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_PROOF_ENVELOPE_IMMUTABLE';
  end if;

  if v_command.result_code <> 'expired'
     and v_command.applied_at >= old.expires_at then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_CONTACT_COMMAND_AFTER_EXPIRY_FORBIDDEN';
  end if;

  if v_command.result_code = 'verified' then
    perform 1
    from backend_auth.account_contacts contact
    where contact.account_id = old.account_id
      and contact.field = old.field
      and contact.contact_version = old.contact_version
      and contact.subject_digest = old.subject_digest
      and contact.subject_digest_key_version = old.subject_digest_key_version
    for share;

    if not found
       or v_command.command_type <> 'submit_proof'
       or v_command.presented_digest is distinct from old.verifier_digest
       or v_command.presented_digest_key_version is distinct from
         old.verifier_digest_key_version
       or new.state <> 'verified'
       or new.verified_command_id is distinct from v_command.command_id
       or new.verified_at <> v_command.applied_at
       or new.terminal_at <> v_command.applied_at
       or new.status_changed_at <> v_command.applied_at
       or new.attempts_remaining <> old.attempts_remaining
       or new.last_dispatch_at <> old.last_dispatch_at
       or new.resend_count <> old.resend_count then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_CONTACT_VERIFIED_COMMAND_BINDING_INVALID';
    end if;
  elsif v_command.result_code = 'incorrect_proof' then
    if v_command.command_type <> 'submit_proof'
       or (
         v_command.presented_digest is not distinct from old.verifier_digest
         and v_command.presented_digest_key_version is not distinct from
           old.verifier_digest_key_version
       )
       or new.state <> 'pending'
       or new.attempts_remaining <> old.attempts_remaining - 1
       or v_command.result_attempts_remaining <> new.attempts_remaining
       or new.status_changed_at <> old.status_changed_at
       or new.last_dispatch_at <> old.last_dispatch_at
       or new.resend_count <> old.resend_count then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_CONTACT_INCORRECT_PROOF_COMMAND_BINDING_INVALID';
    end if;
  elsif v_command.result_code = 'attempts_exhausted' then
    if v_command.command_type <> 'submit_proof'
       or (
         v_command.presented_digest is not distinct from old.verifier_digest
         and v_command.presented_digest_key_version is not distinct from
           old.verifier_digest_key_version
       )
       or old.attempts_remaining <> 1
       or new.attempts_remaining <> 0
       or new.state <> 'attempts_exhausted'
       or new.terminal_at <> v_command.applied_at
       or new.status_changed_at <> v_command.applied_at
       or new.last_dispatch_at <> old.last_dispatch_at
       or new.resend_count <> old.resend_count then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_CONTACT_ATTEMPTS_COMMAND_BINDING_INVALID';
    end if;
  elsif v_command.result_code = 'expired' then
    if v_command.applied_at < old.expires_at
       or new.state <> 'expired'
       or new.attempts_remaining <> old.attempts_remaining
       or new.terminal_at <> v_command.applied_at
       or new.status_changed_at <> v_command.applied_at
       or new.last_dispatch_at <> old.last_dispatch_at
       or new.resend_count <> old.resend_count then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_CONTACT_EXPIRED_COMMAND_BINDING_INVALID';
    end if;
  elsif v_command.result_code = 'cancelled' then
    if v_command.command_type <> 'cancel'
       or new.state <> 'cancelled'
       or new.cancel_reason is distinct from v_command.cancel_reason
       or new.attempts_remaining <> old.attempts_remaining
       or new.terminal_at <> v_command.applied_at
       or new.status_changed_at <> v_command.applied_at
       or new.last_dispatch_at <> old.last_dispatch_at
       or new.resend_count <> old.resend_count then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_CONTACT_CANCEL_COMMAND_BINDING_INVALID';
    end if;
  elsif v_command.result_code = 'resend_reserved' then
    if v_command.command_type <> 'reserve_resend'
       or new.state <> 'pending'
       or new.attempts_remaining <> old.attempts_remaining
       or new.last_dispatch_at <> v_command.applied_at
       or new.resend_count <> old.resend_count + 1
       or new.status_changed_at <> old.status_changed_at then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_CONTACT_RESEND_COMMAND_BINDING_INVALID';
    end if;
  else
    raise exception using
      errcode = '23514',
      message = 'BACKEND_CONTACT_COMMAND_RESULT_UNSUPPORTED';
  end if;

  if new.last_dispatch_at = old.last_dispatch_at then
    if new.resend_count <> old.resend_count
       or new.resend_not_before_at <> old.resend_not_before_at then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_CONTACT_RESEND_STATE_INVALID';
    end if;
  elsif new.last_dispatch_at < old.resend_not_before_at
        or new.resend_count <> old.resend_count + 1
        or new.last_command_sequence <> old.last_command_sequence + 1
        or new.resend_not_before_at <>
          new.last_dispatch_at + new.resend_cooldown_seconds
        or new.attempts_remaining <> old.attempts_remaining
        or new.verifier_digest is distinct from old.verifier_digest then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_CONTACT_RESEND_COOLDOWN_OR_PROOF_INVALID';
  end if;

  if new.state <> 'pending' and exists (
    select 1
    from backend_auth.contact_verification_dispatches dispatch
    where dispatch.challenge_id = old.challenge_id
      and dispatch.invalidated_at is null
      and dispatch.status = any (
        array['reserved', 'pending', 'unknown']::text[]
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_RECOVERABLE_DISPATCH_MUST_BE_INVALIDATED';
  end if;

  return new;
end;
$function$;

create function backend_auth.guard_contact_verification_dispatch_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_DISPATCH_IMMUTABLE';
  end if;

  if new.dispatch_id is distinct from old.dispatch_id
     or new.challenge_id is distinct from old.challenge_id
     or new.account_id is distinct from old.account_id
     or new.field is distinct from old.field
     or new.method is distinct from old.method
     or new.purpose is distinct from old.purpose
     or new.challenge_expires_at is distinct from old.challenge_expires_at
     or new.dispatch_kind is distinct from old.dispatch_kind
     or new.command_id is distinct from old.command_id
     or new.reserved_at is distinct from old.reserved_at
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_DISPATCH_BINDING_IMMUTABLE';
  end if;

  if old.invalidated_at is not null
     or old.status = any (
       array['accepted', 'unavailable', 'rate_limited']::text[]
     ) then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_DISPATCH_TERMINAL_IMMUTABLE';
  end if;

  if new.lock_version <> old.lock_version + 1
     or new.updated_at < old.updated_at
     or new.status_changed_at < old.status_changed_at
     or new.reconciliation_attempts not in (
       old.reconciliation_attempts,
       old.reconciliation_attempts + 1
     ) then
    raise exception using
      errcode = '40001',
      message = 'BACKEND_CONTACT_DISPATCH_VERSION_CONFLICT';
  end if;

  if (
       new.status = 'reserved'
       and old.status <> 'reserved'
     )
     or (
       new.status = 'pending'
       and old.status <> all (array['reserved', 'unknown']::text[])
     )
     or (
       new.status = 'unknown'
       and old.status <> all (
         array['reserved', 'pending', 'unknown']::text[]
       )
     )
     or (
       new.status = any (
         array['accepted', 'unavailable', 'rate_limited']::text[]
       )
       and old.status <> all (
         array['reserved', 'pending', 'unknown']::text[]
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_CONTACT_DISPATCH_TRANSITION_INVALID';
  end if;

  if old.payload_ciphertext is null and new.payload_ciphertext is not null then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_DISPATCH_ENVELOPE_RESTORE_FORBIDDEN';
  end if;

  if new.payload_ciphertext is not null
     and (
       new.payload_ciphertext is distinct from old.payload_ciphertext
       or new.payload_nonce is distinct from old.payload_nonce
       or new.payload_auth_tag is distinct from old.payload_auth_tag
       or new.payload_algorithm is distinct from old.payload_algorithm
       or new.payload_key_version is distinct from old.payload_key_version
       or new.payload_digest is distinct from old.payload_digest
       or new.payload_digest_key_version is distinct from
         old.payload_digest_key_version
       or new.payload_expires_at is distinct from old.payload_expires_at
     ) then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_DISPATCH_ENVELOPE_IMMUTABLE';
  end if;

  if old.reconciliation_ref_ciphertext is not null
     and new.reconciliation_ref_ciphertext is not null
     and (
       new.reconciliation_ref_ciphertext is distinct from
         old.reconciliation_ref_ciphertext
       or new.reconciliation_ref_nonce is distinct from
         old.reconciliation_ref_nonce
       or new.reconciliation_ref_auth_tag is distinct from
         old.reconciliation_ref_auth_tag
       or new.reconciliation_ref_algorithm is distinct from
         old.reconciliation_ref_algorithm
       or new.reconciliation_ref_key_version is distinct from
         old.reconciliation_ref_key_version
       or new.reconciliation_ref_digest is distinct from
         old.reconciliation_ref_digest
       or new.reconciliation_ref_digest_key_version is distinct from
         old.reconciliation_ref_digest_key_version
       or new.reconciliation_ref_expires_at is distinct from
         old.reconciliation_ref_expires_at
     ) then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_RECONCILIATION_REFERENCE_IMMUTABLE';
  end if;

  return new;
end;
$function$;

create function backend_auth.guard_contact_verification_rate_bucket_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_RATE_HISTORY_RETENTION_UNAPPROVED';
  end if;

  if new.field is distinct from old.field
     or new.method is distinct from old.method
     or new.purpose is distinct from old.purpose
     or new.scope is distinct from old.scope
     or new.subject_digest is distinct from old.subject_digest
     or new.subject_digest_key_version is distinct from
       old.subject_digest_key_version
     or new.operation is distinct from old.operation
     or new.window_started_at is distinct from old.window_started_at
     or new.window_seconds is distinct from old.window_seconds
     or new.limit_count is distinct from old.limit_count
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_CONTACT_RATE_BUCKET_BINDING_IMMUTABLE';
  end if;

  if new.lock_version <> old.lock_version + 1
     or new.consumed_count < old.consumed_count
     or new.consumed_count > old.consumed_count + 1
     or new.updated_at < old.updated_at
     or new.cooldown_until is distinct from old.cooldown_until then
    raise exception using
      errcode = '40001',
      message = 'BACKEND_CONTACT_RATE_BUCKET_VERSION_CONFLICT';
  end if;

  if (
       new.consumed_count = old.consumed_count
       and new.last_decision_id is distinct from old.last_decision_id
     )
     or (
       new.consumed_count = old.consumed_count + 1
       and new.last_decision_id is not distinct from old.last_decision_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_CONTACT_RATE_DECISION_BINDING_INVALID';
  end if;

  return new;
end;
$function$;

create trigger account_contacts_transition_guard
before update or delete on backend_auth.account_contacts
for each row execute function backend_auth.guard_account_contact_transition();

create trigger account_contacts_truncate_guard
before truncate on backend_auth.account_contacts
for each statement execute function backend_auth.reject_immutable_mutation();

create trigger contact_verification_challenges_transition_guard
before insert or update or delete on backend_auth.contact_verification_challenges
for each row execute function
  backend_auth.guard_contact_verification_challenge_transition();

create trigger contact_verification_challenges_truncate_guard
before truncate on backend_auth.contact_verification_challenges
for each statement execute function backend_auth.reject_immutable_mutation();

create trigger contact_verification_commands_update_delete_guard
before update or delete on backend_auth.contact_verification_commands
for each row execute function backend_auth.reject_immutable_mutation();

create trigger contact_verification_commands_truncate_guard
before truncate on backend_auth.contact_verification_commands
for each statement execute function backend_auth.reject_immutable_mutation();

create trigger contact_verification_dispatches_transition_guard
before update or delete on backend_auth.contact_verification_dispatches
for each row execute function
  backend_auth.guard_contact_verification_dispatch_transition();

create trigger contact_verification_dispatches_truncate_guard
before truncate on backend_auth.contact_verification_dispatches
for each statement execute function backend_auth.reject_immutable_mutation();

create trigger contact_verification_rate_buckets_transition_guard
before update or delete on backend_auth.contact_verification_rate_buckets
for each row execute function
  backend_auth.guard_contact_verification_rate_bucket_transition();

create trigger contact_verification_rate_buckets_truncate_guard
before truncate on backend_auth.contact_verification_rate_buckets
for each statement execute function backend_auth.reject_immutable_mutation();

create trigger contact_verification_audit_update_delete_guard
before update or delete on backend_auth.contact_verification_audit
for each row execute function backend_auth.reject_immutable_mutation();

create trigger contact_verification_audit_truncate_guard
before truncate on backend_auth.contact_verification_audit
for each statement execute function backend_auth.reject_immutable_mutation();

revoke all on table
  backend_auth.account_contacts,
  backend_auth.contact_verification_challenges,
  backend_auth.contact_verification_commands,
  backend_auth.contact_verification_dispatches,
  backend_auth.contact_verification_rate_buckets,
  backend_auth.contact_verification_audit
from public, backend_auth_app;

revoke all on function
  backend_auth.guard_account_contact_transition(),
  backend_auth.guard_contact_verification_challenge_transition(),
  backend_auth.guard_contact_verification_dispatch_transition(),
  backend_auth.guard_contact_verification_rate_bucket_transition()
from public, backend_auth_app;

do $acl_lockdown$
declare
  v_name text;
  v_relation pg_catalog.regclass;
  v_function pg_catalog.regprocedure;
  v_grantee text;
begin
  foreach v_name in array array[
    'account_contacts',
    'contact_verification_challenges',
    'contact_verification_commands',
    'contact_verification_dispatches',
    'contact_verification_rate_buckets',
    'contact_verification_audit'
  ] loop
    v_relation := ('backend_auth.' || v_name)::pg_catalog.regclass;
    for v_grantee in
      select role_row.rolname
      from pg_catalog.pg_class relation_row
      cross join lateral pg_catalog.aclexplode(
        pg_catalog.coalesce(
          relation_row.relacl,
          pg_catalog.acldefault('r', relation_row.relowner)
        )
      ) acl
      join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where relation_row.oid = v_relation
        and acl.grantee <> relation_row.relowner
    loop
      execute pg_catalog.format(
        'revoke all privileges on table %s from %I',
        v_relation,
        v_grantee
      );
    end loop;
  end loop;

  foreach v_name in array array[
    'guard_account_contact_transition()',
    'guard_contact_verification_challenge_transition()',
    'guard_contact_verification_dispatch_transition()',
    'guard_contact_verification_rate_bucket_transition()'
  ] loop
    v_function := ('backend_auth.' || v_name)::pg_catalog.regprocedure;
    for v_grantee in
      select role_row.rolname
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        pg_catalog.coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = v_function
        and acl.grantee <> function_row.proowner
    loop
      execute pg_catalog.format(
        'revoke all privileges on function %s from %I',
        v_function,
        v_grantee
      );
    end loop;
  end loop;
end;
$acl_lockdown$;

do $comments$
declare
  v_name text;
  v_relation pg_catalog.regclass;
  v_function pg_catalog.regprocedure;
begin
  foreach v_name in array array[
    'account_contacts',
    'contact_verification_challenges',
    'contact_verification_commands',
    'contact_verification_dispatches',
    'contact_verification_rate_buckets',
    'contact_verification_audit'
  ] loop
    v_relation := ('backend_auth.' || v_name)::pg_catalog.regclass;
    execute pg_catalog.format(
      'comment on table %s is %L',
      v_relation,
      '042_backend_contact_verification_persistence:'
        || backend_auth.relation_fingerprint(v_relation)
    );
  end loop;

  foreach v_name in array array[
    'guard_account_contact_transition()',
    'guard_contact_verification_challenge_transition()',
    'guard_contact_verification_dispatch_transition()',
    'guard_contact_verification_rate_bucket_transition()'
  ] loop
    v_function := ('backend_auth.' || v_name)::pg_catalog.regprocedure;
    execute pg_catalog.format(
      'comment on function %s is %L',
      v_function,
      '042_backend_contact_verification_persistence:'
        || pg_catalog.md5(pg_catalog.pg_get_functiondef(v_function::oid))
    );
  end loop;
end;
$comments$;

do $assertions$
declare
  v_name text;
  v_relation_oid oid;
  v_function_oid oid;
begin
  foreach v_name in array array[
    'account_contacts',
    'contact_verification_challenges',
    'contact_verification_commands',
    'contact_verification_dispatches',
    'contact_verification_rate_buckets',
    'contact_verification_audit'
  ] loop
    v_relation_oid := pg_catalog.to_regclass('backend_auth.' || v_name)::oid;
    if v_relation_oid is null
       or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
         '042_backend_contact_verification_persistence:'
           || backend_auth.relation_fingerprint(
             v_relation_oid::pg_catalog.regclass
           )
       or pg_catalog.has_table_privilege(
         'public',
         v_relation_oid,
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app',
         v_relation_oid,
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
       )
       or exists (
         select 1
         from pg_catalog.pg_class relation_row
         where relation_row.oid = v_relation_oid
           and relation_row.relowner is distinct from
             pg_catalog.to_regrole('backend_auth_owner')::oid
       )
       or exists (
         select 1
         from pg_catalog.pg_class relation_row
         cross join lateral pg_catalog.aclexplode(
           pg_catalog.coalesce(
             relation_row.relacl,
             pg_catalog.acldefault('r', relation_row.relowner)
           )
         ) acl
         where relation_row.oid = v_relation_oid
           and acl.grantee <> relation_row.relowner
       ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: relation % differs', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'guard_account_contact_transition()',
    'guard_contact_verification_challenge_transition()',
    'guard_contact_verification_dispatch_transition()',
    'guard_contact_verification_rate_bucket_transition()'
  ] loop
    v_function_oid := pg_catalog.to_regprocedure(
      'backend_auth.' || v_name
    )::oid;
    if v_function_oid is null
       or pg_catalog.obj_description(v_function_oid, 'pg_proc') is distinct from
         '042_backend_contact_verification_persistence:'
           || pg_catalog.md5(
             pg_catalog.pg_get_functiondef(v_function_oid)
           )
       or exists (
         select 1
         from pg_catalog.pg_proc function_row
         where function_row.oid = v_function_oid
           and (
             function_row.proowner is distinct from
               pg_catalog.to_regrole('backend_auth_owner')::oid
             or function_row.prosecdef
             or function_row.provolatile <> 'v'
             or function_row.proconfig is distinct from
               array['search_path=pg_catalog, pg_temp']::text[]
           )
       )
       or pg_catalog.has_function_privilege(
         'public',
         v_function_oid,
         'EXECUTE'
       )
       or pg_catalog.has_function_privilege(
         'backend_auth_app',
         v_function_oid,
         'EXECUTE'
       )
       or exists (
         select 1
         from pg_catalog.pg_proc function_row
         cross join lateral pg_catalog.aclexplode(
           pg_catalog.coalesce(
             function_row.proacl,
             pg_catalog.acldefault('f', function_row.proowner)
           )
         ) acl
         where function_row.oid = v_function_oid
           and acl.grantee <> function_row.proowner
       ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: function % differs', v_name;
    end if;
  end loop;

  if exists (select 1 from backend_auth.account_contacts)
     or exists (select 1 from backend_auth.contact_verification_challenges)
     or exists (select 1 from backend_auth.contact_verification_commands)
     or exists (select 1 from backend_auth.contact_verification_dispatches)
     or exists (select 1 from backend_auth.contact_verification_rate_buckets)
     or exists (select 1 from backend_auth.contact_verification_audit) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 042 target must start empty';
  end if;
end;
$assertions$;

reset role;
commit;

select '042_backend_contact_verification_persistence applied; runtime disconnected'
  as result;
