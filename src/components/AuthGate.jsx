/* eslint-disable react-hooks/exhaustive-deps -- the login hook returns an ephemeral frozen facade; dependency lists below track its stable callback members explicitly. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import App          from '../App';
import Toast from './Toast'; // Correct path for Toast
import { useTelegramBackendLogin } from '../hooks/useTelegramBackendLogin';
import TelegramBackendLoginStatus from './auth/TelegramBackendLoginStatus';
import BallLoader from './BallLoader'; // Если мяч лежит в папке components
import OnboardingFlowGate, {
  LegalReconsentGate,
} from './OnboardingFlowGate';
import InitialLevelReassessmentGate from './InitialLevelReassessmentGate';
import {
  hasCurrentLegalConsents,
  readOnboardingLegalConfig,
} from '../lib/playerOnboardingUiPolicy';

export function resolveOwnProfileGate({
  backendRequired,
  sessionReady,
  profileStatus,
  hasProfile,
}) {
  if (!backendRequired) return 'legacy';
  if (!sessionReady) return 'loading';
  if (profileStatus === 'loading' || profileStatus === 'inactive') {
    return 'loading';
  }
  if (profileStatus === 'ready' && hasProfile) return 'ready';
  return 'error';
}

export function createBackendMatchActions(telegramBackendLogin) {
  if (telegramBackendLogin?.sessionReady !== true) return null;

  return Object.freeze({
    listMatches: telegramBackendLogin.listMatches,
    listAccountMatches: telegramBackendLogin.listAccountMatches,
    loadMatch: telegramBackendLogin.loadMatch,
    createMatch: telegramBackendLogin.createMatch,
    updateMatchDescription:
      telegramBackendLogin.updateMatchDescription,
    linkMatchReservation:
      telegramBackendLogin.linkMatchReservation,
    moderateText: telegramBackendLogin.moderateText,
    joinMatch: telegramBackendLogin.joinMatch,
    leaveMatch: telegramBackendLogin.leaveMatch,
    searchPlayers: telegramBackendLogin.searchPlayers,
    listIncomingMatchInvitations:
      telegramBackendLogin.listIncomingMatchInvitations,
    listOutgoingMatchInvitations:
      telegramBackendLogin.listOutgoingMatchInvitations,
    createMatchInvitation:
      telegramBackendLogin.createMatchInvitation,
    acceptMatchInvitation:
      telegramBackendLogin.acceptMatchInvitation,
    declineMatchInvitation:
      telegramBackendLogin.declineMatchInvitation,
    cancelMatchInvitation:
      telegramBackendLogin.cancelMatchInvitation,
    listMatchMessages:
      telegramBackendLogin.listMatchMessages,
    sendMatchMessage:
      telegramBackendLogin.sendMatchMessage,
    listMatchWaitlist:
      telegramBackendLogin.listMatchWaitlist,
    listMatchNotifications:
      telegramBackendLogin.listMatchNotifications,
    markMatchNotificationRead:
      telegramBackendLogin.markMatchNotificationRead,
    joinMatchWaitlist:
      telegramBackendLogin.joinMatchWaitlist,
    leaveMatchWaitlist:
      telegramBackendLogin.leaveMatchWaitlist,
    readMatchLineup:
      telegramBackendLogin.readMatchLineup,
    assignMatchLineupSlot:
      telegramBackendLogin.assignMatchLineupSlot,
    releaseMatchLineupSlot:
      telegramBackendLogin.releaseMatchLineupSlot,
    readMatchResult:
      telegramBackendLogin.readMatchResult,
    submitMatchResult:
      telegramBackendLogin.submitMatchResult,
    confirmMatchResult:
      telegramBackendLogin.confirmMatchResult,
    disputeMatchResult:
      telegramBackendLogin.disputeMatchResult,
    listAdminPlayers:
      telegramBackendLogin.listAdminPlayers,
    setAdminPlayerRatingState:
      telegramBackendLogin.setAdminPlayerRatingState,
  });
}

export function createBackendBookingAvailabilityActions(telegramBackendLogin) {
  if (telegramBackendLogin?.sessionReady !== true) return null;

  return Object.freeze({
    listServices: telegramBackendLogin.listBookingServices,
    listCourts: telegramBackendLogin.listBookingCourts,
    listDates: telegramBackendLogin.listBookingDates,
    listTimes: telegramBackendLogin.listBookingTimes,
    createBooking: telegramBackendLogin.createBooking,
    listBookings: telegramBackendLogin.listBookings,
    readBooking: telegramBackendLogin.readBooking,
    readBookingByRequestKey: telegramBackendLogin.readBookingByRequestKey,
  });
}

export default function AuthGate() {
  const telegramBackendLogin = useTelegramBackendLogin();
  const onboardingLegalConfig = useMemo(
    () => readOnboardingLegalConfig(),
    [],
  );
  const {
    completeOwnInitialLevelReassessment,
    loadOwnInitialLevelReassessment,
  } = telegramBackendLogin;
  const [toastMessage, setToastMessage] = useState(null);
  const [backendProfile, setBackendProfile] = useState(null);
  const [backendProfileStatus, setBackendProfileStatus] =
    useState('inactive');
  const backendProfileRequestRef = useRef(0);
  const [playerOnboarding, setPlayerOnboarding] = useState(null);
  const [playerOnboardingStatus, setPlayerOnboardingStatus] =
    useState('inactive');
  const playerOnboardingRequestRef = useRef(0);
  const completedLegalPolicyCurrent = hasCurrentLegalConsents(
    playerOnboarding,
    onboardingLegalConfig,
  );
  const [initialLevelReassessment, setInitialLevelReassessment] =
    useState(null);
  const [initialLevelReassessmentStatus, setInitialLevelReassessmentStatus] =
    useState('inactive');
  const initialLevelReassessmentRequestRef = useRef(0);

  useEffect(() => {
    if (!telegramBackendLogin.sessionReady) {
      backendProfileRequestRef.current += 1;
      setBackendProfile(null);
      setBackendProfileStatus((previous) =>
        previous === 'ready' || previous === 'loading'
          ? 'error'
          : 'inactive');
      return;
    }

    const requestToken = backendProfileRequestRef.current + 1;
    backendProfileRequestRef.current = requestToken;
    setBackendProfileStatus('loading');
    void telegramBackendLogin.loadOwnProfile().then(
      (result) => {
        if (backendProfileRequestRef.current !== requestToken) return;
        if (result.outcome === 'profile_loaded') {
          setBackendProfile(result.profile);
          setBackendProfileStatus('ready');
          return;
        }
        setBackendProfile(null);
        setBackendProfileStatus('error');
      },
      () => {
        if (backendProfileRequestRef.current === requestToken) {
          setBackendProfile(null);
          setBackendProfileStatus('error');
        }
      },
    );
  }, [
    telegramBackendLogin.loadOwnProfile,
    telegramBackendLogin.sessionReady,
  ]);

  useEffect(() => () => {
    backendProfileRequestRef.current += 1;
  }, []);

  const loadPlayerOnboarding = useCallback(async ({
    showLoading = true,
  } = {}) => {
    if (!telegramBackendLogin.sessionReady) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      });
    }
    const requestToken = playerOnboardingRequestRef.current + 1;
    playerOnboardingRequestRef.current = requestToken;
    if (showLoading) setPlayerOnboardingStatus('loading');
    try {
      const result = await telegramBackendLogin.loadOwnOnboarding();
      if (playerOnboardingRequestRef.current !== requestToken) return result;
      if (result.outcome === 'loaded') {
        setPlayerOnboarding(result.onboarding);
        setPlayerOnboardingStatus('ready');
      } else if (result.outcome !== 'cancelled') {
        setPlayerOnboarding(null);
        setPlayerOnboardingStatus('error');
      }
      return result;
    } catch {
      if (playerOnboardingRequestRef.current === requestToken) {
        setPlayerOnboarding(null);
        setPlayerOnboardingStatus('error');
      }
      return Object.freeze({
        outcome: 'rejected',
        reason: 'internal_error',
      });
    }
  }, [
    telegramBackendLogin.loadOwnOnboarding,
    telegramBackendLogin.sessionReady,
  ]);

  useEffect(() => {
    if (!telegramBackendLogin.sessionReady) {
      playerOnboardingRequestRef.current += 1;
      setPlayerOnboarding(null);
      setPlayerOnboardingStatus('inactive');
      return;
    }
    void loadPlayerOnboarding();
  }, [loadPlayerOnboarding, telegramBackendLogin.sessionReady]);

  useEffect(() => () => {
    playerOnboardingRequestRef.current += 1;
  }, []);

  const loadInitialLevelReassessment = useCallback(async ({
    showLoading = true,
  } = {}) => {
    if (!telegramBackendLogin.sessionReady) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'not_authenticated',
      });
    }
    const requestToken = initialLevelReassessmentRequestRef.current + 1;
    initialLevelReassessmentRequestRef.current = requestToken;
    if (showLoading) setInitialLevelReassessmentStatus('loading');
    try {
      const result = await loadOwnInitialLevelReassessment();
      if (initialLevelReassessmentRequestRef.current !== requestToken) {
        return result;
      }
      if (result.outcome === 'loaded') {
        setInitialLevelReassessment(result.reassessment);
        setInitialLevelReassessmentStatus('ready');
      } else if (result.outcome !== 'cancelled') {
        setInitialLevelReassessment(null);
        setInitialLevelReassessmentStatus('error');
      }
      return result;
    } catch {
      if (initialLevelReassessmentRequestRef.current === requestToken) {
        setInitialLevelReassessment(null);
        setInitialLevelReassessmentStatus('error');
      }
      return Object.freeze({
        outcome: 'rejected',
        reason: 'internal_error',
      });
    }
  }, [
    loadOwnInitialLevelReassessment,
    telegramBackendLogin.sessionReady,
  ]);

  useEffect(() => {
    if (
      !telegramBackendLogin.sessionReady ||
      playerOnboardingStatus !== 'ready' ||
      playerOnboarding?.status !== 'completed' ||
      !completedLegalPolicyCurrent
    ) {
      initialLevelReassessmentRequestRef.current += 1;
      setInitialLevelReassessment(null);
      setInitialLevelReassessmentStatus('inactive');
      return;
    }
    if (
      playerOnboarding.initialLevelAlgorithmVersion !== 'initial_level_v1'
    ) {
      initialLevelReassessmentRequestRef.current += 1;
      setInitialLevelReassessment(Object.freeze({ status: 'not_eligible' }));
      setInitialLevelReassessmentStatus('ready');
      return;
    }
    void loadInitialLevelReassessment();
  }, [
    loadInitialLevelReassessment,
    playerOnboarding,
    playerOnboardingStatus,
    onboardingLegalConfig,
    completedLegalPolicyCurrent,
    telegramBackendLogin.sessionReady,
  ]);

  useEffect(() => () => {
    initialLevelReassessmentRequestRef.current += 1;
  }, []);

  const handleBackendProfileRefresh = useCallback(async () => {
    if (!telegramBackendLogin.sessionReady) {
      return Object.freeze({ outcome: 'rejected' });
    }
    const requestToken = backendProfileRequestRef.current + 1;
    backendProfileRequestRef.current = requestToken;
    try {
      const result = await telegramBackendLogin.loadOwnProfile();
      if (backendProfileRequestRef.current !== requestToken) return result;
      if (result.outcome === 'profile_loaded') {
        setBackendProfile(result.profile);
        setBackendProfileStatus('ready');
      }
      return result;
    } catch {
      return Object.freeze({ outcome: 'rejected' });
    }
  }, [
    telegramBackendLogin.loadOwnProfile,
    telegramBackendLogin.sessionReady,
  ]);

  const handleAppLogout = useCallback(async () => {
    backendProfileRequestRef.current += 1;
    playerOnboardingRequestRef.current += 1;
    initialLevelReassessmentRequestRef.current += 1;
    setBackendProfile(null);
    setBackendProfileStatus('inactive');
    setPlayerOnboarding(null);
    setPlayerOnboardingStatus('inactive');
    setInitialLevelReassessment(null);
    setInitialLevelReassessmentStatus('inactive');
    const backendResult = await telegramBackendLogin.logout();
    if (backendResult.outcome !== 'logged_out') {
      throw new Error('Backend session logout failed');
    }
  }, [telegramBackendLogin.logout]);

  const handlePlayerOnboardingSave = useCallback(async (draft) => {
    playerOnboardingRequestRef.current += 1;
    const result = await telegramBackendLogin.saveOwnOnboardingDraft(draft);
    if (result.outcome === 'saved') {
      setPlayerOnboarding(result.onboarding);
      setPlayerOnboardingStatus('ready');
      return result;
    }
    if (
      result.outcome === 'rejected' &&
      result.reason === 'stale_revision'
    ) {
      const refreshed = await loadPlayerOnboarding({ showLoading: false });
      return refreshed.outcome === 'loaded'
        ? Object.freeze({
            outcome: 'reconciled',
            onboarding: refreshed.onboarding,
          })
        : refreshed;
    }
    return result;
  }, [
    loadPlayerOnboarding,
    telegramBackendLogin.saveOwnOnboardingDraft,
  ]);

  const handlePlayerOnboardingAdvance = useCallback(async (progress) => {
    playerOnboardingRequestRef.current += 1;
    const result = await telegramBackendLogin.advanceOwnOnboarding(progress);
    if (result.outcome === 'advanced') {
      setPlayerOnboarding(result.onboarding);
      setPlayerOnboardingStatus('ready');
      return result;
    }
    if (
      result.outcome === 'rejected' &&
      result.reason === 'stale_revision'
    ) {
      const refreshed = await loadPlayerOnboarding({ showLoading: false });
      return refreshed.outcome === 'loaded'
        ? Object.freeze({
            outcome: 'reconciled',
            onboarding: refreshed.onboarding,
          })
        : refreshed;
    }
    return result;
  }, [
    loadPlayerOnboarding,
    telegramBackendLogin.advanceOwnOnboarding,
  ]);

  const handlePlayerOnboardingComplete = useCallback(async (completion) => {
    playerOnboardingRequestRef.current += 1;
    const result = await telegramBackendLogin.completeOwnOnboarding(completion);
    if (result.outcome === 'completed') {
      return result;
    }
    if (
      result.outcome === 'rejected' &&
      result.reason === 'stale_revision'
    ) {
      const refreshed = await loadPlayerOnboarding({ showLoading: false });
      return refreshed.outcome === 'loaded'
        ? Object.freeze({
            outcome: 'reconciled',
            onboarding: refreshed.onboarding,
          })
        : refreshed;
    }
    return result;
  }, [
    loadPlayerOnboarding,
    telegramBackendLogin.completeOwnOnboarding,
  ]);

  const handlePlayerOnboardingLegalAcceptances = useCallback(
    async (acceptance) => {
      playerOnboardingRequestRef.current += 1;
      const result =
        await telegramBackendLogin.acceptOwnOnboardingLegalPolicy(acceptance);
      if (result.outcome === 'accepted') {
        setPlayerOnboarding(result.onboarding);
        setPlayerOnboardingStatus('ready');
      }
      return result;
    },
    [telegramBackendLogin.acceptOwnOnboardingLegalPolicy],
  );

  const handlePlayerOnboardingEnterApp = useCallback((completedOnboarding) => {
    if (
      completedOnboarding?.status !== 'completed'
    ) {
      return;
    }
    setPlayerOnboarding(completedOnboarding);
    setPlayerOnboardingStatus('ready');
  }, []);

  const handleInitialLevelReassessmentComplete = useCallback(
    (completion) => completeOwnInitialLevelReassessment(completion),
    [completeOwnInitialLevelReassessment],
  );

  const handleInitialLevelReassessmentReconcile = useCallback(
    () => loadOwnInitialLevelReassessment(),
    [loadOwnInitialLevelReassessment],
  );

  const handleInitialLevelReassessmentEnterApp = useCallback(
    (completedReassessment) => {
      if (
        completedReassessment !== null &&
        completedReassessment?.status !== 'completed'
      ) {
        return;
      }
      setInitialLevelReassessment(
        completedReassessment ?? Object.freeze({ status: 'not_eligible' }),
      );
      setInitialLevelReassessmentStatus('ready');
    },
    [],
  );

  const handleBackendProfileSave = useCallback(async (changes) => {
    backendProfileRequestRef.current += 1;
    const result = await telegramBackendLogin.updateOwnProfile(changes);
    if (result.outcome === 'profile_updated') {
      setBackendProfile(result.profile);
      setBackendProfileStatus('ready');
    }
    return result;
  }, [telegramBackendLogin.updateOwnProfile]);

  const handleBackendProfilePhotoUpload = useCallback(async (photo) => {
    backendProfileRequestRef.current += 1;
    const result = await telegramBackendLogin.uploadOwnProfilePhoto(photo);
    if (result.outcome === 'profile_photo_updated') {
      setBackendProfile((previous) => (
        previous?.accountId === result.accountId
          ? {
              ...previous,
              photoUrl: result.photoUrl,
              fullPhotoUrl: result.fullPhotoUrl,
            }
          : previous
      ));
      setBackendProfileStatus('ready');
    }
    return result;
  }, [telegramBackendLogin.uploadOwnProfilePhoto]);

  const handleBackendProfilePhotoDelete = useCallback(async () => {
    backendProfileRequestRef.current += 1;
    const result = await telegramBackendLogin.deleteOwnProfilePhoto();
    if (result.outcome === 'profile_photo_deleted') {
      setBackendProfile((previous) => (
        previous?.accountId === result.accountId
          ? {
              ...previous,
              photoUrl: null,
              fullPhotoUrl: null,
            }
          : previous
      ));
      setBackendProfileStatus('ready');
    }
    return result;
  }, [telegramBackendLogin.deleteOwnProfilePhoto]);

  const backendMatchActions = useMemo(
    () => createBackendMatchActions(telegramBackendLogin),
    [
      telegramBackendLogin.createMatch,
      telegramBackendLogin.updateMatchDescription,
      telegramBackendLogin.linkMatchReservation,
      telegramBackendLogin.moderateText,
      telegramBackendLogin.createMatchInvitation,
      telegramBackendLogin.acceptMatchInvitation,
      telegramBackendLogin.cancelMatchInvitation,
      telegramBackendLogin.declineMatchInvitation,
      telegramBackendLogin.joinMatch,
      telegramBackendLogin.leaveMatch,
      telegramBackendLogin.listIncomingMatchInvitations,
      telegramBackendLogin.listAccountMatches,
      telegramBackendLogin.listMatches,
      telegramBackendLogin.listOutgoingMatchInvitations,
      telegramBackendLogin.listMatchMessages,
      telegramBackendLogin.listMatchWaitlist,
      telegramBackendLogin.listMatchNotifications,
      telegramBackendLogin.markMatchNotificationRead,
      telegramBackendLogin.loadMatch,
      telegramBackendLogin.joinMatchWaitlist,
      telegramBackendLogin.leaveMatchWaitlist,
      telegramBackendLogin.readMatchLineup,
      telegramBackendLogin.assignMatchLineupSlot,
      telegramBackendLogin.releaseMatchLineupSlot,
      telegramBackendLogin.readMatchResult,
      telegramBackendLogin.submitMatchResult,
      telegramBackendLogin.confirmMatchResult,
      telegramBackendLogin.disputeMatchResult,
      telegramBackendLogin.listAdminPlayers,
      telegramBackendLogin.setAdminPlayerRatingState,
      telegramBackendLogin.searchPlayers,
      telegramBackendLogin.sendMatchMessage,
      telegramBackendLogin.sessionReady,
    ],
  );

  const backendBookingAvailabilityActions = useMemo(
    () => createBackendBookingAvailabilityActions(telegramBackendLogin),
    [
      telegramBackendLogin.listBookingServices,
      telegramBackendLogin.listBookingCourts,
      telegramBackendLogin.listBookingDates,
      telegramBackendLogin.listBookingTimes,
      telegramBackendLogin.createBooking,
      telegramBackendLogin.listBookings,
      telegramBackendLogin.readBooking,
      telegramBackendLogin.readBookingByRequestKey,
      telegramBackendLogin.sessionReady,
    ],
  );

  const showToast = (message, variant = 'info') => {
    setToastMessage({ message, variant });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const backendProfileRequired = true;
  const effectiveBackendProfileStatus =
    telegramBackendLogin.sessionReady &&
    backendProfileStatus === 'inactive'
      ? 'loading'
      : backendProfileStatus;
  const ownProfileGate = resolveOwnProfileGate({
    backendRequired: backendProfileRequired,
    sessionReady: telegramBackendLogin.sessionReady,
    profileStatus: effectiveBackendProfileStatus,
    hasProfile: backendProfile !== null,
  });
  const visibleTelegramBackendStatus = ownProfileGate === 'error'
    ? 'profile_unavailable'
    : telegramBackendLogin.status;
  const telegramBackendStatus = (
    <TelegramBackendLoginStatus
      status={visibleTelegramBackendStatus}
      accountKind={telegramBackendLogin.accountKind}
    />
  );

  const toast = toastMessage && (
    <Toast
      message={toastMessage.message}
      variant={toastMessage.variant}
      onClose={() => setToastMessage(null)}
    />
  );

  if (
    ownProfileGate !== 'ready'
  ) {
    return (
      <div
        data-testid="backend-own-profile-gate"
        data-state={ownProfileGate}
      >
        <BallLoader />
        {telegramBackendStatus}
      </div>
    );
  }

  if (playerOnboardingStatus !== 'ready' || playerOnboarding === null) {
    if (playerOnboardingStatus === 'error') {
      return (
        <>
          <main className="onboarding-profile-screen" data-testid="player-onboarding-load-gate" data-state="error">
            <section className="onboarding-profile-card" aria-labelledby="onboarding-load-error-title">
              <p className="onboarding-profile-eyebrow">Просто Падел</p>
              <h1 id="onboarding-load-error-title">Не удалось загрузить анкету</h1>
              <p className="onboarding-profile-intro" role="alert">
                Проверьте соединение и попробуйте снова.
              </p>
              <button type="button" className="onboarding-profile-submit" onClick={() => void loadPlayerOnboarding()}>
                Попробовать снова
              </button>
            </section>
          </main>
          {telegramBackendStatus}
        </>
      );
    }
    return (
      <div data-testid="player-onboarding-load-gate" data-state="loading">
        <BallLoader />
        {telegramBackendStatus}
      </div>
    );
  }

  if (playerOnboarding.status !== 'completed') {
    return (
      <OnboardingFlowGate
        onboarding={playerOnboarding}
        legalConfig={onboardingLegalConfig}
        onReload={loadPlayerOnboarding}
        onSaveProfile={handlePlayerOnboardingSave}
        onAdvance={handlePlayerOnboardingAdvance}
        onComplete={handlePlayerOnboardingComplete}
        onEnterApp={handlePlayerOnboardingEnterApp}
      />
    );
  }

  if (!completedLegalPolicyCurrent) {
    return (
      <LegalReconsentGate
        onboarding={playerOnboarding}
        legalConfig={onboardingLegalConfig}
        onAccept={handlePlayerOnboardingLegalAcceptances}
        onAccepted={setPlayerOnboarding}
      />
    );
  }

  if (
    initialLevelReassessmentStatus !== 'ready' ||
    initialLevelReassessment === null
  ) {
    if (initialLevelReassessmentStatus === 'error') {
      return (
        <>
          <main
            className="onboarding-profile-screen"
            data-testid="initial-level-reassessment-load-gate"
            data-state="error"
          >
            <section
              className="onboarding-profile-card"
              aria-labelledby="initial-level-reassessment-load-error-title"
            >
              <p className="onboarding-profile-eyebrow">Просто Падел</p>
              <h1 id="initial-level-reassessment-load-error-title">
                Не удалось проверить начальный уровень
              </h1>
              <p className="onboarding-profile-intro" role="alert">
                Проверьте соединение и попробуйте снова.
              </p>
              <button
                type="button"
                className="onboarding-profile-submit"
                onClick={() => void loadInitialLevelReassessment()}
              >
                Попробовать снова
              </button>
            </section>
          </main>
          {telegramBackendStatus}
        </>
      );
    }
    return (
      <div
        data-testid="initial-level-reassessment-load-gate"
        data-state="loading"
      >
        <BallLoader />
        {telegramBackendStatus}
      </div>
    );
  }

  if (initialLevelReassessment.status === 'required') {
    return (
      <InitialLevelReassessmentGate
        reassessment={initialLevelReassessment}
        onComplete={handleInitialLevelReassessmentComplete}
        onReconcile={handleInitialLevelReassessmentReconcile}
        onEnterApp={handleInitialLevelReassessmentEnterApp}
      />
    );
  }

  const reassessedInitialLevelLabel =
    initialLevelReassessment.status === 'completed'
      ? initialLevelReassessment.initialLevelLabel
      : null;

  return (
    <>
      <App
        backendProfile={backendProfile}
        privateBookingClient={{
          fullName: [
            backendProfile.firstName,
            backendProfile.lastName,
          ].filter(Boolean).join(' '),
          phone: backendProfile.phone ?? '',
        }}
        playerOnboardingInitialLevelLabel={
          reassessedInitialLevelLabel ??
          (playerOnboarding.initialLevelAlgorithmVersion === 'initial_level_v2'
            ? playerOnboarding.initialLevelLabel
            : null)
        }
        backendMatchRequired={backendProfileRequired}
        backendMatchLifecycleStatus={telegramBackendLogin.status}
        backendProfileStatus={effectiveBackendProfileStatus}
        backendMatchActions={backendMatchActions}
        backendBookingAvailabilityActions={backendBookingAvailabilityActions}
        onBackendProfileRefresh={handleBackendProfileRefresh}
        onBackendProfileSave={handleBackendProfileSave}
        onBackendProfilePhotoUpload={handleBackendProfilePhotoUpload}
        onBackendProfilePhotoDelete={handleBackendProfilePhotoDelete}
        showToast={showToast}
        onLogout={handleAppLogout}
      />
      {toast}
      {telegramBackendStatus}
    </>
  );
}
