import { useCallback, useEffect, useState } from 'react';
import {
  backendSessionClient,
  isBackendOwnProfile,
  isBackendOwnProfilePatch,
} from '../lib/backendSessionClient';
import { bookingAvailabilityClient } from '../lib/bookingAvailabilityClient';
import {
  playerInitialLevelReassessmentClient,
  readPlayerInitialLevelReassessment,
} from '../lib/playerInitialLevelReassessmentClient';
import {
  playerOnboardingClient,
  readPlayerOnboardingState,
} from '../lib/playerOnboardingClient';
import { telegramBackendLoginClient } from '../lib/telegramBackendLogin';
import { telegramSecureCredentialStorage } from '../lib/telegramSecureCredentialStorage';

const FEATURE_SETTING =
  import.meta.env.VITE_TELEGRAM_BACKEND_LOGIN_ENABLED;
const FEATURE_ENABLED =
  FEATURE_SETTING === undefined || FEATURE_SETTING === 'true';
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
  const profiles = dependencies.profiles ?? sessions;
  const matches = dependencies.matches ?? sessions;
  const bookings = dependencies.bookings ?? bookingAvailabilityClient;
  const onboarding =
    dependencies.onboarding ?? playerOnboardingClient;
  const initialLevelReassessments =
    dependencies.initialLevelReassessments ??
    playerInitialLevelReassessmentClient;
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
  let activeProfileRead = null;
  let activeProfileUpdate = null;
  const activeMatchRequests = new Set();
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

  function abortActiveProfileRead() {
    const request = activeProfileRead;
    activeProfileRead = null;
    request?.controller.abort();
  }

  function abortActiveProfileUpdate() {
    const request = activeProfileUpdate;
    activeProfileUpdate = null;
    request?.controller.abort();
  }

  function abortActiveMatchRequests() {
    for (const controller of activeMatchRequests) {
      controller.abort();
    }
    activeMatchRequests.clear();
  }

  function clearPrivateSession() {
    abortActiveProfileRead();
    abortActiveProfileUpdate();
    abortActiveMatchRequests();
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
    abortActiveProfileRead();
    abortActiveProfileUpdate();
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

  function loadOwnProfile() {
    const requestGeneration = generation;
    const expectedPrincipal = privatePrincipal;
    let presentedCredential = privateCredential;

    if (
      presentedCredential === null ||
      expectedPrincipal === null
    ) {
      presentedCredential = null;
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    if (expectedPrincipal.role !== 'player') {
      presentedCredential = null;
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'profile_not_found',
      }));
    }

    if (
      activeProfileRead !== null &&
      activeProfileRead.generation === requestGeneration &&
      activeProfileRead.principal === expectedPrincipal
    ) {
      presentedCredential = null;
      return activeProfileRead.promise;
    }
    abortActiveProfileRead();

    const controller = new AbortController();
    let requestRecord;
    const promise = (async () => {
      try {
        let result;
        try {
          result = await profiles.readOwnProfile(presentedCredential, {
            signal: controller.signal,
          });
        } catch {
          result = Object.freeze({
            outcome: 'rejected',
            reason: 'internal_error',
          });
        }

        if (
          controller.signal.aborted ||
          requestGeneration !== generation ||
          activeProfileRead !== requestRecord ||
          privatePrincipal !== expectedPrincipal
        ) {
          return Object.freeze({ outcome: 'cancelled' });
        }
        if (
          result?.outcome === 'profile_loaded' &&
          isBackendOwnProfile(result.profile) &&
          result.profile.accountId === expectedPrincipal.accountId &&
          result.profile.role === expectedPrincipal.role
        ) {
          return Object.freeze({
            outcome: 'profile_loaded',
            profile: Object.freeze({
              accountId: result.profile.accountId,
              role: result.profile.role,
              firstName: result.profile.firstName,
              lastName: result.profile.lastName,
              username: result.profile.username,
              photoUrl: result.profile.photoUrl,
              ...(Object.prototype.hasOwnProperty.call(
                result.profile,
                'fullPhotoUrl',
              )
                ? { fullPhotoUrl: result.profile.fullPhotoUrl }
                : {}),
              languageCode: result.profile.languageCode,
              phone: result.profile.phone,
              sidePreference: result.profile.sidePreference,
              capabilities: Object.freeze([
                ...(Array.isArray(result.profile.capabilities)
                  ? result.profile.capabilities
                  : []),
              ]),
              ...(Object.prototype.hasOwnProperty.call(
                result.profile,
                'rating',
              )
                ? {
                    rating: result.profile.rating,
                    isVerified: result.profile.isVerified,
                  }
                : {}),
            }),
          });
        }
        if (result?.outcome === 'cancelled') {
          return Object.freeze({ outcome: 'cancelled' });
        }

        const allowedReason = result?.outcome === 'rejected'
          ? result.reason
          : 'internal_error';
        if (allowedReason === 'invalid') {
          clearBoundary();
          return Object.freeze({
            outcome: 'rejected',
            reason: 'session_invalid',
          });
        }
        return Object.freeze({
          outcome: 'rejected',
          reason:
            allowedReason === 'profile_not_found'
              ? 'profile_not_found'
              : allowedReason === 'temporary_unavailable'
                ? 'temporary_unavailable'
                : 'internal_error',
        });
      } finally {
        presentedCredential = null;
        if (activeProfileRead === requestRecord) {
          activeProfileRead = null;
        }
      }
    })();

    requestRecord = {
      controller,
      generation: requestGeneration,
      principal: expectedPrincipal,
      promise,
    };
    activeProfileRead = requestRecord;
    return promise;
  }

  function updateOwnProfile(changes) {
    const requestGeneration = generation;
    const expectedPrincipal = privatePrincipal;
    let presentedCredential = privateCredential;

    if (
      presentedCredential === null ||
      expectedPrincipal === null
    ) {
      presentedCredential = null;
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    if (
      expectedPrincipal.role !== 'player' ||
      !isBackendOwnProfilePatch(changes)
    ) {
      presentedCredential = null;
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason:
          expectedPrincipal.role === 'player'
            ? 'invalid_request'
            : 'profile_not_found',
      }));
    }

    abortActiveProfileUpdate();
    abortActiveProfileRead();
    const controller = new AbortController();
    let requestRecord;
    const promise = (async () => {
      try {
        let result;
        try {
          result = await profiles.updateOwnProfile(
            presentedCredential,
            changes,
            { signal: controller.signal },
          );
        } catch {
          result = Object.freeze({
            outcome: 'rejected',
            reason: 'internal_error',
          });
        }

        if (
          controller.signal.aborted ||
          requestGeneration !== generation ||
          activeProfileUpdate !== requestRecord ||
          privatePrincipal !== expectedPrincipal
        ) {
          return Object.freeze({ outcome: 'cancelled' });
        }
        if (
          result?.outcome === 'profile_updated' &&
          isBackendOwnProfile(result.profile) &&
          result.profile.accountId === expectedPrincipal.accountId &&
          result.profile.role === expectedPrincipal.role
        ) {
          return Object.freeze({
            outcome: 'profile_updated',
            profile: result.profile,
          });
        }
        if (result?.outcome === 'cancelled') {
          return Object.freeze({ outcome: 'cancelled' });
        }

        const allowedReason = result?.outcome === 'rejected'
          ? result.reason
          : 'internal_error';
        if (allowedReason === 'invalid') {
          clearBoundary();
          return Object.freeze({
            outcome: 'rejected',
            reason: 'session_invalid',
          });
        }
        return Object.freeze({
          outcome: 'rejected',
          reason:
            allowedReason === 'profile_not_found'
              ? 'profile_not_found'
              : allowedReason === 'invalid_request'
                ? 'invalid_request'
                : allowedReason === 'content_not_allowed'
                  ? 'content_not_allowed'
                  : allowedReason === 'temporary_unavailable'
                    ? 'temporary_unavailable'
                    : 'internal_error',
        });
      } finally {
        presentedCredential = null;
        if (activeProfileUpdate === requestRecord) {
          activeProfileUpdate = null;
        }
      }
    })();

    requestRecord = {
      controller,
      generation: requestGeneration,
      principal: expectedPrincipal,
      promise,
    };
    activeProfileUpdate = requestRecord;
    return promise;
  }

  function mutateOwnProfilePhoto(operation, photo) {
    const requestGeneration = generation;
    const expectedPrincipal = privatePrincipal;
    let presentedCredential = privateCredential;

    if (
      presentedCredential === null ||
      expectedPrincipal === null
    ) {
      presentedCredential = null;
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    if (expectedPrincipal.role !== 'player') {
      presentedCredential = null;
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'profile_not_found',
      }));
    }

    abortActiveProfileUpdate();
    abortActiveProfileRead();
    const controller = new AbortController();
    let requestRecord;
    const promise = (async () => {
      try {
        let result;
        try {
          result = operation === 'upload'
            ? await profiles.uploadOwnProfilePhoto(
                presentedCredential,
                photo,
                { signal: controller.signal },
              )
            : await profiles.deleteOwnProfilePhoto(
                presentedCredential,
                { signal: controller.signal },
              );
        } catch {
          result = Object.freeze({
            outcome: 'rejected',
            reason: 'internal_error',
          });
        }

        if (
          controller.signal.aborted ||
          requestGeneration !== generation ||
          activeProfileUpdate !== requestRecord ||
          privatePrincipal !== expectedPrincipal
        ) {
          return Object.freeze({ outcome: 'cancelled' });
        }
        if (
          result?.outcome === 'profile_photo_updated' &&
          typeof result.photoUrl === 'string' &&
          typeof result.fullPhotoUrl === 'string'
        ) {
          return Object.freeze({
            outcome: 'profile_photo_updated',
            accountId: expectedPrincipal.accountId,
            photoUrl: result.photoUrl,
            fullPhotoUrl: result.fullPhotoUrl,
          });
        }
        if (
          result?.outcome === 'profile_photo_deleted' &&
          result.photoUrl === null &&
          result.fullPhotoUrl === null
        ) {
          return Object.freeze({
            outcome: 'profile_photo_deleted',
            accountId: expectedPrincipal.accountId,
            photoUrl: null,
            fullPhotoUrl: null,
          });
        }
        if (result?.outcome === 'cancelled') {
          return Object.freeze({ outcome: 'cancelled' });
        }

        const allowedReason = result?.outcome === 'rejected'
          ? result.reason
          : 'internal_error';
        if (allowedReason === 'invalid') {
          clearBoundary();
          return Object.freeze({
            outcome: 'rejected',
            reason: 'session_invalid',
          });
        }
        return Object.freeze({
          outcome: 'rejected',
          reason: [
            'invalid_request',
            'invalid_image',
            'profile_not_found',
            'conflict',
            'feature_unavailable',
            'temporary_unavailable',
          ].includes(allowedReason)
            ? allowedReason
            : 'internal_error',
        });
      } finally {
        presentedCredential = null;
        if (activeProfileUpdate === requestRecord) {
          activeProfileUpdate = null;
        }
      }
    })();

    requestRecord = {
      controller,
      generation: requestGeneration,
      principal: expectedPrincipal,
      promise,
    };
    activeProfileUpdate = requestRecord;
    return promise;
  }

  function uploadOwnProfilePhoto(photo) {
    return mutateOwnProfilePhoto('upload', photo);
  }

  function deleteOwnProfilePhoto() {
    return mutateOwnProfilePhoto('delete');
  }

  function runMatchOperation(invoke, validateResult) {
    const requestGeneration = generation;
    const expectedPrincipal = privatePrincipal;
    let presentedCredential = privateCredential;

    if (
      presentedCredential === null ||
      expectedPrincipal === null
    ) {
      presentedCredential = null;
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    if (expectedPrincipal.role !== 'player') {
      presentedCredential = null;
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'forbidden',
      }));
    }

    const controller = new AbortController();
    activeMatchRequests.add(controller);
    return (async () => {
      try {
        let result;
        try {
          result = await invoke(
            presentedCredential,
            controller.signal,
          );
        } catch {
          result = Object.freeze({
            outcome: 'rejected',
            reason: 'internal_error',
          });
        }

        if (
          controller.signal.aborted ||
          requestGeneration !== generation ||
          privatePrincipal !== expectedPrincipal
        ) {
          return Object.freeze({ outcome: 'cancelled' });
        }
        if (validateResult(result, expectedPrincipal)) {
          return result;
        }
        if (result?.outcome === 'cancelled') {
          return Object.freeze({ outcome: 'cancelled' });
        }
        if (
          result?.outcome === 'rejected' &&
          result.reason === 'invalid'
        ) {
          clearBoundary();
          return Object.freeze({
            outcome: 'rejected',
            reason: 'session_invalid',
          });
        }
        if (
          result?.outcome === 'rejected' &&
          typeof result.reason === 'string'
        ) {
          return Object.freeze({
            outcome: 'rejected',
            reason: result.reason,
          });
        }
        return Object.freeze({
          outcome: 'rejected',
          reason: 'internal_error',
        });
      } finally {
        presentedCredential = null;
        activeMatchRequests.delete(controller);
      }
    })();
  }

  function loadOwnOnboarding() {
    return runMatchOperation(
      (credential, signal) => onboarding.read(credential, { signal }),
      (result) =>
        result?.outcome === 'loaded' &&
        readPlayerOnboardingState(result.onboarding) !== null,
    );
  }

  function saveOwnOnboardingDraft(draft) {
    return runMatchOperation(
      (credential, signal) =>
        onboarding.saveDraft(credential, draft, { signal }),
      (result) =>
        result?.outcome === 'saved' &&
        readPlayerOnboardingState(result.onboarding) !== null,
    );
  }

  function advanceOwnOnboarding(progress) {
    return runMatchOperation(
      (credential, signal) =>
        onboarding.advance(credential, progress, { signal }),
      (result) => {
        const nextState = readPlayerOnboardingState(result?.onboarding);
        return (
          result?.outcome === 'advanced' &&
          nextState?.status === 'in_progress' &&
          nextState.currentStep === progress?.nextStep
        );
      },
    );
  }

  function completeOwnOnboarding(completion) {
    return runMatchOperation(
      (credential, signal) =>
        onboarding.complete(credential, completion, { signal }),
      (result) => {
        const nextState = readPlayerOnboardingState(result?.onboarding);
        return (
          result?.outcome === 'completed' &&
          nextState?.status === 'completed'
        );
      },
    );
  }

  function acceptOwnOnboardingLegalPolicy(acceptance) {
    return runMatchOperation(
      (credential, signal) =>
        onboarding.acceptLegalPolicy(credential, acceptance, { signal }),
      (result) => {
        const nextState = readPlayerOnboardingState(result?.onboarding);
        return (
          result?.outcome === 'accepted' &&
          nextState?.status === 'completed'
        );
      },
    );
  }

  function loadOwnInitialLevelReassessment() {
    return runMatchOperation(
      (credential, signal) =>
        initialLevelReassessments.read(credential, { signal }),
      (result) =>
        result?.outcome === 'loaded' &&
        readPlayerInitialLevelReassessment(result.reassessment) !== null,
    );
  }

  function completeOwnInitialLevelReassessment(completion) {
    return runMatchOperation(
      (credential, signal) =>
        initialLevelReassessments.complete(credential, completion, {
          signal,
        }),
      (result) => {
        const reassessment = readPlayerInitialLevelReassessment(
          result?.reassessment,
        );
        return (
          result?.outcome === 'completed' &&
          reassessment?.status === 'completed'
        );
      },
    );
  }

  function listBookingServices() {
    return runMatchOperation(
      (credential, signal) =>
        bookings.listServices(credential, { signal }),
      (result) =>
        result?.outcome === 'services_loaded' &&
        Array.isArray(result.services),
    );
  }

  function listBookingCourts(serviceId) {
    return runMatchOperation(
      (credential, signal) =>
        bookings.listCourts(credential, serviceId, { signal }),
      (result) =>
        result?.outcome === 'courts_loaded' &&
        Array.isArray(result.courts),
    );
  }

  function listBookingDates(query) {
    return runMatchOperation(
      (credential, signal) =>
        bookings.listDates(credential, query, { signal }),
      (result) =>
        result?.outcome === 'dates_loaded' &&
        Array.isArray(result.dates),
    );
  }

  function listBookingTimes(query) {
    return runMatchOperation(
      (credential, signal) =>
        bookings.listTimes(credential, query, { signal }),
      (result) =>
        result?.outcome === 'times_loaded' &&
        Array.isArray(result.times),
    );
  }

  function createBooking(command) {
    return runMatchOperation(
      (credential, signal) =>
        bookings.createBooking(credential, command, { signal }),
      (result) =>
        ['booking_created', 'booking_unknown'].includes(result?.outcome) &&
        typeof result.reservation?.reservationId === 'string',
    );
  }

  function listBookings() {
    return runMatchOperation(
      (credential, signal) =>
        bookings.listBookings(credential, { signal }),
      (result) =>
        result?.outcome === 'bookings_loaded' &&
        Array.isArray(result.reservations),
    );
  }

  function readBooking(reservationId) {
    return runMatchOperation(
      (credential, signal) =>
        bookings.readBooking(credential, reservationId, { signal }),
      (result) =>
        result?.outcome === 'booking_loaded' &&
        typeof result.reservation?.reservationId === 'string',
    );
  }

  function readBookingByRequestKey(requestKey) {
    return runMatchOperation(
      (credential, signal) =>
        bookings.readBookingByRequestKey(credential, requestKey, { signal }),
      (result) =>
        result?.outcome === 'booking_loaded' &&
        typeof result.reservation?.reservationId === 'string',
    );
  }

  function listMatches(limit = 20) {
    return runMatchOperation(
      (credential, signal) =>
        matches.listMatches(credential, limit, { signal }),
      (result) =>
        result?.outcome === 'matches_loaded' &&
        Array.isArray(result.matches),
    );
  }

  function listAccountMatches(limit = 50) {
    return runMatchOperation(
      (credential, signal) =>
        matches.listAccountMatches(credential, limit, { signal }),
      (result, principal) =>
        result?.outcome === 'matches_loaded' &&
        Array.isArray(result.matches) &&
        result.matches.every(
          (match) =>
            match.ownerAccountId === principal.accountId ||
            match.participants?.some(
              (participant) =>
                participant.playerId === principal.accountId,
            ),
        ),
    );
  }

  function loadMatch(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.readMatch(credential, matchId, { signal }),
      (result) =>
        result?.outcome === 'match_loaded' &&
        result.match?.matchId === matchId,
    );
  }

  function createMatch(draft) {
    return runMatchOperation(
      (credential, signal) =>
        matches.createMatch(credential, draft, { signal }),
      (result, principal) =>
        result?.outcome === 'match_created' &&
        result.match?.ownerAccountId === principal.accountId,
    );
  }

  function updateMatchDescription(matchId, description) {
    return runMatchOperation(
      (credential, signal) =>
        matches.updateMatchDescription(
          credential,
          matchId,
          description,
          { signal },
        ),
      (result) =>
        result?.outcome === 'match_description_updated' &&
        result.match?.matchId === matchId &&
        result.match?.description === description,
    );
  }

  function linkMatchReservation(matchId, reservationId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.linkMatchReservation(
          credential,
          matchId,
          reservationId,
          { signal },
        ),
      (result) =>
        result?.outcome === 'match_reservation_linked' &&
        result.courtReservationId === reservationId &&
        result.courtBookingStatus === 'confirmed',
    );
  }

  function moderateText(text) {
    return runMatchOperation(
      (credential, signal) =>
        matches.moderateText(credential, text, { signal }),
      (result) => result?.outcome === 'content_allowed',
    );
  }

  function joinMatch(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.joinMatch(credential, matchId, { signal }),
      (result, principal) =>
        result?.outcome === 'participant_joined' &&
        result.participant?.matchId === matchId &&
        result.participant?.playerId === principal.accountId,
    );
  }

  function leaveMatch(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.leaveMatch(credential, matchId, { signal }),
      (result, principal) =>
        result?.outcome === 'participant_left' &&
        result.participant?.matchId === matchId &&
        result.participant?.playerId === principal.accountId,
    );
  }

  function searchPlayers(query, limit = 8) {
    return runMatchOperation(
      (credential, signal) =>
        matches.searchPlayers(credential, query, limit, { signal }),
      (result) =>
        result?.outcome === 'players_loaded' &&
        Array.isArray(result.players),
    );
  }

  function listIncomingMatchInvitations(limit = 20) {
    return runMatchOperation(
      (credential, signal) =>
        matches.listIncomingMatchInvitations(
          credential,
          limit,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'invitations_loaded' &&
        Array.isArray(result.invitations) &&
        result.invitations.every(
          ({ invitedAccountId }) =>
            invitedAccountId === principal.accountId,
        ),
    );
  }

  function listOutgoingMatchInvitations(matchId, limit = 20) {
    return runMatchOperation(
      (credential, signal) =>
        matches.listOutgoingMatchInvitations(
          credential,
          matchId,
          limit,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'invitations_loaded' &&
        Array.isArray(result.invitations) &&
        result.invitations.every(
          (invitation) =>
            invitation.matchId === matchId &&
            invitation.invitedByAccountId === principal.accountId,
        ),
    );
  }

  function createMatchInvitation(matchId, playerId, slotNumber) {
    return runMatchOperation(
      (credential, signal) =>
        matches.createMatchInvitation(
          credential,
          matchId,
          playerId,
          slotNumber,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'invitation_created' &&
        result.invitation?.matchId === matchId &&
        result.invitation?.invitedByAccountId === principal.accountId &&
        result.invitation?.invitedAccountId === playerId &&
        result.invitation?.slotNumber === slotNumber,
    );
  }

  function acceptMatchInvitation(invitationId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.acceptMatchInvitation(
          credential,
          invitationId,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'invitation_accepted' &&
        result.invitation?.invitationId === invitationId &&
        result.invitation?.invitedAccountId === principal.accountId &&
        result.participant?.accountId === principal.accountId,
    );
  }

  function declineMatchInvitation(invitationId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.declineMatchInvitation(
          credential,
          invitationId,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'invitation_declined' &&
        result.invitation?.invitationId === invitationId &&
        result.invitation?.invitedAccountId === principal.accountId,
    );
  }

  function cancelMatchInvitation(invitationId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.cancelMatchInvitation(
          credential,
          invitationId,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'invitation_cancelled' &&
        result.invitation?.invitationId === invitationId &&
        result.invitation?.invitedByAccountId === principal.accountId,
    );
  }

  function listMatchMessages(matchId, limit = 50, before) {
    return runMatchOperation(
      (credential, signal) =>
        matches.listMatchMessages(
          credential,
          matchId,
          limit,
          before,
          { signal },
        ),
      (result) =>
        result?.outcome === 'messages_loaded' &&
        Array.isArray(result.messages) &&
        result.messages.every(
          (message) => message.matchId === matchId,
        ),
    );
  }

  function sendMatchMessage(matchId, body) {
    return runMatchOperation(
      (credential, signal) =>
        matches.sendMatchMessage(
          credential,
          matchId,
          body,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'message_sent' &&
        result.message?.matchId === matchId &&
        result.message?.sender?.playerId === principal.accountId,
    );
  }

  function listMatchWaitlist(matchId, limit = 50) {
    return runMatchOperation(
      (credential, signal) =>
        matches.listMatchWaitlist(
          credential,
          matchId,
          limit,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'waitlist_loaded' &&
        Array.isArray(result.entries) &&
        result.entries.every((entry) => {
          const playerId = entry.player?.playerId;
          return entry.isCurrentPlayer
            ? playerId === undefined || playerId === principal.accountId
            : playerId !== principal.accountId;
        }) &&
        (
          result.current === undefined ||
          (
            result.current.isCurrentPlayer === true &&
            (
              result.current.player?.playerId === undefined ||
              result.current.player.playerId === principal.accountId
            )
          )
        ),
    );
  }

  function listMatchNotifications(limit = 50, before) {
    return runMatchOperation(
      (credential, signal) =>
        matches.listMatchNotifications(
          credential,
          limit,
          before,
          { signal },
        ),
      (result) =>
        result?.outcome === 'notifications_loaded' &&
        Array.isArray(result.notifications) &&
        Number.isSafeInteger(result.unreadCount) &&
        result.unreadCount >= 0,
    );
  }

  function markMatchNotificationRead(notificationId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.markMatchNotificationRead(
          credential,
          notificationId,
          { signal },
        ),
      (result) =>
        result?.outcome === 'notification_read' &&
        result.notification?.notificationId === notificationId &&
        Number.isSafeInteger(result.notification?.readAt),
    );
  }

  function joinMatchWaitlist(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.joinMatchWaitlist(credential, matchId, { signal }),
      (result) =>
        result?.outcome === 'waitlist_joined' &&
        result.entry?.matchId === matchId &&
        result.entry?.status === 'waiting',
    );
  }

  function leaveMatchWaitlist(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.leaveMatchWaitlist(credential, matchId, { signal }),
      (result) =>
        result?.outcome === 'waitlist_left' &&
        result.entry?.matchId === matchId &&
        result.entry?.status === 'left',
    );
  }

  function readMatchLineup(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.readMatchLineup(credential, matchId, { signal }),
      (result, principal) =>
        result?.outcome === 'lineup_loaded' &&
        result.lineup?.matchId === matchId &&
        Array.isArray(result.lineup.slots) &&
        result.lineup.slots.every((slot) => {
          const assignment = slot.assignment;
          const playerId = assignment?.player?.playerId;
          if (assignment?.isCurrentPlayer === true) {
            return playerId === undefined || playerId === principal.accountId;
          }
          return playerId !== principal.accountId;
        }),
    );
  }

  function assignMatchLineupSlot(matchId, teamNumber, courtSide) {
    return runMatchOperation(
      (credential, signal) =>
        matches.assignMatchLineupSlot(
          credential,
          matchId,
          teamNumber,
          courtSide,
          { signal },
        ),
      (result, principal) =>
        result?.outcome === 'lineup_assigned' &&
        result.assignment?.matchId === matchId &&
        result.assignment?.accountId === principal.accountId &&
        result.assignment?.teamNumber === teamNumber &&
        result.assignment?.courtSide === courtSide,
    );
  }

  function releaseMatchLineupSlot(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.releaseMatchLineupSlot(credential, matchId, { signal }),
      (result, principal) =>
        result?.outcome === 'lineup_released' &&
        result.assignment?.matchId === matchId &&
        result.assignment?.accountId === principal.accountId,
    );
  }

  function readMatchResult(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.readMatchResult(credential, matchId, { signal }),
      (result) =>
        result?.outcome === 'result_loaded' &&
        result.result?.matchId === matchId,
    );
  }

  function submitMatchResult(matchId, sets) {
    return runMatchOperation(
      (credential, signal) =>
        matches.submitMatchResult(credential, matchId, sets, { signal }),
      (result) =>
        result?.outcome === 'result_submitted' &&
        result.result?.matchId === matchId &&
        result.result?.status === 'submitted',
    );
  }

  function confirmMatchResult(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.confirmMatchResult(credential, matchId, { signal }),
      (result) =>
        result?.outcome === 'result_confirmed' &&
        result.result?.matchId === matchId &&
        result.result?.status === 'confirmed',
    );
  }

  function disputeMatchResult(matchId) {
    return runMatchOperation(
      (credential, signal) =>
        matches.disputeMatchResult(credential, matchId, { signal }),
      (result) =>
        result?.outcome === 'result_disputed' &&
        result.result?.matchId === matchId &&
        result.result?.status === 'disputed',
    );
  }

  function listAdminPlayers(request = {}) {
    return runMatchOperation(
      (credential, signal) =>
        matches.listAdminPlayers(credential, request, { signal }),
      (result) =>
        result?.outcome === 'admin_players_loaded' &&
        Array.isArray(result.players),
    );
  }

  function setAdminPlayerRatingState(playerId, rating, isVerified) {
    return runMatchOperation(
      (credential, signal) =>
        matches.setAdminPlayerRatingState(
          credential,
          playerId,
          rating,
          isVerified,
          { signal },
        ),
      (result) =>
        result?.outcome === 'admin_rating_state_updated' &&
        result.state?.targetAccountId === playerId &&
        result.state?.rating === rating &&
        result.state?.isVerified === isVerified,
    );
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
    loadOwnProfile,
    updateOwnProfile,
    uploadOwnProfilePhoto,
    deleteOwnProfilePhoto,
    loadOwnOnboarding,
    saveOwnOnboardingDraft,
    advanceOwnOnboarding,
    completeOwnOnboarding,
    acceptOwnOnboardingLegalPolicy,
    loadOwnInitialLevelReassessment,
    completeOwnInitialLevelReassessment,
    listBookingServices,
    listBookingCourts,
    listBookingDates,
    listBookingTimes,
    createBooking,
    listBookings,
    readBooking,
    readBookingByRequestKey,
    listMatches,
    listAccountMatches,
    loadMatch,
    createMatch,
    updateMatchDescription,
    linkMatchReservation,
    moderateText,
    joinMatch,
    leaveMatch,
    searchPlayers,
    listIncomingMatchInvitations,
    listOutgoingMatchInvitations,
    createMatchInvitation,
    acceptMatchInvitation,
    declineMatchInvitation,
    cancelMatchInvitation,
    listMatchMessages,
    sendMatchMessage,
    listMatchWaitlist,
    listMatchNotifications,
    markMatchNotificationRead,
    joinMatchWaitlist,
    leaveMatchWaitlist,
    readMatchLineup,
    assignMatchLineupSlot,
    releaseMatchLineupSlot,
    readMatchResult,
    submitMatchResult,
    confirmMatchResult,
    disputeMatchResult,
    listAdminPlayers,
    setAdminPlayerRatingState,
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

  const loadOwnProfile = useCallback(() => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.loadOwnProfile();
  }, []);

  const updateOwnProfile = useCallback((changes) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.updateOwnProfile(changes);
  }, []);

  const uploadOwnProfilePhoto = useCallback((photo) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.uploadOwnProfilePhoto(photo);
  }, []);

  const deleteOwnProfilePhoto = useCallback(() => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.deleteOwnProfilePhoto();
  }, []);

  const loadOwnOnboarding = useCallback(() => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.loadOwnOnboarding();
  }, []);

  const saveOwnOnboardingDraft = useCallback((draft) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.saveOwnOnboardingDraft(draft);
  }, []);

  const advanceOwnOnboarding = useCallback((progress) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.advanceOwnOnboarding(progress);
  }, []);

  const completeOwnOnboarding = useCallback((completion) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.completeOwnOnboarding(completion);
  }, []);

  const acceptOwnOnboardingLegalPolicy = useCallback((acceptance) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.acceptOwnOnboardingLegalPolicy(
      acceptance,
    );
  }, []);

  const loadOwnInitialLevelReassessment = useCallback(() => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.loadOwnInitialLevelReassessment();
  }, []);

  const completeOwnInitialLevelReassessment = useCallback((completion) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.completeOwnInitialLevelReassessment(
      completion,
    );
  }, []);

  const listBookingServices = useCallback(() => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listBookingServices();
  }, []);

  const listBookingCourts = useCallback((serviceId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listBookingCourts(serviceId);
  }, []);

  const listBookingDates = useCallback((query) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listBookingDates(query);
  }, []);

  const listBookingTimes = useCallback((query) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listBookingTimes(query);
  }, []);

  const createBooking = useCallback((command) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.createBooking(command);
  }, []);

  const listBookings = useCallback(() => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listBookings();
  }, []);

  const readBooking = useCallback((reservationId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.readBooking(reservationId);
  }, []);

  const readBookingByRequestKey = useCallback((requestKey) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.readBookingByRequestKey(requestKey);
  }, []);

  const listMatches = useCallback((limit = 20) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listMatches(limit);
  }, []);

  const listAccountMatches = useCallback((limit = 50) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listAccountMatches(limit);
  }, []);

  const loadMatch = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.loadMatch(matchId);
  }, []);

  const createMatch = useCallback((draft) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.createMatch(draft);
  }, []);

  const updateMatchDescription = useCallback((matchId, description) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.updateMatchDescription(
      matchId,
      description,
    );
  }, []);

  const linkMatchReservation = useCallback((matchId, reservationId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.linkMatchReservation(
      matchId,
      reservationId,
    );
  }, []);

  const moderateText = useCallback((text) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.moderateText(text);
  }, []);

  const joinMatch = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.joinMatch(matchId);
  }, []);

  const leaveMatch = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.leaveMatch(matchId);
  }, []);

  const searchPlayers = useCallback((query, limit = 8) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.searchPlayers(query, limit);
  }, []);

  const listIncomingMatchInvitations = useCallback((limit = 20) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listIncomingMatchInvitations(limit);
  }, []);

  const listOutgoingMatchInvitations = useCallback((
    matchId,
    limit = 20,
  ) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listOutgoingMatchInvitations(
      matchId,
      limit,
    );
  }, []);

  const createMatchInvitation = useCallback((
    matchId,
    playerId,
    slotNumber,
  ) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.createMatchInvitation(
      matchId,
      playerId,
      slotNumber,
    );
  }, []);

  const acceptMatchInvitation = useCallback((invitationId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.acceptMatchInvitation(invitationId);
  }, []);

  const declineMatchInvitation = useCallback((invitationId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.declineMatchInvitation(invitationId);
  }, []);

  const cancelMatchInvitation = useCallback((invitationId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.cancelMatchInvitation(invitationId);
  }, []);

  const listMatchMessages = useCallback((matchId, limit = 50, before) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listMatchMessages(
      matchId,
      limit,
      before,
    );
  }, []);

  const sendMatchMessage = useCallback((matchId, body) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.sendMatchMessage(matchId, body);
  }, []);

  const listMatchWaitlist = useCallback((matchId, limit = 50) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listMatchWaitlist(matchId, limit);
  }, []);

  const listMatchNotifications = useCallback((limit = 50, before) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listMatchNotifications(limit, before);
  }, []);

  const markMatchNotificationRead = useCallback((notificationId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.markMatchNotificationRead(
      notificationId,
    );
  }, []);

  const joinMatchWaitlist = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.joinMatchWaitlist(matchId);
  }, []);

  const leaveMatchWaitlist = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.leaveMatchWaitlist(matchId);
  }, []);

  const readMatchLineup = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.readMatchLineup(matchId);
  }, []);

  const assignMatchLineupSlot = useCallback((
    matchId,
    teamNumber,
    courtSide,
  ) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.assignMatchLineupSlot(
      matchId,
      teamNumber,
      courtSide,
    );
  }, []);

  const releaseMatchLineupSlot = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.releaseMatchLineupSlot(matchId);
  }, []);

  const readMatchResult = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.readMatchResult(matchId);
  }, []);

  const submitMatchResult = useCallback((matchId, sets) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.submitMatchResult(matchId, sets);
  }, []);

  const confirmMatchResult = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.confirmMatchResult(matchId);
  }, []);

  const disputeMatchResult = useCallback((matchId) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.disputeMatchResult(matchId);
  }, []);

  const listAdminPlayers = useCallback((request = {}) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.listAdminPlayers(request);
  }, []);

  const setAdminPlayerRatingState = useCallback((
    playerId,
    rating,
    isVerified,
  ) => {
    if (!FEATURE_ENABLED) {
      return Promise.resolve(Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      }));
    }
    return telegramBackendLoginLifecycle.setAdminPlayerRatingState(
      playerId,
      rating,
      isVerified,
    );
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
    sessionReady:
      FEATURE_ENABLED && telegramBackendLoginLifecycle.hasPrincipal(),
    clear,
    dismissSuccess,
    loadOwnProfile,
    updateOwnProfile,
    uploadOwnProfilePhoto,
    deleteOwnProfilePhoto,
    loadOwnOnboarding,
    saveOwnOnboardingDraft,
    advanceOwnOnboarding,
    completeOwnOnboarding,
    acceptOwnOnboardingLegalPolicy,
    loadOwnInitialLevelReassessment,
    completeOwnInitialLevelReassessment,
    listBookingServices,
    listBookingCourts,
    listBookingDates,
    listBookingTimes,
    createBooking,
    listBookings,
    readBooking,
    readBookingByRequestKey,
    listMatches,
    listAccountMatches,
    loadMatch,
    createMatch,
    updateMatchDescription,
    linkMatchReservation,
    moderateText,
    joinMatch,
    leaveMatch,
    searchPlayers,
    listIncomingMatchInvitations,
    listOutgoingMatchInvitations,
    createMatchInvitation,
    acceptMatchInvitation,
    declineMatchInvitation,
    cancelMatchInvitation,
    listMatchMessages,
    sendMatchMessage,
    listMatchWaitlist,
    listMatchNotifications,
    markMatchNotificationRead,
    joinMatchWaitlist,
    leaveMatchWaitlist,
    readMatchLineup,
    assignMatchLineupSlot,
    releaseMatchLineupSlot,
    readMatchResult,
    submitMatchResult,
    confirmMatchResult,
    disputeMatchResult,
    listAdminPlayers,
    setAdminPlayerRatingState,
    logout,
  });
}
