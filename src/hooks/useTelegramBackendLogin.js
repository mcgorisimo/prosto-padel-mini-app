import { useCallback, useEffect, useState } from 'react';
import { telegramBackendLoginClient } from '../lib/telegramBackendLogin';

const FEATURE_ENABLED =
  import.meta.env.VITE_TELEGRAM_BACKEND_LOGIN_ENABLED === 'true';
const MAX_TIMER_DELAY_MS = 2_147_000_000;

const IDLE_SNAPSHOT = Object.freeze({
  status: 'idle',
  accountKind: null,
  expiresAt: null,
  errorKind: null,
});

const DISABLED_SNAPSHOT = Object.freeze({
  status: 'disabled',
  accountKind: null,
  expiresAt: null,
  errorKind: null,
});

function normalizeSnapshot(snapshot) {
  return Object.freeze({
    status: snapshot.status,
    accountKind: snapshot.accountKind ?? null,
    expiresAt: snapshot.expiresAt ?? null,
    errorKind: snapshot.errorKind ?? null,
  });
}

async function fingerprintInitData(rawInitData) {
  const cryptoImpl = globalThis.crypto;
  if (
    !cryptoImpl?.subtle ||
    typeof cryptoImpl.subtle.digest !== 'function' ||
    typeof TextEncoder !== 'function'
  ) {
    throw new Error('TELEGRAM_BACKEND_LOGIN_FINGERPRINT_UNAVAILABLE');
  }

  const digest = await cryptoImpl.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rawInitData),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}

export function createTelegramBackendLoginLifecycle(dependencies = {}) {
  const client = dependencies.client ?? telegramBackendLoginClient;
  const fingerprint = dependencies.fingerprint ?? fingerprintInitData;
  const setTimer = dependencies.setTimer ?? globalThis.setTimeout;
  const clearTimer = dependencies.clearTimer ?? globalThis.clearTimeout;
  const now = dependencies.now ?? Date.now;

  const listeners = new Set();
  let consumerCount = 0;
  let teardownTimer = null;
  let expirationTimer = null;
  let generation = 0;
  let identityToken = 0;
  let currentIdentityFingerprint = null;
  let pendingIdentity = null;
  let activeAttempt = null;
  let privateCredential = null;
  let publicSnapshot = IDLE_SNAPSHOT;

  function publish(snapshot) {
    publicSnapshot = normalizeSnapshot(snapshot);
    for (const listener of listeners) {
      listener(publicSnapshot);
    }
  }

  function clearExpirationTimer() {
    if (expirationTimer !== null) {
      clearTimer(expirationTimer);
      expirationTimer = null;
    }
  }

  function abortActiveAttempt() {
    const attempt = activeAttempt;
    activeAttempt = null;
    if (attempt !== null) {
      attempt.rawInitData = null;
      attempt.controller.abort();
    }
  }

  function clearBoundary() {
    generation += 1;
    identityToken += 1;
    if (teardownTimer !== null) {
      clearTimer(teardownTimer);
      teardownTimer = null;
    }
    if (pendingIdentity !== null) {
      pendingIdentity.rawInitData = null;
    }
    pendingIdentity = null;
    abortActiveAttempt();
    currentIdentityFingerprint = null;
    privateCredential = null;
    clearExpirationTimer();
    publish(IDLE_SNAPSHOT);
  }

  function replaceCompletedIdentity() {
    generation += 1;
    abortActiveAttempt();
    currentIdentityFingerprint = null;
    privateCredential = null;
    clearExpirationTimer();
    publish(IDLE_SNAPSHOT);
  }

  function scheduleExpiration(expiresAt, attemptGeneration) {
    clearExpirationTimer();

    const checkExpiration = () => {
      if (attemptGeneration !== generation) return;

      const remainingMs = (expiresAt * 1_000) - now();
      if (remainingMs <= 0) {
        privateCredential = null;
        expirationTimer = null;
        publish({
          status: 'invalid_telegram_data',
          errorKind: 'invalid_telegram_data',
        });
        return;
      }

      expirationTimer = setTimer(
        checkExpiration,
        Math.min(remainingMs, MAX_TIMER_DELAY_MS),
      );
    };

    checkExpiration();
  }

  function beginLogin(rawInitData) {
    if (
      activeAttempt !== null &&
      activeAttempt.rawInitData === rawInitData
    ) {
      return activeAttempt.promise;
    }

    if (
      pendingIdentity !== null &&
      pendingIdentity.rawInitData === rawInitData
    ) {
      return pendingIdentity.promise;
    }

    if (activeAttempt !== null || pendingIdentity !== null) {
      clearBoundary();
    }

    const token = identityToken + 1;
    identityToken = token;
    let pendingRecord;

    const promise = (async () => {
      await Promise.resolve();

      let identityFingerprint;
      try {
        identityFingerprint = await fingerprint(rawInitData);
      } catch {
        if (
          pendingIdentity === pendingRecord &&
          identityToken === token
        ) {
          pendingRecord.rawInitData = null;
          pendingIdentity = null;
          privateCredential = null;
          publish({
            status: 'internal_error',
            errorKind: 'internal_error',
          });
        }
        return;
      }

      if (
        pendingIdentity !== pendingRecord ||
        identityToken !== token
      ) {
        pendingRecord.rawInitData = null;
        return;
      }

      pendingIdentity = null;
      pendingRecord.rawInitData = null;

      if (currentIdentityFingerprint !== null) {
        if (currentIdentityFingerprint === identityFingerprint) {
          for (const listener of listeners) {
            listener(publicSnapshot);
          }
          return;
        }
        replaceCompletedIdentity();
      }

      currentIdentityFingerprint = identityFingerprint;
      const attemptGeneration = generation;
      const controller = new AbortController();
      let attemptRecord;

      publish({ status: 'checking' });

      const loginPromise = client.login(rawInitData, {
        signal: controller.signal,
      });

      attemptRecord = {
        controller,
        fingerprint: identityFingerprint,
        promise,
        rawInitData,
      };
      activeAttempt = attemptRecord;

      try {
        const result = await loginPromise;
        if (
          controller.signal.aborted ||
          attemptGeneration !== generation ||
          activeAttempt !== attemptRecord ||
          currentIdentityFingerprint !== identityFingerprint
        ) {
          return;
        }

        if (result.outcome === 'cancelled') return;

        if (result.outcome === 'authenticated') {
          privateCredential = result.credential;
          publish({
            status: 'authenticated',
            accountKind: result.accountKind,
            expiresAt: result.expiresAt,
          });
          scheduleExpiration(result.expiresAt, attemptGeneration);
          return;
        }

        privateCredential = null;
        publish({
          status: result.errorKind,
          errorKind: result.errorKind,
        });
      } catch {
        if (
          !controller.signal.aborted &&
          attemptGeneration === generation &&
          activeAttempt === attemptRecord
        ) {
          privateCredential = null;
          publish({
            status: 'internal_error',
            errorKind: 'internal_error',
          });
        }
      } finally {
        attemptRecord.rawInitData = null;
        if (activeAttempt === attemptRecord) {
          activeAttempt = null;
        }
      }
    })();

    pendingRecord = {
      promise,
      rawInitData,
      token,
    };
    pendingIdentity = pendingRecord;
    return promise;
  }

  function attach(rawInitData, listener) {
    if (teardownTimer !== null) {
      clearTimer(teardownTimer);
      teardownTimer = null;
    }

    consumerCount += 1;
    listeners.add(listener);

    const hasRawInitData =
      typeof rawInitData === 'string' && rawInitData.length > 0;

    if (!hasRawInitData) {
      if (
        currentIdentityFingerprint !== null ||
        activeAttempt !== null ||
        pendingIdentity !== null
      ) {
        clearBoundary();
      }
      publish({
        status: 'outside_telegram',
        errorKind: 'outside_telegram',
      });
    } else if (
      (activeAttempt !== null &&
        activeAttempt.rawInitData === rawInitData) ||
      (pendingIdentity !== null &&
        pendingIdentity.rawInitData === rawInitData)
    ) {
      listener(publicSnapshot);
      void beginLogin(rawInitData);
    } else {
      listener(IDLE_SNAPSHOT);
      void beginLogin(rawInitData);
    }

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      listeners.delete(listener);
      consumerCount = Math.max(0, consumerCount - 1);

      if (consumerCount === 0 && teardownTimer === null) {
        teardownTimer = setTimer(() => {
          teardownTimer = null;
          if (consumerCount === 0) {
            clearBoundary();
          }
        }, 0);
      }
    };
  }

  return Object.freeze({
    attach,
    clear: clearBoundary,
    hasCredential: () => privateCredential !== null,
  });
}

const telegramBackendLoginLifecycle =
  createTelegramBackendLoginLifecycle();

export function useTelegramBackendLogin() {
  const [snapshot, setSnapshot] = useState(
    FEATURE_ENABLED ? IDLE_SNAPSHOT : DISABLED_SNAPSHOT,
  );

  const clear = useCallback(() => {
    if (FEATURE_ENABLED) {
      telegramBackendLoginLifecycle.clear();
    }
  }, []);

  useEffect(() => {
    if (!FEATURE_ENABLED) return undefined;

    const webApp = globalThis.window?.Telegram?.WebApp;
    const rawInitData = webApp?.initData;

    return telegramBackendLoginLifecycle.attach(
      webApp && typeof rawInitData === 'string' ? rawInitData : null,
      setSnapshot,
    );
  }, []);

  return Object.freeze({
    status: snapshot.status,
    accountKind: snapshot.accountKind,
    expiresAt: snapshot.expiresAt,
    errorKind: snapshot.errorKind,
    clear,
  });
}
