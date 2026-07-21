-- 015_backend_auth_foundation_POSTCHECK.sql
-- Read-only structural and privilege verification. Inserts no probe data.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'POSTCHECK_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;
end;
$$;

set local role backend_auth_owner;

-- Independent column contract. Fingerprints below remain useful for drift,
-- but this inventory is authored in POSTCHECK and cannot be self-signed by a
-- structurally incorrect main migration.
do $$
declare
  v_expected_columns pg_catalog.jsonb := $columns$
  {
    "accounts": [
      ["id", "uuid", true, null, ""],
      ["role", "text", true, "'player'::text", ""],
      ["status", "text", true, "'active'::text", ""],
      ["created_at", "bigint", true, null, ""],
      ["updated_at", "bigint", true, null, ""]
    ],
    "player_profiles": [
      ["account_id", "uuid", true, null, ""]
    ],
    "external_identities": [
      ["id", "uuid", true, null, ""],
      ["account_id", "uuid", true, null, ""],
      ["provider", "text", true, null, ""],
      ["namespace", "text", true, null, ""],
      ["status", "text", true, null, ""],
      ["is_primary", "boolean", true, null, ""]
    ],
    "external_identity_lookup_digests": [
      ["identity_id", "uuid", true, null, ""],
      ["algorithm", "text", true, null, ""],
      ["provider", "text", true, null, ""],
      ["namespace", "text", true, null, ""],
      ["digest", "bytea", true, null, ""],
      ["digest_version", "bigint", true, null, ""],
      ["pepper_version", "bigint", true, null, ""],
      ["created_at", "bigint", true, null, ""]
    ],
    "authentication_operations": [
      ["id", "uuid", true, null, ""],
      ["intent", "text", true, null, ""],
      ["identity_provider", "text", true, null, ""],
      ["identity_namespace", "text", true, null, ""],
      ["identity_lookup_digest", "bytea", true, null, ""],
      ["proof_type", "text", true, null, ""],
      ["telegram_proof_fingerprint", "bytea", false, null, ""],
      ["otp_challenge_id", "uuid", false, null, ""],
      ["created_at", "bigint", true, null, ""],
      ["expires_at", "bigint", true, null, ""],
      ["idempotency_key", "text", true, null, ""],
      ["request_digest", "text", true, null, ""],
      ["status", "text", true, "'pending'::text", ""],
      ["resolution_type", "text", false, null, ""],
      ["resolution_account_id", "uuid", false, null, ""],
      ["resolution_account_status", "text", false, null, ""],
      ["resolution_initial_role", "text", false, null, ""],
      ["resolution_reason", "text", false, null, ""],
      ["failure_reason", "text", false, null, ""],
      ["terminal_command_id", "uuid", false, null, ""],
      ["terminal_command_type", "text", false, null, ""],
      ["terminal_applied_at", "bigint", false, null, ""]
    ],
    "telegram_proof_consumptions": [
      ["proof_fingerprint", "bytea", true, null, ""],
      ["proof_expires_at", "bigint", true, null, ""],
      ["intent", "text", true, null, ""],
      ["idempotency_key", "text", true, null, ""],
      ["request_digest", "text", true, null, ""],
      ["operation_id", "uuid", true, null, ""],
      ["consumed_at", "bigint", true, null, ""]
    ],
    "auth_session_families": [
      ["id", "uuid", true, null, ""],
      ["account_id", "uuid", true, null, ""],
      ["authentication_operation_id", "uuid", true, null, ""],
      ["status", "text", true, "'active'::text", ""],
      ["current_credential_generation", "bigint", true, null, ""],
      ["created_at", "bigint", true, null, ""],
      ["expires_at", "bigint", true, null, ""],
      ["terminal_command_id", "uuid", false, null, ""],
      ["terminal_reason", "text", false, null, ""],
      ["terminal_at", "bigint", false, null, ""],
      ["terminal_reuse_generation", "bigint", false, null, ""],
      ["terminal_reuse_digest", "bytea", false, null, ""]
    ],
    "auth_session_credentials": [
      ["family_id", "uuid", true, null, ""],
      ["generation", "bigint", true, null, ""],
      ["digest", "bytea", true, null, ""],
      ["issued_at", "bigint", true, null, ""],
      ["consumed_at", "bigint", false, null, ""],
      ["consumed_by_command_id", "uuid", false, null, ""]
    ],
    "auth_session_commands": [
      ["family_id", "uuid", true, null, ""],
      ["command_id", "uuid", true, null, ""],
      ["command_sequence", "bigint", true, null, ""],
      ["request_digest", "text", true, null, ""],
      ["command_type", "text", true, null, ""],
      ["applied_at", "bigint", true, null, ""],
      ["presented_generation", "bigint", false, null, ""],
      ["presented_digest", "bytea", false, null, ""],
      ["next_generation", "bigint", false, null, ""],
      ["next_digest", "bytea", false, null, ""],
      ["reason", "text", false, null, ""],
      ["result_type", "text", true, null, ""]
    ],
    "fresh_authentication_evidence": [
      ["id", "uuid", true, null, ""],
      ["account_id", "uuid", true, null, ""],
      ["family_id", "uuid", true, null, ""],
      ["verification_method", "text", true, null, ""],
      ["authenticated_at", "bigint", true, null, ""],
      ["expires_at", "bigint", true, null, ""]
    ],
    "reauthentication_grants": [
      ["id", "uuid", true, null, ""],
      ["evidence_id", "uuid", true, null, ""],
      ["account_id", "uuid", true, null, ""],
      ["family_id", "uuid", true, null, ""],
      ["scope", "text", true, null, ""],
      ["resource_digest", "bytea", true, null, ""],
      ["created_at", "bigint", true, null, ""],
      ["expires_at", "bigint", true, null, ""],
      ["status", "text", true, "'active'::text", ""],
      ["terminal_command_id", "uuid", false, null, ""],
      ["terminal_command_type", "text", false, null, ""],
      ["terminal_request_digest", "bytea", false, null, ""],
      ["terminal_applied_at", "bigint", false, null, ""],
      ["terminal_reason", "text", false, null, ""]
    ],
    "otp_challenges": [
      ["id", "uuid", true, null, ""],
      ["intent", "text", true, null, ""],
      ["identity_provider", "text", true, null, ""],
      ["identity_namespace", "text", true, null, ""],
      ["identity_lookup_digest", "bytea", true, null, ""],
      ["operation_id", "uuid", true, null, ""],
      ["request_digest", "bytea", true, null, ""],
      ["verifier_digest", "bytea", true, null, ""],
      ["created_at", "bigint", true, null, ""],
      ["expires_at", "bigint", true, null, ""],
      ["max_attempts", "bigint", true, null, ""],
      ["attempts_remaining", "bigint", true, null, ""],
      ["status", "text", true, "'pending'::text", ""],
      ["terminal_command_id", "uuid", false, null, ""],
      ["terminal_at", "bigint", false, null, ""],
      ["terminal_reason", "text", false, null, ""]
    ],
    "otp_commands": [
      ["challenge_id", "uuid", true, null, ""],
      ["command_id", "uuid", true, null, ""],
      ["command_sequence", "bigint", true, null, ""],
      ["request_digest", "bytea", true, null, ""],
      ["command_type", "text", true, null, ""],
      ["applied_at", "bigint", true, null, ""],
      ["presented_digest", "bytea", false, null, ""],
      ["reason", "text", false, null, ""],
      ["result_type", "text", true, null, ""],
      ["result_attempts_remaining", "bigint", false, null, ""]
    ],
    "security_audit_events": [
      ["event_order", "bigint", true, "<identity>", "a"],
      ["event_id", "uuid", true, null, ""],
      ["event_type", "text", true, null, ""],
      ["outcome", "text", true, null, ""],
      ["occurred_at", "bigint", true, null, ""],
      ["account_id", "uuid", false, null, ""],
      ["role", "text", false, null, ""],
      ["previous_status", "text", false, null, ""],
      ["next_status", "text", false, null, ""],
      ["identity_id", "uuid", false, null, ""],
      ["provider", "text", false, null, ""],
      ["reserved_account_id", "uuid", false, null, ""],
      ["attempted_account_id", "uuid", false, null, ""],
      ["operation_id", "uuid", false, null, ""],
      ["attempted_operation_id", "uuid", false, null, ""],
      ["intent", "text", false, null, ""],
      ["terminal_status", "text", false, null, ""],
      ["challenge_id", "uuid", false, null, ""],
      ["otp_status", "text", false, null, ""],
      ["session_id", "uuid", false, null, ""],
      ["session_status", "text", false, null, ""],
      ["generation", "bigint", false, null, ""],
      ["evidence_id", "uuid", false, null, ""],
      ["verification_method", "text", false, null, ""],
      ["grant_id", "uuid", false, null, ""],
      ["scope", "text", false, null, ""],
      ["grant_status", "text", false, null, ""],
      ["aggregate_type", "text", false, null, ""],
      ["aggregate_id", "uuid", false, null, ""]
    ]
  }
  $columns$::pg_catalog.jsonb;
  v_mismatch_count bigint;
begin
  with expected as (
    select table_entry.key as table_name,
           column_entry.ordinality::integer as column_position,
           column_entry.value ->> 0 as column_name,
           column_entry.value ->> 1 as data_type,
           (column_entry.value ->> 2)::boolean as not_null,
           column_entry.value ->> 3 as default_expression,
           column_entry.value ->> 4 as identity_kind
    from pg_catalog.jsonb_each(v_expected_columns) table_entry
    cross join lateral pg_catalog.jsonb_array_elements(table_entry.value)
      with ordinality column_entry(value, ordinality)
  ), actual as (
    select c.relname as table_name, a.attnum::integer as column_position,
           a.attname as column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
           a.attnotnull as not_null,
           case when a.attidentity = 'a' then '<identity>'
             else pg_catalog.pg_get_expr(d.adbin, d.adrelid, false) end
             as default_expression,
           a.attidentity::text as identity_kind
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'backend_auth' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped
  )
  select pg_catalog.count(*) into v_mismatch_count
  from expected e
  full join actual a
    on a.table_name = e.table_name and a.column_position = e.column_position
  where a.table_name is null or e.table_name is null
     or a.column_name is distinct from e.column_name
     or a.data_type is distinct from e.data_type
     or a.not_null is distinct from e.not_null
     or a.default_expression is distinct from e.default_expression
     or a.identity_kind is distinct from e.identity_kind;

  if v_mismatch_count <> 0 then
    raise exception 'POSTCHECK_FAILED: exact column/type/nullability/default inventory has % mismatches',
      v_mismatch_count;
  end if;
end;
$$;

-- Independent constraint inventory.  Names and kinds are declared here rather
-- than copied from the relation fingerprint stored by the main migration.
do $$
declare
  v_expected_constraint_names constant text[] := array[
    'accounts_pkey', 'accounts_role_check', 'accounts_status_check',
    'accounts_time_check', 'player_profiles_pkey',
    'player_profiles_account_id_fkey', 'external_identities_pkey',
    'external_identities_binding_key', 'external_identities_account_id_fkey',
    'external_identities_provider_check', 'external_identities_namespace_check',
    'external_identities_state_check',
    'external_identity_lookup_digests_pkey',
    'external_identity_lookup_digests_global_key',
    'external_identity_lookup_digests_identity_fkey',
    'external_identity_lookup_digests_algorithm_check',
    'external_identity_lookup_digests_provider_check',
    'external_identity_lookup_digests_namespace_check',
    'external_identity_lookup_digests_digest_check',
    'external_identity_lookup_digests_version_check',
    'external_identity_lookup_digests_created_at_check',
    'authentication_operations_pkey',
    'authentication_operations_idempotency_key_key',
    'authentication_operations_telegram_fingerprint_key',
    'authentication_operations_otp_challenge_key',
    'authentication_operations_resolution_account_fkey',
    'authentication_operations_intent_check',
    'authentication_operations_identity_provider_check',
    'authentication_operations_identity_namespace_check',
    'authentication_operations_identity_digest_check',
    'authentication_operations_proof_check',
    'authentication_operations_window_check',
    'authentication_operations_idempotency_key_check',
    'authentication_operations_request_digest_check',
    'authentication_operations_status_check',
    'authentication_operations_resolution_values_check',
    'authentication_operations_resolution_shape_check',
    'authentication_operations_intent_resolution_check',
    'authentication_operations_terminal_check',
    'telegram_proof_consumptions_pkey',
    'telegram_proof_consumptions_idempotency_key_key',
    'telegram_proof_consumptions_operation_id_key',
    'telegram_proof_consumptions_operation_id_fkey',
    'telegram_proof_consumptions_fingerprint_check',
    'telegram_proof_consumptions_intent_check',
    'telegram_proof_consumptions_idempotency_key_check',
    'telegram_proof_consumptions_request_digest_check',
    'telegram_proof_consumptions_time_check',
    'auth_session_families_pkey', 'auth_session_families_operation_id_key',
    'auth_session_families_id_account_key',
    'auth_session_families_account_id_fkey',
    'auth_session_families_operation_id_fkey',
    'auth_session_families_status_check',
    'auth_session_families_generation_check',
    'auth_session_families_window_check', 'auth_session_families_reason_check',
    'auth_session_families_reuse_digest_check',
    'auth_session_families_terminal_check', 'auth_session_credentials_pkey',
    'auth_session_credentials_family_digest_key',
    'auth_session_credentials_family_id_fkey',
    'auth_session_credentials_generation_check',
    'auth_session_credentials_digest_check',
    'auth_session_credentials_time_check',
    'auth_session_credentials_consumption_check', 'auth_session_commands_pkey',
    'auth_session_commands_family_sequence_key',
    'auth_session_commands_family_id_fkey',
    'auth_session_commands_sequence_check',
    'auth_session_commands_request_digest_check',
    'auth_session_commands_applied_at_check',
    'auth_session_commands_credential_reference_check',
    'auth_session_commands_reason_check', 'auth_session_commands_variant_check',
    'fresh_authentication_evidence_pkey',
    'fresh_authentication_evidence_binding_key',
    'fresh_authentication_evidence_family_account_fkey',
    'fresh_authentication_evidence_method_check',
    'fresh_authentication_evidence_window_check', 'reauthentication_grants_pkey',
    'reauthentication_grants_evidence_binding_fkey',
    'reauthentication_grants_scope_check',
    'reauthentication_grants_resource_digest_check',
    'reauthentication_grants_window_check',
    'reauthentication_grants_status_check',
    'reauthentication_grants_terminal_digest_check',
    'reauthentication_grants_reason_check',
    'reauthentication_grants_terminal_check', 'otp_challenges_pkey',
    'otp_challenges_operation_id_key', 'otp_challenges_operation_id_fkey',
    'otp_challenges_intent_check', 'otp_challenges_identity_check',
    'otp_challenges_digest_check', 'otp_challenges_window_check',
    'otp_challenges_attempts_check', 'otp_challenges_status_check',
    'otp_challenges_reason_check', 'otp_challenges_terminal_check',
    'otp_commands_pkey', 'otp_commands_challenge_sequence_key',
    'otp_commands_challenge_id_fkey', 'otp_commands_sequence_check',
    'otp_commands_request_digest_check', 'otp_commands_applied_at_check',
    'otp_commands_presented_digest_check', 'otp_commands_reason_check',
    'otp_commands_result_attempts_check', 'otp_commands_variant_check',
    'security_audit_events_pkey', 'security_audit_events_event_order_key',
    'security_audit_events_account_id_fkey',
    'security_audit_events_identity_id_fkey',
    'security_audit_events_reserved_account_id_fkey',
    'security_audit_events_operation_id_fkey',
    'security_audit_events_challenge_id_fkey',
    'security_audit_events_session_id_fkey',
    'security_audit_events_evidence_id_fkey',
    'security_audit_events_grant_id_fkey',
    'security_audit_events_event_type_check',
    'security_audit_events_outcome_check',
    'security_audit_events_occurred_at_check',
    'security_audit_events_metadata_values_check',
    'security_audit_events_metadata_shape_check',
    'authentication_operations_telegram_proof_fkey',
    'authentication_operations_otp_challenge_fkey',
    'auth_session_families_current_credential_fkey',
    'auth_session_families_terminal_command_fkey',
    'auth_session_credentials_consuming_command_fkey',
    'otp_challenges_terminal_command_fkey'
  ]::text[];
  v_actual_constraint_names text[];
  v_expected_fks pg_catalog.jsonb := $fks$
  [
    ["player_profiles_account_id_fkey","player_profiles","account_id","accounts","id",false,false],
    ["external_identities_account_id_fkey","external_identities","account_id","accounts","id",false,false],
    ["external_identity_lookup_digests_identity_fkey","external_identity_lookup_digests","identity_id,provider,namespace","external_identities","id,provider,namespace",false,false],
    ["authentication_operations_resolution_account_fkey","authentication_operations","resolution_account_id","accounts","id",false,false],
    ["telegram_proof_consumptions_operation_id_fkey","telegram_proof_consumptions","operation_id","authentication_operations","id",false,false],
    ["auth_session_families_account_id_fkey","auth_session_families","account_id","accounts","id",false,false],
    ["auth_session_families_operation_id_fkey","auth_session_families","authentication_operation_id","authentication_operations","id",false,false],
    ["auth_session_credentials_family_id_fkey","auth_session_credentials","family_id","auth_session_families","id",false,false],
    ["auth_session_commands_family_id_fkey","auth_session_commands","family_id","auth_session_families","id",false,false],
    ["fresh_authentication_evidence_family_account_fkey","fresh_authentication_evidence","family_id,account_id","auth_session_families","id,account_id",false,false],
    ["reauthentication_grants_evidence_binding_fkey","reauthentication_grants","evidence_id,account_id,family_id","fresh_authentication_evidence","id,account_id,family_id",false,false],
    ["otp_challenges_operation_id_fkey","otp_challenges","operation_id","authentication_operations","id",false,false],
    ["otp_commands_challenge_id_fkey","otp_commands","challenge_id","otp_challenges","id",false,false],
    ["security_audit_events_account_id_fkey","security_audit_events","account_id","accounts","id",false,false],
    ["security_audit_events_identity_id_fkey","security_audit_events","identity_id","external_identities","id",false,false],
    ["security_audit_events_reserved_account_id_fkey","security_audit_events","reserved_account_id","accounts","id",false,false],
    ["security_audit_events_operation_id_fkey","security_audit_events","operation_id","authentication_operations","id",false,false],
    ["security_audit_events_challenge_id_fkey","security_audit_events","challenge_id","otp_challenges","id",false,false],
    ["security_audit_events_session_id_fkey","security_audit_events","session_id","auth_session_families","id",false,false],
    ["security_audit_events_evidence_id_fkey","security_audit_events","evidence_id","fresh_authentication_evidence","id",false,false],
    ["security_audit_events_grant_id_fkey","security_audit_events","grant_id","reauthentication_grants","id",false,false],
    ["authentication_operations_telegram_proof_fkey","authentication_operations","telegram_proof_fingerprint","telegram_proof_consumptions","proof_fingerprint",true,true],
    ["authentication_operations_otp_challenge_fkey","authentication_operations","otp_challenge_id","otp_challenges","id",true,true],
    ["auth_session_families_current_credential_fkey","auth_session_families","id,current_credential_generation","auth_session_credentials","family_id,generation",true,true],
    ["auth_session_families_terminal_command_fkey","auth_session_families","id,terminal_command_id","auth_session_commands","family_id,command_id",false,false],
    ["auth_session_credentials_consuming_command_fkey","auth_session_credentials","family_id,consumed_by_command_id","auth_session_commands","family_id,command_id",false,false],
    ["otp_challenges_terminal_command_fkey","otp_challenges","id,terminal_command_id","otp_commands","challenge_id,command_id",false,false]
  ]
  $fks$::pg_catalog.jsonb;
  v_expected_keys pg_catalog.jsonb := $keys$
  [
    ["accounts_pkey","p","id"],
    ["player_profiles_pkey","p","account_id"],
    ["external_identities_pkey","p","id"],
    ["external_identities_binding_key","u","id,provider,namespace"],
    ["external_identity_lookup_digests_pkey","p","identity_id,digest_version,pepper_version"],
    ["external_identity_lookup_digests_global_key","u","provider,namespace,digest"],
    ["authentication_operations_pkey","p","id"],
    ["authentication_operations_idempotency_key_key","u","idempotency_key"],
    ["authentication_operations_telegram_fingerprint_key","u","telegram_proof_fingerprint"],
    ["authentication_operations_otp_challenge_key","u","otp_challenge_id"],
    ["telegram_proof_consumptions_pkey","p","proof_fingerprint"],
    ["telegram_proof_consumptions_idempotency_key_key","u","idempotency_key"],
    ["telegram_proof_consumptions_operation_id_key","u","operation_id"],
    ["auth_session_families_pkey","p","id"],
    ["auth_session_families_operation_id_key","u","authentication_operation_id"],
    ["auth_session_families_id_account_key","u","id,account_id"],
    ["auth_session_credentials_pkey","p","family_id,generation"],
    ["auth_session_credentials_family_digest_key","u","family_id,digest"],
    ["auth_session_commands_pkey","p","family_id,command_id"],
    ["auth_session_commands_family_sequence_key","u","family_id,command_sequence"],
    ["fresh_authentication_evidence_pkey","p","id"],
    ["fresh_authentication_evidence_binding_key","u","id,account_id,family_id"],
    ["reauthentication_grants_pkey","p","id"],
    ["otp_challenges_pkey","p","id"],
    ["otp_challenges_operation_id_key","u","operation_id"],
    ["otp_commands_pkey","p","challenge_id,command_id"],
    ["otp_commands_challenge_sequence_key","u","challenge_id,command_sequence"],
    ["security_audit_events_pkey","p","event_id"],
    ["security_audit_events_event_order_key","u","event_order"]
  ]
  $keys$::pg_catalog.jsonb;
  v_mismatch_count bigint;
begin
  select pg_catalog.array_agg(c.conname order by c.conname)
  into v_actual_constraint_names
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class r on r.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'backend_auth' and c.contype in ('p', 'u', 'f', 'c');

  if v_actual_constraint_names is distinct from (
    select pg_catalog.array_agg(name order by name)
    from pg_catalog.unnest(v_expected_constraint_names) name
  ) then
    raise exception 'POSTCHECK_FAILED: exact constraint-name inventory differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'backend_auth' and c.contype in ('p', 'u', 'f', 'c')
      and (
        not c.convalidated
        or pg_catalog.left(c.conname, pg_catalog.char_length(r.relname) + 1)
           <> r.relname || '_'
        or c.contype <> case
          when c.conname like '%_pkey' then 'p'::"char"
          when c.conname like '%_fkey' then 'f'::"char"
          when c.conname like '%_check' then 'c'::"char"
          else 'u'::"char"
        end
      )
  ) then
    raise exception 'POSTCHECK_FAILED: constraint kind, owning table, or validation state differs';
  end if;

  with expected as (
    select value ->> 0 as constraint_name, value ->> 1 as constraint_type,
           value ->> 2 as key_columns
    from pg_catalog.jsonb_array_elements(v_expected_keys)
  ), actual as (
    select c.conname as constraint_name, c.contype::text as constraint_type,
           (select pg_catalog.string_agg(a.attname, ',' order by key_position)
            from pg_catalog.unnest(c.conkey) with ordinality k(attnum, key_position)
            join pg_catalog.pg_attribute a
              on a.attrelid = c.conrelid and a.attnum = k.attnum) as key_columns
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'backend_auth' and c.contype in ('p', 'u')
  )
  select pg_catalog.count(*) into v_mismatch_count
  from expected e full join actual a using (constraint_name)
  where e.constraint_name is null or a.constraint_name is null
     or a.constraint_type is distinct from e.constraint_type
     or a.key_columns is distinct from e.key_columns;
  if v_mismatch_count <> 0 then
    raise exception 'POSTCHECK_FAILED: exact PK/UNIQUE key inventory has % mismatches',
      v_mismatch_count;
  end if;

  with expected as (
    select value ->> 0 as constraint_name, value ->> 1 as source_table,
           value ->> 2 as source_columns, value ->> 3 as target_table,
           value ->> 4 as target_columns, (value ->> 5)::boolean as is_deferrable,
           (value ->> 6)::boolean as is_deferred
    from pg_catalog.jsonb_array_elements(v_expected_fks)
  ), actual as (
    select c.conname as constraint_name, src.relname as source_table,
           (select pg_catalog.string_agg(a.attname, ',' order by key_position)
            from pg_catalog.unnest(c.conkey) with ordinality k(attnum, key_position)
            join pg_catalog.pg_attribute a
              on a.attrelid = c.conrelid and a.attnum = k.attnum) as source_columns,
           dstn.nspname as target_schema, dst.relname as target_table,
           (select pg_catalog.string_agg(a.attname, ',' order by key_position)
            from pg_catalog.unnest(c.confkey) with ordinality k(attnum, key_position)
            join pg_catalog.pg_attribute a
              on a.attrelid = c.confrelid and a.attnum = k.attnum) as target_columns,
           c.condeferrable as is_deferrable, c.condeferred as is_deferred,
           c.confupdtype, c.confdeltype
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class src on src.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = src.relnamespace
    join pg_catalog.pg_class dst on dst.oid = c.confrelid
    join pg_catalog.pg_namespace dstn on dstn.oid = dst.relnamespace
    where n.nspname = 'backend_auth' and c.contype = 'f'
  )
  select pg_catalog.count(*) into v_mismatch_count
  from expected e
  full join actual a using (constraint_name)
  where e.constraint_name is null or a.constraint_name is null
     or a.source_table is distinct from e.source_table
     or a.source_columns is distinct from e.source_columns
     or a.target_schema is distinct from 'backend_auth'
     or a.target_table is distinct from e.target_table
     or a.target_columns is distinct from e.target_columns
     or a.is_deferrable is distinct from e.is_deferrable
     or a.is_deferred is distinct from e.is_deferred
     or a.confupdtype is distinct from 'a'::"char"
     or a.confdeltype is distinct from 'a'::"char";

  if v_mismatch_count <> 0 then
    raise exception 'POSTCHECK_FAILED: exact 27-FK inventory has % mismatches',
      v_mismatch_count;
  end if;
end;
$$;

-- Independent explicit-index, function, trigger, and identity-sequence
-- inventories. Constraint-backed indexes are verified by the constraint block.
do $$
declare
  v_expected_indexes pg_catalog.jsonb := $indexes$
  [
    ["external_identities_one_linked_primary_uidx","external_identities",true,"account_id","status='linked'andis_primary"],
    ["external_identities_account_status_id_idx","external_identities",false,"account_id,status,id",null],
    ["authentication_operations_pending_expiry_idx","authentication_operations",false,"expires_at,id","status='pending'"],
    ["auth_session_families_account_status_id_idx","auth_session_families",false,"account_id,status,id",null],
    ["auth_session_credentials_one_unconsumed_uidx","auth_session_credentials",true,"family_id","consumed_atisnull"],
    ["reauthentication_grants_active_account_family_idx","reauthentication_grants",false,"account_id,family_id,expires_at,id","status='active'"],
    ["otp_challenges_pending_expiry_idx","otp_challenges",false,"expires_at,id","status='pending'"],
    ["security_audit_events_time_order_idx","security_audit_events",false,"occurred_at,event_order",null],
    ["security_audit_events_account_time_idx","security_audit_events",false,"account_id,occurred_at,event_order","account_idisnotnull"],
    ["security_audit_events_session_time_idx","security_audit_events",false,"session_id,occurred_at,event_order","session_idisnotnull"],
    ["security_audit_events_operation_time_idx","security_audit_events",false,"operation_id,occurred_at,event_order","operation_idisnotnull"]
  ]
  $indexes$::pg_catalog.jsonb;
  v_expected_functions pg_catalog.jsonb := $functions$
  [
    ["relation_fingerprint","regclass","text","s","sql"],
    ["reject_immutable_mutation","","trigger","v","plpgsql"],
    ["guard_account_transition","","trigger","v","plpgsql"],
    ["guard_external_identity_transition","","trigger","v","plpgsql"],
    ["guard_authentication_operation_transition","","trigger","v","plpgsql"],
    ["guard_session_family_transition","","trigger","v","plpgsql"],
    ["guard_session_credential_transition","","trigger","v","plpgsql"],
    ["guard_reauthentication_grant_transition","","trigger","v","plpgsql"],
    ["guard_otp_challenge_transition","","trigger","v","plpgsql"],
    ["assert_player_profile_consistency","","trigger","v","plpgsql"],
    ["assert_external_identity_aliases","","trigger","v","plpgsql"],
    ["assert_active_account_has_login_method","","trigger","v","plpgsql"],
    ["assert_primary_unlink_replacement","","trigger","v","plpgsql"],
    ["assert_authentication_proof_binding","","trigger","v","plpgsql"],
    ["assert_session_family_operation","","trigger","v","plpgsql"],
    ["assert_session_consistency","","trigger","v","plpgsql"],
    ["assert_reauthentication_grant_consistency","","trigger","v","plpgsql"],
    ["assert_otp_consistency","","trigger","v","plpgsql"],
    ["reject_audit_mutation","","trigger","v","plpgsql"],
    ["assert_fresh_authentication_evidence_consistency","","trigger","v","plpgsql"]
  ]
  $functions$::pg_catalog.jsonb;
  v_expected_triggers pg_catalog.jsonb := $triggers$
  [
    ["accounts_transition_guard","accounts","guard_account_transition",23,false,false],
    ["external_identities_transition_guard","external_identities","guard_external_identity_transition",23,false,false],
    ["authentication_operations_transition_guard","authentication_operations","guard_authentication_operation_transition",23,false,false],
    ["auth_session_families_transition_guard","auth_session_families","guard_session_family_transition",23,false,false],
    ["auth_session_credentials_transition_guard","auth_session_credentials","guard_session_credential_transition",23,false,false],
    ["reauthentication_grants_transition_guard","reauthentication_grants","guard_reauthentication_grant_transition",23,false,false],
    ["otp_challenges_transition_guard","otp_challenges","guard_otp_challenge_transition",23,false,false],
    ["player_profiles_immutable_guard","player_profiles","reject_immutable_mutation",27,false,false],
    ["external_identity_lookup_digests_immutable_guard","external_identity_lookup_digests","reject_immutable_mutation",27,false,false],
    ["telegram_proof_consumptions_immutable_guard","telegram_proof_consumptions","reject_immutable_mutation",27,false,false],
    ["auth_session_commands_immutable_guard","auth_session_commands","reject_immutable_mutation",27,false,false],
    ["fresh_authentication_evidence_immutable_guard","fresh_authentication_evidence","reject_immutable_mutation",27,false,false],
    ["otp_commands_immutable_guard","otp_commands","reject_immutable_mutation",27,false,false],
    ["accounts_player_profile_consistency","accounts","assert_player_profile_consistency",29,true,true],
    ["player_profiles_account_consistency","player_profiles","assert_player_profile_consistency",29,true,true],
    ["external_identities_alias_required","external_identities","assert_external_identity_aliases",29,true,true],
    ["external_identity_lookup_digests_identity_required","external_identity_lookup_digests","assert_external_identity_aliases",29,true,true],
    ["accounts_active_login_method_required","accounts","assert_active_account_has_login_method",29,true,true],
    ["external_identities_active_login_method_required","external_identities","assert_active_account_has_login_method",29,true,true],
    ["external_identities_primary_unlink_replacement","external_identities","assert_primary_unlink_replacement",25,true,true],
    ["authentication_operations_proof_binding","authentication_operations","assert_authentication_proof_binding",29,true,true],
    ["telegram_proof_consumptions_operation_binding","telegram_proof_consumptions","assert_authentication_proof_binding",29,true,true],
    ["otp_challenges_operation_binding","otp_challenges","assert_authentication_proof_binding",29,true,true],
    ["auth_session_families_operation_consistency","auth_session_families","assert_session_family_operation",5,false,false],
    ["auth_session_families_state_consistency","auth_session_families","assert_session_consistency",29,true,true],
    ["auth_session_credentials_state_consistency","auth_session_credentials","assert_session_consistency",29,true,true],
    ["auth_session_commands_state_consistency","auth_session_commands","assert_session_consistency",29,true,true],
    ["fresh_authentication_evidence_state_consistency","fresh_authentication_evidence","assert_fresh_authentication_evidence_consistency",5,false,false],
    ["reauthentication_grants_state_consistency","reauthentication_grants","assert_reauthentication_grant_consistency",21,false,false],
    ["otp_challenges_state_consistency","otp_challenges","assert_otp_consistency",29,true,true],
    ["otp_commands_state_consistency","otp_commands","assert_otp_consistency",29,true,true],
    ["security_audit_events_update_delete_guard","security_audit_events","reject_audit_mutation",27,false,false],
    ["security_audit_events_truncate_guard","security_audit_events","reject_audit_mutation",34,false,false]
  ]
  $triggers$::pg_catalog.jsonb;
  v_mismatch_count bigint;
begin
  with expected as (
    select value ->> 0 as index_name, value ->> 1 as table_name,
           (value ->> 2)::boolean as is_unique, value ->> 3 as key_columns,
           value ->> 4 as predicate
    from pg_catalog.jsonb_array_elements(v_expected_indexes)
  ), actual as (
    select idx.relname as index_name, tbl.relname as table_name,
           i.indisunique as is_unique,
           (select pg_catalog.string_agg(a.attname, ',' order by key_position)
            from pg_catalog.unnest(i.indkey) with ordinality k(attnum, key_position)
            join pg_catalog.pg_attribute a
              on a.attrelid = i.indrelid and a.attnum = k.attnum
            where key_position <= i.indnkeyatts) as key_columns,
           case when i.indpred is null then null else
             pg_catalog.regexp_replace(
               pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)),
               '[()[:space:]]|::text', '', 'g'
             ) end as predicate,
           i.indisvalid, i.indisready
    from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid = i.indexrelid
    join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = tbl.relnamespace
    where n.nspname = 'backend_auth'
      and not exists (
        select 1 from pg_catalog.pg_constraint c where c.conindid = i.indexrelid
      )
  )
  select pg_catalog.count(*) into v_mismatch_count
  from expected e full join actual a using (index_name)
  where e.index_name is null or a.index_name is null
     or a.table_name is distinct from e.table_name
     or a.is_unique is distinct from e.is_unique
     or a.key_columns is distinct from e.key_columns
     or a.predicate is distinct from e.predicate
     or not a.indisvalid or not a.indisready;
  if v_mismatch_count <> 0 then
    raise exception 'POSTCHECK_FAILED: exact explicit-index inventory has % mismatches',
      v_mismatch_count;
  end if;

  with expected as (
    select value ->> 0 as function_name, value ->> 1 as arguments,
           value ->> 2 as result_type, value ->> 3 as volatility,
           value ->> 4 as language_name
    from pg_catalog.jsonb_array_elements(v_expected_functions)
  ), actual as (
    select p.proname as function_name,
           pg_catalog.oidvectortypes(p.proargtypes) as arguments,
           pg_catalog.format_type(p.prorettype, null) as result_type,
           p.provolatile::text as volatility, l.lanname as language_name,
           p.prosecdef, p.proconfig, p.prokind
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'backend_auth'
  )
  select pg_catalog.count(*) into v_mismatch_count
  from expected e full join actual a using (function_name)
  where e.function_name is null or a.function_name is null
     or a.arguments is distinct from e.arguments
     or a.result_type is distinct from e.result_type
     or a.volatility is distinct from e.volatility
     or a.language_name is distinct from e.language_name
     or a.prosecdef
     or a.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[]
     or a.prokind is distinct from 'f'::"char";
  if v_mismatch_count <> 0 then
    raise exception 'POSTCHECK_FAILED: exact function inventory has % mismatches',
      v_mismatch_count;
  end if;

  with expected as (
    select value ->> 0 as trigger_name, value ->> 1 as table_name,
           value ->> 2 as function_name, (value ->> 3)::integer as trigger_type,
           (value ->> 4)::boolean as is_deferrable,
           (value ->> 5)::boolean as is_deferred
    from pg_catalog.jsonb_array_elements(v_expected_triggers)
  ), actual as (
    select t.tgname as trigger_name, r.relname as table_name,
           p.proname as function_name, t.tgtype::integer as trigger_type,
           coalesce(c.condeferrable, false) as is_deferrable,
           coalesce(c.condeferred, false) as is_deferred,
           t.tgenabled, t.tgisinternal
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class r on r.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    left join pg_catalog.pg_constraint c on c.oid = t.tgconstraint
    where n.nspname = 'backend_auth' and not t.tgisinternal
  )
  select pg_catalog.count(*) into v_mismatch_count
  from expected e full join actual a using (trigger_name)
  where e.trigger_name is null or a.trigger_name is null
     or a.table_name is distinct from e.table_name
     or a.function_name is distinct from e.function_name
     or a.trigger_type is distinct from e.trigger_type
     or a.is_deferrable is distinct from e.is_deferrable
     or a.is_deferred is distinct from e.is_deferred
     or a.tgenabled is distinct from 'O'::"char"
     or a.tgisinternal;
  if v_mismatch_count <> 0 then
    raise exception 'POSTCHECK_FAILED: exact trigger inventory has % mismatches',
      v_mismatch_count;
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_class s
      join pg_catalog.pg_namespace n on n.oid = s.relnamespace
      where n.nspname = 'backend_auth' and s.relkind = 'S') <> 1
     or not exists (
       select 1
       from pg_catalog.pg_class s
       join pg_catalog.pg_namespace n on n.oid = s.relnamespace
       where n.nspname = 'backend_auth'
         and s.relname = 'security_audit_events_event_order_seq'
         and s.relkind = 'S'
         and pg_catalog.pg_get_userbyid(s.relowner) = 'backend_auth_owner'
         and exists (
           select 1
           from pg_catalog.pg_depend d
           join pg_catalog.pg_attribute a
             on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
           where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
             and d.objid = s.oid
             and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
             and d.refobjid = 'backend_auth.security_audit_events'::pg_catalog.regclass
             and a.attname = 'event_order' and d.deptype = 'i'
         )
     ) then
    raise exception 'POSTCHECK_FAILED: exact audit identity-sequence inventory differs';
  end if;

  -- The strengthened validator must derive successful rotation order solely
  -- from command_sequence; fingerprints are not accepted as evidence here.
  if pg_catalog.strpos(
       pg_catalog.lower(pg_catalog.pg_get_functiondef(
         'backend_auth.assert_session_consistency()'::pg_catalog.regprocedure
       )),
       'ordered_rotation.result_type = ''credential_rotated'''
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(pg_catalog.pg_get_functiondef(
         'backend_auth.assert_session_consistency()'::pg_catalog.regprocedure
       )),
       'ordered_rotation.command_sequence <= c.command_sequence'
     ) = 0 then
    raise exception 'POSTCHECK_FAILED: sequence-ordered session rotation validation is missing';
  end if;
end;
$$;

do $$
declare
  v_expected_tables constant text[] := array[
    'accounts', 'auth_session_commands', 'auth_session_credentials',
    'auth_session_families', 'authentication_operations', 'external_identities',
    'external_identity_lookup_digests', 'fresh_authentication_evidence',
    'otp_challenges', 'otp_commands', 'player_profiles',
    'reauthentication_grants', 'security_audit_events',
    'telegram_proof_consumptions'
  ]::text[];
  v_actual_tables text[];
  v_expected_indexes constant text[] := array[
    'auth_session_credentials_one_unconsumed_uidx',
    'auth_session_families_account_status_id_idx',
    'authentication_operations_pending_expiry_idx',
    'external_identities_account_status_id_idx',
    'external_identities_one_linked_primary_uidx',
    'otp_challenges_pending_expiry_idx',
    'reauthentication_grants_active_account_family_idx',
    'security_audit_events_account_time_idx',
    'security_audit_events_operation_time_idx',
    'security_audit_events_session_time_idx',
    'security_audit_events_time_order_idx'
  ]::text[];
  v_actual_indexes text[];
  v_name text;
  v_relation pg_catalog.regclass;
  v_marker text;
  v_function record;
  v_acl record;
  v_expected_acl pg_catalog.jsonb := $acl$
  {
    "accounts": {
      "INSERT": ["id", "created_at", "updated_at"],
      "UPDATE": ["status", "updated_at"]
    },
    "player_profiles": {"INSERT": ["account_id"], "UPDATE": []},
    "external_identities": {
      "INSERT": ["id", "account_id", "provider", "namespace", "status", "is_primary"],
      "UPDATE": ["status", "is_primary"]
    },
    "external_identity_lookup_digests": {
      "INSERT": ["identity_id", "algorithm", "provider", "namespace", "digest", "digest_version", "pepper_version", "created_at"],
      "UPDATE": []
    },
    "authentication_operations": {
      "INSERT": ["id", "intent", "identity_provider", "identity_namespace", "identity_lookup_digest", "proof_type", "telegram_proof_fingerprint", "otp_challenge_id", "created_at", "expires_at", "idempotency_key", "request_digest"],
      "UPDATE": ["status", "resolution_type", "resolution_account_id", "resolution_account_status", "resolution_initial_role", "resolution_reason", "failure_reason", "terminal_command_id", "terminal_command_type", "terminal_applied_at"]
    },
    "telegram_proof_consumptions": {
      "INSERT": ["proof_fingerprint", "proof_expires_at", "intent", "idempotency_key", "request_digest", "operation_id", "consumed_at"],
      "UPDATE": []
    },
    "auth_session_families": {
      "INSERT": ["id", "account_id", "authentication_operation_id", "current_credential_generation", "created_at", "expires_at"],
      "UPDATE": ["status", "current_credential_generation", "terminal_command_id", "terminal_reason", "terminal_at", "terminal_reuse_generation", "terminal_reuse_digest"]
    },
    "auth_session_credentials": {
      "INSERT": ["family_id", "generation", "digest", "issued_at"],
      "UPDATE": ["consumed_at", "consumed_by_command_id"]
    },
    "auth_session_commands": {
      "INSERT": ["family_id", "command_id", "command_sequence", "request_digest", "command_type", "applied_at", "presented_generation", "presented_digest", "next_generation", "next_digest", "reason", "result_type"],
      "UPDATE": []
    },
    "fresh_authentication_evidence": {
      "INSERT": ["id", "account_id", "family_id", "verification_method", "authenticated_at", "expires_at"],
      "UPDATE": []
    },
    "reauthentication_grants": {
      "INSERT": ["id", "evidence_id", "account_id", "family_id", "scope", "resource_digest", "created_at", "expires_at"],
      "UPDATE": ["status", "terminal_command_id", "terminal_command_type", "terminal_request_digest", "terminal_applied_at", "terminal_reason"]
    },
    "otp_challenges": {
      "INSERT": ["id", "intent", "identity_provider", "identity_namespace", "identity_lookup_digest", "operation_id", "request_digest", "verifier_digest", "created_at", "expires_at", "max_attempts", "attempts_remaining"],
      "UPDATE": ["attempts_remaining", "status", "terminal_command_id", "terminal_at", "terminal_reason"]
    },
    "otp_commands": {
      "INSERT": ["challenge_id", "command_id", "command_sequence", "request_digest", "command_type", "applied_at", "presented_digest", "reason", "result_type", "result_attempts_remaining"],
      "UPDATE": []
    },
    "security_audit_events": {
      "INSERT": ["event_id", "event_type", "outcome", "occurred_at", "account_id", "role", "previous_status", "next_status", "identity_id", "provider", "reserved_account_id", "attempted_account_id", "operation_id", "attempted_operation_id", "intent", "terminal_status", "challenge_id", "otp_status", "session_id", "session_status", "generation", "evidence_id", "verification_method", "grant_id", "scope", "grant_status", "aggregate_type", "aggregate_id"],
      "UPDATE": []
    }
  }
  $acl$::pg_catalog.jsonb;
  v_count bigint;
  v_total_rows bigint;
begin
  if pg_catalog.to_regnamespace('backend_auth') is null then
    raise exception 'POSTCHECK_FAILED: schema backend_auth is missing';
  end if;

  if pg_catalog.pg_get_userbyid(
    (select n.nspowner from pg_catalog.pg_namespace n where n.nspname = 'backend_auth')
  ) <> 'backend_auth_owner' then
    raise exception 'POSTCHECK_FAILED: schema owner is not backend_auth_owner';
  end if;

  select pg_catalog.array_agg(c.relname order by c.relname) into v_actual_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';

  if v_actual_tables is distinct from v_expected_tables then
    raise exception 'POSTCHECK_FAILED: table set differs from the exact 14-table mapping: %',
      v_actual_tables;
  end if;

  select pg_catalog.array_agg(idx.relname order by idx.relname)
  into v_actual_indexes
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
  join pg_catalog.pg_namespace n on n.oid = tbl.relnamespace
  where n.nspname = 'backend_auth'
    and not exists (
      select 1 from pg_catalog.pg_constraint c where c.conindid = i.indexrelid
    );
  if v_actual_indexes is distinct from v_expected_indexes then
    raise exception 'POSTCHECK_FAILED: explicit index set differs: %', v_actual_indexes;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_auth' and c.relkind in ('r', 'i', 'S')
      and pg_catalog.pg_get_userbyid(c.relowner) <> 'backend_auth_owner'
  ) then
    raise exception 'POSTCHECK_FAILED: table/index/sequence ownership differs';
  end if;

  foreach v_name in array v_expected_tables loop
    v_relation := pg_catalog.to_regclass('backend_auth.' || v_name);
    if pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid = v_relation)
    ) <> 'backend_auth_owner' then
      raise exception 'POSTCHECK_FAILED: unexpected owner for table %', v_name;
    end if;

    v_marker := pg_catalog.obj_description(v_relation, 'pg_class');
    if v_marker is null
       or v_marker <> '015_backend_auth_foundation:' ||
         backend_auth.relation_fingerprint(v_relation) then
      raise exception 'POSTCHECK_FAILED: exact columns/defaults/constraints/indexes/triggers fingerprint failed for %',
        v_name;
    end if;
  end loop;

  for v_function in
    select p.oid, p.oid::pg_catalog.regprocedure as identity,
           p.proowner, p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'backend_auth'
  loop
    if pg_catalog.pg_get_userbyid(v_function.proowner) <> 'backend_auth_owner'
       or v_function.prosecdef
       or v_function.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[]
       or pg_catalog.obj_description(v_function.oid, 'pg_proc') <>
          '015_backend_auth_foundation:' ||
            pg_catalog.md5(pg_catalog.pg_get_functiondef(v_function.oid)) then
      raise exception 'POSTCHECK_FAILED: function safety/fingerprint failed for %',
        v_function.identity;
    end if;
    if exists (
         select 1
         from pg_catalog.pg_proc p
         cross join lateral pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) acl
         where p.oid = v_function.oid and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
       )
       or pg_catalog.has_function_privilege('backend_auth_app', v_function.oid, 'EXECUTE') then
      raise exception 'POSTCHECK_FAILED: function EXECUTE leaked for %', v_function.identity;
    end if;
  end loop;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'backend_auth';
  if v_count <> 20 then
    raise exception 'POSTCHECK_FAILED: expected 20 migration functions, found %', v_count;
  end if;

  -- Only the six approved initial-state defaults plus the audit identity are allowed.
  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'backend_auth' and c.relkind = 'r'
    and a.attnum > 0 and not a.attisdropped
    and (d.oid is not null or a.attidentity <> '')
    and (c.relname, a.attname) not in (
      ('accounts', 'role'), ('accounts', 'status'),
      ('authentication_operations', 'status'),
      ('auth_session_families', 'status'),
      ('reauthentication_grants', 'status'),
      ('otp_challenges', 'status'),
      ('security_audit_events', 'event_order')
    );
  if v_count <> 0 then
    raise exception 'POSTCHECK_FAILED: an unapproved DB default exists';
  end if;

  if (select pg_catalog.pg_get_expr(d.adbin, d.adrelid)
      from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a
        on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'backend_auth.accounts'::pg_catalog.regclass
        and a.attname = 'role') is distinct from '''player''::text'
     or (select pg_catalog.pg_get_expr(d.adbin, d.adrelid)
         from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a
           on a.attrelid = d.adrelid and a.attnum = d.adnum
         where d.adrelid = 'backend_auth.accounts'::pg_catalog.regclass
           and a.attname = 'status') is distinct from '''active''::text'
     or exists (
       select 1
       from (values
         ('authentication_operations', 'pending'),
         ('auth_session_families', 'active'),
         ('reauthentication_grants', 'active'),
         ('otp_challenges', 'pending')
       ) expected(table_name, expected_default)
       join pg_catalog.pg_class c on c.relname = expected.table_name
       join pg_catalog.pg_namespace n
         on n.oid = c.relnamespace and n.nspname = 'backend_auth'
       join pg_catalog.pg_attribute a
         on a.attrelid = c.oid and a.attname = 'status'
       left join pg_catalog.pg_attrdef d
         on d.adrelid = a.attrelid and d.adnum = a.attnum
       where pg_catalog.pg_get_expr(d.adbin, d.adrelid)
         is distinct from pg_catalog.quote_literal(expected.expected_default) || '::text'
     ) then
    raise exception 'POSTCHECK_FAILED: initial role/status defaults differ from the mapping';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'backend_auth.security_audit_events'::pg_catalog.regclass
      and a.attname = 'event_order' and a.attidentity = 'a'
      and a.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
  ) then
    raise exception 'POSTCHECK_FAILED: audit event_order is not GENERATED ALWAYS bigint identity';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_auth' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped
      and a.atttypid not in (
        'pg_catalog.uuid'::pg_catalog.regtype,
        'pg_catalog.int8'::pg_catalog.regtype,
        'pg_catalog.bytea'::pg_catalog.regtype,
        'pg_catalog.text'::pg_catalog.regtype,
        'pg_catalog.bool'::pg_catalog.regtype
      )
  ) then
    raise exception 'POSTCHECK_FAILED: unexpected physical column type exists';
  end if;

  -- All FKs are NO ACTION; exactly the three approved outward/current FKs defer.
  if exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'backend_auth' and c.contype = 'f'
      and (c.confupdtype <> 'a' or c.confdeltype <> 'a')
  ) then
    raise exception 'POSTCHECK_FAILED: a foreign key does not use ON UPDATE/DELETE NO ACTION';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class r on r.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'backend_auth' and c.contype = 'f'
    and c.condeferrable and c.condeferred
    and c.conname = any (array[
      'authentication_operations_telegram_proof_fkey',
      'authentication_operations_otp_challenge_fkey',
      'auth_session_families_current_credential_fkey'
    ]::text[]);
  if v_count <> 3 or exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'backend_auth' and c.contype = 'f'
      and c.condeferrable
      and c.conname <> all (array[
        'authentication_operations_telegram_proof_fkey',
        'authentication_operations_otp_challenge_fkey',
        'auth_session_families_current_credential_fkey'
      ]::text[])
  ) then
    raise exception 'POSTCHECK_FAILED: FK deferrability differs from the approved three';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'backend_auth.auth_session_families'::pg_catalog.regclass
      and conname = 'auth_session_families_terminal_command_fkey'
      and pg_catalog.pg_get_constraintdef(oid, false) like
        'FOREIGN KEY (id, terminal_command_id) REFERENCES backend_auth.auth_session_commands(family_id, command_id)%'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'backend_auth.auth_session_credentials'::pg_catalog.regclass
      and conname = 'auth_session_credentials_consuming_command_fkey'
      and pg_catalog.pg_get_constraintdef(oid, false) like
        'FOREIGN KEY (family_id, consumed_by_command_id) REFERENCES backend_auth.auth_session_commands(family_id, command_id)%'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'backend_auth.otp_challenges'::pg_catalog.regclass
      and conname = 'otp_challenges_terminal_command_fkey'
      and pg_catalog.pg_get_constraintdef(oid, false) like
        'FOREIGN KEY (id, terminal_command_id) REFERENCES backend_auth.otp_commands(challenge_id, command_id)%'
  ) then
    raise exception 'POSTCHECK_FAILED: a same-aggregate composite command FK is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'backend_auth.auth_session_credentials'::pg_catalog.regclass
      and c.conname = 'auth_session_credentials_family_digest_key'
      and c.contype = 'u'
      and (select pg_catalog.string_agg(a.attname, ',' order by key_position)
           from pg_catalog.unnest(c.conkey)
             with ordinality k(attnum, key_position)
           join pg_catalog.pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = 'family_id,digest'
  ) or exists (
    select 1
    from pg_catalog.pg_index i
    where i.indrelid = 'backend_auth.auth_session_credentials'::pg_catalog.regclass
      and (select a.attname
           from pg_catalog.unnest(i.indkey)
             with ordinality k(attnum, key_position)
           join pg_catalog.pg_attribute a
             on a.attrelid = i.indrelid and a.attnum = k.attnum
           where key_position = 1) = 'digest'
  ) then
    raise exception 'POSTCHECK_FAILED: credential digest scope is not family-local';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'backend_auth.external_identity_lookup_digests'::pg_catalog.regclass
      and conname = 'external_identity_lookup_digests_global_key' and contype = 'u'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'backend_auth.telegram_proof_consumptions'::pg_catalog.regclass
      and conname = 'telegram_proof_consumptions_operation_id_key' and contype = 'u'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'backend_auth.otp_challenges'::pg_catalog.regclass
      and conname = 'otp_challenges_operation_id_key' and contype = 'u'
  ) then
    raise exception 'POSTCHECK_FAILED: identity/proof uniqueness is incomplete';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'backend_auth.accounts'::pg_catalog.regclass
      and tgname = 'accounts_active_login_method_required'
      and tgdeferrable and tginitdeferred
  ) or pg_catalog.strpos(
    pg_catalog.upper(pg_catalog.pg_get_functiondef(
      'backend_auth.assert_active_account_has_login_method()'::pg_catalog.regprocedure
    )), 'FOR UPDATE'
  ) = 0 or pg_catalog.strpos(
    pg_catalog.upper(pg_catalog.pg_get_functiondef(
      'backend_auth.assert_active_account_has_login_method()'::pg_catalog.regprocedure
    )), 'PG_CATALOG.COUNT'
  ) = 0 then
    raise exception 'POSTCHECK_FAILED: self-locking active-account invariant is incomplete';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'backend_auth.security_audit_events'::pg_catalog.regclass
      and tgname = 'security_audit_events_update_delete_guard'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'backend_auth.security_audit_events'::pg_catalog.regclass
      and tgname = 'security_audit_events_truncate_guard'
  ) then
    raise exception 'POSTCHECK_FAILED: append-only audit triggers are missing';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'backend_auth.security_audit_events'::pg_catalog.regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attname = any (array[
        'correlation_id', 'reason', 'telegram_subject', 'phone', 'raw_init_data',
        'otp', 'session_credential', 'lookup_digest', 'credential_digest',
        'verifier_digest', 'idempotency_key', 'ciphertext', 'name', 'username',
        'photo_url', 'pepper', 'encryption_key'
      ]::text[])
  ) or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'backend_auth.security_audit_events'::pg_catalog.regclass
      and a.attname = 'operation_id' and a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
  ) or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'backend_auth.security_audit_events'::pg_catalog.regclass
      and a.attname = 'attempted_operation_id'
      and a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
  ) or exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'backend_auth.security_audit_events'::pg_catalog.regclass
      and c.contype = 'f'
      and (select a.attnum from pg_catalog.pg_attribute a
           where a.attrelid = c.conrelid and a.attname = 'attempted_operation_id')
          = any (c.conkey)
  ) then
    raise exception 'POSTCHECK_FAILED: audit existing/attempted operation projection is unsafe';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_auth' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped
      and a.attname = any (array[
        'subject', 'telegram_subject', 'phone', 'destination', 'raw_init_data',
        'otp_code', 'session_credential', 'ciphertext', 'name', 'username',
        'photo_url', 'pepper', 'encryption_key', 'secret', 'password'
      ]::text[])
  ) then
    raise exception 'POSTCHECK_FAILED: a forbidden plaintext/secret column exists';
  end if;

  -- Ownership and least-privilege ACL checks.
  if exists (
       select 1
       from pg_catalog.pg_namespace n
       cross join lateral pg_catalog.aclexplode(
         coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
       ) acl
       where n.nspname = 'backend_auth' and acl.grantee = 0
     )
     or (select pg_catalog.array_agg(acl.privilege_type order by acl.privilege_type)
         from pg_catalog.pg_namespace n
         cross join lateral pg_catalog.aclexplode(
           coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
         ) acl
         where n.nspname = 'backend_auth'
           and acl.grantee = 'backend_auth_app'::pg_catalog.regrole)
        is distinct from array['USAGE']::text[]
     or not pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'USAGE')
     or pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE')
     or pg_catalog.has_database_privilege(
       'backend_auth_app', pg_catalog.current_database(), 'CREATE'
     ) then
    raise exception 'POSTCHECK_FAILED: schema ACL is unsafe';
  end if;

  -- The column ACL is exact: every expected grant exists and no extra
  -- column-level grant to the application role is tolerated.
  for v_acl in
    select table_acl.key as table_name,
           privilege_acl.key as privilege_type,
           column_acl.value as column_name
    from pg_catalog.jsonb_each(v_expected_acl) table_acl
    cross join lateral pg_catalog.jsonb_each(table_acl.value) privilege_acl
    cross join lateral pg_catalog.jsonb_array_elements_text(privilege_acl.value) column_acl
  loop
    if not pg_catalog.has_column_privilege(
      'backend_auth_app',
      pg_catalog.format('backend_auth.%I', v_acl.table_name),
      v_acl.column_name,
      v_acl.privilege_type
    ) then
      raise exception 'POSTCHECK_FAILED: missing %.% % column privilege',
        v_acl.table_name, v_acl.column_name, v_acl.privilege_type;
    end if;
  end loop;

  for v_acl in
    select c.relname as table_name, a.attname as column_name,
           acl.privilege_type
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    where n.nspname = 'backend_auth'
      and acl.grantee = 'backend_auth_app'::pg_catalog.regrole
  loop
    if not coalesce(
      (v_expected_acl -> v_acl.table_name -> v_acl.privilege_type)
        ? v_acl.column_name,
      false
    ) then
      raise exception 'POSTCHECK_FAILED: unexpected %.% % column privilege',
        v_acl.table_name, v_acl.column_name, v_acl.privilege_type;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'backend_auth' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped and a.attnotnull
      and d.oid is null and a.attidentity = ''
      and not pg_catalog.has_column_privilege(
        'backend_auth_app', c.oid, a.attnum, 'INSERT'
      )
  ) then
    raise exception 'POSTCHECK_FAILED: a required initial INSERT column is not writable';
  end if;

  foreach v_name in array v_expected_tables loop
    v_relation := pg_catalog.to_regclass('backend_auth.' || v_name);
    if not pg_catalog.has_table_privilege('backend_auth_app', v_relation, 'SELECT')
       or (select pg_catalog.array_agg(acl.privilege_type order by acl.privilege_type)
           from pg_catalog.pg_class c
           cross join lateral pg_catalog.aclexplode(
             coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
           ) acl
           where c.oid = v_relation
             and acl.grantee = 'backend_auth_app'::pg_catalog.regrole)
          is distinct from array['SELECT']::text[]
       or pg_catalog.has_table_privilege('backend_auth_app', v_relation, 'INSERT')
       or pg_catalog.has_table_privilege('backend_auth_app', v_relation, 'UPDATE')
       or pg_catalog.has_table_privilege('backend_auth_app', v_relation, 'DELETE')
       or pg_catalog.has_table_privilege('backend_auth_app', v_relation, 'TRUNCATE')
       or pg_catalog.has_table_privilege('backend_auth_app', v_relation, 'REFERENCES')
       or pg_catalog.has_table_privilege('backend_auth_app', v_relation, 'TRIGGER')
       or exists (
         select 1
         from pg_catalog.pg_class c
         cross join lateral pg_catalog.aclexplode(
           coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
         ) acl
         where c.oid = v_relation and acl.grantee = 0
       ) then
      raise exception 'POSTCHECK_FAILED: table ACL is unsafe for %', v_name;
    end if;
  end loop;

  if pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.accounts', 'role', 'INSERT'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.accounts', 'role', 'UPDATE'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.accounts', 'status', 'INSERT'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.authentication_operations', 'status', 'INSERT'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.auth_session_families', 'status', 'INSERT'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.reauthentication_grants', 'status', 'INSERT'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.otp_challenges', 'status', 'INSERT'
     ) then
    raise exception 'POSTCHECK_FAILED: application can bypass initial role/status defaults';
  end if;

  if not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.accounts', 'id', 'INSERT'
     ) or not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.authentication_operations', 'id', 'INSERT'
     ) or not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.auth_session_families', 'id', 'INSERT'
     ) or not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.reauthentication_grants', 'id', 'INSERT'
     ) or not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.otp_challenges', 'id', 'INSERT'
     ) then
    raise exception 'POSTCHECK_FAILED: required initial aggregate INSERT columns are missing';
  end if;

  if pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.external_identity_lookup_digests', 'digest', 'UPDATE'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.auth_session_commands', 'command_id', 'UPDATE'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.otp_commands', 'command_id', 'UPDATE'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.security_audit_events', 'event_order', 'INSERT'
     ) or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.security_audit_events', 'event_id', 'UPDATE'
     ) then
    raise exception 'POSTCHECK_FAILED: append-only/identity column ACL is unsafe';
  end if;

  if not pg_catalog.has_sequence_privilege(
       'backend_auth_app', 'backend_auth.security_audit_events_event_order_seq', 'USAGE'
     ) or (select pg_catalog.array_agg(acl.privilege_type order by acl.privilege_type)
           from pg_catalog.pg_class s
           cross join lateral pg_catalog.aclexplode(
             coalesce(s.relacl, pg_catalog.acldefault('S', s.relowner))
           ) acl
           where s.oid =
             'backend_auth.security_audit_events_event_order_seq'::pg_catalog.regclass
             and acl.grantee = 'backend_auth_app'::pg_catalog.regrole)
          is distinct from array['USAGE']::text[]
     or pg_catalog.has_sequence_privilege(
       'backend_auth_app', 'backend_auth.security_audit_events_event_order_seq', 'SELECT'
     ) or pg_catalog.has_sequence_privilege(
       'backend_auth_app', 'backend_auth.security_audit_events_event_order_seq', 'UPDATE'
     ) or exists (
       select 1
       from pg_catalog.pg_class s
       cross join lateral pg_catalog.aclexplode(
         coalesce(s.relacl, pg_catalog.acldefault('S', s.relowner))
       ) acl
       where s.oid =
         'backend_auth.security_audit_events_event_order_seq'::pg_catalog.regclass
         and acl.grantee = 0
     ) then
    raise exception 'POSTCHECK_FAILED: audit identity sequence ACL is not minimal';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) acl
    where d.defaclrole = 'backend_auth_owner'::pg_catalog.regrole
      and acl.grantee = 'backend_auth_app'::pg_catalog.regrole
  ) then
    raise exception 'POSTCHECK_FAILED: owner default ACL grants access to backend_auth_app';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'backend_auth'
      and (
        pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef(p.oid)), 'auth.uid()'
        ) > 0
        or pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef(p.oid)), 'supabase'
        ) > 0
        or pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef(p.oid)), 'service_role'
        ) > 0
      )
  ) then
    raise exception 'POSTCHECK_FAILED: Supabase-specific function dependency found';
  end if;

  -- No seed account, admin, test datum, or any other row may be introduced by 015.
  v_total_rows := 0;
  foreach v_name in array v_expected_tables loop
    execute pg_catalog.format('select count(*) from backend_auth.%I', v_name)
      into v_count;
    v_total_rows := v_total_rows + v_count;
  end loop;
  if v_total_rows <> 0 then
    raise exception 'POSTCHECK_FAILED: expected empty foundation, found % rows', v_total_rows;
  end if;
end;
$$;

reset role;

select
  'backend_auth' as schema_name,
  14 as exact_table_count,
  'independent exact catalogs plus relation/function fingerprints verified' as structure,
  'NO ACTION FKs; exactly 3 deferred outward/current FKs' as referential_policy,
  'self-locking account, proof, session, OTP, immutability and audit triggers verified' as triggers,
  'column ACL and minimal audit sequence USAGE verified' as privileges,
  'no rows, secrets, forbidden audit columns, or Supabase dependency found' as data_boundary;

rollback;
