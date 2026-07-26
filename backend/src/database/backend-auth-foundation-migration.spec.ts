import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTH_INTEGRATION_EXPECTED_COLUMNS } from '../../test/auth-integration/auth-integration.postcheck-inventory';

type TriggerOperation = 'INSERT' | 'UPDATE' | 'DELETE';

interface ParsedSelectorBranch {
  readonly table: string;
  readonly oldField: string;
  readonly newField: string;
}

interface ParsedScalarSelector {
  readonly branches: readonly ParsedSelectorBranch[];
  readonly sqlState: string;
  readonly errorMessage: string;
}

interface ScalarSelectorExpectation {
  readonly functionName: string;
  readonly targetVariable: string;
  readonly errorMessage: string;
  readonly tables: readonly Readonly<{
    table: string;
    field: string;
  }>[];
}

const MIGRATION_SQL = readFileSync(
  resolve(
    __dirname,
    '../../../docs/migrations/015_backend_auth_foundation.sql',
  ),
  'utf8',
);

const POSTCHECK_SQL = readFileSync(
  resolve(
    __dirname,
    '../../../docs/migrations/015_backend_auth_foundation_POSTCHECK.sql',
  ),
  'utf8',
);

const SCALAR_SELECTORS: readonly ScalarSelectorExpectation[] = [
  {
    functionName: 'assert_player_profile_consistency',
    targetVariable: 'v_account_id',
    errorMessage: 'BACKEND_AUTH_PLAYER_PROFILE_TRIGGER_TABLE_INVALID',
    tables: [
      { table: 'accounts', field: 'id' },
      { table: 'player_profiles', field: 'account_id' },
    ],
  },
  {
    functionName: 'assert_external_identity_aliases',
    targetVariable: 'v_identity_id',
    errorMessage: 'BACKEND_AUTH_IDENTITY_ALIAS_TRIGGER_TABLE_INVALID',
    tables: [
      { table: 'external_identities', field: 'id' },
      {
        table: 'external_identity_lookup_digests',
        field: 'identity_id',
      },
    ],
  },
  {
    functionName: 'assert_session_consistency',
    targetVariable: 'v_family_id',
    errorMessage: 'BACKEND_AUTH_SESSION_TRIGGER_TABLE_INVALID',
    tables: [
      { table: 'auth_session_families', field: 'id' },
      { table: 'auth_session_credentials', field: 'family_id' },
      { table: 'auth_session_commands', field: 'family_id' },
    ],
  },
  {
    functionName: 'assert_otp_consistency',
    targetVariable: 'v_challenge_id',
    errorMessage: 'BACKEND_AUTH_OTP_TRIGGER_TABLE_INVALID',
    tables: [
      { table: 'otp_challenges', field: 'id' },
      { table: 'otp_commands', field: 'challenge_id' },
    ],
  },
] as const;

const SHARED_CONSTRAINT_TRIGGER_TABLES = {
  assert_player_profile_consistency: ['accounts', 'player_profiles'],
  assert_external_identity_aliases: [
    'external_identities',
    'external_identity_lookup_digests',
  ],
  assert_active_account_has_login_method: [
    'accounts',
    'external_identities',
  ],
  assert_authentication_proof_binding: [
    'authentication_operations',
    'telegram_proof_consumptions',
    'otp_challenges',
  ],
  assert_session_consistency: [
    'auth_session_families',
    'auth_session_credentials',
    'auth_session_commands',
  ],
  assert_otp_consistency: ['otp_challenges', 'otp_commands'],
} as const;

const TRIGGER_OPERATIONS: readonly TriggerOperation[] = [
  'INSERT',
  'UPDATE',
  'DELETE',
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function functionBody(
  functionName: string,
  migrationSql: string = MIGRATION_SQL,
): string {
  const match = new RegExp(
    String.raw`create function backend_auth\.${escapeRegex(
      functionName,
    )}\(\)[\s\S]*?\bas \$\$([\s\S]*?)\$\$;`,
    'iu',
  ).exec(migrationSql);
  if (match === null) {
    throw new Error('Expected migration 015 trigger function');
  }
  return match[1];
}

function stripSqlComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/--[^\r\n]*/gu, '');
}

function compactExecutableSql(value: string): string {
  return stripSqlComments(value).replace(/\s+/gu, '');
}

function countOccurrences(value: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let offset = 0;
  while (offset < value.length) {
    const next = value.indexOf(needle, offset);
    if (next < 0) {
      return count;
    }
    count += 1;
    offset = next + needle.length;
  }
  return count;
}

function renderScalarSelector(expectation: ScalarSelectorExpectation): string {
  const branches = expectation.tables
    .map(
      ({ table, field }, index) => `
${index === 0 ? 'if' : 'elsif'} tg_table_name = '${table}' then
  if tg_op = 'DELETE' then
    ${expectation.targetVariable} := old.${field};
  else
    ${expectation.targetVariable} := new.${field};
  end if;`,
    )
    .join('');

  return `${branches}
else
  raise exception using errcode = '55000', message = '${expectation.errorMessage}';
end if;`;
}

function parsePostcheckSelector(
  expectation: ScalarSelectorExpectation,
): Readonly<{
  selector: string;
  errorMessage: string;
  stripsBlockComments: boolean;
  stripsLineComments: boolean;
  removesWhitespace: boolean;
  checksExactMessage: boolean;
}> {
  const regprocedure =
    `'backend_auth.${expectation.functionName}()'` +
    '::pg_catalog.regprocedure';
  const block = POSTCHECK_SQL.split(
    /(?=\n  select pg_catalog\.regexp_replace\()/gu,
  ).find(
    (candidate) =>
      candidate.includes(regprocedure) &&
      candidate.includes('v_expected_selector :='),
  );
  if (block === undefined) {
    throw new Error('Expected POSTCHECK shared trigger selector');
  }

  const selectorExpression =
    /v_expected_selector\s*:=([\s\S]*?)\n\s*if pg_catalog\.strpos/iu.exec(
      block,
    )?.[1];
  const errorMessage =
    /v_expected_error_message\s*:=\s*'([^']+)';/iu.exec(block)?.[1];
  if (selectorExpression === undefined || errorMessage === undefined) {
    throw new Error('Expected POSTCHECK selector constants');
  }

  const selector = [...selectorExpression.matchAll(/'((?:''|[^'])*)'/gu)]
    .map((match) => match[1].replace(/''/gu, "'"))
    .join('');

  return {
    selector,
    errorMessage,
    stripsBlockComments: block.includes("'/\\*.*?\\*/'"),
    stripsLineComments: block.includes("'--[^\\r\\n]*'"),
    removesWhitespace: block.includes("'[[:space:]]+'"),
    checksExactMessage:
      block.includes('pg_catalog.quote_literal(v_expected_error_message)') &&
      block.includes('pg_catalog.replace('),
  };
}

function parseScalarSelector(
  expectation: ScalarSelectorExpectation,
  migrationSql: string = MIGRATION_SQL,
): ParsedScalarSelector {
  const body = stripSqlComments(
    functionBody(expectation.functionName, migrationSql),
  );
  const compactBody = compactExecutableSql(body);
  const compactBodyLower = compactBody.toLowerCase();
  const target = escapeRegex(expectation.targetVariable);
  if (
    compactBodyLower.includes(
      `${expectation.targetVariable.toLowerCase()}:=case`,
    )
  ) {
    throw new Error('Shared trigger selector must not use one CASE');
  }

  const expectedSelector = compactExecutableSql(
    renderScalarSelector(expectation),
  );
  const expectedSelectorLower = expectedSelector.toLowerCase();
  const selectorOffset = compactBodyLower.indexOf(expectedSelectorLower);
  if (selectorOffset < 0) {
    throw new Error('Expected executable shared trigger selector');
  }

  const expectedMessageLower = expectation.errorMessage.toLowerCase();
  if (
    countOccurrences(compactBodyLower, expectedMessageLower) !== 1 ||
    !compactBody.includes(`'${expectation.errorMessage}'`)
  ) {
    throw new Error('Expected exact shared trigger fail-closed error');
  }

  const selectorBlock = compactBody.slice(
    selectorOffset,
    selectorOffset + expectedSelector.length,
  );
  const failClosed = /elseraiseexceptionusingerrcode='([^']+)',message='([^']+)';endif;$/u.exec(
    selectorBlock,
  );
  if (failClosed === null) {
    throw new Error('Expected shared trigger fail-closed branch');
  }

  const branchPattern = new RegExp(
    String.raw`(?:if|elsif)\s+tg_table_name\s*=\s*'([a-z0-9_]+)'\s+then\s+` +
      String.raw`if\s+tg_op\s*=\s*'DELETE'\s+then\s+` +
      String.raw`${target}\s*:=\s*old\.([a-z0-9_]+);\s+else\s+` +
      String.raw`${target}\s*:=\s*new\.([a-z0-9_]+);\s+end if;`,
    'giu',
  );

  return {
    branches: [...body.matchAll(branchPattern)].map((match) => ({
      table: match[1],
      oldField: match[2],
      newField: match[3],
    })),
    sqlState: failClosed[1],
    errorMessage: failClosed[2],
  };
}

function expectedColumnsByTable(): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  for (const column of AUTH_INTEGRATION_EXPECTED_COLUMNS) {
    const [, table, , columnName] = column;
    const columns = result.get(table) ?? new Set<string>();
    columns.add(columnName);
    result.set(table, columns);
  }
  return result;
}

interface ParsedConstraintTrigger {
  readonly functionName: string;
  readonly table: string;
  readonly operations: readonly string[];
}

function constraintTriggers(): readonly ParsedConstraintTrigger[] {
  const pattern =
    /create constraint trigger\s+[a-z0-9_]+\s+after\s+([a-z\s]+?)\s+on\s+backend_auth\.([a-z0-9_]+)\s+deferrable\s+initially\s+deferred\s+for each row execute function backend_auth\.([a-z0-9_]+)\(\);/giu;

  return [...MIGRATION_SQL.matchAll(pattern)].map((match) => ({
    operations: match[1]
      .trim()
      .split(/\s+or\s+/u)
      .map((operation) => operation.toUpperCase()),
    table: match[2],
    functionName: match[3],
  }));
}

describe('migration 015 shared constraint trigger row shapes', () => {
  const columnsByTable = expectedColumnsByTable();

  it.each(SCALAR_SELECTORS)(
    '$functionName POSTCHECK validates the normalized executable selector',
    (expectation) => {
      const parsed = parsePostcheckSelector(expectation);

      expect(parsed).toEqual({
        selector: compactExecutableSql(
          renderScalarSelector(expectation),
        ).toLowerCase(),
        errorMessage: expectation.errorMessage,
        stripsBlockComments: true,
        stripsLineComments: true,
        removesWhitespace: true,
        checksExactMessage: true,
      });
    },
  );

  it.each(SCALAR_SELECTORS)(
    '$functionName isolates each table row shape in its own PL/pgSQL branch',
    (expectation) => {
      expect(parseScalarSelector(expectation).branches).toEqual(
        expectation.tables.map(({ table, field }) => ({
          table,
          oldField: field,
          newField: field,
        })),
      );
    },
  );

  it.each(SCALAR_SELECTORS)(
    '$functionName fails closed for an unexpected trigger table',
    (expectation) => {
      const parsed = parseScalarSelector(expectation);

      expect({
        sqlState: parsed.sqlState,
        errorMessage: parsed.errorMessage,
      }).toEqual({
        sqlState: '55000',
        errorMessage: expectation.errorMessage,
      });
    },
  );

  it.each(SCALAR_SELECTORS)(
    '$functionName cannot satisfy its selector with comments',
    (expectation) => {
      const selector = renderScalarSelector(expectation);
      const lineCommentedSelector = selector
        .split(/\r?\n/gu)
        .map((line) => `-- ${line}`)
        .join('\n');
      const migrationWithCommentOnlySelector = `
create function backend_auth.${expectation.functionName}()
returns trigger
language plpgsql
as $$
begin
${lineCommentedSelector}
/* ${selector} */
return null;
end;
$$;
`;

      expect(() =>
        parseScalarSelector(expectation, migrationWithCommentOnlySelector),
      ).toThrow('Expected executable shared trigger selector');
    },
  );

  it.each(SCALAR_SELECTORS)(
    '$functionName rejects the former cross-row assignment CASE',
    (expectation) => {
      const firstField = expectation.tables[0].field;
      const migrationWithUnsafeCase = `
create function backend_auth.${expectation.functionName}()
returns trigger
language plpgsql
as $$
begin
${expectation.targetVariable} := case
  when tg_op = 'DELETE' then old.${firstField}
  else new.${firstField}
end;
return null;
end;
$$;
`;

      expect(() =>
        parseScalarSelector(expectation, migrationWithUnsafeCase),
      ).toThrow('Shared trigger selector must not use one CASE');
    },
  );

  it.each(SCALAR_SELECTORS)(
    '$functionName selector is insensitive to CRLF and ordinary whitespace',
    (expectation) => {
      const reformattedMigration = MIGRATION_SQL.replace(
        /\r?\n[ \t]*/gu,
        '\r\n\t',
      );

      const parsed = parseScalarSelector(expectation, reformattedMigration);
      expect({
        branches: parsed.branches,
        sqlState: parsed.sqlState,
        errorMessage: parsed.errorMessage,
      }).toEqual({
        branches: expectation.tables.map(({ table, field }) => ({
          table,
          oldField: field,
          newField: field,
        })),
        sqlState: '55000',
        errorMessage: expectation.errorMessage,
      });
    },
  );

  const selectorCases = SCALAR_SELECTORS.flatMap((expectation) =>
    expectation.tables.flatMap(({ table, field }) =>
      TRIGGER_OPERATIONS.map((operation) => ({
        expectation,
        functionName: expectation.functionName,
        table,
        field,
        operation,
      })),
    ),
  );

  it.each(selectorCases)(
    '$functionName resolves $table $operation through a valid row field',
    ({ expectation, table, field, operation }) => {
      const branches = parseScalarSelector(expectation).branches;
      const branch = branches.find((candidate) => candidate.table === table);
      const record = operation === 'DELETE' ? 'old' : 'new';
      const resolvedField =
        record === 'old' ? branch?.oldField : branch?.newField;

      expect({
        record,
        field: resolvedField,
        fieldExists: columnsByTable.get(table)?.has(resolvedField ?? ''),
      }).toEqual({
        record,
        field,
        fieldExists: true,
      });
    },
  );

  it('keeps every shared cross-row trigger deferred for all operations', () => {
    const parsed = constraintTriggers();

    for (const [functionName, expectedTables] of Object.entries(
      SHARED_CONSTRAINT_TRIGGER_TABLES,
    )) {
      const triggers = parsed
        .filter((trigger) => trigger.functionName === functionName)
        .map(({ table, operations }) => ({
          table,
          operations: [...operations].sort(),
        }))
        .sort((left, right) => left.table.localeCompare(right.table));

      expect(triggers).toEqual(
        expectedTables
          .map((table) => ({
            table,
            operations: [...TRIGGER_OPERATIONS].sort(),
          }))
          .sort((left, right) => left.table.localeCompare(right.table)),
      );
    }
  });
});
