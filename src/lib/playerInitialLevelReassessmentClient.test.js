import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlayerInitialLevelReassessmentClient,
  readPlayerInitialLevelReassessment,
} from './playerInitialLevelReassessmentClient.js';

const CREDENTIAL = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE';
const SOURCE = Object.freeze({
  flowVersion: 'tma_v1',
  surveyVersion: 'initial_level_v1',
  revision: 4,
});
const ANSWERS = Object.freeze({
  match_count: 'thirty_one_to_ninety_nine',
  rally_stability: 'steady_under_pressure',
  glass_play: 'confident_returns',
  serve_return_net: 'confident_patterns',
  match_experience_year: 'league_or_club',
});

function response(body, status = 200, cacheControl = 'private, no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': cacheControl,
      'Content-Type': 'application/json',
    },
  });
}

function publicError(statusCode, code) {
  return {
    statusCode,
    code,
    message: 'Public reassessment error',
  };
}

function requiredState() {
  return {
    status: 'required',
    source: { ...SOURCE },
    surveyVersion: 'initial_level_v2',
  };
}

function completedState(initialLevelLabel = 'B+') {
  return {
    status: 'completed',
    surveyVersion: 'initial_level_v2',
    initialLevelLabel,
  };
}

function completion(answers = ANSWERS) {
  return {
    source: { ...SOURCE },
    survey: {
      version: 'initial_level_v2',
      answers: { ...answers },
    },
  };
}

function clientFor(fetchImpl, dependencies = {}) {
  return createPlayerInitialLevelReassessmentClient({
    fetchImpl,
    sleep: vi.fn().mockResolvedValue(true),
    random: () => 0,
    ...dependencies,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('playerInitialLevelReassessmentClient', () => {
  it('strictly reads required, completed and not-eligible owner states', async () => {
    const required = requiredState();
    const completed = completedState('C+');
    const notEligible = { status: 'not_eligible' };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(required))
      .mockResolvedValueOnce(response(completed))
      .mockResolvedValueOnce(response(notEligible));
    const client = clientFor(fetchImpl);

    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'loaded',
      reassessment: required,
    });
    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'loaded',
      reassessment: completed,
    });
    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'loaded',
      reassessment: notEligible,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url).toBe('/api/v1/onboarding/me/initial-level-reassessment');
      expect(options).toMatchObject({
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${CREDENTIAL}`,
        },
      });
      expect(options).not.toHaveProperty('body');
    }
    expect(Object.isFrozen(readPlayerInitialLevelReassessment(required))).toBe(
      true,
    );
  });

  it('sends only exact v2 option IDs and exposes only the server label', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(completedState('A')));
    const client = clientFor(fetchImpl);

    await expect(client.complete(CREDENTIAL, completion())).resolves.toEqual({
      outcome: 'completed',
      reassessment: completedState('A'),
    });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      '/api/v1/onboarding/me/initial-level-reassessment/complete',
    );
    expect(options).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${CREDENTIAL}`,
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(options.body)).toEqual({
      source: SOURCE,
      survey: {
        version: 'initial_level_v2',
        answers: ANSWERS,
      },
    });
    expect(options.body).not.toMatch(
      /score|formula|cap|rating|isVerified|phone|email/iu,
    );
  });

  it('retries an exact completion with a byte-identical body', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('private-network-marker'))
      .mockResolvedValueOnce(response(completedState('B')));
    const sleep = vi.fn().mockResolvedValue(true);
    const client = clientFor(fetchImpl, { sleep });

    await expect(client.complete(CREDENTIAL, completion())).resolves.toEqual({
      outcome: 'completed',
      reassessment: completedState('B'),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      fetchImpl.mock.calls[1][1].body,
    );
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('maps unauthorized and all reassessment conflicts without retrying', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          publicError(409, 'initial_level_reassessment_not_eligible'),
          409,
        ),
      )
      .mockResolvedValueOnce(
        response(
          publicError(409, 'initial_level_reassessment_source_conflict'),
          409,
        ),
      )
      .mockResolvedValueOnce(
        response(publicError(409, 'initial_level_reassessment_conflict'), 409),
      )
      .mockResolvedValueOnce(
        response(publicError(401, 'session_invalid'), 401),
      );
    const client = clientFor(fetchImpl);

    await expect(client.complete(CREDENTIAL, completion())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'not_eligible',
    });
    await expect(client.complete(CREDENTIAL, completion())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'stale_source',
    });
    await expect(client.complete(CREDENTIAL, completion())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'conflict',
    });
    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    [
      'missing answer',
      (() => {
        const answers = { ...ANSWERS };
        delete answers.glass_play;
        return completion(answers);
      })(),
    ],
    ['extra answer', completion({ ...ANSWERS, private_score: 'twenty' })],
    [
      'invalid option',
      completion({ ...ANSWERS, match_count: 'private_option' }),
    ],
    [
      'expanded source',
      { ...completion(), source: { ...SOURCE, accountId: 'private' } },
    ],
    [
      'expanded survey',
      { ...completion(), survey: { ...completion().survey, score: 20 } },
    ],
  ])('rejects %s before fetch', async (_label, request) => {
    const fetchImpl = vi.fn();
    const client = clientFor(fetchImpl);

    await expect(client.complete(CREDENTIAL, request)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['required extra field', { ...requiredState(), accountId: 'private' }],
    ['completed private score', { ...completedState(), initialLevelScore: 17 }],
    ['completed invalid label', completedState('S')],
    [
      'required stale source version',
      {
        ...requiredState(),
        source: { ...SOURCE, surveyVersion: 'initial_level_v0' },
      },
    ],
    ['not-eligible extra field', { status: 'not_eligible', reason: 'private' }],
  ])('fails closed on %s response', async (_label, state) => {
    const client = clientFor(vi.fn().mockResolvedValue(response(state)));

    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(readPlayerInitialLevelReassessment(state)).toBeNull();
  });

  it('requires canonical credentials and no-store bounded responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response(requiredState(), 200, 'private'));
    const client = clientFor(fetchImpl);

    await expect(client.read('invalid')).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(client.read(CREDENTIAL)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not persist or log credential, answers or private markers', async () => {
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
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('private-network-marker'))
      .mockResolvedValueOnce(response(completedState('D+')));
    const client = clientFor(fetchImpl);

    await expect(client.complete(CREDENTIAL, completion())).resolves.toEqual({
      outcome: 'completed',
      reassessment: completedState('D+'),
    });
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
