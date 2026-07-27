import { useCallback, useEffect, useState } from 'react';
import { backendSessionClient } from '../lib/backendSessionClient';
import { telegramBackendLoginClient } from '../lib/telegramBackendLogin';
import { telegramSecureCredentialStorage } from '../lib/telegramSecureCredentialStorage';

const FEATURE_ENABLED =
  import.meta.env.VITE_TELEGRAM_BACKEND_LOGIN_ENABLED === 'true';
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const SUCCESS_MESSAGE_DURATION_MS = 3_000;

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

function isSuccessStatus(status) {
  return status === 'authenticated' || status === 'session_restored';
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
  const sessions = dependencies.sessions ?? backendSessionClient;
  const credentialStorage =
    dependencies.credentialStorage ?? telegramSecureCredentialStorage;
  const fingerprint = dependencies.fingerprint ?? fingerprintInitData;
  const setTimer = dependencies.setTimer ?? globalThis.setTimeout;
  const clearTimer = dependencies.clearTimer ?? globalThis.clearTimeout;
  const now = dependencies.now ?? Date.now;

  const listeners = new Set();
  let consumerCount = 0;
  let teardownTimer = null;
  let expirationTimer = null;
  let successMessageTimer = null;
  let generation = 0;
  let identityToken = 0;
  let currentIdentityFingerprint = null;
  let pendingIdentity = null;
  let activeAttempt = null;
  let activeLogout = null;
  let privateCredential = null;
  let privatePrincipal = null;
  let publicSnapshot = IDLE_SNAPSHOT;
  let storageMutations = Promise.resolve();

  function publish(snapshot) {
    if (!isSuccessStatus(snapshot.status)) {
      clearSuccessMessageTimer();
    }
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

  function clearSuccessMessageTimer() {
    if (successMessageTimer !== null) {
      clearTimer(successMessageTimer);
      successMessageTimer = null;
    }
  }

  function dismissSuccess() {
    clearSuccessMessageTimer();
    if (isSuccessStatus(publicSnapshot.status)) {
      publish(IDLE_SNAPSHOT);
    }
  }

  function enqueueStorageMutation(operation) {
    const execution = storageMutations.then(operation, operation);
    storageMutations = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }

  function removeStoredCredential(signal) {
    return enqueueStorageMutation(
      () => credentialStorage.remove({ signal }),
    );
  }

  function removeStoredCredentialBestEffort() {
    const removal = removeStoredCredential();
    void removal.catch(() => {});
  }

  async function readStoredCredential(signal) {
    await storageMutations;
    if (signal?.aborted) {
      return Object.freeze({ outcome: 'cancelled' });
    }
    return credentialStorage.read({ signal });
  }

  async function persistCredentialOrRemove(credential, signal) {
    let stored = false;
    try {
      const result = await enqueueStorageMutation(
        () => credentialStorage.write(credential, { signal }),
      );
      stored = result?.outcome === 'stored';
    } catch {
      stored = false;
    }
    if (stored || signal?.aborted) return;

    try {
      await removeStoredCredential(signal);
    } catch {
      // A failed write must never intentionally retain a stale credential.
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

  function abortActiveLogout() {
    const attempt = activeLogout;
    activeLogout = null;
    attempt?.controller.abort();
  }

  function clearPrivateSession() {
    privateCredential = null;
    privatePrincipal = null;
  }

  function clearBoundary({ removeStored = true } = {}) {
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
    abortActiveLogout();
    currentIdentityFingerprint = null;
    clearPrivateSession();
    clearExpirationTimer();
    clearSuccessMessageTimer();
    if (removeStored) {
      removeStoredCredentialBestEffort();
    }
    publish(IDLE_SNAPSHOT);
  }

  function replaceCompletedIdentity() {
    generation += 1;
    abortActiveAttempt();
    currentIdentityFingerprint = null;
    clearPrivateSession();
    clearExpirationTimer();
    clearSuccessMessageTimer();
    removeStoredCredentialBestEffort();
    publish(IDLE_SNAPSHOT);
  }

  function scheduleSuccessMessageDismissal(attemptGeneration) {
    clearSuccessMessageTimer();
    successMessageTimer = setTimer(() => {
      successMessageTimer = null;
      if (
        attemptGeneration === generation &&
        isSuccessStatus(publicSnapshot.status)
      ) {
        publish(IDLE_SNAPSHOT);
      }
    }, SUCCESS_MESSAGE_DURATION_MS);
  }

  function scheduleExpiration(expiresAt, attemptGeneration) {
    clearExpirationTimer();

    const checkExpiration = () => {
      if (attemptGeneration !== generation) return;

      const remainingMs = (expiresAt * 1_000) - now();
      if (remainingMs <= 0) {
        clearPrivateSession();
        expirationTimer = null;
        removeStoredCredentialBestEffort();
        publish({
          status: 'session_expired',
          errorKind: 'session_expired',
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

    let skipStoredRefresh = false;
    if (activeAttempt !== null || pendingIdentity !== null) {
      skipStoredRefresh = true;
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
          clearPrivateSession();
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
        skipStoredRefresh = true;
        replaceCompletedIdentity();
      }

      currentIdentityFingerprint = identityFingerprint;
      const attemptGeneration = generation;
      const controller = new AbortController();
      const attemptRecord = {
        controller,
        fingerprint: identityFingerprint,
        promise,
        rawInitData,
      };
      activeAttempt = attemptRecord;

      const attemptIsCurrent = () => (
        !controller.signal.aborted &&
        attemptGeneration === generation &&
        activeAttempt === attemptRecord &&
        currentIdentityFingerprint === identityFingerprint
      );

      publish({ status: 'checking' });

      try {
        let stored;
        if (skipStoredRefresh) {
          stored = Object.freeze({ outcome: 'empty' });
        } else {
          try {
            stored = await readStoredCredential(controller.signal);
          } catch {
            stored = Object.freeze({ outcome: 'failed' });
          }
        }
        if (!attemptIsCurrent() || stored.outcome === 'cancelled') return;

        if (stored.outcome === 'invalid') {
          try {
            await removeStoredCredential(controller.signal);
          } catch {
            // An invalid stored value is ignored even if removal fails.
          }
          if (!attemptIsCurrent()) return;
        }

        if (stored.outcome === 'found') {
          let storedCredential = stored.credential;
          let refreshResult;
          try {
            refreshResult = await sessions.refresh(storedCredential, {
              signal: controller.signal,
            });
          } catch {
            refreshResult = Object.freeze({
              outcome: 'rejected',
              reason: 'internal_error',
            });
          } finally {
            storedCredential = null;
            stored = null;
          }
          if (!attemptIsCurrent() || refreshResult.outcome === 'cancelled') {
            return;
          }

          if (refreshResult.outcome === 'refreshed') {
            await persistCredentialOrRemove(
              refreshResult.credential,
              controller.signal,
            );
            if (!attemptIsCurrent()) return;

            privateCredential = refreshResult.credential;
            let authenticationResult;
            try {
              authenticationResult = await sessions.authenticate(
                refreshResult.credential,
                { signal: controller.signal },
              );
            } catch {
              authenticationResult = Object.freeze({
                outcome: 'rejected',
                reason: 'internal_error',
              });
            }
            if (
              !attemptIsCurrent() ||
              authenticationResult.outcome === 'cancelled'
            ) {
              return;
            }

            if (authenticationResult.outcome === 'authenticated') {
              privatePrincipal = authenticationResult.principal;
              publish({
                status: 'session_restored',
                expiresAt: authenticationResult.principal.expiresAt,
              });
              scheduleSuccessMessageDismissal(attemptGeneration);
              scheduleExpiration(
                authenticationResult.principal.expiresAt,
                attemptGeneration,
              );
              return;
            }

            privatePrincipal = null;
            if (authenticationResult.reason === 'invalid') {
              privateCredential = null;
              try {
                await removeStoredCredential(controller.signal);
              } catch {
                // An invalid rotated credential is never reused.
              }
              if (!attemptIsCurrent()) return;
            } else {
              const errorKind =
                authenticationResult.reason === 'temporary_unavailable'
                  ? 'temporary_unavailable'
                  : 'internal_error';
              publish({ status: errorKind, errorKind });
              return;
            }
          } else if (
            refreshResult.reason === 'invalid' ||
            refreshResult.reason === 'expired' ||
            refreshResult.reason === 'reopen_required'
          ) {
            try {
              await removeStoredCredential(controller.signal);
            } catch {
              // A rejected credential is never reused in this page.
            }
            if (!attemptIsCurrent()) return;
          } else {
            clearPrivateSession();
            const errorKind =
              refreshResult.reason === 'temporary_unavailable'
                ? 'temporary_unavailable'
                : 'internal_error';
            publish({ status: errorKind, errorKind });
            return;
          }
        }

        const result = await client.login(rawInitData, {
          signal: controller.signal,
        });
        if (!attemptIsCurrent() || result.outcome === 'cancelled') return;

        if (result.outcome === 'authenticated') {
          await persistCredentialOrRemove(
            result.credential,
            controller.signal,
          );
          if (!attemptIsCurrent()) return;

          privateCredential = result.credential;
          let authenticationResult;
          try {
            authenticationResult = await sessions.authenticate(
              result.credential,
              { signal: controller.signal },
            );
          } catch {
            authenticationResult = Object.freeze({
              outcome: 'rejected',
              reason: 'internal_error',
            });
          }
          if (
            !attemptIsCurrent() ||
            authenticationResult.outcome === 'cancelled'
          ) {
            return;
          }
          if (authenticationResult.outcome !== 'authenticated') {
            privatePrincipal = null;
            if (authenticationResult.reason === 'invalid') {
              privateCredential = null;
              try {
                await removeStoredCredential(controller.signal);
              } catch {
                // A credential rejected immediately after login is discarded.
              }
              if (!attemptIsCurrent()) return;
            }
            const errorKind =
              authenticationResult.reason === 'temporary_unavailable'
                ? 'temporary_unavailable'
                : 'internal_error';
            publish({ status: errorKind, errorKind });
            return;
          }

          privatePrincipal = authenticationResult.principal;
          publish({
            status: 'authenticated',
            accountKind: result.accountKind,
            expiresAt: authenticationResult.principal.expiresAt,
          });
          scheduleSuccessMessageDismissal(attemptGeneration);
          scheduleExpiration(
            authenticationResult.principal.expiresAt,
            attemptGeneration,
          );
          return;
        }

        clearPrivateSession();
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
          clearPrivateSession();
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

  function logout() {
    if (activeLogout !== null) {
      return activeLogout.promise;
    }

    abortActiveAttempt();
    if (pendingIdentity !== null) {
      pendingIdentity.rawInitData = null;
      pendingIdentity = null;
      identityToken += 1;
    }
    dismissSuccess();

    let presentedCredential = privateCredential;
    if (presentedCredential === null) {
      removeStoredCredentialBestEffort();
      return Promise.resolve(Object.freeze({ outcome: 'logged_out' }));
    }

    const controller = new AbortController();
    let logoutRecord;
    const promise = (async () => {
      try {
        let result;
        try {
          result = await sessions.logout(presentedCredential, {
            signal: controller.signal,
          });
        } catch {
          result = Object.freeze({
            outcome: 'rejected',
            reason: 'internal_error',
          });
        }

        if (controller.signal.aborted || result.outcome === 'cancelled') {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'internal_error',
          });
        }
        if (
          result.outcome === 'logged_out' ||
          (result.outcome === 'rejected' && result.reason === 'invalid')
        ) {
          generation += 1;
          currentIdentityFingerprint = null;
          clearPrivateSession();
          clearExpirationTimer();
          try {
            await removeStoredCredential(controller.signal);
          } catch {
            // A server-revoked credential is harmless if removal fails.
          }
          publish(IDLE_SNAPSHOT);
          return Object.freeze({ outcome: 'logged_out' });
        }

        return Object.freeze({
          outcome: 'rejected',
          reason: result.reason === 'temporary_unavailable'
            ? 'temporary_unavailable'
            : 'internal_error',
        });
      } finally {
        presentedCredential = null;
        if (activeLogout === logoutRecord) {
          activeLogout = null;
        }
      }
    })();

    logoutRecord = { controller, promise };
    activeLogout = logoutRecord;
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
            clearBoundary({ removeStored: false });
          }
        }, 0);
      }
    };
  }

  return Object.freeze({
    attach,
    clear: clearBoundary,
    dismissSuccess,
    hasCredential: () => privateCredential !== null,
    hasPrincipal: () => privatePrincipal !== null,
    logout,
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

  const dismissSuccess = useCallback(() => {
    if (FEATURE_ENABLED) {
      telegramBackendLoginLifecycle.dismissSuccess();
    }
  }, []);

  const logout = useCallback(() => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({ outcome: 'logged_out' }));
    }
    return telegramBackendLoginLifecycle.logout();
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
    dismissSuccess,
    logout,
  });
}
