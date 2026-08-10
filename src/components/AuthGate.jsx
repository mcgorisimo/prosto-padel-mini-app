import React, {
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
  const [toastMessage, setToastMessage] = useState(null);
  const [backendProfile, setBackendProfile] = useState(null);
  const [backendProfileStatus, setBackendProfileStatus] =
    useState('inactive');
  const backendProfileRequestRef = useRef(0);

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
    setBackendProfile(null);
    setBackendProfileStatus('inactive');
    const backendResult = await telegramBackendLogin.logout();
    if (backendResult.outcome !== 'logged_out') {
      throw new Error('Backend session logout failed');
    }
  }, [telegramBackendLogin.logout]);

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

  return (
    <>
      <App
        backendProfile={backendProfile}
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
