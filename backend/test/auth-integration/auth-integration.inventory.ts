import {
  AUTH_INTEGRATION_EXPECTED_COLUMNS,
  AUTH_INTEGRATION_EXPECTED_COLUMN_ACL,
  AUTH_INTEGRATION_EXPECTED_CONSTRAINTS,
  AUTH_INTEGRATION_EXPECTED_FOREIGN_KEYS,
  AUTH_INTEGRATION_EXPECTED_FUNCTION_ACL,
  AUTH_INTEGRATION_EXPECTED_KEYS,
  AUTH_INTEGRATION_EXPECTED_SCHEMA_ACL,
  AUTH_INTEGRATION_EXPECTED_SEQUENCE_ACL,
  AUTH_INTEGRATION_EXPECTED_TABLE_ACL,
} from './auth-integration.postcheck-inventory';

export interface AuthIntegrationTableEvidence {
  readonly name: unknown;
  readonly fingerprintMatches: unknown;
}

export interface AuthIntegrationFunctionEvidence {
  readonly name: unknown;
  readonly arguments: unknown;
  readonly resultType: unknown;
  readonly volatility: unknown;
  readonly language: unknown;
  readonly fingerprintMatches: unknown;
  readonly securityBoundaryValid: unknown;
}

export interface AuthIntegrationTriggerEvidence {
  readonly name: unknown;
  readonly tableName: unknown;
  readonly functionName: unknown;
  readonly triggerType: unknown;
  readonly isDeferrable: unknown;
  readonly isDeferred: unknown;
  readonly enabledState: unknown;
}

export interface AuthIntegrationIndexEvidence {
  readonly name: unknown;
  readonly tableName: unknown;
  readonly isUnique: unknown;
  readonly keyColumns: unknown;
  readonly predicate: unknown;
  readonly isValid: unknown;
  readonly isReady: unknown;
}

export interface AuthIntegrationConstraintEvidence {
  readonly schemaName: unknown;
  readonly tableName: unknown;
  readonly name: unknown;
  readonly constraintType: unknown;
  readonly isDeferrable: unknown;
  readonly isDeferred: unknown;
  readonly isValidated: unknown;
}

export interface AuthIntegrationColumnEvidence {
  readonly schemaName: unknown;
  readonly tableName: unknown;
  readonly columnPosition: unknown;
  readonly columnName: unknown;
  readonly dataType: unknown;
  readonly notNull: unknown;
  readonly defaultExpression: unknown;
  readonly identityKind: unknown;
}

export interface AuthIntegrationKeyEvidence
  extends AuthIntegrationConstraintEvidence {
  readonly keyColumns: unknown;
}

export interface AuthIntegrationForeignKeyEvidence
  extends AuthIntegrationConstraintEvidence {
  readonly sourceColumns: unknown;
  readonly targetSchema: unknown;
  readonly targetTable: unknown;
  readonly targetColumns: unknown;
  readonly matchType: unknown;
  readonly onUpdate: unknown;
  readonly onDelete: unknown;
}

export interface AuthIntegrationSchemaAclEvidence {
  readonly schemaName: unknown;
  readonly grantee: unknown;
  readonly privilegeType: unknown;
  readonly isGrantable: unknown;
}

export interface AuthIntegrationRelationAclEvidence {
  readonly schemaName: unknown;
  readonly relationName: unknown;
  readonly grantee: unknown;
  readonly privilegeType: unknown;
  readonly isGrantable: unknown;
}

export interface AuthIntegrationColumnAclEvidence {
  readonly schemaName: unknown;
  readonly tableName: unknown;
  readonly columnName: unknown;
  readonly grantee: unknown;
  readonly privilegeType: unknown;
  readonly isGrantable: unknown;
}

export interface AuthIntegrationFunctionAclEvidence {
  readonly schemaName: unknown;
  readonly functionIdentity: unknown;
  readonly grantee: unknown;
  readonly privilegeType: unknown;
  readonly isGrantable: unknown;
}

export interface AuthIntegrationCatalogEvidence {
  readonly tables: readonly AuthIntegrationTableEvidence[];
  readonly columns: readonly AuthIntegrationColumnEvidence[];
  readonly functions: readonly AuthIntegrationFunctionEvidence[];
  readonly triggers: readonly AuthIntegrationTriggerEvidence[];
  readonly indexes: readonly AuthIntegrationIndexEvidence[];
  readonly constraints: readonly AuthIntegrationConstraintEvidence[];
  readonly keys: readonly AuthIntegrationKeyEvidence[];
  readonly foreignKeys: readonly AuthIntegrationForeignKeyEvidence[];
  readonly schemaAcl: readonly AuthIntegrationSchemaAclEvidence[];
  readonly tableAcl: readonly AuthIntegrationRelationAclEvidence[];
  readonly columnAcl: readonly AuthIntegrationColumnAclEvidence[];
  readonly sequenceAcl: readonly AuthIntegrationRelationAclEvidence[];
  readonly functionAcl: readonly AuthIntegrationFunctionAclEvidence[];
  readonly aclValid: unknown;
  readonly sequenceValid: unknown;
  readonly semanticFunctionsValid: unknown;
}

export const AUTH_INTEGRATION_EXPECTED_TABLES = Object.freeze([
  'accounts',
  'account_notification_preferences',
  'auth_session_commands',
  'auth_session_credentials',
  'auth_session_families',
  'authentication_operations',
  'external_identities',
  'external_identity_lookup_digests',
  'fresh_authentication_evidence',
  'otp_challenges',
  'otp_commands',
  'player_profile_details',
  'player_profiles',
  'player_rating_states',
  'reauthentication_grants',
  'security_audit_events',
  'telegram_proof_consumptions',
  'telegram_notification_destinations',
] as const);

export const AUTH_INTEGRATION_EXPECTED_FUNCTIONS = Object.freeze([
  ['relation_fingerprint', 'regclass', 'text', 's', 'sql'],
  ['reject_immutable_mutation', '', 'trigger', 'v', 'plpgsql'],
  ['guard_account_transition', '', 'trigger', 'v', 'plpgsql'],
  ['guard_external_identity_transition', '', 'trigger', 'v', 'plpgsql'],
  [
    'guard_authentication_operation_transition',
    '',
    'trigger',
    'v',
    'plpgsql',
  ],
  ['guard_session_family_transition', '', 'trigger', 'v', 'plpgsql'],
  [
    'guard_session_credential_transition',
    '',
    'trigger',
    'v',
    'plpgsql',
  ],
  [
    'guard_reauthentication_grant_transition',
    '',
    'trigger',
    'v',
    'plpgsql',
  ],
  ['guard_otp_challenge_transition', '', 'trigger', 'v', 'plpgsql'],
  ['assert_player_profile_consistency', '', 'trigger', 'v', 'plpgsql'],
  ['assert_external_identity_aliases', '', 'trigger', 'v', 'plpgsql'],
  [
    'assert_active_account_has_login_method',
    '',
    'trigger',
    'v',
    'plpgsql',
  ],
  [
    'assert_primary_unlink_replacement',
    '',
    'trigger',
    'v',
    'plpgsql',
  ],
  [
    'assert_authentication_proof_binding',
    '',
    'trigger',
    'v',
    'plpgsql',
  ],
  ['assert_session_family_operation', '', 'trigger', 'v', 'plpgsql'],
  ['assert_session_consistency', '', 'trigger', 'v', 'plpgsql'],
  [
    'assert_reauthentication_grant_consistency',
    '',
    'trigger',
    'v',
    'plpgsql',
  ],
  ['assert_otp_consistency', '', 'trigger', 'v', 'plpgsql'],
  ['reject_audit_mutation', '', 'trigger', 'v', 'plpgsql'],
  [
    'assert_fresh_authentication_evidence_consistency',
    '',
    'trigger',
    'v',
    'plpgsql',
  ],
] as const);

export const AUTH_INTEGRATION_EXPECTED_TRIGGERS = Object.freeze([
  ['accounts_transition_guard', 'accounts', 'guard_account_transition', 23, false, false],
  ['external_identities_transition_guard', 'external_identities', 'guard_external_identity_transition', 23, false, false],
  ['authentication_operations_transition_guard', 'authentication_operations', 'guard_authentication_operation_transition', 23, false, false],
  ['auth_session_families_transition_guard', 'auth_session_families', 'guard_session_family_transition', 23, false, false],
  ['auth_session_credentials_transition_guard', 'auth_session_credentials', 'guard_session_credential_transition', 23, false, false],
  ['reauthentication_grants_transition_guard', 'reauthentication_grants', 'guard_reauthentication_grant_transition', 23, false, false],
  ['otp_challenges_transition_guard', 'otp_challenges', 'guard_otp_challenge_transition', 23, false, false],
  ['player_profiles_immutable_guard', 'player_profiles', 'reject_immutable_mutation', 27, false, false],
  ['external_identity_lookup_digests_immutable_guard', 'external_identity_lookup_digests', 'reject_immutable_mutation', 27, false, false],
  ['telegram_proof_consumptions_immutable_guard', 'telegram_proof_consumptions', 'reject_immutable_mutation', 27, false, false],
  ['auth_session_commands_immutable_guard', 'auth_session_commands', 'reject_immutable_mutation', 27, false, false],
  ['fresh_authentication_evidence_immutable_guard', 'fresh_authentication_evidence', 'reject_immutable_mutation', 27, false, false],
  ['otp_commands_immutable_guard', 'otp_commands', 'reject_immutable_mutation', 27, false, false],
  ['accounts_player_profile_consistency', 'accounts', 'assert_player_profile_consistency', 29, true, true],
  ['player_profiles_account_consistency', 'player_profiles', 'assert_player_profile_consistency', 29, true, true],
  ['external_identities_alias_required', 'external_identities', 'assert_external_identity_aliases', 29, true, true],
  ['external_identity_lookup_digests_identity_required', 'external_identity_lookup_digests', 'assert_external_identity_aliases', 29, true, true],
  ['accounts_active_login_method_required', 'accounts', 'assert_active_account_has_login_method', 29, true, true],
  ['external_identities_active_login_method_required', 'external_identities', 'assert_active_account_has_login_method', 29, true, true],
  ['external_identities_primary_unlink_replacement', 'external_identities', 'assert_primary_unlink_replacement', 25, true, true],
  ['authentication_operations_proof_binding', 'authentication_operations', 'assert_authentication_proof_binding', 29, true, true],
  ['telegram_proof_consumptions_operation_binding', 'telegram_proof_consumptions', 'assert_authentication_proof_binding', 29, true, true],
  ['otp_challenges_operation_binding', 'otp_challenges', 'assert_authentication_proof_binding', 29, true, true],
  ['auth_session_families_operation_consistency', 'auth_session_families', 'assert_session_family_operation', 5, false, false],
  ['auth_session_families_state_consistency', 'auth_session_families', 'assert_session_consistency', 29, true, true],
  ['auth_session_credentials_state_consistency', 'auth_session_credentials', 'assert_session_consistency', 29, true, true],
  ['auth_session_commands_state_consistency', 'auth_session_commands', 'assert_session_consistency', 29, true, true],
  ['fresh_authentication_evidence_state_consistency', 'fresh_authentication_evidence', 'assert_fresh_authentication_evidence_consistency', 5, false, false],
  ['reauthentication_grants_state_consistency', 'reauthentication_grants', 'assert_reauthentication_grant_consistency', 21, false, false],
  ['otp_challenges_state_consistency', 'otp_challenges', 'assert_otp_consistency', 29, true, true],
  ['otp_commands_state_consistency', 'otp_commands', 'assert_otp_consistency', 29, true, true],
  ['security_audit_events_update_delete_guard', 'security_audit_events', 'reject_audit_mutation', 27, false, false],
  ['security_audit_events_truncate_guard', 'security_audit_events', 'reject_audit_mutation', 34, false, false],
] as const);

export const AUTH_INTEGRATION_EXPECTED_INDEXES = Object.freeze([
  ['external_identities_one_linked_primary_uidx', 'external_identities', true, 'account_id', "status='linked'andis_primary"],
  ['external_identities_account_status_id_idx', 'external_identities', false, 'account_id,status,id', null],
  ['authentication_operations_pending_expiry_idx', 'authentication_operations', false, 'expires_at,id', "status='pending'"],
  ['auth_session_families_account_status_id_idx', 'auth_session_families', false, 'account_id,status,id', null],
  ['auth_session_credentials_one_unconsumed_uidx', 'auth_session_credentials', true, 'family_id', 'consumed_atisnull'],
  ['reauthentication_grants_active_account_family_idx', 'reauthentication_grants', false, 'account_id,family_id,expires_at,id', "status='active'"],
  ['otp_challenges_pending_expiry_idx', 'otp_challenges', false, 'expires_at,id', "status='pending'"],
  ['security_audit_events_time_order_idx', 'security_audit_events', false, 'occurred_at,event_order', null],
  ['security_audit_events_account_time_idx', 'security_audit_events', false, 'account_id,occurred_at,event_order', 'account_idisnotnull'],
  ['security_audit_events_session_time_idx', 'security_audit_events', false, 'session_id,occurred_at,event_order', 'session_idisnotnull'],
  ['security_audit_events_operation_time_idx', 'security_audit_events', false, 'operation_id,occurred_at,event_order', 'operation_idisnotnull'],
] as const);

export const AUTH_INTEGRATION_EXPECTED_CONSTRAINT_NAMES =
  Object.freeze([
  'accounts_pkey',
  'accounts_role_check',
  'accounts_status_check',
  'accounts_time_check',
  'player_profiles_pkey',
  'player_profiles_account_id_fkey',
  'player_profile_details_pkey',
  'player_profile_details_account_id_fkey',
  'player_profile_details_first_name_check',
  'player_profile_details_last_name_check',
  'player_profile_details_username_check',
  'player_profile_details_photo_url_check',
  'player_profile_details_language_code_check',
  'player_profile_details_time_check',
  'player_profile_details_phone_check',
  'player_profile_details_side_preference_check',
  'player_rating_states_pkey',
  'player_rating_states_account_id_fkey',
  'player_rating_states_rating_check',
  'player_rating_states_time_check',
  'telegram_notification_destinations_pkey',
  'telegram_notification_destinations_chat_key',
  'telegram_notification_destinations_account_id_fkey',
  'telegram_notification_destinations_chat_check',
  'telegram_notification_destinations_status_check',
  'telegram_notification_destinations_reason_check',
  'telegram_notification_destinations_time_check',
  'telegram_notification_destinations_state_check',
  'telegram_notification_destinations_version_check',
  'external_identities_pkey',
  'external_identities_binding_key',
  'external_identities_account_id_fkey',
  'external_identities_provider_check',
  'external_identities_namespace_check',
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
  'auth_session_families_pkey',
  'auth_session_families_operation_id_key',
  'auth_session_families_id_account_key',
  'auth_session_families_account_id_fkey',
  'auth_session_families_operation_id_fkey',
  'auth_session_families_status_check',
  'auth_session_families_generation_check',
  'auth_session_families_window_check',
  'auth_session_families_reason_check',
  'auth_session_families_reuse_digest_check',
  'auth_session_families_terminal_check',
  'auth_session_credentials_pkey',
  'auth_session_credentials_family_digest_key',
  'auth_session_credentials_family_id_fkey',
  'auth_session_credentials_generation_check',
  'auth_session_credentials_digest_check',
  'auth_session_credentials_time_check',
  'auth_session_credentials_consumption_check',
  'auth_session_commands_pkey',
  'auth_session_commands_family_sequence_key',
  'auth_session_commands_family_id_fkey',
  'auth_session_commands_sequence_check',
  'auth_session_commands_request_digest_check',
  'auth_session_commands_applied_at_check',
  'auth_session_commands_credential_reference_check',
  'auth_session_commands_reason_check',
  'auth_session_commands_variant_check',
  'fresh_authentication_evidence_pkey',
  'fresh_authentication_evidence_binding_key',
  'fresh_authentication_evidence_family_account_fkey',
  'fresh_authentication_evidence_method_check',
  'fresh_authentication_evidence_window_check',
  'reauthentication_grants_pkey',
  'reauthentication_grants_evidence_binding_fkey',
  'reauthentication_grants_scope_check',
  'reauthentication_grants_resource_digest_check',
  'reauthentication_grants_window_check',
  'reauthentication_grants_status_check',
  'reauthentication_grants_terminal_digest_check',
  'reauthentication_grants_reason_check',
  'reauthentication_grants_terminal_check',
  'otp_challenges_pkey',
  'otp_challenges_operation_id_key',
  'otp_challenges_operation_id_fkey',
  'otp_challenges_intent_check',
  'otp_challenges_identity_check',
  'otp_challenges_digest_check',
  'otp_challenges_window_check',
  'otp_challenges_attempts_check',
  'otp_challenges_status_check',
  'otp_challenges_reason_check',
  'otp_challenges_terminal_check',
  'otp_commands_pkey',
  'otp_commands_challenge_sequence_key',
  'otp_commands_challenge_id_fkey',
  'otp_commands_sequence_check',
  'otp_commands_request_digest_check',
  'otp_commands_applied_at_check',
  'otp_commands_presented_digest_check',
  'otp_commands_reason_check',
  'otp_commands_result_attempts_check',
  'otp_commands_variant_check',
  'security_audit_events_pkey',
  'security_audit_events_event_order_key',
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
  'otp_challenges_terminal_command_fkey',
] as const);

function exactPrimitiveRows(
  actual: readonly (readonly unknown[])[],
  expected: readonly (readonly unknown[])[],
): boolean {
  const key = (row: readonly unknown[]) => JSON.stringify(row);
  const actualKeys = actual.map(key).sort();
  const expectedKeys = expected.map(key).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((value, index) => value === expectedKeys[index])
  );
}

export function isValidAuthIntegrationCatalogEvidence(
  evidence: AuthIntegrationCatalogEvidence,
): boolean {
  const tables = evidence.tables.map((row) => [
    row.name,
    row.fingerprintMatches,
  ]);
  const expectedTables = AUTH_INTEGRATION_EXPECTED_TABLES.map(
    (name) => [name, true] as const,
  );
  const functions = evidence.functions.map((row) => [
    row.name,
    row.arguments,
    row.resultType,
    row.volatility,
    row.language,
    row.fingerprintMatches,
    row.securityBoundaryValid,
  ]);
  const expectedFunctions = AUTH_INTEGRATION_EXPECTED_FUNCTIONS.map(
    ([name, arguments_, resultType, volatility, language]) => [
      name,
      arguments_,
      resultType,
      volatility,
      language,
      true,
      true,
    ],
  );
  const columns = evidence.columns.map((row) => [
    row.schemaName,
    row.tableName,
    row.columnPosition,
    row.columnName,
    row.dataType,
    row.notNull,
    row.defaultExpression,
    row.identityKind,
  ]);
  const triggers = evidence.triggers.map((row) => [
    row.name,
    row.tableName,
    row.functionName,
    row.triggerType,
    row.isDeferrable,
    row.isDeferred,
    row.enabledState,
  ]);
  const expectedTriggers = AUTH_INTEGRATION_EXPECTED_TRIGGERS.map(
    ([name, table, functionName, type, deferrable, deferred]) => [
      name,
      table,
      functionName,
      type,
      deferrable,
      deferred,
      'O',
    ],
  );
  const indexes = evidence.indexes.map((row) => [
    row.name,
    row.tableName,
    row.isUnique,
    row.keyColumns,
    row.predicate,
    row.isValid,
    row.isReady,
  ]);
  const expectedIndexes = AUTH_INTEGRATION_EXPECTED_INDEXES.map(
    ([name, table, unique, columns, predicate]) => [
      name,
      table,
      unique,
      columns,
      predicate,
      true,
      true,
    ],
  );
  const constraints = evidence.constraints.map((row) => [
    row.schemaName,
    row.tableName,
    row.name,
    row.constraintType,
    row.isDeferrable,
    row.isDeferred,
    row.isValidated,
  ]);
  const keys = evidence.keys.map((row) => [
    row.schemaName,
    row.tableName,
    row.name,
    row.constraintType,
    row.keyColumns,
    row.isDeferrable,
    row.isDeferred,
    row.isValidated,
  ]);
  const foreignKeys = evidence.foreignKeys.map((row) => [
    row.schemaName,
    row.tableName,
    row.name,
    row.sourceColumns,
    row.targetSchema,
    row.targetTable,
    row.targetColumns,
    row.matchType,
    row.onUpdate,
    row.onDelete,
    row.isDeferrable,
    row.isDeferred,
    row.isValidated,
  ]);
  const schemaAcl = evidence.schemaAcl.map((row) => [
    row.schemaName,
    row.grantee,
    row.privilegeType,
    row.isGrantable,
  ]);
  const tableAcl = evidence.tableAcl.map((row) => [
    row.schemaName,
    row.relationName,
    row.grantee,
    row.privilegeType,
    row.isGrantable,
  ]);
  const columnAcl = evidence.columnAcl.map((row) => [
    row.schemaName,
    row.tableName,
    row.columnName,
    row.grantee,
    row.privilegeType,
    row.isGrantable,
  ]);
  const sequenceAcl = evidence.sequenceAcl.map((row) => [
    row.schemaName,
    row.relationName,
    row.grantee,
    row.privilegeType,
    row.isGrantable,
  ]);
  const functionAcl = evidence.functionAcl.map((row) => [
    row.schemaName,
    row.functionIdentity,
    row.grantee,
    row.privilegeType,
    row.isGrantable,
  ]);

  return (
    exactPrimitiveRows(tables, expectedTables) &&
    exactPrimitiveRows(columns, AUTH_INTEGRATION_EXPECTED_COLUMNS) &&
    exactPrimitiveRows(functions, expectedFunctions) &&
    exactPrimitiveRows(triggers, expectedTriggers) &&
    exactPrimitiveRows(indexes, expectedIndexes) &&
    exactPrimitiveRows(
      constraints,
      AUTH_INTEGRATION_EXPECTED_CONSTRAINTS,
    ) &&
    exactPrimitiveRows(keys, AUTH_INTEGRATION_EXPECTED_KEYS) &&
    exactPrimitiveRows(
      foreignKeys,
      AUTH_INTEGRATION_EXPECTED_FOREIGN_KEYS,
    ) &&
    exactPrimitiveRows(schemaAcl, AUTH_INTEGRATION_EXPECTED_SCHEMA_ACL) &&
    exactPrimitiveRows(tableAcl, AUTH_INTEGRATION_EXPECTED_TABLE_ACL) &&
    exactPrimitiveRows(columnAcl, AUTH_INTEGRATION_EXPECTED_COLUMN_ACL) &&
    exactPrimitiveRows(
      sequenceAcl,
      AUTH_INTEGRATION_EXPECTED_SEQUENCE_ACL,
    ) &&
    exactPrimitiveRows(
      functionAcl,
      AUTH_INTEGRATION_EXPECTED_FUNCTION_ACL,
    ) &&
    evidence.aclValid === true &&
    evidence.sequenceValid === true &&
    evidence.semanticFunctionsValid === true
  );
}

export function validAuthIntegrationCatalogEvidenceFixture(): AuthIntegrationCatalogEvidence {
  return {
    tables: AUTH_INTEGRATION_EXPECTED_TABLES.map((name) => ({
      name,
      fingerprintMatches: true,
    })),
    columns: AUTH_INTEGRATION_EXPECTED_COLUMNS.map(
      ([
        schemaName,
        tableName,
        columnPosition,
        columnName,
        dataType,
        notNull,
        defaultExpression,
        identityKind,
      ]) => ({
        schemaName,
        tableName,
        columnPosition,
        columnName,
        dataType,
        notNull,
        defaultExpression,
        identityKind,
      }),
    ),
    functions: AUTH_INTEGRATION_EXPECTED_FUNCTIONS.map(
      ([name, arguments_, resultType, volatility, language]) => ({
        name,
        arguments: arguments_,
        resultType,
        volatility,
        language,
        fingerprintMatches: true,
        securityBoundaryValid: true,
      }),
    ),
    triggers: AUTH_INTEGRATION_EXPECTED_TRIGGERS.map(
      ([name, tableName, functionName, triggerType, isDeferrable, isDeferred]) => ({
        name,
        tableName,
        functionName,
        triggerType,
        isDeferrable,
        isDeferred,
        enabledState: 'O',
      }),
    ),
    indexes: AUTH_INTEGRATION_EXPECTED_INDEXES.map(
      ([name, tableName, isUnique, keyColumns, predicate]) => ({
        name,
        tableName,
        isUnique,
        keyColumns,
        predicate,
        isValid: true,
        isReady: true,
      }),
    ),
    constraints: AUTH_INTEGRATION_EXPECTED_CONSTRAINTS.map(
      ([
        schemaName,
        tableName,
        name,
        constraintType,
        isDeferrable,
        isDeferred,
        isValidated,
      ]) => ({
        schemaName,
        tableName,
        name,
        constraintType,
        isDeferrable,
        isDeferred,
        isValidated,
      }),
    ),
    keys: AUTH_INTEGRATION_EXPECTED_KEYS.map(
      ([
        schemaName,
        tableName,
        name,
        constraintType,
        keyColumns,
        isDeferrable,
        isDeferred,
        isValidated,
      ]) => ({
        schemaName,
        tableName,
        name,
        constraintType,
        keyColumns,
        isDeferrable,
        isDeferred,
        isValidated,
      }),
    ),
    foreignKeys: AUTH_INTEGRATION_EXPECTED_FOREIGN_KEYS.map(
      ([
        schemaName,
        tableName,
        name,
        sourceColumns,
        targetSchema,
        targetTable,
        targetColumns,
        matchType,
        onUpdate,
        onDelete,
        isDeferrable,
        isDeferred,
        isValidated,
      ]) => ({
        schemaName,
        tableName,
        name,
        constraintType: 'f',
        sourceColumns,
        targetSchema,
        targetTable,
        targetColumns,
        matchType,
        onUpdate,
        onDelete,
        isDeferrable,
        isDeferred,
        isValidated,
      }),
    ),
    schemaAcl: AUTH_INTEGRATION_EXPECTED_SCHEMA_ACL.map(
      ([schemaName, grantee, privilegeType, isGrantable]) => ({
        schemaName,
        grantee,
        privilegeType,
        isGrantable,
      }),
    ),
    tableAcl: AUTH_INTEGRATION_EXPECTED_TABLE_ACL.map(
      ([
        schemaName,
        relationName,
        grantee,
        privilegeType,
        isGrantable,
      ]) => ({
        schemaName,
        relationName,
        grantee,
        privilegeType,
        isGrantable,
      }),
    ),
    columnAcl: AUTH_INTEGRATION_EXPECTED_COLUMN_ACL.map(
      ([
        schemaName,
        tableName,
        columnName,
        grantee,
        privilegeType,
        isGrantable,
      ]) => ({
        schemaName,
        tableName,
        columnName,
        grantee,
        privilegeType,
        isGrantable,
      }),
    ),
    sequenceAcl: AUTH_INTEGRATION_EXPECTED_SEQUENCE_ACL.map(
      ([
        schemaName,
        relationName,
        grantee,
        privilegeType,
        isGrantable,
      ]) => ({
        schemaName,
        relationName,
        grantee,
        privilegeType,
        isGrantable,
      }),
    ),
    functionAcl: [],
    aclValid: true,
    sequenceValid: true,
    semanticFunctionsValid: true,
  };
}
