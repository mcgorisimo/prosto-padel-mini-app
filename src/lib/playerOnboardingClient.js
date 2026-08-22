import { isCanonicalSessionCredential } from './sessionCredential';

const ONBOARDING_PATH = '/api/v1/onboarding/me';
const ONBOARDING_PROGRESS_PATH = `${ONBOARDING_PATH}/progress`;
const ONBOARDING_COMPLETE_PATH = `${ONBOARDING_PATH}/complete`;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUESTS = 3;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 2_000;
const MAX_RESPONSE_BODY_BYTES = 32_768;

const BODY_ABORTED = Symbol('player-onboarding-body-aborted');
const BODY_INVALID = Symbol('player-onboarding-body-invalid');
const BODY_NETWORK_FAILURE = Symbol('player-onboarding-body-network-failure');

const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;
const FLOW_VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const DOCUMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;
const ANSWER_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const ONBOARDING_STEPS = Object.freeze([
  'profile',
  'contacts',
  'consents',
  'level_survey',
  'completed',
]);
const CONSENT_KINDS = Object.freeze(['terms', 'privacy', 'cancellation']);

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

function isBoundedString(value, maximumCodePoints) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximumCodePoints
  );
}

function isCanonicalEmail(value) {
  return (
    typeof value === 'string' &&
    value.length <= 320 &&
    value === value.trim().toLowerCase() &&
    EMAIL_PATTERN.test(value)
  );
}

function isRevision(value, nullable = false) {
  return (
    (nullable && value === null) || (Number.isSafeInteger(value) && value >= 1)
  );
}

function compareConsents(left, right) {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  if (left.documentVersion === right.documentVersion) return 0;
  return left.documentVersion < right.documentVersion ? -1 : 1;
}

function readConsent(value) {
  if (
    !hasExactKeys(value, ['kind', 'documentVersion']) ||
    !CONSENT_KINDS.includes(value.kind) ||
    typeof value.documentVersion !== 'string' ||
    !DOCUMENT_VERSION_PATTERN.test(value.documentVersion)
  ) {
    return null;
  }
  return Object.freeze({
    kind: value.kind,
    documentVersion: value.documentVersion,
  });
}

function readConsents(value, requireCurrentKinds = false) {
  if (!Array.isArray(value)) return null;
  const consents = [];
  const exactPairs = new Set();
  for (const candidate of value) {
    const consent = readConsent(candidate);
    if (!consent) return null;
    const pair = `${consent.kind}\0${consent.documentVersion}`;
    if (exactPairs.has(pair)) return null;
    exactPairs.add(pair);
    consents.push(consent);
  }
  if (
    requireCurrentKinds &&
    (consents.length !== CONSENT_KINDS.length ||
      new Set(consents.map(({ kind }) => kind)).size !== CONSENT_KINDS.length)
  ) {
    return null;
  }
  return Object.freeze(consents.sort(compareConsents));
}

function readSurveyAnswers(value, requireAnswers = false) {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (
    entries.length > 16 ||
    (requireAnswers && entries.length === 0) ||
    entries.some(
      ([question, answer]) =>
        !ANSWER_CODE_PATTERN.test(question) ||
        typeof answer !== 'string' ||
        !ANSWER_CODE_PATTERN.test(answer),
    )
  ) {
    return null;
  }
  return Object.freeze(
    Object.fromEntries(
      entries.sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

export function readPlayerOnboardingState(value) {
  if (
    !hasExactKeys(value, [
      'status',
      'flowVersion',
      'currentStep',
      'surveyVersion',
      'revision',
      'profile',
      'contacts',
      'consents',
      'surveyAnswers',
    ]) ||
    !['required', 'in_progress', 'completed'].includes(value.status) ||
    !ONBOARDING_STEPS.includes(value.currentStep) ||
    !hasExactKeys(value.profile, ['firstName', 'lastName']) ||
    !isBoundedString(value.profile.firstName, 256) ||
    !(
      value.profile.lastName === null ||
      isBoundedString(value.profile.lastName, 256)
    ) ||
    !hasExactKeys(value.contacts, ['phone', 'normalizedEmail', 'assurance']) ||
    !(
      value.contacts.phone === null ||
      (typeof value.contacts.phone === 'string' &&
        PHONE_PATTERN.test(value.contacts.phone))
    ) ||
    !(
      value.contacts.normalizedEmail === null ||
      isCanonicalEmail(value.contacts.normalizedEmail)
    ) ||
    value.contacts.assurance !== 'declared'
  ) {
    return null;
  }

  const consents = readConsents(value.consents);
  const surveyAnswers = readSurveyAnswers(
    value.surveyAnswers,
    value.status === 'completed',
  );
  if (!consents || !surveyAnswers) return null;

  if (
    value.status === 'required'
      ? value.flowVersion !== null ||
        value.currentStep !== 'profile' ||
        value.surveyVersion !== null ||
        value.revision !== null ||
        consents.length !== 0 ||
        Object.keys(surveyAnswers).length !== 0
      : typeof value.flowVersion !== 'string' ||
        !FLOW_VERSION_PATTERN.test(value.flowVersion) ||
        typeof value.surveyVersion !== 'string' ||
        !FLOW_VERSION_PATTERN.test(value.surveyVersion) ||
        !isRevision(value.revision) ||
        (value.status === 'completed'
          ? value.currentStep !== 'completed'
          : value.currentStep === 'completed')
  ) {
    return null;
  }

  return Object.freeze({
    status: value.status,
    flowVersion: value.flowVersion,
    currentStep: value.currentStep,
    surveyVersion: value.surveyVersion,
    revision: value.revision,
    profile: Object.freeze({
      firstName: value.profile.firstName,
      lastName: value.profile.lastName,
    }),
    contacts: Object.freeze({
      phone: value.contacts.phone,
      normalizedEmail: value.contacts.normalizedEmail,
      assurance: 'declared',
    }),
    consents,
    surveyAnswers,
  });
}

function readDraft(value) {
  if (
    !hasExactKeys(value, ['expectedRevision', 'profile', 'contacts']) ||
    !isRevision(value.expectedRevision, true) ||
    !hasExactKeys(value.profile, ['firstName', 'lastName']) ||
    !isBoundedString(value.profile.firstName, 256) ||
    value.profile.firstName !== value.profile.firstName.trim() ||
    !(
      value.profile.lastName === null ||
      (isBoundedString(value.profile.lastName, 256) &&
        value.profile.lastName === value.profile.lastName.trim())
    ) ||
    !hasExactKeys(value.contacts, ['phone', 'email']) ||
    !(
      value.contacts.phone === null ||
      (typeof value.contacts.phone === 'string' &&
        PHONE_PATTERN.test(value.contacts.phone))
    ) ||
    !(
      value.contacts.email === null ||
      (typeof value.contacts.email === 'string' &&
        value.contacts.email.length <= 512)
    )
  ) {
    return null;
  }
  const normalizedEmail =
    value.contacts.email === null
      ? null
      : value.contacts.email.trim().toLowerCase();
  if (normalizedEmail !== null && !isCanonicalEmail(normalizedEmail)) {
    return null;
  }
  return Object.freeze({
    expectedRevision: value.expectedRevision,
    profile: Object.freeze({
      firstName: value.profile.firstName,
      lastName: value.profile.lastName,
    }),
    contacts: Object.freeze({
      phone: value.contacts.phone,
      email: normalizedEmail,
    }),
  });
}

function readProgress(value) {
  if (
    !isPlainObject(value) ||
    !isRevision(value.expectedRevision) ||
    typeof value.flowVersion !== 'string' ||
    !FLOW_VERSION_PATTERN.test(value.flowVersion)
  ) {
    return null;
  }
  if (
    value.nextStep === 'consents' &&
    hasExactKeys(value, ['expectedRevision', 'flowVersion', 'nextStep'])
  ) {
    return Object.freeze({
      expectedRevision: value.expectedRevision,
      flowVersion: value.flowVersion,
      nextStep: 'consents',
    });
  }
  if (
    value.nextStep !== 'level_survey' ||
    !hasExactKeys(value, [
      'expectedRevision',
      'flowVersion',
      'nextStep',
      'consents',
    ])
  ) {
    return null;
  }
  const consents = readConsents(value.consents, true);
  return consents
    ? Object.freeze({
        expectedRevision: value.expectedRevision,
        flowVersion: value.flowVersion,
        nextStep: 'level_survey',
        consents,
      })
    : null;
}

function readCompletion(value) {
  if (
    !hasExactKeys(value, [
      'expectedRevision',
      'flowVersion',
      'consents',
      'survey',
    ]) ||
    !isRevision(value.expectedRevision) ||
    typeof value.flowVersion !== 'string' ||
    !FLOW_VERSION_PATTERN.test(value.flowVersion) ||
    !hasExactKeys(value.survey, ['version', 'answers']) ||
    typeof value.survey.version !== 'string' ||
    !FLOW_VERSION_PATTERN.test(value.survey.version)
  ) {
    return null;
  }
  const consents = readConsents(value.consents, true);
  const answers = readSurveyAnswers(value.survey.answers, true);
  if (!consents || !answers) return null;
  return Object.freeze({
    expectedRevision: value.expectedRevision,
    flowVersion: value.flowVersion,
    consents,
    survey: Object.freeze({
      version: value.survey.version,
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

function classifyFailure(operation, status, body) {
  const code = readPublicCode(status, body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  const reasons = Object.freeze({
    onboarding_not_found: 'not_found',
    onboarding_draft_invalid_request: 'invalid_request',
    onboarding_draft_revision_conflict: 'stale_revision',
    onboarding_draft_closed: 'closed',
    onboarding_draft_content_not_allowed: 'content_not_allowed',
    onboarding_progress_invalid_request: 'invalid_request',
    onboarding_progress_revision_conflict: 'stale_revision',
    onboarding_progress_conflict: 'conflict',
    onboarding_progress_incomplete: 'incomplete',
    onboarding_progress_closed: 'closed',
    onboarding_completion_invalid_request: 'invalid_request',
    onboarding_completion_revision_conflict: 'stale_revision',
    onboarding_completion_conflict: 'conflict',
    onboarding_incomplete: 'incomplete',
  });
  if (operation === 'read' && code === 'onboarding_not_found') {
    return frozen('rejected', { reason: 'not_found' });
  }
  return frozen('rejected', { reason: reasons[code] ?? 'internal_error' });
}

export function createPlayerOnboardingClient(dependencies = {}) {
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
    const isRead = operation === 'read';
    const path =
      operation === 'progress'
        ? ONBOARDING_PROGRESS_PATH
        : operation === 'complete'
          ? ONBOARDING_COMPLETE_PATH
          : ONBOARDING_PATH;
    try {
      const response = await fetchImpl(path, {
        method: isRead ? 'GET' : operation === 'draft' ? 'PATCH' : 'POST',
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
      });
      const body = await readBoundedJson(response, controller.signal);
      if (response.status === 200) {
        const onboarding = readPlayerOnboardingState(body);
        return onboarding
          ? frozen('success', {
              result: frozen(
                operation === 'read'
                  ? 'loaded'
                  : operation === 'draft'
                    ? 'saved'
                    : operation === 'progress'
                      ? 'advanced'
                      : 'completed',
                { onboarding },
              ),
            })
          : frozen('malformed_response');
      }
      if (
        response.status === 503 &&
        readPublicCode(response.status, body) ===
          'onboarding_service_unavailable'
      ) {
        return frozen('retryable_unavailable');
      }
      return frozen('failure', {
        result: classifyFailure(operation, response.status, body),
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

  async function execute(operation, credential, payload, options = {}) {
    if (!isCanonicalSessionCredential(credential)) {
      return frozen('rejected', { reason: 'invalid' });
    }
    if (options.signal?.aborted) return frozen('cancelled');
    const normalizedPayload =
      operation === 'read'
        ? undefined
        : operation === 'draft'
          ? readDraft(payload)
          : operation === 'progress'
            ? readProgress(payload)
            : readCompletion(payload);
    if (operation !== 'read' && !normalizedPayload) {
      return frozen('rejected', { reason: 'invalid_request' });
    }
    const serializedBody =
      normalizedPayload === undefined
        ? undefined
        : JSON.stringify(normalizedPayload);

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
        attempt.outcome !== 'network_failure' &&
        attempt.outcome !== 'request_timeout' &&
        attempt.outcome !== 'retryable_unavailable'
      ) {
        return frozen('rejected', { reason: 'internal_error' });
      }
      if (
        operation === 'draft' &&
        (attempt.outcome === 'network_failure' ||
          attempt.outcome === 'request_timeout')
      ) {
        return frozen('rejected', { reason: 'unknown_outcome' });
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
    saveDraft: (credential, draft, options) =>
      execute('draft', credential, draft, options),
    advance: (credential, progress, options) =>
      execute('progress', credential, progress, options),
    complete: (credential, completion, options) =>
      execute('complete', credential, completion, options),
  });
}

export const playerOnboardingClient = createPlayerOnboardingClient();
