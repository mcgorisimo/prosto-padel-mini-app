import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlayerOnboardingClient,
  readPlayerOnboardingState,
} from './playerOnboardingClient.js';

const CREDENTIAL = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE';
const PHONE = '+999123456789012';
const EMAIL = 'synthetic@example.invalid';
const TEST_POLICY_VERSION = 'synthetic-v1';
const INPUT_CONSENTS = Object.freeze([
  { kind: 'terms', documentVersion: TEST_POLICY_VERSION },
  { kind: 'privacy', documentVersion: TEST_POLICY_VERSION },
  { kind: 'cancellation', documentVersion: TEST_POLICY_VERSION },
]);
const CONSENTS = Object.freeze([
  { kind: 'cancellation', documentVersion: TEST_POLICY_VERSION },
  { kind: 'privacy', documentVersion: TEST_POLICY_VERSION },
  { kind: 'terms', documentVersion: TEST_POLICY_VERSION },
]);

function response(body, status = 200, cacheControl = 'private, no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': cacheControl,
      'Content-Type': 'application/json',
    },
  });
}

function requiredState() {
  return {
    status: 'required',
    flowVersion: null,
    currentStep: 'profile',
    surveyVersion: null,
    revision: null,
    profile: { firstName: 'Synthetic', lastName: null },
    contacts: {
      phone: null,
      normalizedEmail: null,
      assurance: 'declared',
    },
    consents: [],
    surveyAnswers: {},
  };
}

function progressState(currentStep, revision, consents = []) {
  return {
    status: 'in_progress',
    flowVersion: 'tma_v1',
    currentStep,
    surveyVersion: 'initial_level_v1',
    revision,
    profile: { firstName: 'Synthetic', lastName: 'Player' },
    contacts: {
      phone: PHONE,
      normalizedEmail: EMAIL,
      assurance: 'declared',
    },
    consents,
    surveyAnswers: {},
  };
}

function completedState() {
  return {
    ...progressState('completed', 4, CONSENTS),
    status: 'completed',
    surveyAnswers: { experience: 'beginner' },
  };
}

function completedV2State(initialLevelLabel = 'B+') {
  return {
    ...progressState('completed', 4, CONSENTS),
    status: 'completed',
    surveyVersion: 'initial_level_v2',
    surveyAnswers: {
      match_count: 'thirty_one_to_ninety_nine',
      rally_stability: 'steady_under_pressure',
      glass_play: 'confident_returns',
      serve_return_net: 'confident_patterns',
      match_experience_year: 'league_or_club',
    },
    initialLevelLabel,
  };
}

function publicError(statusCode, code) {
  return {
    statusCode,
    code,
    message: 'Public onboarding error',
  };
}

function draft(expectedRevision = null) {
  return {
    expectedRevision,
    profile: { firstName: 'Synthetic', lastName: 'Player' },
    contacts: { phone: PHONE, email: '  SYNTHETIC@EXAMPLE.INVALID  ' },
  };
}

function levelSurveyProgress(expectedRevision = 2) {
  return {
    expectedRevision,
    flowVersion: 'tma_v1',
    nextStep: 'level_survey',
    consents: INPUT_CONSENTS,
  };
}

function completion(expectedRevision = 3) {
  return {
    expectedRevision,
    flowVersion: 'tma_v1',
    consents: INPUT_CONSENTS,
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

function clientFor(fetchImpl, dependencies = {}) {
  return createPlayerOnboardingClient({
    fetchImpl,
    sleep: vi.fn().mockResolvedValue(true),
    random: () => 0,
    ...dependencies,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('playerOnboardingClient', () => {
  it('reads first-run state and saves one exact normalized profile draft', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(requiredState()))
      .mockResolvedValueOnce(response(progressState('profile', 1)));
    const client = clientFor(fetchImpl);

    const firstRun = await client.read(CREDENTIAL);
    const saved = await client.saveDraft(CREDENTIAL, draft());

    expect(firstRun).toEqual({
      outcome: 'loaded',
      onboarding: requiredState(),
    });
    expect(saved).toEqual({
      outcome: 'saved',
      onboarding: progressState('profile', 1),
    });
    expect(Object.isFrozen(firstRun)).toBe(true);
    expect(Object.isFrozen(firstRun.onboarding)).toBe(true);
    expect(Object.isFrozen(saved.onboarding.contacts)).toBe(true);

    const [readUrl, readOptions] = fetchImpl.mock.calls[0];
    expect(readUrl).toBe('/api/v1/onboarding/me');
    expect(readOptions).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${CREDENTIAL}`,
      },
    });
    expect(readOptions).not.toHaveProperty('body');

    const [saveUrl, saveOptions] = fetchImpl.mock.calls[1];
    expect(saveUrl).toBe('/api/v1/onboarding/me');
    expect(saveOptions.method).toBe('PATCH');
    expect(JSON.parse(saveOptions.body)).toEqual({
      expectedRevision: null,
      profile: { firstName: 'Synthetic', lastName: 'Player' },
      contacts: { phone: PHONE, email: EMAIL },
    });
    expect(saveOptions.body).not.toContain('verified');
    expect(saveOptions.body).not.toContain('rating');
    expect(saveOptions.headers).not.toHaveProperty('Cookie');
  });

  it('resumes progress and sends exact progress and completion contracts', async () => {
    const consentState = progressState('consents', 2);
    const surveyState = progressState('level_survey', 3, [
      ...CONSENTS.slice(0, 2),
      { kind: 'terms', documentVersion: 'historical-v1' },
      CONSENTS[2],
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(consentState))
      .mockResolvedValueOnce(response(surveyState))
      .mockResolvedValueOnce(response(completedV2State()));
    const client = clientFor(fetchImpl);

    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'loaded',
      onboarding: consentState,
    });
    await expect(
      client.advance(CREDENTIAL, levelSurveyProgress()),
    ).resolves.toEqual({ outcome: 'advanced', onboarding: surveyState });
    await expect(client.complete(CREDENTIAL, completion())).resolves.toEqual({
      outcome: 'completed',
      onboarding: completedV2State(),
    });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/onboarding/me',
      '/api/v1/onboarding/me/progress',
      '/api/v1/onboarding/me/complete',
    ]);
    const progressBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    const completionBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(progressBody).toEqual({
      expectedRevision: 2,
      flowVersion: 'tma_v1',
      nextStep: 'level_survey',
      consents: [
        { kind: 'cancellation', documentVersion: TEST_POLICY_VERSION },
        { kind: 'privacy', documentVersion: TEST_POLICY_VERSION },
        { kind: 'terms', documentVersion: TEST_POLICY_VERSION },
      ],
    });
    expect(completionBody).toEqual({
      expectedRevision: 3,
      flowVersion: 'tma_v1',
      consents: progressBody.consents,
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
    });
    expect(JSON.stringify({ progressBody, completionBody })).not.toMatch(
      /requestKey|verified|rating/iu,
    );
    expect(surveyState.consents).toHaveLength(4);
  });

  it('loads and reloads only the server-computed label for a completed v2 owner', async () => {
    const completed = completedV2State('C+');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(completed))
      .mockResolvedValueOnce(response(completed));
    const client = clientFor(fetchImpl);

    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'loaded',
      onboarding: completed,
    });
    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'loaded',
      onboarding: completed,
    });
    expect(JSON.stringify(completed)).not.toMatch(
      /initialLevelScore|isVerified|verified|rating/iu,
    );
  });

  it('keeps legacy completed states compatible without an initial-level label', async () => {
    const legacyCompleted = completedState();
    const client = clientFor(
      vi.fn().mockResolvedValue(response(legacyCompleted)),
    );

    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'loaded',
      onboarding: legacyCompleted,
    });
    expect(readPlayerOnboardingState(legacyCompleted)).toEqual(legacyCompleted);
  });

  it('maps unauthorized without retrying or exposing the credential', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response(publicError(401, 'session_invalid'), 401));
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const client = clientFor(fetchImpl);

    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('maps stale and different progress conflicts without retrying', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          publicError(409, 'onboarding_progress_revision_conflict'),
          409,
        ),
      )
      .mockResolvedValueOnce(
        response(publicError(409, 'onboarding_progress_conflict'), 409),
      );
    const client = clientFor(fetchImpl);
    const toConsents = {
      expectedRevision: 1,
      flowVersion: 'tma_v1',
      nextStep: 'consents',
    };

    await expect(client.advance(CREDENTIAL, toConsents)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'stale_revision',
    });
    await expect(client.advance(CREDENTIAL, toConsents)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'conflict',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a draft whose network outcome is unknown', async () => {
    const privateMarker = 'private-email-marker@example.invalid';
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError(privateMarker));
    const sleep = vi.fn().mockResolvedValue(true);
    const localStorage = Object.freeze({
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const sessionStorage = Object.freeze({
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const client = clientFor(fetchImpl, { sleep });

    await expect(client.saveDraft(CREDENTIAL, draft())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'unknown_outcome',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      expectedRevision: null,
      profile: { firstName: 'Synthetic', lastName: 'Player' },
      contacts: { phone: PHONE, email: EMAIL },
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('retries an idempotent progress outcome with a byte-identical body', async () => {
    const surveyState = progressState('level_survey', 3, CONSENTS);
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('private-progress-marker'))
      .mockResolvedValueOnce(response(surveyState));
    const sleep = vi.fn().mockResolvedValue(true);
    const client = clientFor(fetchImpl, { sleep });

    await expect(
      client.advance(CREDENTIAL, levelSurveyProgress()),
    ).resolves.toEqual({ outcome: 'advanced', onboarding: surveyState });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      fetchImpl.mock.calls[1][1].body,
    );
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('rejects expanded requests and expanded verification responses fail closed', async () => {
    const expandedState = {
      ...requiredState(),
      phoneVerified: true,
    };
    const fetchImpl = vi.fn().mockResolvedValue(response(expandedState));
    const client = clientFor(fetchImpl);

    await expect(
      client.saveDraft(CREDENTIAL, {
        ...draft(),
        verification: { phone: true, email: true },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readPlayerOnboardingState(expandedState)).toBeNull();
  });

  it.each([
    [
      'missing completed v2 label',
      (() => {
        const { initialLevelLabel: _label, ...state } = completedV2State();
        return state;
      })(),
    ],
    ['invalid completed v2 label', completedV2State('S')],
    ['private score field', { ...completedV2State(), initialLevelScore: 14 }],
    [
      'label on in-progress state',
      { ...progressState('profile', 1), initialLevelLabel: 'C' },
    ],
    [
      'label on legacy completion',
      { ...completedState(), initialLevelLabel: 'C' },
    ],
  ])(
    'rejects a malformed or expanded response with %s',
    async (_label, state) => {
      const client = clientFor(vi.fn().mockResolvedValue(response(state)));

      await expect(client.read(CREDENTIAL)).resolves.toEqual({
        outcome: 'rejected',
        reason: 'internal_error',
      });
      expect(readPlayerOnboardingState(state)).toBeNull();
    },
  );

  it('rejects invalid owner inputs before fetch and requires no-store responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response(requiredState(), 200, 'private'));
    const client = clientFor(fetchImpl);

    await expect(client.read('invalid')).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid',
    });
    await expect(
      client.saveDraft(CREDENTIAL, {
        ...draft(),
        contacts: { phone: '79991234567', email: EMAIL },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    await expect(
      client.advance(CREDENTIAL, {
        expectedRevision: 1,
        flowVersion: 'tma_v1',
        nextStep: 'completed',
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
