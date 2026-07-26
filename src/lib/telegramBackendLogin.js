const TELEGRAM_LOGIN_PATH = '/api/v1/auth/telegram/login';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUESTS = 3;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 2_000;
const MAX_INIT_DATA_UTF8_BYTES = 16_384;
const MAX_RESPONSE_BODY_BYTES = 32_768;

const BODY_ABORTED = Symbol('telegram-login-body-aborted');
const BODY_INVALID = Symbol('telegram-login-body-invalid');
const BODY_NETWORK_FAILURE = Symbol('telegram-login-body-network-failure');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const FAILURE_KINDS = Object.freeze({
  invalidTelegramData: 'invalid_telegram_data',
  accountUnavailable: 'account_unavailable',
  conflictReopenRequired: 'conflict_reopen_required',
  temporaryUnavailable: 'temporary_unavailable',
  internalError: 'internal_error',
});

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fixedFailure(errorKind) {
  return Object.freeze({ outcome: 'failed', errorKind });
}

function readSuccess(body) {
  if (!isPlainObject(body)) return null;

  const keys = Object.keys(body).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'accountKind' ||
    keys[1] !== 'credential' ||
    keys[2] !== 'expiresAt' ||
    typeof body.credential !== 'string' ||
    body.credential.length === 0 ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Math.floor(Date.now() / 1_000) ||
    (body.accountKind !== 'new' && body.accountKind !== 'existing')
  ) {
    return null;
  }

  return Object.freeze({
    outcome: 'authenticated',
    credential: body.credential,
    expiresAt: body.expiresAt,
    accountKind: body.accountKind,
  });
}

function classifyFailure(status, body) {
  const code = isPlainObject(body) && typeof body.code === 'string'
    ? body.code
    : '';

  if (status === 401 && code === 'telegram_authentication_failed') {
    return fixedFailure(FAILURE_KINDS.invalidTelegramData);
  }
  if (status === 403 && code === 'telegram_account_unavailable') {
    return fixedFailure(FAILURE_KINDS.accountUnavailable);
  }
  if (
    status === 409 &&
    (code === 'telegram_proof_replayed' ||
      code === 'telegram_authentication_conflict')
  ) {
    return fixedFailure(FAILURE_KINDS.conflictReopenRequired);
  }

  return fixedFailure(FAILURE_KINDS.internalError);
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel();
    if (cancellation && typeof cancellation.catch === 'function') {
      void cancellation.catch(() => {});
    }
  } catch {
    // Cancellation is best-effort after the request has already been aborted.
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
        // The malformed response is rejected regardless of cleanup outcome.
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

      if (!(chunk.value instanceof Uint8Array)) {
        throw BODY_INVALID;
      }

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
      // The body may already be cancelled and unlocked.
    }
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

function waitForBackoff(sleep, delayMs, signal) {
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (completed) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      resolve(completed);
    };

    const handleAbort = () => finish(false);
    signal?.addEventListener('abort', handleAbort, { once: true });

    Promise.resolve()
      .then(() => sleep(delayMs, signal))
      .then(
        (completed) => finish(completed !== false && !signal?.aborted),
        () => finish(false),
      );
  });
}

function retryDelayMs(retryNumber, random) {
  const ceiling = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * (2 ** retryNumber),
  );
  const half = ceiling / 2;
  return Math.floor(half + (Math.max(0, Math.min(1, random())) * half));
}

function createRequestKey(cryptoImpl) {
  if (!cryptoImpl || typeof cryptoImpl.randomUUID !== 'function') {
    return null;
  }

  let requestKey;
  try {
    requestKey = cryptoImpl.randomUUID();
  } catch {
    return null;
  }

  return typeof requestKey === 'string' && UUID_PATTERN.test(requestKey)
    ? requestKey
    : null;
}

export function createTelegramBackendLoginClient(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const cryptoImpl = dependencies.cryptoImpl ?? globalThis.crypto;
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;
  const requestTimeoutMs =
    dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  async function requestOnce(initData, requestKey, externalSignal) {
    if (
      typeof fetchImpl !== 'function' ||
      typeof AbortController !== 'function' ||
      !Number.isFinite(requestTimeoutMs) ||
      requestTimeoutMs <= 0
    ) {
      return Object.freeze({ kind: 'configuration_failure' });
    }

    if (externalSignal?.aborted) {
      return Object.freeze({ kind: 'cancelled' });
    }

    const controller = new AbortController();
    let timedOut = false;

    const handleExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', handleExternalAbort, {
      once: true,
    });

    const timeout = globalThis.setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      requestTimeoutMs,
    );

    try {
      const response = await fetchImpl(TELEGRAM_LOGIN_PATH, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initData, requestKey }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });

      const body = await readBoundedJson(response, controller.signal);

      if (response.status === 200) {
        const result = readSuccess(body);
        return result
          ? Object.freeze({ kind: 'success', result })
          : Object.freeze({ kind: 'malformed_response' });
      }

      if (
        response.status === 503 &&
        isPlainObject(body) &&
        body.code === 'telegram_authentication_unavailable'
      ) {
        return Object.freeze({ kind: 'retryable_unavailable' });
      }

      return Object.freeze({
        kind: 'failure',
        result: classifyFailure(response.status, body),
      });
    } catch (error) {
      if (externalSignal?.aborted) {
        return Object.freeze({ kind: 'cancelled' });
      }
      if (timedOut || error === BODY_ABORTED) {
        return Object.freeze({ kind: 'request_timeout' });
      }
      if (error === BODY_INVALID) {
        return Object.freeze({ kind: 'malformed_response' });
      }
      if (error === BODY_NETWORK_FAILURE) {
        return Object.freeze({ kind: 'network_failure' });
      }
      return Object.freeze({ kind: 'network_failure' });
    } finally {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', handleExternalAbort);
    }
  }

  async function login(initData, options = {}) {
    const externalSignal = options.signal;

    if (externalSignal?.aborted) {
      return Object.freeze({ outcome: 'cancelled' });
    }

    if (
      typeof initData !== 'string' ||
      initData.length === 0 ||
      new TextEncoder().encode(initData).byteLength >
        MAX_INIT_DATA_UTF8_BYTES
    ) {
      return fixedFailure(FAILURE_KINDS.internalError);
    }

    const requestKey = createRequestKey(cryptoImpl);
    if (!requestKey) {
      return fixedFailure(FAILURE_KINDS.internalError);
    }

    for (let requestNumber = 0; requestNumber < MAX_REQUESTS; requestNumber += 1) {
      if (externalSignal?.aborted) {
        return Object.freeze({ outcome: 'cancelled' });
      }

      const attempt = await requestOnce(
        initData,
        requestKey,
        externalSignal,
      );

      if (attempt.kind === 'configuration_failure') {
        return fixedFailure(FAILURE_KINDS.internalError);
      }

      if (attempt.kind === 'cancelled') {
        return Object.freeze({ outcome: 'cancelled' });
      }

      if (
        attempt.kind === 'network_failure' ||
        attempt.kind === 'request_timeout' ||
        attempt.kind === 'retryable_unavailable'
      ) {
        if (requestNumber === MAX_REQUESTS - 1) {
          return fixedFailure(FAILURE_KINDS.temporaryUnavailable);
        }

        const completed = await waitForBackoff(
          sleep,
          retryDelayMs(requestNumber, random),
          externalSignal,
        );
        if (!completed) {
          return externalSignal?.aborted
            ? Object.freeze({ outcome: 'cancelled' })
            : fixedFailure(FAILURE_KINDS.internalError);
        }
        continue;
      }

      if (attempt.kind === 'success') {
        return attempt.result;
      }

      if (attempt.kind === 'failure') {
        return attempt.result;
      }

      return fixedFailure(FAILURE_KINDS.internalError);
    }

    return fixedFailure(FAILURE_KINDS.internalError);
  }

  return Object.freeze({ login });
}

export const telegramBackendLoginClient =
  createTelegramBackendLoginClient();
