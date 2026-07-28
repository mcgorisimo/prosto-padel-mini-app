import { isCanonicalSessionCredential } from './sessionCredential';

const REFRESH_PATH = '/api/v1/auth/session/refresh';
const LOGOUT_PATH = '/api/v1/auth/session/logout';
const AUTHENTICATE_PATH = '/api/v1/auth/session/me';
const PROFILE_PATH = '/api/v1/profile/me';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUESTS = 3;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 2_000;
const MAX_RESPONSE_BODY_BYTES = 32_768;

const BODY_ABORTED = Symbol('backend-session-body-aborted');
const BODY_INVALID = Symbol('backend-session-body-invalid');
const BODY_NETWORK_FAILURE = Symbol('backend-session-body-network-failure');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTERNAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

function isBoundedString(value, maximumCodePoints) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximumCodePoints
  );
}

function isNullableBoundedString(value, maximumCodePoints) {
  return value === null || isBoundedString(value, maximumCodePoints);
}

function exactPublicCode(body) {
  return isPlainObject(body) && typeof body.code === 'string'
    ? body.code
    : '';
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel();
    if (cancellation && typeof cancellation.catch === 'function') {
      void cancellation.catch(() => {});
    }
  } catch {
    // Cancellation is best-effort after abort.
  }
}

function waitForRead(readPromise, signal, reader) {
  if (signal.aborted) {
    cancelReader(reader);
    return Promise.reject(BODY_ABORTED);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      callback(value);
    };
    const handleAbort = () => {
      cancelReader(reader);
      finish(reject, BODY_ABORTED);
    };

    signal.addEventListener('abort', handleAbort, { once: true });
    readPromise.then(
      (value) => finish(resolve, value),
      () => finish(
        reject,
        signal.aborted ? BODY_ABORTED : BODY_NETWORK_FAILURE,
      ),
    );
  });
}

async function readBoundedJson(response, signal) {
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_RESPONSE_BODY_BYTES
    ) {
      try {
        const cancellation = response.body?.cancel?.();
        if (cancellation && typeof cancellation.catch === 'function') {
          void cancellation.catch(() => {});
        }
      } catch {
        // The response is rejected regardless of cleanup.
      }
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
      // The body may already be cancelled.
    }
  }
}

function createRequestKey(cryptoImpl) {
  if (!cryptoImpl || typeof cryptoImpl.randomUUID !== 'function') return null;
  try {
    const requestKey = cryptoImpl.randomUUID();
    return typeof requestKey === 'string' && UUID_PATTERN.test(requestKey)
      ? requestKey
      : null;
  } catch {
    return null;
  }
}

function defaultSleep(delayMs, signal) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
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
  const ceiling = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * (2 ** retryNumber),
  );
  const half = ceiling / 2;
  return Math.floor(
    half + (Math.max(0, Math.min(1, random())) * half),
  );
}

function refreshSuccess(body) {
  if (!isPlainObject(body)) return null;
  const keys = Object.keys(body).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== 'credential' ||
    keys[1] !== 'expiresAt' ||
    !isCanonicalSessionCredential(body.credential) ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Math.floor(Date.now() / 1_000)
  ) {
    return null;
  }
  return frozen('refreshed', {
    credential: body.credential,
    expiresAt: body.expiresAt,
  });
}

function authenticationSuccess(body) {
  if (!isPlainObject(body)) return null;
  const keys = Object.keys(body).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'accountId' ||
    keys[1] !== 'expiresAt' ||
    keys[2] !== 'role' ||
    !INTERNAL_UUID_PATTERN.test(body.accountId) ||
    (body.role !== 'player' && body.role !== 'club_admin') ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Math.floor(Date.now() / 1_000)
  ) {
    return null;
  }
  return frozen('authenticated', {
    principal: Object.freeze({
      accountId: body.accountId,
      role: body.role,
      expiresAt: body.expiresAt,
    }),
  });
}

export function isBackendOwnProfile(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 7 ||
    keys[0] !== 'accountId' ||
    keys[1] !== 'firstName' ||
    keys[2] !== 'languageCode' ||
    keys[3] !== 'lastName' ||
    keys[4] !== 'photoUrl' ||
    keys[5] !== 'role' ||
    keys[6] !== 'username' ||
    !INTERNAL_UUID_PATTERN.test(value.accountId) ||
    value.role !== 'player' ||
    !isBoundedString(value.firstName, 256) ||
    !isNullableBoundedString(value.lastName, 256) ||
    !isNullableBoundedString(value.username, 64) ||
    !isNullableBoundedString(value.photoUrl, 2_048) ||
    !isNullableBoundedString(value.languageCode, 64)
  ) {
    return false;
  }
  if (value.photoUrl !== null) {
    try {
      if (new URL(value.photoUrl).protocol !== 'https:') return false;
    } catch {
      return false;
    }
  }
  return true;
}

function profileSuccess(body) {
  if (!isBackendOwnProfile(body)) return null;
  return frozen('profile_loaded', {
    profile: Object.freeze({
      accountId: body.accountId,
      role: body.role,
      firstName: body.firstName,
      lastName: body.lastName,
      username: body.username,
      photoUrl: body.photoUrl,
      languageCode: body.languageCode,
    }),
  });
}

function classifyRefresh(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_expired') {
    return frozen('rejected', { reason: 'expired' });
  }
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  if (status === 409 && code === 'session_refresh_reopen_required') {
    return frozen('rejected', { reason: 'reopen_required' });
  }
  if (status === 409 && code === 'session_request_conflict') {
    return frozen('rejected', { reason: 'conflict' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

function classifyLogout(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  if (status === 409 && code === 'session_request_conflict') {
    return frozen('rejected', { reason: 'conflict' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

function classifyAuthentication(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

function classifyProfile(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  if (status === 404 && code === 'profile_not_found') {
    return frozen('rejected', { reason: 'profile_not_found' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

export function createBackendSessionClient(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const cryptoImpl = dependencies.cryptoImpl ?? globalThis.crypto;
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;
  const requestTimeoutMs =
    dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  async function requestOnce(operation, credential, requestKey, externalSignal) {
    if (
      typeof fetchImpl !== 'function' ||
      typeof AbortController !== 'function' ||
      !Number.isFinite(requestTimeoutMs) ||
      requestTimeoutMs <= 0
    ) {
      return frozen('configuration_failure');
    }
    if (externalSignal?.aborted) return frozen('cancelled');

    const controller = new AbortController();
    let timedOut = false;
    const handleExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', handleExternalAbort, {
      once: true,
    });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);

    try {
      const isReadOnly =
        operation === 'authenticate' || operation === 'profile';
      const response = await fetchImpl(
        operation === 'refresh'
          ? REFRESH_PATH
          : operation === 'logout'
            ? LOGOUT_PATH
            : operation === 'profile'
              ? PROFILE_PATH
              : AUTHENTICATE_PATH,
        {
          method: isReadOnly ? 'GET' : 'POST',
          headers: isReadOnly
            ? {
                Accept: 'application/json',
                Authorization: `Bearer ${credential}`,
              }
            : {
                Accept: 'application/json',
                Authorization: `Bearer ${credential}`,
                'Content-Type': 'application/json',
              },
          ...(isReadOnly
            ? {}
            : { body: JSON.stringify({ requestKey }) }),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        },
      );

      if (operation === 'logout' && response.status === 204) {
        return frozen('success', { result: frozen('logged_out') });
      }

      const body = await readBoundedJson(response, controller.signal);
      if (operation === 'authenticate' && response.status === 200) {
        const result = authenticationSuccess(body);
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'profile' && response.status === 200) {
        const result = profileSuccess(body);
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'refresh' && response.status === 200) {
        const result = refreshSuccess(body);
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (
        response.status === 503 &&
        exactPublicCode(body) === (
          operation === 'profile'
            ? 'profile_service_unavailable'
            : 'session_service_unavailable'
        )
      ) {
        return frozen('retryable_unavailable');
      }
      return frozen('success', {
        result:
          operation === 'refresh'
            ? classifyRefresh(response.status, body)
            : operation === 'logout'
              ? classifyLogout(response.status, body)
              : operation === 'profile'
                ? classifyProfile(response.status, body)
                : classifyAuthentication(response.status, body),
      });
    } catch (error) {
      if (externalSignal?.aborted) return frozen('cancelled');
      if (timedOut || error === BODY_ABORTED) return frozen('request_timeout');
      if (error === BODY_INVALID) return frozen('malformed_response');
      if (error === BODY_NETWORK_FAILURE) return frozen('network_failure');
      return frozen('network_failure');
    } finally {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', handleExternalAbort);
    }
  }

  async function execute(operation, credential, options = {}) {
    const externalSignal = options.signal;
    if (!isCanonicalSessionCredential(credential)) {
      return frozen('rejected', { reason: 'invalid' });
    }
    if (externalSignal?.aborted) return frozen('cancelled');

    const requiresRequestKey =
      operation === 'refresh' || operation === 'logout';
    const requestKey =
      requiresRequestKey ? createRequestKey(cryptoImpl) : null;
    if (requiresRequestKey && !requestKey) {
      return frozen('rejected', { reason: 'internal_error' });
    }

    for (let requestNumber = 0; requestNumber < MAX_REQUESTS; requestNumber += 1) {
      const attempt = await requestOnce(
        operation,
        credential,
        requestKey,
        externalSignal,
      );
      if (attempt.outcome === 'success') return attempt.result;
      if (attempt.outcome === 'cancelled') return frozen('cancelled');
      if (attempt.outcome === 'configuration_failure') {
        return frozen('rejected', { reason: 'internal_error' });
      }
      if (
        attempt.outcome === 'network_failure' ||
        attempt.outcome === 'request_timeout' ||
        attempt.outcome === 'retryable_unavailable'
      ) {
        if (requestNumber === MAX_REQUESTS - 1) {
          return frozen('rejected', { reason: 'temporary_unavailable' });
        }
        let completed;
        try {
          completed = await sleep(
            retryDelayMs(requestNumber, random),
            externalSignal,
          );
        } catch {
          return externalSignal?.aborted
            ? frozen('cancelled')
            : frozen('rejected', { reason: 'internal_error' });
        }
        if (completed === false || externalSignal?.aborted) {
          return externalSignal?.aborted
            ? frozen('cancelled')
            : frozen('rejected', { reason: 'internal_error' });
        }
        continue;
      }
      return frozen('rejected', { reason: 'internal_error' });
    }
    return frozen('rejected', { reason: 'internal_error' });
  }

  return Object.freeze({
    authenticate: (credential, options) =>
      execute('authenticate', credential, options),
    readOwnProfile: (credential, options) =>
      execute('profile', credential, options),
    refresh: (credential, options) =>
      execute('refresh', credential, options),
    logout: (credential, options) =>
      execute('logout', credential, options),
  });
}

export const backendSessionClient = createBackendSessionClient();
