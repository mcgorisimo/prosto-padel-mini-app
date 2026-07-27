import { isCanonicalSessionCredential } from './sessionCredential';

const STORAGE_KEY = 'prosto_padel_backend_session_v1';
const STORAGE_TIMEOUT_MS = 3_000;

function frozen(outcome, extra = {}) {
  return Object.freeze({ outcome, ...extra });
}

function isUnsupported(error) {
  return (
    error === 'UNSUPPORTED' ||
    error?.code === 'UNSUPPORTED' ||
    error?.message === 'UNSUPPORTED'
  );
}

function defaultWebApp() {
  return globalThis.window?.Telegram?.WebApp ?? null;
}

export function createTelegramSecureCredentialStorage(dependencies = {}) {
  const getWebApp = dependencies.getWebApp ?? defaultWebApp;
  const setTimer = dependencies.setTimer ?? globalThis.setTimeout;
  const clearTimer = dependencies.clearTimer ?? globalThis.clearTimeout;
  const timeoutMs = dependencies.timeoutMs ?? STORAGE_TIMEOUT_MS;

  function secureStorage() {
    let webApp;
    try {
      webApp = getWebApp();
      if (
        !webApp ||
        typeof webApp.isVersionAtLeast !== 'function' ||
        webApp.isVersionAtLeast('9.0') !== true
      ) {
        return null;
      }
    } catch {
      return null;
    }

    const storage = webApp.SecureStorage;
    return storage && typeof storage === 'object' ? storage : null;
  }

  function invoke(methodName, args, readResult, signal) {
    const storage = secureStorage();
    if (!storage || typeof storage[methodName] !== 'function') {
      return Promise.resolve(frozen('unavailable'));
    }
    if (
      typeof setTimer !== 'function' ||
      typeof clearTimer !== 'function' ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0
    ) {
      return Promise.resolve(frozen('failed'));
    }
    if (signal?.aborted) {
      return Promise.resolve(frozen('cancelled'));
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimer(timer);
        signal?.removeEventListener('abort', handleAbort);
        resolve(result);
      };
      const handleAbort = () => finish(frozen('cancelled'));

      timer = setTimer(() => finish(frozen('failed')), timeoutMs);
      signal?.addEventListener('abort', handleAbort, { once: true });

      try {
        storage[methodName](...args, (error, ...callbackValues) => {
          if (error !== null && error !== undefined) {
            finish(frozen(isUnsupported(error) ? 'unavailable' : 'failed'));
            return;
          }
          try {
            finish(readResult(...callbackValues));
          } catch {
            finish(frozen('failed'));
          }
        });
      } catch (error) {
        finish(frozen(isUnsupported(error) ? 'unavailable' : 'failed'));
      }
    });
  }

  async function read(options = {}) {
    return invoke('getItem', [STORAGE_KEY], (value) => {
      if (value === null || value === undefined) {
        return frozen('empty');
      }
      if (!isCanonicalSessionCredential(value)) {
        return frozen('invalid');
      }
      return frozen('found', { credential: value });
    }, options.signal);
  }

  async function write(credential, options = {}) {
    if (!isCanonicalSessionCredential(credential)) {
      return frozen('failed');
    }
    return invoke('setItem', [STORAGE_KEY, credential], (stored) =>
      frozen(stored === true ? 'stored' : 'failed'), options.signal);
  }

  async function remove(options = {}) {
    return invoke('removeItem', [STORAGE_KEY], (removed) =>
      frozen(removed === true ? 'removed' : 'failed'), options.signal);
  }

  return Object.freeze({ read, write, remove });
}

export const telegramSecureCredentialStorage =
  createTelegramSecureCredentialStorage();
