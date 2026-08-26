import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { PlayerOnboardingController } from './player-onboarding.controller';
import { PlayerOnboardingService } from './player-onboarding.service';
import {
  AcceptOwnPlayerOnboardingLegalPolicyInput,
  AcceptOwnPlayerOnboardingLegalPolicyResult,
  AdvanceOwnPlayerOnboardingInput,
  AdvanceOwnPlayerOnboardingResult,
  CompleteOwnPlayerOnboardingInput,
  CompleteOwnPlayerOnboardingResult,
  OwnPlayerOnboarding,
  OwnPlayerOnboardingResponse,
  ReadOwnPlayerOnboardingResult,
  SaveOwnPlayerOnboardingDraftInput,
  SaveOwnPlayerOnboardingDraftResult,
} from './player-onboarding.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionAuthenticationClock,
  SessionBearerGuard,
} from './session-authentication.guard';
import { SessionAuthenticationService } from './session-authentication.service';
import {
  SessionAuthenticationInput,
  SessionAuthenticationResult,
} from './session-authentication.types';

const ROUTE = '/api/v1/onboarding/me';
const CREDENTIAL = Buffer.alloc(32, 0x62).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'player-onboarding-controller',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-onboarding-controller-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PHONE_MARKER = '+79991112233';
const EMAIL_MARKER = 'private.owner@example.test';
const PRIVATE_MARKER = 'SYNTHETIC_ONBOARDING_HTTP_PRIVATE';

interface Harness {
  readonly app: NestFastifyApplication;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >;
  readonly readOwnOnboarding: jest.Mock<
    Promise<ReadOwnPlayerOnboardingResult>,
    [{ readonly accountId: AccountId; readonly role: 'player' | 'club_admin' }]
  >;
  readonly saveOwnOnboardingDraft: jest.Mock<
    Promise<SaveOwnPlayerOnboardingDraftResult>,
    [SaveOwnPlayerOnboardingDraftInput]
  >;
  readonly advanceOwnOnboarding: jest.Mock<
    Promise<AdvanceOwnPlayerOnboardingResult>,
    [AdvanceOwnPlayerOnboardingInput]
  >;
  readonly completeOwnOnboarding: jest.Mock<
    Promise<CompleteOwnPlayerOnboardingResult>,
    [CompleteOwnPlayerOnboardingInput]
  >;
  readonly acceptOwnLegalPolicy: jest.Mock<
    Promise<AcceptOwnPlayerOnboardingLegalPolicyResult>,
    [AcceptOwnPlayerOnboardingLegalPolicyInput]
  >;
  readonly logs: readonly unknown[][];
}

function captureLogger(logs: unknown[][]) {
  const capture = (...values: unknown[]): void => {
    logs.push(values);
  };
  return {
    log: capture,
    error: capture,
    warn: capture,
    debug: capture,
    verbose: capture,
    fatal: capture,
  };
}

function foundOnboarding(): OwnPlayerOnboarding & { readonly status: 'in_progress' } {
  return {
    status: 'in_progress',
    flowVersion: 'tma_v1',
    currentStep: 'contacts',
    surveyVersion: 'initial_level_v1',
    revision: 2,
    profile: { firstName: 'Private', lastName: 'Owner' },
    contacts: {
      phone: PHONE_MARKER,
      normalizedEmail: EMAIL_MARKER,
      assurance: 'declared',
    },
    consents: [{ kind: 'terms', documentVersion: '2026-08-01' }],
    surveyAnswers: {},
  };
}

function foundResult(): ReadOwnPlayerOnboardingResult {
  return { outcome: 'found', onboarding: foundOnboarding() };
}

function completedOnboarding(): Extract<
  OwnPlayerOnboardingResponse,
  { readonly status: 'completed' }
> {
  return {
    status: 'completed',
    legalPolicyCurrent: true,
    initialLevelLabel: 'B+',
    initialLevelAlgorithmVersion: 'initial_level_v2',
  };
}

async function createHarness(): Promise<Harness> {
  const authenticate = jest
    .fn<Promise<SessionAuthenticationResult>, [SessionAuthenticationInput]>()
    .mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT_ID,
        role: 'player',
        expiresAt: EXPIRES_AT,
      },
    });
  const readOwnOnboarding = jest
    .fn<
      Promise<ReadOwnPlayerOnboardingResult>,
      [
        {
          readonly accountId: AccountId;
          readonly role: 'player' | 'club_admin';
        },
      ]
    >()
    .mockResolvedValue(foundResult());
  const saveOwnOnboardingDraft = jest
    .fn<
      Promise<SaveOwnPlayerOnboardingDraftResult>,
      [SaveOwnPlayerOnboardingDraftInput]
    >()
    .mockResolvedValue({
      outcome: 'saved',
      onboarding: foundOnboarding(),
    });
  const completeOwnOnboarding = jest
    .fn<
      Promise<CompleteOwnPlayerOnboardingResult>,
      [CompleteOwnPlayerOnboardingInput]
    >()
    .mockResolvedValue({
      outcome: 'completed',
      onboarding: completedOnboarding(),
    });
  const advanceOwnOnboarding = jest
    .fn<
      Promise<AdvanceOwnPlayerOnboardingResult>,
      [AdvanceOwnPlayerOnboardingInput]
    >()
    .mockResolvedValue({
      outcome: 'advanced',
      onboarding: {
        ...foundOnboarding(),
        currentStep: 'consents',
        revision: 3,
      },
    });
  const acceptOwnLegalPolicy = jest
    .fn<
      Promise<AcceptOwnPlayerOnboardingLegalPolicyResult>,
      [AcceptOwnPlayerOnboardingLegalPolicyInput]
    >()
    .mockResolvedValue({
      outcome: 'accepted',
      onboarding: completedOnboarding(),
    });
  const nowEpochSeconds = jest.fn<
    ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const moduleRef = await Test.createTestingModule({
    controllers: [PlayerOnboardingController],
    providers: [
      SessionBearerGuard,
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: PlayerOnboardingService,
        useValue: {
          readOwnOnboarding,
          saveOwnOnboardingDraft,
          advanceOwnOnboarding,
          completeOwnOnboarding,
          acceptOwnLegalPolicy,
        },
      },
      {
        provide: SESSION_AUTHENTICATION_CLOCK,
        useValue: { nowEpochSeconds },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  const logs: unknown[][] = [];
  app.useLogger(captureLogger(logs));
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    authenticate,
    readOwnOnboarding,
    saveOwnOnboardingDraft,
    advanceOwnOnboarding,
    completeOwnOnboarding,
    acceptOwnLegalPolicy,
    logs,
  };
}

function inject(
  harness: Harness,
  authorization?: string,
  suffix = '',
  cookie?: string,
) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }
  return harness.app.inject({
    method: 'GET',
    url: `${ROUTE}${suffix}`,
    headers,
  });
}

function patch(
  harness: Harness,
  body: unknown,
  authorization?: string,
  suffix = '',
) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  return harness.app.inject({
    method: 'PATCH',
    url: `${ROUTE}${suffix}`,
    headers,
    payload: body as never,
  });
}

function draftBody(expectedRevision: number | null = null) {
  return {
    expectedRevision,
    profile: { firstName: 'Private', lastName: 'Owner' },
    contacts: { phone: PHONE_MARKER, email: EMAIL_MARKER },
  };
}

function completionBody(expectedRevision = 4) {
  return {
    expectedRevision,
    flowVersion: 'tma_v1',
    consents: [
      { kind: 'terms', documentVersion: '2026-08-01' },
      { kind: 'personal_data_processing', documentVersion: '2026-08-01' },
      { kind: 'cancellation', documentVersion: '2026-08-01' },
    ],
    survey: {
      version: 'initial_level_v2',
      answers: {
        match_count: 'thirty_one_to_ninety_nine',
        rally_stability: 'steady_under_pressure',
        glass_play: 'confident_returns',
        serve_return_net: 'confident_patterns',
        match_experience_year: 'league_or_club',
      },
    },
  };
}

function progressBody(
  expectedRevision = 2,
): Extract<
  AdvanceOwnPlayerOnboardingInput['progress'],
  { readonly nextStep: 'consents' }
> {
  return {
    expectedRevision,
    flowVersion: 'tma_v1',
    nextStep: 'consents',
  };
}

function levelSurveyProgressBody(
  expectedRevision = 3,
): Extract<
  AdvanceOwnPlayerOnboardingInput['progress'],
  { readonly nextStep: 'level_survey' }
> {
  return {
    expectedRevision,
    flowVersion: 'tma_v1',
    nextStep: 'level_survey',
    consents: [
      { kind: 'terms', documentVersion: '2026-08-01' },
      { kind: 'personal_data_processing', documentVersion: '2026-08-01' },
      { kind: 'cancellation', documentVersion: '2026-08-01' },
    ],
  };
}

function postProgress(harness: Harness, body: unknown, authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  return harness.app.inject({
    method: 'POST',
    url: `${ROUTE}/progress`,
    headers,
    payload: body as never,
  });
}

function postCompletion(
  harness: Harness,
  body: unknown,
  authorization?: string,
) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  return harness.app.inject({
    method: 'POST',
    url: `${ROUTE}/complete`,
    headers,
    payload: body as never,
  });
}

function postLegalAcceptances(
  harness: Harness,
  body: unknown,
  authorization?: string,
) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return harness.app.inject({
    method: 'POST',
    url: `${ROUTE}/legal-acceptances`,
    headers,
    payload: body as never,
  });
}

function expectNoStore(response: {
  readonly headers: Record<string, string | string[] | number | undefined>;
}): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers.pragma).toBe('no-cache');
}

describe('PlayerOnboardingController HTTP boundary', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    jest.restoreAllMocks();
  });

  it('returns the owner-only resumable allowlist with declared contacts', async () => {
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual(foundOnboarding());
    expect(harness.authenticate).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      now: NOW,
    });
    expect(harness.readOwnOnboarding).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
    });
    const responseBody = JSON.stringify(response.json());
    expect(responseBody).toContain(PHONE_MARKER);
    expect(responseBody).toContain(EMAIL_MARKER);
    for (const forbidden of [
      ACCOUNT_ID,
      CREDENTIAL,
      'rating',
      'isVerified',
      'phoneVerified',
      'emailVerified',
    ]) {
      expect(responseBody).not.toContain(forbidden);
    }
    const logs = JSON.stringify(harness.logs);
    expect(logs).not.toContain(PHONE_MARKER);
    expect(logs).not.toContain(EMAIL_MARKER);
  });

  it('returns only the completed owner initial-level label on relogin', async () => {
    harness.readOwnOnboarding.mockResolvedValueOnce({
      outcome: 'found',
      onboarding: completedOnboarding(),
    });

    const response = await inject(harness, `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual(completedOnboarding());
    expect(response.json()).toMatchObject({ initialLevelLabel: 'B+' });
    expect(response.body).not.toMatch(
      /surveyAnswers|profile|contacts|consents|initialLevelScore|isVerified|rating/iu,
    );
  });

  it('accepts only the bearer owner exact new three-record evidence set', async () => {
    const body = {
      consents: [
        { kind: 'terms', documentVersion: '2026-08-01' },
        { kind: 'cancellation', documentVersion: '2026-08-01' },
        { kind: 'personal_data_processing', documentVersion: '2026-08-01' },
      ],
    };
    const response = await postLegalAcceptances(
      harness,
      body,
      `Bearer ${CREDENTIAL}`,
    );

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual(completedOnboarding());
    expect(harness.acceptOwnLegalPolicy).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      acceptance: {
        consents: [
          { kind: 'cancellation', documentVersion: '2026-08-01' },
          { kind: 'personal_data_processing', documentVersion: '2026-08-01' },
          { kind: 'terms', documentVersion: '2026-08-01' },
        ],
      },
    });
  });

  it('rejects legacy privacy in place of separate PD consent', async () => {
    const response = await postLegalAcceptances(
      harness,
      {
        consents: [
          { kind: 'terms', documentVersion: '2026-08-01' },
          { kind: 'cancellation', documentVersion: '2026-08-01' },
          { kind: 'privacy', documentVersion: '2026-08-01' },
        ],
      },
      `Bearer ${CREDENTIAL}`,
    );

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(harness.acceptOwnLegalPolicy).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    CREDENTIAL,
    `bearer ${CREDENTIAL}`,
    `Bearer  ${CREDENTIAL}`,
    `Bearer ${CREDENTIAL} `,
    'Bearer invalid',
  ])(
    'rejects non-canonical authorization %p before service',
    async (authorization) => {
      const response = await inject(harness, authorization);
      expect(response.statusCode).toBe(401);
      expectNoStore(response);
      expect(response.json()).toEqual({
        statusCode: 401,
        code: 'session_invalid',
        message: 'Session is invalid',
      });
      expect(harness.readOwnOnboarding).not.toHaveBeenCalled();
    },
  );

  it('never accepts account or credential overrides from query/cookie', async () => {
    const response = await inject(
      harness,
      `Bearer ${CREDENTIAL}`,
      `?accountId=${OTHER_ACCOUNT_ID}&credential=override`,
      'credential=override',
    );
    expect(response.statusCode).toBe(200);
    expect(harness.readOwnOnboarding).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
    });
    expect(JSON.stringify(response.json())).not.toContain(OTHER_ACCOUNT_ID);
  });

  it.each([
    ['onboarding_not_found', 404, 'onboarding_not_found'],
    ['temporary_unavailable', 503, 'onboarding_service_unavailable'],
    ['invalid_request', 500, 'onboarding_internal_error'],
    ['internal_failure', 500, 'onboarding_internal_error'],
  ] as const)('maps %s to safe HTTP %d', async (reason, statusCode, code) => {
    harness.readOwnOnboarding.mockResolvedValueOnce({
      outcome: 'rejected',
      reason,
    });
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(statusCode);
    expectNoStore(response);
    expect(response.json()).toMatchObject({ statusCode, code });
    expect(response.body).not.toContain(PHONE_MARKER);
    expect(response.body).not.toContain(EMAIL_MARKER);
  });

  it.each([
    null,
    {},
    { outcome: 'found' },
    {
      outcome: 'found',
      onboarding: {
        ...foundOnboarding(),
        accountId: OTHER_ACCOUNT_ID,
      },
    },
    { outcome: 'rejected', reason: PRIVATE_MARKER },
  ])('fails closed on malformed service result %#', async (result) => {
    harness.readOwnOnboarding.mockResolvedValueOnce(result as never);
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(500);
    expectNoStore(response);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'onboarding_internal_error',
      message: 'Onboarding request failed',
    });
    expect(
      JSON.stringify({ response: response.json(), logs: harness.logs }),
    ).not.toContain(PRIVATE_MARKER);
  });

  it('hides thrown PII and credential details from response and logs', async () => {
    harness.readOwnOnboarding.mockRejectedValueOnce(
      new Error(
        `${PRIVATE_MARKER}:${PHONE_MARKER}:${EMAIL_MARKER}:${CREDENTIAL}`,
      ),
    );
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(500);
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    for (const marker of [
      PRIVATE_MARKER,
      PHONE_MARKER,
      EMAIL_MARKER,
      CREDENTIAL,
    ]) {
      expect(output).not.toContain(marker);
    }
  });

  it.each([
    ['first run', null],
    ['resume', 2],
  ] as const)(
    'saves an authenticated owner draft for %s',
    async (_label, revision) => {
      const response = await patch(
        harness,
        draftBody(revision),
        `Bearer ${CREDENTIAL}`,
      );

      expect(response.statusCode).toBe(200);
      expectNoStore(response);
      expect(response.json()).toEqual(foundOnboarding());
      expect(harness.saveOwnOnboardingDraft).toHaveBeenCalledWith({
        accountId: ACCOUNT_ID,
        role: 'player',
        draft: draftBody(revision),
      });
      const output = JSON.stringify(harness.logs);
      expect(output).not.toContain(PHONE_MARKER);
      expect(output).not.toContain(EMAIL_MARKER);
      expect(output).not.toContain(CREDENTIAL);
    },
  );

  it('rejects unauthorized draft writes before the service', async () => {
    const response = await patch(harness, draftBody());
    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(harness.saveOwnOnboardingDraft).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ...draftBody(), accountId: OTHER_ACCOUNT_ID },
    { ...draftBody(), expectedRevision: 0 },
    {
      ...draftBody(),
      contacts: { phone: '79991112233', email: EMAIL_MARKER },
    },
    {
      ...draftBody(),
      verification: { phone: true, email: true },
    },
  ])(
    'rejects malformed or expanded draft body without persistence %#',
    async (body) => {
      const response = await patch(
        harness,
        body,
        `Bearer ${CREDENTIAL}`,
        `?accountId=${OTHER_ACCOUNT_ID}`,
      );
      expect(response.statusCode).toBe(400);
      expectNoStore(response);
      expect(response.json()).toEqual({
        statusCode: 400,
        code: 'onboarding_draft_invalid_request',
        message: 'Onboarding draft request is invalid',
      });
      expect(harness.saveOwnOnboardingDraft).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['onboarding_not_found', 404, 'onboarding_not_found'],
    ['stale_revision', 409, 'onboarding_draft_revision_conflict'],
    ['onboarding_closed', 409, 'onboarding_draft_closed'],
    ['content_not_allowed', 422, 'onboarding_draft_content_not_allowed'],
    ['temporary_unavailable', 503, 'onboarding_service_unavailable'],
    ['invalid_request', 400, 'onboarding_draft_invalid_request'],
    ['internal_failure', 500, 'onboarding_internal_error'],
  ] as const)(
    'maps draft %s to safe HTTP %d',
    async (reason, statusCode, code) => {
      harness.saveOwnOnboardingDraft.mockResolvedValueOnce({
        outcome: 'rejected',
        reason,
      });
      const response = await patch(
        harness,
        draftBody(2),
        `Bearer ${CREDENTIAL}`,
      );
      expect(response.statusCode).toBe(statusCode);
      expectNoStore(response);
      expect(response.json()).toMatchObject({ statusCode, code });
      expect(response.body).not.toContain(PHONE_MARKER);
      expect(response.body).not.toContain(EMAIL_MARKER);
    },
  );

  it('hides thrown draft PII and credentials from response and logs', async () => {
    harness.saveOwnOnboardingDraft.mockRejectedValueOnce(
      new Error(
        `${PRIVATE_MARKER}:${PHONE_MARKER}:${EMAIL_MARKER}:${CREDENTIAL}`,
      ),
    );
    const response = await patch(harness, draftBody(2), `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(500);
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    for (const marker of [
      PRIVATE_MARKER,
      PHONE_MARKER,
      EMAIL_MARKER,
      CREDENTIAL,
    ]) {
      expect(output).not.toContain(marker);
    }
  });

  it.each([
    ['profile', progressBody()],
    ['consents', levelSurveyProgressBody()],
  ] as const)(
    'advances authenticated owner progress from %s with an exact no-store body',
    async (_step, body) => {
      const nextRevision = body.expectedRevision + 1;
      harness.advanceOwnOnboarding.mockResolvedValueOnce({
        outcome: 'advanced',
        onboarding: {
          ...foundOnboarding(),
          currentStep: body.nextStep,
          revision: nextRevision,
          consents:
            body.nextStep === 'level_survey'
              ? levelSurveyProgressBody().consents
              : [],
        },
      });
      const response = await postProgress(
        harness,
        body,
        `Bearer ${CREDENTIAL}`,
      );
      expect(response.statusCode).toBe(200);
      expectNoStore(response);
      expect(harness.advanceOwnOnboarding).toHaveBeenCalledWith({
        accountId: ACCOUNT_ID,
        role: 'player',
        progress:
          body.nextStep === 'level_survey'
            ? {
                ...body,
                consents: [
                  { kind: 'cancellation', documentVersion: '2026-08-01' },
                  {
                    kind: 'personal_data_processing',
                    documentVersion: '2026-08-01',
                  },
                  { kind: 'terms', documentVersion: '2026-08-01' },
                ],
              }
            : body,
      });
      expect(response.json()).toMatchObject({
        status: 'in_progress',
        currentStep: body.nextStep,
        revision: nextRevision,
        contacts: { assurance: 'declared' },
      });
      expect(response.body).not.toMatch(/isVerified|verified|rating/iu);
      const logs = JSON.stringify(harness.logs);
      expect(logs).not.toContain(PHONE_MARKER);
      expect(logs).not.toContain(EMAIL_MARKER);
      expect(logs).not.toContain(CREDENTIAL);
    },
  );

  it('rejects unauthorized progress before the service', async () => {
    harness.authenticate.mockResolvedValueOnce({
      outcome: 'rejected',
      reason: 'session_invalid',
    });
    const response = await postProgress(harness, progressBody());
    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(harness.advanceOwnOnboarding).not.toHaveBeenCalled();
  });

  it.each([
    [
      'extra owner selector',
      { ...progressBody(), accountId: OTHER_ACCOUNT_ID },
    ],
    ['unsafe revision', progressBody(0)],
    ['silent skip payload', { ...progressBody(), nextStep: 'level_survey' }],
    [
      'duplicate consent kind',
      {
        ...levelSurveyProgressBody(),
        consents: [
          { kind: 'terms', documentVersion: '2026-08-01' },
          { kind: 'terms', documentVersion: '2026-08-01' },
          { kind: 'personal_data_processing', documentVersion: '2026-08-01' },
        ],
      },
    ],
    [
      'verification claim',
      { ...progressBody(), verification: { phone: true, email: true } },
    ],
  ])(
    'rejects progress %s with an exact body allowlist',
    async (_label, body) => {
      const response = await postProgress(
        harness,
        body,
        `Bearer ${CREDENTIAL}`,
      );
      expect(response.statusCode).toBe(400);
      expectNoStore(response);
      expect(response.json()).toEqual({
        statusCode: 400,
        code: 'onboarding_progress_invalid_request',
        message: 'Onboarding progress request is invalid',
      });
      expect(harness.advanceOwnOnboarding).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['onboarding_not_found', 404, 'onboarding_not_found'],
    ['stale_revision', 409, 'onboarding_progress_revision_conflict'],
    ['progress_conflict', 409, 'onboarding_progress_conflict'],
    ['onboarding_incomplete', 422, 'onboarding_progress_incomplete'],
    ['onboarding_closed', 409, 'onboarding_progress_closed'],
    ['temporary_unavailable', 503, 'onboarding_service_unavailable'],
    ['invalid_request', 400, 'onboarding_progress_invalid_request'],
    ['internal_failure', 500, 'onboarding_internal_error'],
  ] as const)(
    'maps progress %s to safe HTTP %d',
    async (reason, statusCode, code) => {
      harness.advanceOwnOnboarding.mockResolvedValueOnce({
        outcome: 'rejected',
        reason,
      });
      const response = await postProgress(
        harness,
        progressBody(),
        `Bearer ${CREDENTIAL}`,
      );
      expect(response.statusCode).toBe(statusCode);
      expectNoStore(response);
      expect(response.json()).toMatchObject({ statusCode, code });
      expect(response.body).not.toContain(PHONE_MARKER);
      expect(response.body).not.toContain(EMAIL_MARKER);
    },
  );

  it('hides thrown progress PII and credentials from response and logs', async () => {
    harness.advanceOwnOnboarding.mockRejectedValueOnce(
      new Error(
        `${PRIVATE_MARKER}:${PHONE_MARKER}:${EMAIL_MARKER}:${CREDENTIAL}`,
      ),
    );
    const response = await postProgress(
      harness,
      progressBody(),
      `Bearer ${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(500);
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    for (const marker of [
      PRIVATE_MARKER,
      PHONE_MARKER,
      EMAIL_MARKER,
      CREDENTIAL,
    ]) {
      expect(output).not.toContain(marker);
    }
  });

  it('completes only the bearer owner and returns a no-store one-time survey projection', async () => {
    const response = await postCompletion(
      harness,
      completionBody(),
      `Bearer ${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(harness.completeOwnOnboarding).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      completion: {
        expectedRevision: 4,
        flowVersion: 'tma_v1',
        consents: [
          { kind: 'cancellation', documentVersion: '2026-08-01' },
          { kind: 'personal_data_processing', documentVersion: '2026-08-01' },
          { kind: 'terms', documentVersion: '2026-08-01' },
        ],
        survey: {
          version: 'initial_level_v2',
          answers: {
            match_count: 'thirty_one_to_ninety_nine',
            rally_stability: 'steady_under_pressure',
            glass_play: 'confident_returns',
            serve_return_net: 'confident_patterns',
            match_experience_year: 'league_or_club',
          },
        },
      },
    });
    expect(response.json()).toMatchObject({
      status: 'completed',
      legalPolicyCurrent: true,
      initialLevelLabel: 'B+',
      initialLevelAlgorithmVersion: 'initial_level_v2',
    });
    expect(response.body).not.toMatch(
      /surveyAnswers|profile|contacts|consents|revision|initialLevelScore|isVerified|verified|rating/iu,
    );
  });

  it('rejects unauthorized completion before the service', async () => {
    harness.authenticate.mockResolvedValueOnce({
      outcome: 'rejected',
      reason: 'session_invalid',
    });
    const response = await postCompletion(harness, completionBody());
    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(harness.completeOwnOnboarding).not.toHaveBeenCalled();
  });

  it.each([
    [
      'extra owner selector',
      { ...completionBody(), accountId: OTHER_ACCOUNT_ID },
    ],
    ['unsafe revision', completionBody(0)],
    [
      'duplicate consent kind',
      {
        ...completionBody(),
        consents: [
          { kind: 'terms', documentVersion: '2026-08-01' },
          { kind: 'terms', documentVersion: '2026-08-01' },
          { kind: 'personal_data_processing', documentVersion: '2026-08-01' },
        ],
      },
    ],
    [
      'partial survey',
      {
        ...completionBody(),
        survey: { version: 'initial_level_v1', answers: {} },
      },
    ],
    [
      'unsafe survey code',
      {
        ...completionBody(),
        survey: {
          version: 'initial_level_v1',
          answers: { experience: PRIVATE_MARKER },
        },
      },
    ],
  ])(
    'rejects completion %s with an exact body allowlist',
    async (_label, body) => {
      const response = await postCompletion(
        harness,
        body,
        `Bearer ${CREDENTIAL}`,
      );
      expect(response.statusCode).toBe(400);
      expectNoStore(response);
      expect(response.json()).toMatchObject({
        statusCode: 400,
        code: 'onboarding_completion_invalid_request',
      });
      expect(harness.completeOwnOnboarding).not.toHaveBeenCalled();
      expect(response.body).not.toContain(PRIVATE_MARKER);
    },
  );

  it.each([
    ['onboarding_not_found', 404, 'onboarding_not_found'],
    ['stale_revision', 409, 'onboarding_completion_revision_conflict'],
    ['completion_conflict', 409, 'onboarding_completion_conflict'],
    ['onboarding_incomplete', 422, 'onboarding_incomplete'],
    ['temporary_unavailable', 503, 'onboarding_service_unavailable'],
    ['invalid_request', 400, 'onboarding_completion_invalid_request'],
    ['internal_failure', 500, 'onboarding_internal_error'],
  ] as const)(
    'maps completion %s to safe HTTP %d',
    async (reason, statusCode, code) => {
      harness.completeOwnOnboarding.mockResolvedValueOnce({
        outcome: 'rejected',
        reason,
      });
      const response = await postCompletion(
        harness,
        completionBody(),
        `Bearer ${CREDENTIAL}`,
      );
      expect(response.statusCode).toBe(statusCode);
      expectNoStore(response);
      expect(response.json()).toMatchObject({ statusCode, code });
      expect(response.body).not.toContain(PHONE_MARKER);
      expect(response.body).not.toContain(EMAIL_MARKER);
    },
  );

  it('hides thrown completion body, PII and credential details from response and logs', async () => {
    harness.completeOwnOnboarding.mockRejectedValueOnce(
      new Error(
        `${PRIVATE_MARKER}:${PHONE_MARKER}:${EMAIL_MARKER}:${CREDENTIAL}`,
      ),
    );
    const response = await postCompletion(
      harness,
      completionBody(),
      `Bearer ${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(500);
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    for (const marker of [
      PRIVATE_MARKER,
      PHONE_MARKER,
      EMAIL_MARKER,
      CREDENTIAL,
    ]) {
      expect(output).not.toContain(marker);
    }
  });
});
