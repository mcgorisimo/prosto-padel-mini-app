import { isCanonicalSessionCredential } from './sessionCredential';

const REASSESSMENT_PATH = '/api/v1/onboarding/me/initial-level-reassessment';
const REASSESSMENT_COMPLETE_PATH = `${REASSESSMENT_PATH}/complete`;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUESTS = 3;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 2_000;
const MAX_RESPONSE_BODY_BYTES = 16_384;

const BODY_ABORTED = Symbol('initial-level-reassessment-body-aborted');
const BODY_INVALID = Symbol('initial-level-reassessment-body-invalid');
const BODY_NETWORK_FAILURE = Symbol(
  'initial-level-reassessment-body-network-failure',
);

const SOURCE_SURVEY_VERSION = 'initial_level_v1';
const REASSESSMENT_SURVEY_VERSION = 'initial_level_v2';
const FLOW_VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const INITIAL_LEVEL_LABELS = Object.freeze([
  'D',
  'D+',
  'C',
  'C+',
  'B',
  'B+',
  'A',
]);
const INITIAL_LEVEL_OPTIONS = Object.freeze({
  match_count: Object.freeze([
    'none',
    'one_to_ten',
    'eleven_to_thirty',
    'thirty_one_to_ninety_nine',
    'one_hundred_plus',
  ]),
  rally_stability: Object.freeze([
    'learning_contact',
    'short_rallies',
    'steady_slow',
    'steady_under_pressure',
    'controls_pace',
  ]),
  glass_play: Object.freeze([
    'not_used',
    'rarely_returns',
    'basic_returns',
    'confident_returns',
    'uses_tactically',
  ]),
  serve_return_net: Object.freeze([
    'learning_basics',
    'inconsistent',
    'stable_basics',
    'confident_patterns',
    'advanced_patterns',
  ]),
  match_experience_year: Object.freeze([
    'none',
    'casual_few',
    'regular_social',
    'league_or_club',
    'tournament',
  ]),
});
const INITIAL_LEVEL_QUESTION_CODES = Object.freeze(
  Object.keys(INITIAL_LEVEL_OPTIONS),
);

function frozen(outcome, extra = {}) {
  return Object.freeze({ outcome, ...extra });
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function readSource(value) {
  if (
    !hasExactKeys(value, ['flowVersion', 'surveyVersion', 'revision']) ||
    typeof value.flowVersion !== 'string' ||
    !FLOW_VERSION_PATTERN.test(value.flowVersion) ||
    value.surveyVersion !== SOURCE_SURVEY_VERSION ||
    !isRevision(value.revision)
  ) {
    return null;
  }
  return Object.freeze({
    flowVersion: value.flowVersion,
    surveyVersion: SOURCE_SURVEY_VERSION,
    revision: value.revision,
  });
}

function readAnswers(value) {
  if (!hasExactKeys(value, INITIAL_LEVEL_QUESTION_CODES)) return null;
  const entries = INITIAL_LEVEL_QUESTION_CODES.map((question) => {
    const answer = value[question];
    return typeof answer === 'string' &&
      INITIAL_LEVEL_OPTIONS[question].includes(answer)
      ? [question, answer]
      : null;
  });
  if (entries.some((entry) => entry === null)) return null;
  return Object.freeze(Object.fromEntries(entries));
}

export function readPlayerInitialLevelReassessment(value) {
  if (!isPlainObject(value) || typeof value.status !== 'string') return null;
  if (value.status === 'not_eligible') {
    return hasExactKeys(value, ['status'])
      ? Object.freeze({ status: 'not_eligible' })
      : null;
  }
  if (value.status === 'completed') {
    return hasExactKeys(value, [
      'status',
      'surveyVersion',
      'initialLevelLabel',
    ]) &&
      value.surveyVersion === REASSESSMENT_SURVEY_VERSION &&
      INITIAL_LEVEL_LABELS.includes(value.initialLevelLabel)
      ? Object.freeze({
          status: 'completed',
          surveyVersion: REASSESSMENT_SURVEY_VERSION,
          initialLevelLabel: value.initialLevelLabel,
        })
      : null;
  }
  if (
    value.status !== 'required' ||
    !hasExactKeys(value, ['status', 'source', 'surveyVersion']) ||
    value.surveyVersion !== REASSESSMENT_SURVEY_VERSION
  ) {
    return null;
  }
  const source = readSource(value.source);
  return source === null
    ? null
    : Object.freeze({
        status: 'required',
        source,
        surveyVersion: REASSESSMENT_SURVEY_VERSION,
      });
}

function readCompletion(value) {
  if (
    !hasExactKeys(value, ['source', 'survey']) ||
    !hasExactKeys(value.survey, ['version', 'answers']) ||
    value.survey.version !== REASSESSMENT_SURVEY_VERSION
  ) {
    return null;
  }
  const source = readSource(value.source);
  const answers = readAnswers(value.survey.answers);
  return source === null || answers === null
    ? null
    : Object.freeze({
        source,
        survey: Object.freeze({
          version: REASSESSMENT_SURVEY_VERSION,
          answers,
        }),
      });
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel();
    if (cancellation && typeof cancellation.catch === 'function') {
      void cancellation.catch(() => {});
    }
  } catch {
    // Cleanup is best-effort after a bounded-body failure.
  }
}

function waitForRead(readPromise, signal, reader) {
  if (signal.aborted) {
    cancelReader(reader);
    return Promise.reject(BODY_ABORTED);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      callback(result);
    };
    const handleAbort = () => {
      cancelReader(reader);
      finish(reject, BODY_ABORTED);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    readPromise.then(
      (result) => finish(resolve, result),
      () =>
        finish(reject, signal.aborted ? BODY_ABORTED : BODY_NETWORK_FAILURE),
    );
  });
}

async function readBoundedJson(response, signal) {
  const cacheControl = response.headers?.get?.('cache-control');
  if (
    typeof cacheControl !== 'string' ||
    !cacheControl
      .split(',')
      .some((directive) => directive.trim().toLowerCase() === 'no-store')
  ) {
    throw BODY_INVALID;
  }
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_RESPONSE_BODY_BYTES
    ) {
      cancelReader(response.body);
      throw BODY_INVALID;
    }
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw BODY_INVALID;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await waitForRead(reader.read(), signal, reader);
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw BODY_INVALID;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
        cancelReader(reader);
        throw BODY_INVALID;
      }
      try {
        text += decoder.decode(chunk.value, { stream: true });
      } catch {
        throw BODY_INVALID;
      }
    }
    try {
      text += decoder.decode();
      return JSON.parse(text);
    } catch {
      throw BODY_INVALID;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be cancelled and unlocked.
    }
  }
}

function defaultSleep(delayMs, signal) {
  return new Promise((resolve) => {
    let timer = null;
    const finish = (completed) => {
      if (timer !== null) globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      resolve(completed);
    };
    const handleAbort = () => finish(false);
    if (signal?.aborted) {
      finish(false);
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    timer = globalThis.setTimeout(() => finish(true), delayMs);
  });
}

function retryDelayMs(retryNumber, random) {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** retryNumber);
  const half = ceiling / 2;
  return Math.floor(half + Math.max(0, Math.min(1, random())) * half);
}

function readPublicCode(status, body) {
  return hasExactKeys(body, ['statusCode', 'code', 'message']) &&
    body.statusCode === status &&
    typeof body.code === 'string' &&
    typeof body.message === 'string'
    ? body.code
    : '';
}

function classifyFailure(status, body) {
  const code = readPublicCode(status, body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  const reasons = Object.freeze({
    initial_level_reassessment_invalid_request: 'invalid_request',
    initial_level_reassessment_not_eligible: 'not_eligible',
    initial_level_reassessment_source_conflict: 'stale_source',
    initial_level_reassessment_conflict: 'conflict',
    initial_level_reassessment_internal_error: 'internal_error',
  });
  return frozen('rejected', { reason: reasons[code] ?? 'internal_error' });
}

export function createPlayerInitialLevelReassessmentClient(dependencies = {}) {
  const fetchImpl =
    dependencies.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  async function requestOnce(operation, credential, serializedBody, signal) {
    if (
      typeof fetchImpl !== 'function' ||
      typeof AbortController !== 'function' ||
      !Number.isFinite(requestTimeoutMs) ||
      requestTimeoutMs <= 0
    ) {
      return frozen('configuration_failure');
    }
    if (signal?.aborted) return frozen('cancelled');

    const controller = new AbortController();
    let timedOut = false;
    const handleAbort = () => controller.abort();
    signal?.addEventListener('abort', handleAbort, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    try {
      const isRead = operation === 'read';
      const response = await fetchImpl(
        isRead ? REASSESSMENT_PATH : REASSESSMENT_COMPLETE_PATH,
        {
          method: isRead ? 'GET' : 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${credential}`,
            ...(isRead ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(isRead ? {} : { body: serializedBody }),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        },
      );
      const body = await readBoundedJson(response, controller.signal);
      if (response.status === 200) {
        const reassessment = readPlayerInitialLevelReassessment(body);
        if (
          reassessment === null ||
          (operation === 'complete' && reassessment.status !== 'completed')
        ) {
          return frozen('malformed_response');
        }
        return frozen('success', {
          result: frozen(operation === 'read' ? 'loaded' : 'completed', {
            reassessment,
          }),
        });
      }
      if (
        response.status === 503 &&
        readPublicCode(response.status, body) ===
          'initial_level_reassessment_unavailable'
      ) {
        return frozen('retryable_unavailable');
      }
      return frozen('failure', {
        result: classifyFailure(response.status, body),
      });
    } catch (error) {
      if (signal?.aborted) return frozen('cancelled');
      if (timedOut || error === BODY_ABORTED) {
        return frozen('request_timeout');
      }
      if (error === BODY_INVALID) return frozen('malformed_response');
      if (error === BODY_NETWORK_FAILURE) return frozen('network_failure');
      return frozen('network_failure');
    } finally {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', handleAbort);
    }
  }

  async function execute(operation, credential, completion, options = {}) {
    if (!isCanonicalSessionCredential(credential)) {
      return frozen('rejected', { reason: 'invalid' });
    }
    if (options.signal?.aborted) return frozen('cancelled');
    const normalizedCompletion =
      operation === 'complete' ? readCompletion(completion) : undefined;
    if (operation === 'complete' && normalizedCompletion === null) {
      return frozen('rejected', { reason: 'invalid_request' });
    }
    const serializedBody =
      normalizedCompletion === undefined
        ? undefined
        : JSON.stringify(normalizedCompletion);

    for (
      let requestNumber = 0;
      requestNumber < MAX_REQUESTS;
      requestNumber += 1
    ) {
      const attempt = await requestOnce(
        operation,
        credential,
        serializedBody,
        options.signal,
      );
      if (attempt.outcome === 'success') return attempt.result;
      if (attempt.outcome === 'failure') return attempt.result;
      if (attempt.outcome === 'cancelled') return frozen('cancelled');
      if (
        ![
          'network_failure',
          'request_timeout',
          'retryable_unavailable',
        ].includes(attempt.outcome)
      ) {
        return frozen('rejected', { reason: 'internal_error' });
      }
      if (requestNumber === MAX_REQUESTS - 1) {
        return frozen('rejected', { reason: 'temporary_unavailable' });
      }
      let completed;
      try {
        completed = await sleep(
          retryDelayMs(requestNumber, random),
          options.signal,
        );
      } catch {
        return options.signal?.aborted
          ? frozen('cancelled')
          : frozen('rejected', { reason: 'internal_error' });
      }
      if (completed === false || options.signal?.aborted) {
        return options.signal?.aborted
          ? frozen('cancelled')
          : frozen('rejected', { reason: 'internal_error' });
      }
    }
    return frozen('rejected', { reason: 'internal_error' });
  }

  return Object.freeze({
    read: (credential, options) =>
      execute('read', credential, undefined, options),
    complete: (credential, completion, options) =>
      execute('complete', credential, completion, options),
  });
}

export const playerInitialLevelReassessmentClient =
  createPlayerInitialLevelReassessmentClient();
