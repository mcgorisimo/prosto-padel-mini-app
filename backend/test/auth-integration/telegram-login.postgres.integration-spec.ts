import { createHash } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { QueryResultRow } from 'pg';
import {
  TELEGRAM_LOGIN_HTTP_CLOCK,
  TelegramLoginHttpClock,
} from '../../src/auth/telegram-login.http';
import {
  TELEGRAM_LOGIN_FEATURE,
  TelegramLoginFeature,
} from '../../src/auth/telegram-login.feature';
import { TelegramLoginController } from '../../src/auth/telegram-login.controller';
import { TelegramLoginResult } from '../../src/auth/telegram-login.types';
import {
  AuthIntegrationHarness,
  openAuthIntegrationHarness,
} from './auth-integration.fixture';
import { runWithAuthIntegrationCleanup } from './auth-integration.lifecycle';

interface CountRow extends QueryResultRow {
  readonly count: string;
}

interface AccountIdentityRow extends QueryResultRow {
  readonly identity_id: string;
  readonly account_id: string;
  readonly account_status: string;
  readonly profile_account_id: string | null;
}

interface OperationRow extends QueryResultRow {
  readonly status: string;
  readonly resolution_type: string | null;
  readonly resolution_initial_role: string | null;
  readonly idempotency_key: string;
  readonly request_digest: string;
}

interface CredentialRow extends QueryResultRow {
  readonly family_id: string;
  readonly generation: string;
  readonly digest: Buffer;
  readonly consumed_at: string | null;
}

interface AuditRow extends QueryResultRow {
  readonly event_type: string;
  readonly outcome: string;
}

function safeLoginResult(
  result: TelegramLoginResult,
): Readonly<Record<string, unknown>> {
  return result.outcome === 'authenticated'
    ? Object.freeze({
        outcome: result.outcome,
        accountKind: result.accountKind,
        expiresAt: result.expiresAt,
      })
    : Object.freeze({
        outcome: result.outcome,
        reason: result.reason,
      });
}

function isCanonicalSessionCredential(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value);
}

async function count(
  harness: AuthIntegrationHarness,
  text: string,
  values: readonly unknown[],
): Promise<number> {
  const result = await harness.query<CountRow>(text, values);
  expect(result.rows).toHaveLength(1);
  return Number(result.rows[0].count);
}

describe('Telegram login PostgreSQL integration', () => {
  let harness: AuthIntegrationHarness;

  beforeAll(async () => {
    harness = await openAuthIntegrationHarness();
  });

  afterAll(async () => {
    if (harness !== undefined) {
      await harness.close();
    }
  });

  it('persists the complete new-user workflow and no plaintext credential', async () => {
    const prepared = await harness.prepareLogin({
      subjectLabel: 'new-user',
      proofLabel: 'new-user-proof',
    });

    const result =
      await harness.graph.service.authenticateWithTelegram({
        rawInitData: prepared.rawInitData,
        requestKey: prepared.requestKey,
        now: prepared.now,
      });

    expect(safeLoginResult(result)).toEqual({
      outcome: 'authenticated',
      accountKind: 'new',
      expiresAt: prepared.bindings.timestamps.sessionExpiresAt,
    });
    if (result.outcome !== 'authenticated') {
      throw new Error('Expected authenticated integration result');
    }

    const identity = await harness.query<AccountIdentityRow>(
      `
        SELECT
          i.id AS identity_id,
          i.account_id,
          a.status AS account_status,
          p.account_id AS profile_account_id
        FROM backend_auth.external_identities i
        JOIN backend_auth.accounts a ON a.id = i.account_id
        LEFT JOIN backend_auth.player_profiles p
          ON p.account_id = i.account_id
        WHERE i.id = $1
          AND i.provider = 'telegram'
          AND i.status = 'linked'
          AND i.is_primary = TRUE
      `,
      [prepared.bindings.identityId],
    );
    expect(identity.rows).toEqual([
      {
        identity_id: prepared.bindings.identityId,
        account_id: prepared.bindings.accountId,
        account_status: 'active',
        profile_account_id: prepared.bindings.accountId,
      },
    ]);

    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.external_identity_lookup_digests
          WHERE identity_id = $1
        `,
        [prepared.bindings.identityId],
      ),
    ).toBe(prepared.digests.all.length);

    const operation = await harness.query<OperationRow>(
      `
        SELECT
          status,
          resolution_type,
          resolution_initial_role,
          idempotency_key,
          request_digest
        FROM backend_auth.authentication_operations
        WHERE id = $1
      `,
      [prepared.bindings.operationId],
    );
    expect(operation.rows).toEqual([
      {
        status: 'completed',
        resolution_type: 'new_account_required',
        resolution_initial_role: 'player',
        idempotency_key: prepared.bindings.idempotencyKey,
        request_digest: prepared.bindings.requestDigest,
      },
    ]);
    expect(
      Object.values(operation.rows[0]).includes(result.credential),
    ).toBe(false);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.telegram_proof_consumptions
          WHERE operation_id = $1
        `,
        [prepared.bindings.operationId],
      ),
    ).toBe(1);

    const credential = await harness.query<CredentialRow>(
      `
        SELECT
          c.family_id,
          c.generation::text,
          c.digest,
          c.consumed_at::text
        FROM backend_auth.auth_session_credentials c
        JOIN backend_auth.auth_session_families f
          ON f.id = c.family_id
        WHERE f.authentication_operation_id = $1
          AND f.status = 'active'
      `,
      [prepared.bindings.operationId],
    );
    const expectedDigest = createHash('sha256')
      .update(result.credential, 'utf8')
      .digest();
    expect(credential.rows).toHaveLength(1);
    expect(credential.rows[0]).toMatchObject({
      family_id: prepared.bindings.sessionId,
      generation: '1',
      consumed_at: null,
    });
    expect(credential.rows[0].digest.equals(expectedDigest)).toBe(true);
    expect(
      credential.rows[0].digest.equals(
        Buffer.from(result.credential, 'utf8'),
      ),
    ).toBe(false);

    const audit = await harness.query<AuditRow>(
      `
        SELECT event_type, outcome
        FROM backend_auth.security_audit_events
        WHERE event_id = ANY($1::uuid[])
        ORDER BY event_order
      `,
      [Object.values(prepared.bindings.auditEventIds)],
    );
    expect(audit.rows).toEqual([
      { event_type: 'telegram_proof_consumption', outcome: 'success' },
      { event_type: 'account_created', outcome: 'success' },
      { event_type: 'external_identity_linked', outcome: 'success' },
      {
        event_type: 'authentication_operation_terminal',
        outcome: 'success',
      },
      { event_type: 'session_family_created', outcome: 'success' },
    ]);
  });

  it('reuses the existing account for a fresh proof and creates a new session', async () => {
    const first = await harness.prepareLogin({
      subjectLabel: 'existing-user',
      proofLabel: 'existing-user-first-proof',
    });
    const firstResult =
      await harness.graph.service.authenticateWithTelegram({
        rawInitData: first.rawInitData,
        requestKey: first.requestKey,
        now: first.now,
      });
    expect(safeLoginResult(firstResult)).toEqual({
      outcome: 'authenticated',
      accountKind: 'new',
      expiresAt: first.bindings.timestamps.sessionExpiresAt,
    });

    const second = await harness.prepareLogin({
      subjectLabel: 'existing-user',
      proofLabel: 'existing-user-second-proof',
    });
    const secondResult =
      await harness.graph.service.authenticateWithTelegram({
        rawInitData: second.rawInitData,
        requestKey: second.requestKey,
        now: second.now,
      });
    expect(safeLoginResult(secondResult)).toEqual({
      outcome: 'authenticated',
      accountKind: 'existing',
      expiresAt: second.bindings.timestamps.sessionExpiresAt,
    });

    const identity = await harness.query<AccountIdentityRow>(
      `
        SELECT
          i.id AS identity_id,
          i.account_id,
          a.status AS account_status,
          p.account_id AS profile_account_id
        FROM backend_auth.external_identity_lookup_digests d
        JOIN backend_auth.external_identities i
          ON i.id = d.identity_id
        JOIN backend_auth.accounts a ON a.id = i.account_id
        LEFT JOIN backend_auth.player_profiles p
          ON p.account_id = i.account_id
        WHERE d.provider = $1
          AND d.namespace = $2
          AND d.digest = $3
      `,
      [
        first.digests.primary.provider,
        first.digests.primary.namespace,
        Buffer.from(first.digests.primary.digest, 'hex'),
      ],
    );
    expect(identity.rows).toHaveLength(1);
    expect(identity.rows[0].account_id).toBe(first.bindings.accountId);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.accounts
          WHERE id = $1
        `,
        [second.bindings.accountId],
      ),
    ).toBe(0);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.auth_session_families
          WHERE account_id = $1
            AND authentication_operation_id = ANY($2::uuid[])
        `,
        [
          first.bindings.accountId,
          [first.bindings.operationId, second.bindings.operationId],
        ],
      ),
    ).toBe(2);
  });

  it('rolls provisioning and its audit rows back with the transaction', async () => {
    const prepared = await harness.prepareLogin({
      subjectLabel: 'rollback-user',
      proofLabel: 'rollback-proof',
    });
    const sentinel = new Error('auth integration rollback sentinel');

    await expect(
      harness.graph.transactions.run(async (transaction) => {
        const provisioned = await harness.provisionAccount(
          transaction,
          prepared,
        );
        expect(provisioned).toMatchObject({
          outcome: 'created',
          accountId: prepared.bindings.accountId,
        });
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);

    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.accounts
          WHERE id = $1
        `,
        [prepared.bindings.accountId],
      ),
    ).toBe(0);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.player_profiles
          WHERE account_id = $1
        `,
        [prepared.bindings.accountId],
      ),
    ).toBe(0);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.external_identities
          WHERE id = $1
        `,
        [prepared.bindings.identityId],
      ),
    ).toBe(0);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.external_identity_lookup_digests
          WHERE identity_id = $1
        `,
        [prepared.bindings.identityId],
      ),
    ).toBe(0);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.security_audit_events
          WHERE event_id = ANY($1::uuid[])
        `,
        [
          [
            prepared.bindings.auditEventIds.accountCreated,
            prepared.bindings.auditEventIds.externalIdentityLinked,
          ],
        ],
      ),
    ).toBe(0);
  });

  it('serves the real workflow through Fastify inject without exposing the credential', async () => {
    const prepared = await harness.prepareLogin({
      subjectLabel: 'http-user',
      proofLabel: 'http-proof',
    });
    const feature: TelegramLoginFeature = Object.freeze({
      enabled: true,
      service: harness.graph.service,
    });
    const clock: TelegramLoginHttpClock = {
      nowEpochSeconds: () => prepared.now,
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramLoginController],
      providers: [
        { provide: TELEGRAM_LOGIN_FEATURE, useValue: feature },
        { provide: TELEGRAM_LOGIN_HTTP_CLOCK, useValue: clock },
      ],
    }).compile();
    await runWithAuthIntegrationCleanup(async (registerCleanup) => {
      const app =
        moduleRef.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter(),
        );
      registerCleanup(async () => app.close());
      await app.register(fastifyCookie);
      app.setGlobalPrefix('api/v1');
      await app.init();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram/login',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': prepared.requestKey,
        },
        payload: { initData: prepared.rawInitData },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      const responseBody = response.json<unknown>();
      const isResponseObject =
        typeof responseBody === 'object' &&
        responseBody !== null &&
        !Array.isArray(responseBody);
      expect(isResponseObject).toBe(true);
      if (!isResponseObject) {
        throw new Error(
          'Auth integration HTTP response shape is invalid',
        );
      }
      const responseRecord = responseBody as Record<string, unknown>;
      expect(responseRecord.authenticated === true).toBe(true);
      expect(
        responseRecord.sessionExpiresAt ===
          prepared.bindings.timestamps.sessionExpiresAt,
      ).toBe(true);
      expect(Object.keys(responseRecord).sort()).toEqual([
        'authenticated',
        'sessionExpiresAt',
      ]);
      const setCookie = response.headers['set-cookie'];
      expect(typeof setCookie).toBe('string');
      const cookiePair = (setCookie as string).split(';', 1)[0];
      const [cookieName, credential] = cookiePair.split('=', 2);
      expect(cookieName).toBe('__Host-prosto_padel_session');
      expect(typeof credential === 'string').toBe(true);
      if (credential === undefined) {
        throw new Error('Auth integration session cookie is missing');
      }
      expect(isCanonicalSessionCredential(credential)).toBe(true);
      expect(response.body.includes(credential)).toBe(false);
      expect(response.body.includes(prepared.rawInitData)).toBe(false);

      const persisted = await harness.query<CredentialRow>(
        `
          SELECT
            c.family_id,
            c.generation::text,
            c.digest,
            c.consumed_at::text
          FROM backend_auth.auth_session_credentials c
          WHERE c.family_id = $1
            AND c.generation = 1
        `,
        [prepared.bindings.sessionId],
      );
      expect(persisted.rows).toHaveLength(1);
      expect(
        persisted.rows[0].digest.equals(
          createHash('sha256')
            .update(credential, 'utf8')
            .digest(),
        ),
      ).toBe(true);
    });
  });
});
