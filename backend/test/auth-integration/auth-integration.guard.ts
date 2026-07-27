import { ConfigService } from '@nestjs/config';
import {
  Pool,
  PoolClient,
  PoolConfig,
  QueryResultRow,
} from 'pg';
import { PostgresService } from '../../src/database/postgres.service';
import {
  AuthIntegrationEnvironment,
  AuthIntegrationEnvironmentSource,
  readAuthIntegrationEnvironment,
} from './auth-integration.env';
import {
  AuthIntegrationCatalogEvidence,
  AuthIntegrationColumnAclEvidence,
  AuthIntegrationColumnEvidence,
  AuthIntegrationConstraintEvidence,
  AuthIntegrationForeignKeyEvidence,
  AuthIntegrationFunctionAclEvidence,
  AuthIntegrationFunctionEvidence,
  AuthIntegrationIndexEvidence,
  AuthIntegrationKeyEvidence,
  AuthIntegrationRelationAclEvidence,
  AuthIntegrationSchemaAclEvidence,
  AuthIntegrationTableEvidence,
  AuthIntegrationTriggerEvidence,
  isValidAuthIntegrationCatalogEvidence,
} from './auth-integration.inventory';

const MINIMUM_POSTGRES_VERSION = 140000;
const EXPECTED_APPLICATION_ROLE = 'backend_auth_app';
const NOT_PROVISIONED_MESSAGE =
  'Auth integration database is not provisioned with migrations 015 and 017';

export const AUTH_INTEGRATION_JEST_TIMEOUT_MILLIS = 60_000;
export const AUTH_INTEGRATION_POOL_LIMITS = Object.freeze({
  connectionTimeoutMillis: 5_000,
  queryTimeoutMillis: 10_000,
  statementTimeoutMillis: 10_000,
  lockTimeoutMillis: 5_000,
  idleInTransactionSessionTimeoutMillis: 10_000,
  idleTimeoutMillis: 5_000,
  max: 8,
} as const);

export type AuthIntegrationGuardFailure =
  | 'unsafe_database'
  | 'not_provisioned'
  | 'database_check_failed';

export class AuthIntegrationGuardError extends Error {
  readonly name = 'AuthIntegrationGuardError';

  constructor(readonly reason: AuthIntegrationGuardFailure) {
    super(
      reason === 'not_provisioned'
        ? NOT_PROVISIONED_MESSAGE
        : 'Auth integration database safety check failed',
    );
  }
}

export interface GuardedAuthIntegrationDatabase {
  readonly environment: AuthIntegrationEnvironment;
  readonly postgres: PostgresService;
  readonly pool: Pool;
  close(): Promise<void>;
}

export type AuthIntegrationPostgresFactory = (
  databaseUrl: string,
) => PostgresService;

export type AuthIntegrationPoolFactory = (
  options: PoolConfig,
) => Pool;

interface ScalarRow extends QueryResultRow {
  readonly value: unknown;
}

interface TableEvidenceRow
  extends QueryResultRow,
    AuthIntegrationTableEvidence {}

interface FunctionEvidenceRow
  extends QueryResultRow,
    AuthIntegrationFunctionEvidence {}

interface TriggerEvidenceRow
  extends QueryResultRow,
    AuthIntegrationTriggerEvidence {}

interface IndexEvidenceRow
  extends QueryResultRow,
    AuthIntegrationIndexEvidence {}

interface ConstraintEvidenceRow
  extends QueryResultRow,
    AuthIntegrationConstraintEvidence {}

interface ColumnEvidenceRow
  extends QueryResultRow,
    AuthIntegrationColumnEvidence {}

interface KeyEvidenceRow
  extends QueryResultRow,
    AuthIntegrationKeyEvidence {}

interface ForeignKeyEvidenceRow
  extends QueryResultRow,
    AuthIntegrationForeignKeyEvidence {}

interface SchemaAclEvidenceRow
  extends QueryResultRow,
    AuthIntegrationSchemaAclEvidence {}

interface RelationAclEvidenceRow
  extends QueryResultRow,
    AuthIntegrationRelationAclEvidence {}

interface ColumnAclEvidenceRow
  extends QueryResultRow,
    AuthIntegrationColumnAclEvidence {}

interface FunctionAclEvidenceRow
  extends QueryResultRow,
    AuthIntegrationFunctionAclEvidence {}

function failure(
  reason: AuthIntegrationGuardFailure,
): AuthIntegrationGuardError {
  return new AuthIntegrationGuardError(reason);
}

export function authIntegrationPoolOptions(
  databaseUrl: string,
): Readonly<PoolConfig> {
  return Object.freeze({
    connectionString: databaseUrl,
    connectionTimeoutMillis:
      AUTH_INTEGRATION_POOL_LIMITS.connectionTimeoutMillis,
    query_timeout: AUTH_INTEGRATION_POOL_LIMITS.queryTimeoutMillis,
    statement_timeout:
      AUTH_INTEGRATION_POOL_LIMITS.statementTimeoutMillis,
    lock_timeout: AUTH_INTEGRATION_POOL_LIMITS.lockTimeoutMillis,
    idle_in_transaction_session_timeout:
      AUTH_INTEGRATION_POOL_LIMITS.idleInTransactionSessionTimeoutMillis,
    idleTimeoutMillis: AUTH_INTEGRATION_POOL_LIMITS.idleTimeoutMillis,
    max: AUTH_INTEGRATION_POOL_LIMITS.max,
    options: '-c search_path=pg_catalog,pg_temp',
  });
}

class AuthIntegrationPostgresService extends PostgresService {
  private closed = false;

  constructor(private readonly integrationPool: Pool) {
    super(new ConfigService({ DATABASE_ENABLED: false }));
  }

  override isEnabled(): boolean {
    return true;
  }

  override getPool(): Pool {
    return this.integrationPool;
  }

  override async onApplicationShutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.integrationPool.end();
  }
}

export function createAuthIntegrationPostgresService(
  databaseUrl: string,
  poolFactory: AuthIntegrationPoolFactory = (options) =>
    new Pool(options),
): PostgresService {
  return new AuthIntegrationPostgresService(
    poolFactory(authIntegrationPoolOptions(databaseUrl)),
  );
}

async function scalar(
  client: PoolClient,
  text: string,
): Promise<unknown> {
  const result = await client.query<ScalarRow>(text);
  if (result.rows.length !== 1) {
    throw failure('database_check_failed');
  }
  return result.rows[0].value;
}

async function readCatalogEvidence(
  client: PoolClient,
): Promise<AuthIntegrationCatalogEvidence> {
  const tables = await client.query<TableEvidenceRow>(`
    SELECT
      rel.relname AS name,
      pg_catalog.obj_description(rel.oid, 'pg_class') =
        CASE rel.relname
          WHEN 'player_profile_details'
            THEN '017_backend_auth_player_profile_details:'
          ELSE '015_backend_auth_foundation:'
        END ||
        pg_catalog.md5(pg_catalog.jsonb_build_object(
          'relation', pg_catalog.jsonb_build_object(
            'name', rel.oid::pg_catalog.regclass::text,
            'kind', rel.relkind,
            'owner', rel.relowner,
            'acl', rel.relacl
          ),
          'columns', coalesce((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'number', a.attnum,
              'name', a.attname,
              'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
              'not_null', a.attnotnull,
              'identity', a.attidentity,
              'generated', a.attgenerated,
              'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false),
              'acl', a.attacl
            ) ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute a
            LEFT JOIN pg_catalog.pg_attrdef d
              ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = rel.oid
              AND a.attnum > 0
              AND NOT a.attisdropped
          ), '[]'::pg_catalog.jsonb),
          'constraints', coalesce((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'name', c.conname,
              'type', c.contype,
              'deferrable', c.condeferrable,
              'deferred', c.condeferred,
              'validated', c.convalidated,
              'table', c.conrelid::pg_catalog.regclass::text,
              'keys', coalesce((
                SELECT pg_catalog.jsonb_agg(a.attname::text ORDER BY
                  CASE WHEN c.contype = 'c'
                    THEN a.attname::text COLLATE "C" END,
                  CASE WHEN c.contype <> 'c'
                    THEN k.key_position END)
                FROM pg_catalog.unnest(c.conkey)
                  WITH ORDINALITY k(attnum, key_position)
                JOIN pg_catalog.pg_attribute a
                  ON a.attrelid = c.conrelid
                  AND a.attnum = k.attnum
              ), '[]'::pg_catalog.jsonb),
              'backing_index', CASE WHEN c.conindid = 0 THEN NULL
                ELSE c.conindid::pg_catalog.regclass::text END,
              'referenced_table', CASE WHEN c.confrelid = 0 THEN NULL
                ELSE c.confrelid::pg_catalog.regclass::text END,
              'referenced_keys', coalesce((
                SELECT pg_catalog.jsonb_agg(
                  a.attname::text ORDER BY k.key_position
                )
                FROM pg_catalog.unnest(c.confkey)
                  WITH ORDINALITY k(attnum, key_position)
                JOIN pg_catalog.pg_attribute a
                  ON a.attrelid = c.confrelid
                  AND a.attnum = k.attnum
              ), '[]'::pg_catalog.jsonb),
              'match_type', c.confmatchtype,
              'on_update', c.confupdtype,
              'on_delete', c.confdeltype,
              'definition',
                pg_catalog.pg_get_constraintdef(c.oid, true)
            ) ORDER BY c.conname::text COLLATE "C")
            FROM pg_catalog.pg_constraint c
            WHERE c.conrelid = rel.oid
          ), '[]'::pg_catalog.jsonb),
          'indexes', coalesce((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'name', idx.relname,
              'unique', i.indisunique,
              'primary', i.indisprimary,
              'valid', i.indisvalid,
              'ready', i.indisready,
              'definition',
                pg_catalog.pg_get_indexdef(i.indexrelid, 0, false),
              'predicate',
                pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)
            ) ORDER BY idx.relname)
            FROM pg_catalog.pg_index i
            JOIN pg_catalog.pg_class idx
              ON idx.oid = i.indexrelid
            WHERE i.indrelid = rel.oid
          ), '[]'::pg_catalog.jsonb),
          'triggers', coalesce((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'name', t.tgname,
              'enabled', t.tgenabled,
              'definition', pg_catalog.pg_get_triggerdef(t.oid, false)
            ) ORDER BY t.tgname)
            FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid = rel.oid
              AND NOT t.tgisinternal
          ), '[]'::pg_catalog.jsonb)
        )::text) AS "fingerprintMatches"
    FROM pg_catalog.pg_class rel
    JOIN pg_catalog.pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'backend_auth'
      AND rel.relkind = 'r'
    ORDER BY rel.relname
  `);

  const columns = await client.query<ColumnEvidenceRow>(`
    SELECT
      n.nspname AS "schemaName",
      c.relname AS "tableName",
      a.attnum::integer AS "columnPosition",
      a.attname AS "columnName",
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS "dataType",
      a.attnotnull AS "notNull",
      CASE
        WHEN a.attidentity = 'a' THEN '<identity>'
        ELSE pg_catalog.pg_get_expr(d.adbin, d.adrelid, false)
      END AS "defaultExpression",
      a.attidentity::text AS "identityKind"
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d
      ON d.adrelid = a.attrelid
      AND d.adnum = a.attnum
    WHERE n.nspname = 'backend_auth'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY n.nspname, c.relname, a.attnum
  `);

  const functions = await client.query<FunctionEvidenceRow>(`
    SELECT
      p.proname AS name,
      pg_catalog.oidvectortypes(p.proargtypes) AS arguments,
      pg_catalog.format_type(p.prorettype, NULL) AS "resultType",
      p.provolatile::text AS volatility,
      l.lanname AS language,
      pg_catalog.obj_description(p.oid, 'pg_proc') =
        '015_backend_auth_foundation:' ||
          pg_catalog.md5(
            pg_catalog.pg_get_functiondef(p.oid)
          ) AS "fingerprintMatches",
      (
        pg_catalog.pg_get_userbyid(p.proowner) =
          'backend_auth_owner'
        AND NOT p.prosecdef
        AND p.proconfig IS NOT DISTINCT FROM
          ARRAY['search_path=pg_catalog, pg_temp']::text[]
        AND p.prokind = 'f'::"char"
        AND NOT pg_catalog.has_function_privilege(
          current_user,
          p.oid,
          'EXECUTE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            coalesce(
              p.proacl,
              pg_catalog.acldefault('f', p.proowner)
            )
          ) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
      ) AS "securityBoundaryValid"
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'backend_auth'
    ORDER BY p.proname, pg_catalog.oidvectortypes(p.proargtypes)
  `);

  const triggers = await client.query<TriggerEvidenceRow>(`
    SELECT
      t.tgname AS name,
      r.relname AS "tableName",
      p.proname AS "functionName",
      t.tgtype::integer AS "triggerType",
      coalesce(c.condeferrable, false) AS "isDeferrable",
      coalesce(c.condeferred, false) AS "isDeferred",
      t.tgenabled::text AS "enabledState"
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class r ON r.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    LEFT JOIN pg_catalog.pg_constraint c ON c.oid = t.tgconstraint
    WHERE n.nspname = 'backend_auth'
      AND NOT t.tgisinternal
    ORDER BY t.tgname
  `);

  const indexes = await client.query<IndexEvidenceRow>(`
    SELECT
      idx.relname AS name,
      tbl.relname AS "tableName",
      i.indisunique AS "isUnique",
      (
        SELECT pg_catalog.string_agg(
          a.attname,
          ',' ORDER BY key_position
        )
        FROM pg_catalog.unnest(i.indkey)
          WITH ORDINALITY k(attnum, key_position)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = i.indrelid
          AND a.attnum = k.attnum
        WHERE key_position <= i.indnkeyatts
      ) AS "keyColumns",
      CASE WHEN i.indpred IS NULL THEN NULL ELSE
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)
          ),
          '[()[:space:]]|::text',
          '',
          'g'
        )
      END AS predicate,
      i.indisvalid AS "isValid",
      i.indisready AS "isReady"
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = 'backend_auth'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint c
        WHERE c.conindid = i.indexrelid
      )
    ORDER BY idx.relname
  `);

  const constraints = await client.query<ConstraintEvidenceRow>(`
    SELECT
      n.nspname AS "schemaName",
      r.relname AS "tableName",
      c.conname AS name,
      c.contype::text AS "constraintType",
      c.condeferrable AS "isDeferrable",
      c.condeferred AS "isDeferred",
      c.convalidated AS "isValidated"
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'backend_auth'
      AND c.contype IN ('p', 'u', 'f', 'c')
    ORDER BY c.conname
  `);

  const keys = await client.query<KeyEvidenceRow>(`
    SELECT
      n.nspname AS "schemaName",
      r.relname AS "tableName",
      c.conname AS name,
      c.contype::text AS "constraintType",
      (
        SELECT pg_catalog.string_agg(
          a.attname,
          ',' ORDER BY key_position
        )
        FROM pg_catalog.unnest(c.conkey)
          WITH ORDINALITY k(attnum, key_position)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid
          AND a.attnum = k.attnum
      ) AS "keyColumns",
      c.condeferrable AS "isDeferrable",
      c.condeferred AS "isDeferred",
      c.convalidated AS "isValidated"
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'backend_auth'
      AND c.contype IN ('p', 'u')
    ORDER BY c.conname
  `);

  const foreignKeys = await client.query<ForeignKeyEvidenceRow>(`
    SELECT
      srcn.nspname AS "schemaName",
      src.relname AS "tableName",
      c.conname AS name,
      'f'::text AS "constraintType",
      (
        SELECT pg_catalog.string_agg(
          a.attname,
          ',' ORDER BY key_position
        )
        FROM pg_catalog.unnest(c.conkey)
          WITH ORDINALITY k(attnum, key_position)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid
          AND a.attnum = k.attnum
      ) AS "sourceColumns",
      dstn.nspname AS "targetSchema",
      dst.relname AS "targetTable",
      (
        SELECT pg_catalog.string_agg(
          a.attname,
          ',' ORDER BY key_position
        )
        FROM pg_catalog.unnest(c.confkey)
          WITH ORDINALITY k(attnum, key_position)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.confrelid
          AND a.attnum = k.attnum
      ) AS "targetColumns",
      c.confmatchtype::text AS "matchType",
      c.confupdtype::text AS "onUpdate",
      c.confdeltype::text AS "onDelete",
      c.condeferrable AS "isDeferrable",
      c.condeferred AS "isDeferred",
      c.convalidated AS "isValidated"
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class src ON src.oid = c.conrelid
    JOIN pg_catalog.pg_namespace srcn
      ON srcn.oid = src.relnamespace
    JOIN pg_catalog.pg_class dst ON dst.oid = c.confrelid
    JOIN pg_catalog.pg_namespace dstn
      ON dstn.oid = dst.relnamespace
    WHERE srcn.nspname = 'backend_auth'
      AND c.contype = 'f'
    ORDER BY c.conname
  `);

  const schemaAcl = await client.query<SchemaAclEvidenceRow>(`
    SELECT
      n.nspname AS "schemaName",
      CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE grantee.rolname
      END AS grantee,
      acl.privilege_type AS "privilegeType",
      acl.is_grantable AS "isGrantable"
    FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee
      ON grantee.oid = acl.grantee
    WHERE n.nspname = 'backend_auth'
      AND (
        acl.grantee = 0
        OR grantee.rolname = 'backend_auth_app'
      )
    ORDER BY 2, acl.privilege_type
  `);

  const tableAcl = await client.query<RelationAclEvidenceRow>(`
    SELECT
      n.nspname AS "schemaName",
      c.relname AS "relationName",
      CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE grantee.rolname
      END AS grantee,
      acl.privilege_type AS "privilegeType",
      acl.is_grantable AS "isGrantable"
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee
      ON grantee.oid = acl.grantee
    WHERE n.nspname = 'backend_auth'
      AND c.relkind = 'r'
      AND (
        acl.grantee = 0
        OR grantee.rolname = 'backend_auth_app'
      )
    ORDER BY c.relname, 3, acl.privilege_type
  `);

  const columnAcl = await client.query<ColumnAclEvidenceRow>(`
    SELECT
      n.nspname AS "schemaName",
      c.relname AS "tableName",
      a.attname AS "columnName",
      CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE grantee.rolname
      END AS grantee,
      acl.privilege_type AS "privilegeType",
      acl.is_grantable AS "isGrantable"
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
    LEFT JOIN pg_catalog.pg_roles grantee
      ON grantee.oid = acl.grantee
    WHERE n.nspname = 'backend_auth'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND (
        acl.grantee = 0
        OR grantee.rolname = 'backend_auth_app'
      )
    ORDER BY c.relname, a.attname, 4, acl.privilege_type
  `);

  const sequenceAcl = await client.query<RelationAclEvidenceRow>(`
    SELECT
      n.nspname AS "schemaName",
      c.relname AS "relationName",
      CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE grantee.rolname
      END AS grantee,
      acl.privilege_type AS "privilegeType",
      acl.is_grantable AS "isGrantable"
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee
      ON grantee.oid = acl.grantee
    WHERE n.nspname = 'backend_auth'
      AND c.relkind = 'S'
      AND (
        acl.grantee = 0
        OR grantee.rolname = 'backend_auth_app'
      )
    ORDER BY c.relname, 3, acl.privilege_type
  `);

  const functionAcl = await client.query<FunctionAclEvidenceRow>(`
    SELECT
      n.nspname AS "schemaName",
      p.proname || '(' ||
        pg_catalog.oidvectortypes(p.proargtypes) || ')' AS
          "functionIdentity",
      CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE grantee.rolname
      END AS grantee,
      acl.privilege_type AS "privilegeType",
      acl.is_grantable AS "isGrantable"
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee
      ON grantee.oid = acl.grantee
    WHERE n.nspname = 'backend_auth'
      AND (
        acl.grantee = 0
        OR grantee.rolname = 'backend_auth_app'
      )
    ORDER BY p.proname, pg_catalog.oidvectortypes(p.proargtypes)
  `);

  const aclValid = await scalar(
    client,
    `
      SELECT coalesce(pg_catalog.bool_and((
        pg_catalog.pg_get_userbyid(n.nspowner) =
          'backend_auth_owner'
        AND NOT pg_catalog.has_schema_privilege(
          current_user,
          'backend_auth',
          'CREATE'
        )
        AND NOT pg_catalog.has_database_privilege(
          current_user,
          pg_catalog.current_database(),
          'CREATE'
        )
        AND (
          SELECT pg_catalog.array_agg(
            acl.privilege_type ORDER BY acl.privilege_type
          )
          FROM pg_catalog.aclexplode(
            coalesce(
              n.nspacl,
              pg_catalog.acldefault('n', n.nspowner)
            )
          ) acl
          WHERE acl.grantee = (
            SELECT r.oid
            FROM pg_catalog.pg_roles r
            WHERE r.rolname = current_user
          )
        ) IS NOT DISTINCT FROM ARRAY['USAGE']::text[]
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            coalesce(
              n.nspacl,
              pg_catalog.acldefault('n', n.nspowner)
            )
          ) acl
          WHERE acl.grantee = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_default_acl d
          JOIN pg_catalog.pg_roles r
            ON r.oid = d.defaclrole
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            d.defaclacl
          ) acl
          WHERE r.rolname = 'backend_auth_owner'
            AND acl.grantee = (
              SELECT app.oid
              FROM pg_catalog.pg_roles app
              WHERE app.rolname = current_user
            )
        )
      )), false) AS value
      FROM pg_catalog.pg_namespace n
      WHERE n.nspname = 'backend_auth'
    `,
  );

  const runtimeBoundaryValid = await scalar(
    client,
    `
      SELECT (
        NOT pg_catalog.pg_has_role(
          current_user,
          'backend_auth_owner',
          'MEMBER'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n
            ON n.oid = c.relnamespace
          WHERE n.nspname = 'backend_auth'
            AND c.relkind IN ('r', 'i', 'S')
            AND pg_catalog.pg_get_userbyid(c.relowner) <>
              'backend_auth_owner'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n
            ON n.oid = c.relnamespace
          WHERE n.nspname = 'backend_auth'
            AND c.relkind = 'r'
            AND (
              (
                SELECT pg_catalog.array_agg(
                  acl.privilege_type
                  ORDER BY acl.privilege_type
                )
                FROM pg_catalog.aclexplode(
                  coalesce(
                    c.relacl,
                    pg_catalog.acldefault('r', c.relowner)
                  )
                ) acl
                WHERE acl.grantee = (
                  SELECT app.oid
                  FROM pg_catalog.pg_roles app
                  WHERE app.rolname = current_user
                )
              ) IS DISTINCT FROM ARRAY['SELECT']::text[]
              OR NOT pg_catalog.has_table_privilege(
                current_user,
                c.oid,
                'SELECT'
              )
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.unnest(
                  ARRAY[
                    'INSERT',
                    'UPDATE',
                    'DELETE',
                    'TRUNCATE',
                    'REFERENCES',
                    'TRIGGER'
                  ]::text[]
                ) privilege(name)
                WHERE pg_catalog.has_table_privilege(
                  current_user,
                  c.oid,
                  privilege.name
                )
              )
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.aclexplode(
                  coalesce(
                    c.relacl,
                    pg_catalog.acldefault('r', c.relowner)
                  )
                ) acl
                WHERE acl.grantee = 0
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute a
          JOIN pg_catalog.pg_class c
            ON c.oid = a.attrelid
          JOIN pg_catalog.pg_namespace n
            ON n.oid = c.relnamespace
          CROSS JOIN LATERAL pg_catalog.unnest(
            ARRAY['INSERT', 'UPDATE', 'REFERENCES']::text[]
          ) privilege(name)
          WHERE n.nspname = 'backend_auth'
            AND c.relkind = 'r'
            AND a.attnum > 0
            AND NOT a.attisdropped
            AND (
              pg_catalog.has_column_privilege(
                current_user,
                c.oid,
                a.attnum,
                privilege.name
              ) IS DISTINCT FROM EXISTS (
                SELECT 1
                FROM pg_catalog.aclexplode(a.attacl) acl
                WHERE acl.grantee = (
                    SELECT app.oid
                    FROM pg_catalog.pg_roles app
                    WHERE app.rolname = current_user
                  )
                  AND acl.privilege_type = privilege.name
              )
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.aclexplode(a.attacl) acl
                WHERE acl.grantee = 0
              )
            )
        )
      ) AS value
    `,
  );

  const sequenceValid = await scalar(
    client,
    `
      SELECT (
        (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_class s
          JOIN pg_catalog.pg_namespace n
            ON n.oid = s.relnamespace
          WHERE n.nspname = 'backend_auth'
            AND s.relkind = 'S'
        ) = 1
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class s
          JOIN pg_catalog.pg_namespace n
            ON n.oid = s.relnamespace
          WHERE n.nspname = 'backend_auth'
            AND s.relname =
              'security_audit_events_event_order_seq'
            AND s.relkind = 'S'
            AND pg_catalog.obj_description(
              s.oid,
              'pg_class'
            ) =
              '015_backend_auth_foundation:audit_storage_order'
            AND pg_catalog.pg_get_userbyid(s.relowner) =
              'backend_auth_owner'
            AND pg_catalog.has_sequence_privilege(
              current_user,
              s.oid,
              'USAGE'
            )
            AND NOT pg_catalog.has_sequence_privilege(
              current_user,
              s.oid,
              'SELECT'
            )
            AND NOT pg_catalog.has_sequence_privilege(
              current_user,
              s.oid,
              'UPDATE'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_catalog.aclexplode(
                coalesce(
                  s.relacl,
                  pg_catalog.acldefault('S', s.relowner)
                )
              ) acl
              WHERE acl.grantee = 0
            )
            AND (
              SELECT pg_catalog.array_agg(
                acl.privilege_type
                ORDER BY acl.privilege_type
              )
              FROM pg_catalog.aclexplode(
                coalesce(
                  s.relacl,
                  pg_catalog.acldefault('S', s.relowner)
                )
              ) acl
              WHERE acl.grantee = (
                SELECT app.oid
                FROM pg_catalog.pg_roles app
                WHERE app.rolname = current_user
              )
            ) IS NOT DISTINCT FROM ARRAY['USAGE']::text[]
            AND EXISTS (
              SELECT 1
              FROM pg_catalog.pg_depend d
              JOIN pg_catalog.pg_attribute a
                ON a.attrelid = d.refobjid
                AND a.attnum = d.refobjsubid
              WHERE d.classid =
                  'pg_catalog.pg_class'::pg_catalog.regclass
                AND d.objid = s.oid
                AND d.refclassid =
                  'pg_catalog.pg_class'::pg_catalog.regclass
                AND d.refobjid =
                  'backend_auth.security_audit_events'::pg_catalog.regclass
                AND a.attname = 'event_order'
                AND d.deptype = 'i'
            )
        )
      ) AS value
    `,
  );

  const semanticFunctionsValid = await scalar(
    client,
    `
      SELECT (
        pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef(
            'backend_auth.assert_session_consistency()'
              ::pg_catalog.regprocedure
          )),
          'ordered_rotation.result_type = ''credential_rotated'''
        ) > 0
        AND pg_catalog.strpos(
          pg_catalog.lower(pg_catalog.pg_get_functiondef(
            'backend_auth.assert_session_consistency()'
              ::pg_catalog.regprocedure
          )),
          'ordered_rotation.command_sequence <= c.command_sequence'
        ) > 0
        AND NOT EXISTS (
          WITH ordinary_functions AS MATERIALIZED (
            SELECT p.oid
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n
              ON n.oid = p.pronamespace
            WHERE n.nspname = 'backend_auth'
              AND p.prokind = 'f'
          )
          SELECT 1
          FROM ordinary_functions f
          WHERE pg_catalog.strpos(
              pg_catalog.lower(
                pg_catalog.pg_get_functiondef(f.oid)
              ),
              'auth.uid()'
            ) > 0
            OR pg_catalog.strpos(
              pg_catalog.lower(
                pg_catalog.pg_get_functiondef(f.oid)
              ),
              'supabase'
            ) > 0
        )
      ) AS value
    `,
  );

  return {
    tables: tables.rows,
    columns: columns.rows,
    functions: functions.rows,
    triggers: triggers.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    keys: keys.rows,
    foreignKeys: foreignKeys.rows,
    schemaAcl: schemaAcl.rows,
    tableAcl: tableAcl.rows,
    columnAcl: columnAcl.rows,
    sequenceAcl: sequenceAcl.rows,
    functionAcl: functionAcl.rows,
    aclValid:
      aclValid === true && runtimeBoundaryValid === true,
    sequenceValid,
    semanticFunctionsValid,
  };
}

async function verifyCatalog(client: PoolClient): Promise<void> {
  const evidence = await readCatalogEvidence(client);
  if (!isValidAuthIntegrationCatalogEvidence(evidence)) {
    throw failure('not_provisioned');
  }
}

async function verifyDatabase(
  client: PoolClient,
  environment: AuthIntegrationEnvironment,
): Promise<void> {
  const databaseName = await scalar(
    client,
    'SELECT pg_catalog.current_database() AS value',
  );
  const currentUser = await scalar(
    client,
    'SELECT current_user AS value',
  );
  const isSuperuser = await scalar(
    client,
    "SELECT pg_catalog.current_setting('is_superuser') AS value",
  );
  const versionResult = await client.query<
    QueryResultRow & {
      readonly version_text: unknown;
      readonly version_number: unknown;
    }
  >(`
    SELECT
      pg_catalog.version() AS version_text,
      pg_catalog.current_setting('server_version_num') AS version_number
  `);

  if (
    databaseName !== environment.expectedDatabaseName ||
    currentUser !== EXPECTED_APPLICATION_ROLE ||
    isSuperuser !== 'off' ||
    versionResult.rows.length !== 1 ||
    typeof versionResult.rows[0].version_text !== 'string' ||
    versionResult.rows[0].version_text.length === 0 ||
    typeof versionResult.rows[0].version_number !== 'string' ||
    !/^[0-9]+$/u.test(versionResult.rows[0].version_number) ||
    Number(versionResult.rows[0].version_number) <
      MINIMUM_POSTGRES_VERSION
  ) {
    throw failure('unsafe_database');
  }

  await verifyCatalog(client);
}

export async function openGuardedAuthIntegrationDatabase(
  source: AuthIntegrationEnvironmentSource = process.env,
  postgresFactory: AuthIntegrationPostgresFactory =
    createAuthIntegrationPostgresService,
): Promise<GuardedAuthIntegrationDatabase> {
  const environment = readAuthIntegrationEnvironment(source);
  const postgres = postgresFactory(environment.databaseUrl);
  let client: PoolClient | undefined;

  try {
    const pool = postgres.getPool();
    client = await pool.connect();
    await verifyDatabase(client, environment);
    client.release();
    client = undefined;

    return Object.freeze({
      environment,
      postgres,
      pool,
      close: async () => {
        try {
          await postgres.onApplicationShutdown();
        } catch {
          throw failure('database_check_failed');
        }
      },
    });
  } catch (error) {
    try {
      client?.release();
    } catch {
      // Pool shutdown below remains the authoritative cleanup path.
    }
    try {
      await postgres.onApplicationShutdown();
    } catch {
      // The fixed guard error below intentionally hides close failures.
    }
    if (error instanceof AuthIntegrationGuardError) {
      throw error;
    }
    throw failure('database_check_failed');
  }
}
