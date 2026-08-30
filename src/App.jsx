import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import PlayerProfile from './components/PlayerProfile';
import BottomNav from './components/BottomNav';
import MatchCreationScreen from './components/MatchCreationScreen';
import MatchDetailsScreen from './components/MatchDetailsScreen';
import MatchFeed from './components/MatchFeed';
import Home from './components/Home';
import EditProfileScreen from './components/EditProfileScreen';
import BookingScreen from './components/BookingScreen';
import PullToRefresh from './components/PullToRefresh';
import AdminScreen from './components/AdminScreen';
import BallLoader from './components/BallLoader';
import { useTelegram } from './hooks/useTelegram';
import { getLevelForRating } from './lib/ratingEngine';
import { normalizeInitialLevelLabel } from './lib/playerLevelPresentation';
import {
  BACKEND_PRIVATE_MATCH_CREATION_ENABLED,
  createBackendMatchDraft,
  applyBackendParticipantResult,
  isBackendOwnedMatch,
  mapBackendInvitationToApp,
  mapBackendMatchMessageToApp,
  mapBackendMatchNotificationToApp,
  mapBackendMatchToApp,
  mapBackendPublicPlayerToApp,
  mergeAccountUpcomingMatches,
  preferConfirmedBackendMatchMutation,
  resolveBackendMatchMode,
  resolveMatchSource,
  selectFutureBackendMatches,
  shouldApplyBackendMatchDetail,
  shouldApplyBackendMatchFeedResponse,
} from './lib/backendMatchAdapter';
import {
  selectBackendReservationsForHome,
  selectMissingBookingCourtServiceIds,
} from './lib/backendBookingHomeAdapter';
import { readTelegramNotificationDeepLink } from './lib/telegramNotificationDeepLink';

const MAX_EXPLICIT_HOME_BOOKING_REFRESHES = 3;

export function selectBackendReservationsForExplicitRefresh(reservations) {
  return (Array.isArray(reservations) ? reservations : [])
    .filter((reservation) =>
      typeof reservation?.reservationId === 'string' &&
      !['cancelled', 'rejected'].includes(reservation.status),
    )
    .slice(0, MAX_EXPLICIT_HOME_BOOKING_REFRESHES);
}

function normalizeMessage(row) {
  if (!row) return row;

  return {
    ...row,
    matchId: row.matchId ?? row.match_id,
    senderId: row.senderId ?? row.sender_id,
    senderName: row.senderName ?? row.sender_name,
    timestamp: row.timestamp ?? row.created_at,
  };
}

function getMessageKey(message) {
  if (!message) return null;
  return message.id ?? [
    message.matchId ?? message.match_id,
    message.senderId ?? message.sender_id,
    message.timestamp ?? message.created_at,
    message.text,
  ].join(':');
}

function appendUniqueMessage(messages, row) {
  const message = normalizeMessage(row);
  const messageKey = getMessageKey(message);

  if (!messageKey) return messages;
  if (messages.some(existing => getMessageKey(existing) === messageKey)) {
    return messages;
  }

  return [...messages, message];
}

const isMatchCompleted = (match) =>
  match?.status === 'completed' || match?.status === 'finished';

// Pure derivation: completed matches the given user participated in.
function getUserMatchHistory(allMatches, userId) {
  return (allMatches ?? []).filter(m =>
    isMatchCompleted(m) && Array.isArray(m.participants) && m.participants.includes(userId)
  );
}

function getUserMatchOutcome(match, userId) {
  if (!userId || typeof match?.isTeam1Win !== 'boolean') return 'neutral';
  const inTeam1 = (match.team1 ?? []).some((player) => player?.id === userId);
  const inTeam2 = (match.team2 ?? []).some((player) => player?.id === userId);
  if (!inTeam1 && !inTeam2) return 'neutral';
  return (inTeam1 ? match.isTeam1Win : !match.isTeam1Win) ? 'win' : 'loss';
}

function isBackendInvitationStaleReason(reason) {
  return [
    'invitation_not_found',
    'invitation_closed',
    'match_not_found',
    'match_closed',
    'match_started',
    'match_full',
    'slot_unavailable',
    'already_participant',
  ].includes(reason);
}

function backendInvitationError(reason) {
  const error = new Error('BACKEND_MATCH_INVITATION_REJECTED');
  error.reason = reason;
  return error;
}

export function mapBackendProfileToCurrentUser(backendProfile) {
  return {
    first_name: backendProfile?.firstName ?? 'Новый',
    last_name: backendProfile?.lastName ?? '',
    username: backendProfile?.username ?? '',
    photo_url: backendProfile?.photoUrl ?? '',
    full_photo_url: backendProfile?.fullPhotoUrl ?? '',
    language_code: backendProfile?.languageCode ?? '',
    phone: backendProfile?.phone ?? '',
    side_preference: backendProfile?.sidePreference ?? 'Both',
    rating: Number.isFinite(backendProfile?.rating)
      ? backendProfile.rating
      : 3.0,
    is_verified: backendProfile?.isVerified === true,
    role: backendProfile?.role ?? 'player',
    is_admin:
      backendProfile?.capabilities?.includes('club_admin') === true,
  };
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App({
  backendProfile = null,
  privateBookingClient = null,
  playerOnboardingInitialLevelLabel = null,
  backendMatchLifecycleStatus = 'disabled',
  backendProfileStatus = backendProfile ? 'ready' : 'inactive',
  backendMatchActions = null,
  backendBookingAvailabilityActions = null,
  onBackendProfileRefresh = null,
  onBackendProfileSave = null,
  onBackendProfilePhotoUpload = null,
  onBackendProfilePhotoDelete = null,
  showToast,
  onLogout,
}) { // Accept showToast as a prop
  const { tg } = useTelegram();
  
  // --- 1. СТЕЙТЫ ---
  const ME_ID = backendProfile?.accountId ?? null;
  const backendMatchMode = resolveBackendMatchMode({
    hasBackendActions: backendMatchActions !== null,
    lifecycleStatus: backendMatchLifecycleStatus,
    profileStatus: backendProfileStatus,
    accountId: backendProfile?.accountId,
  });
  const backendMatchesReady = backendMatchMode === 'ready';
  const [loading, setLoading] = useState(true);
  const [backendFeedMatches, setBackendFeedMatches] = useState([]);
  const [backendFeedLoading, setBackendFeedLoading] = useState(false);
  const [backendFeedError, setBackendFeedError] = useState('');
  const [backendAccountMatches, setBackendAccountMatches] = useState([]);
  const [backendReservations, setBackendReservations] = useState([]);
  const [backendCourtNamesById, setBackendCourtNamesById] = useState({});
  const [backendMatchNow, setBackendMatchNow] = useState(
    () => Math.floor(Date.now() / 1_000),
  );
  const [backendChatMessages, setBackendChatMessages] = useState([]);
  const [backendChatLoading, setBackendChatLoading] = useState(false);
  const [backendChatLoadingOlder, setBackendChatLoadingOlder] = useState(false);
  const [backendChatLoadError, setBackendChatLoadError] = useState('');
  const [backendChatCursor, setBackendChatCursor] = useState(null);
  const [activeTab, setActiveTab]    = useState('home');
  const [selectedMatch, setSelected] = useState(null);
  const [selectedBookingReservationId, setSelectedBookingReservationId] = useState(null);
  const [screen, setScreen] = useState(null);
  const backendDetailRequestRef = useRef(0);
  const backendFeedRequestRef = useRef(0);
  const backendAccountRequestRef = useRef(0);
  const backendReservationRequestRef = useRef(0);
  const backendReservationRefreshInFlightRef = useRef(false);
  const attemptedBookingCourtServicesRef = useRef(new Set());
  const backendInvitationRequestRef = useRef(0);
  const backendChatRequestRef = useRef(0);
  const backendNotificationRequestRef = useRef(0);
  const backendNotificationPollInFlightRef = useRef(null);
  const backendChatMatchRef = useRef(null);
  const [incomingInvitations, setIncomingInvitations] = useState([]);
  const [outgoingInvitations, setOutgoingInvitations] = useState([]);
  const [invitationsLoading, setInvitationsLoading] = useState(true);
  const [invitationsLoadError, setInvitationsLoadError] = useState('');
  const [notificationCenter, setNotificationCenter] = useState({ items: [], unreadCount: 0 });
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsLoadError, setNotificationsLoadError] = useState('');
  const [invitationActions, setInvitationActions] = useState(() => new Set());
  const invitationActionRef = useRef(new Set());
  const handledIncomingInvitationIdsRef = useRef(new Set());
  const notificationDeepLinkRef = useRef(
    readTelegramNotificationDeepLink(globalThis.location?.search ?? ''),
  );
  const notificationDeepLinkInFlightRef = useRef(false);

  const hideHandledIncomingInvitation = useCallback((invitationId) => {
    if (!invitationId) return;
    handledIncomingInvitationIdsRef.current.add(String(invitationId));
    setIncomingInvitations((prev) => prev.filter(
      (item) => String(item.invitation_id) !== String(invitationId)
    ));
  }, []);

  const loadBackendMatchFeed = useCallback(async () => {
    const requestId = backendFeedRequestRef.current + 1;
    backendFeedRequestRef.current = requestId;
    if (!backendMatchesReady) {
      setBackendFeedMatches([]);
      setBackendFeedError(
        backendMatchMode === 'error'
          ? 'Не удалось загрузить профиль для матчей. Откройте приложение заново.'
          : '',
      );
      setBackendFeedLoading(backendMatchMode === 'loading');
      return null;
    }

    setBackendFeedLoading(true);
    setBackendFeedError('');
    try {
      const result = await backendMatchActions.listMatches(50);
      if (!shouldApplyBackendMatchFeedResponse(
        backendFeedRequestRef.current,
        requestId,
      )) {
        return null;
      }
      if (result.outcome !== 'matches_loaded') {
        throw new Error('BACKEND_MATCH_FEED_REJECTED');
      }
      const matches = result.matches
        .map((record) => mapBackendMatchToApp(
          record,
          backendProfile,
          backendCourtNamesById,
        ))
        .filter(Boolean);
      setBackendMatchNow(Math.floor(Date.now() / 1_000));
      setBackendFeedMatches(matches);
      return matches;
    } catch {
      if (!shouldApplyBackendMatchFeedResponse(
        backendFeedRequestRef.current,
        requestId,
      )) {
        return null;
      }
      setBackendFeedError('Не удалось загрузить матчи. Проверьте подключение и попробуйте ещё раз.');
      return null;
    } finally {
      if (shouldApplyBackendMatchFeedResponse(
        backendFeedRequestRef.current,
        requestId,
      )) {
        setBackendFeedLoading(false);
      }
    }
  }, [
    backendMatchActions,
    backendMatchMode,
    backendMatchesReady,
    backendCourtNamesById,
    backendProfile,
  ]);

  const loadBackendAccountMatches = useCallback(async () => {
    const requestId = backendAccountRequestRef.current + 1;
    backendAccountRequestRef.current = requestId;
    if (!backendMatchesReady) {
      setBackendAccountMatches([]);
      return null;
    }

    try {
      const result = await backendMatchActions.listAccountMatches(50);
      if (!shouldApplyBackendMatchFeedResponse(
        backendAccountRequestRef.current,
        requestId,
      )) {
        return null;
      }
      if (result.outcome !== 'matches_loaded') {
        throw new Error('BACKEND_ACCOUNT_MATCHES_REJECTED');
      }
      const matches = result.matches
        .map((record) => mapBackendMatchToApp(
          record,
          backendProfile,
          backendCourtNamesById,
        ))
        .filter(Boolean);
      setBackendMatchNow(Math.floor(Date.now() / 1_000));
      setBackendAccountMatches(matches);
      return matches;
    } catch {
      return null;
    }
  }, [
    backendMatchActions,
    backendMatchesReady,
    backendCourtNamesById,
    backendProfile,
  ]);

  const loadBackendReservations = useCallback(async () => {
    const requestId = backendReservationRequestRef.current + 1;
    backendReservationRequestRef.current = requestId;
    if (
      typeof backendBookingAvailabilityActions?.listBookings !== 'function'
    ) {
      setBackendReservations([]);
      return null;
    }

    try {
      const result = await backendBookingAvailabilityActions.listBookings();
      if (backendReservationRequestRef.current !== requestId) return null;
      if (result?.outcome !== 'bookings_loaded') return null;
      const reservations = Array.isArray(result.reservations)
        ? result.reservations
        : [];
      setBackendReservations(reservations);
      return reservations;
    } catch {
      return null;
    }
  }, [backendBookingAvailabilityActions]);

  const refreshBackendReservations = useCallback(async () => {
    if (
      backendReservationRefreshInFlightRef.current ||
      typeof backendBookingAvailabilityActions?.readBooking !== 'function'
    ) return;

    backendReservationRefreshInFlightRef.current = true;
    try {
      const listed = await loadBackendReservations();
      const targets = selectBackendReservationsForExplicitRefresh(listed);
      for (const reservation of targets) {
        try {
          await backendBookingAvailabilityActions.readBooking(
            reservation.reservationId,
          );
        } catch {
          // Each owner read is independent; the final persisted list stays truthful.
        }
      }
      await loadBackendReservations();
    } finally {
      backendReservationRefreshInFlightRef.current = false;
    }
  }, [
    backendBookingAvailabilityActions,
    loadBackendReservations,
  ]);

  const mergeBackendCourtCatalog = useCallback((courts) => {
    if (!Array.isArray(courts)) return;
    setBackendCourtNamesById((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const court of courts) {
        if (
          !Number.isSafeInteger(court?.id) ||
          court.id < 1 ||
          typeof court.name !== 'string' ||
          court.name.trim().length < 1 ||
          court.name.trim().length > 128
        ) continue;
        const name = court.name.trim();
        if (next[court.id] === name) continue;
        next[court.id] = name;
        changed = true;
      }
      return changed ? Object.freeze(next) : previous;
    });
  }, []);

  const loadInvitations = useCallback(async () => {
    if (!backendProfile?.accountId) return null;
    setInvitationsLoading(true);
    setInvitationsLoadError('');

    try {
      if (!backendMatchesReady) {
        setIncomingInvitations([]);
        setOutgoingInvitations([]);
        return null;
      }
      const result =
        await backendMatchActions.listIncomingMatchInvitations(20);
      if (result.outcome !== 'invitations_loaded') {
        throw new Error('BACKEND_INVITATION_LIST_REJECTED');
      }
      const handledIds = handledIncomingInvitationIdsRef.current;
      const visibleIncoming = result.invitations
        .map(mapBackendInvitationToApp)
        .filter(Boolean)
        .filter(
          (item) =>
            item.status === 'pending' &&
            !handledIds.has(String(item.invitation_id)),
        );
      setIncomingInvitations(visibleIncoming);
      return visibleIncoming;
    } catch (error) {
      console.error(`Ошибка при получении приглашений: ${error.message}`);
      setInvitationsLoadError('Не удалось загрузить приглашения. Проверьте подключение и попробуйте ещё раз.');
      return null;
    } finally {
      setInvitationsLoading(false);
    }
  }, [
    backendMatchActions,
    backendMatchesReady,
    backendProfile?.accountId,
  ]);

  const loadBackendOutgoingInvitations = useCallback(async (matchId) => {
    const requestId = backendInvitationRequestRef.current + 1;
    backendInvitationRequestRef.current = requestId;
    if (!backendMatchesReady || !matchId) {
      setOutgoingInvitations([]);
      return null;
    }
    try {
      const result =
        await backendMatchActions.listOutgoingMatchInvitations(matchId, 20);
      if (backendInvitationRequestRef.current !== requestId) return null;
      if (result.outcome !== 'invitations_loaded') {
        throw new Error('BACKEND_INVITATION_LIST_REJECTED');
      }
      const outgoing = result.invitations
        .map(mapBackendInvitationToApp)
        .filter(Boolean)
        .filter((item) => item.status === 'pending');
      setOutgoingInvitations(outgoing);
      return outgoing;
    } catch {
      if (backendInvitationRequestRef.current === requestId) {
        setOutgoingInvitations([]);
      }
      return null;
    }
  }, [backendMatchActions, backendMatchesReady]);

  const loadNotifications = useCallback(async ({ background = false } = {}) => {
    const requestId = backendNotificationRequestRef.current + 1;
    backendNotificationRequestRef.current = requestId;
    if (
      !backendMatchesReady ||
      typeof backendMatchActions?.listMatchNotifications !== 'function'
    ) {
      setNotificationCenter({ items: [], unreadCount: 0 });
      setNotificationsLoading(false);
      setNotificationsLoadError('');
      return null;
    }
    if (!background) setNotificationsLoading(true);
    setNotificationsLoadError('');
    try {
      const center = await backendMatchActions.listMatchNotifications(50).then((result) => {
        if (result.outcome !== 'notifications_loaded') {
          throw new Error('BACKEND_NOTIFICATION_LIST_REJECTED');
        }
        const items = result.notifications
          .map(mapBackendMatchNotificationToApp)
          .filter(Boolean);
        if (items.length !== result.notifications.length) {
          throw new Error('BACKEND_NOTIFICATION_LIST_INVALID');
        }
        return Object.freeze({
          items,
          unreadCount: result.unreadCount,
        });
      });
      if (backendNotificationRequestRef.current !== requestId) return null;
      setNotificationCenter(center);
      return center;
    } catch (error) {
      if (backendNotificationRequestRef.current !== requestId) return null;
      console.error(`Ошибка при получении уведомлений: ${error.message}`);
      setNotificationsLoadError('Не удалось загрузить уведомления. Проверьте подключение и попробуйте ещё раз.');
      return null;
    } finally {
      if (
        !background &&
        backendNotificationRequestRef.current === requestId
      ) {
        setNotificationsLoading(false);
      }
    }
  }, [
    backendMatchActions,
    backendMatchesReady,
  ]);

  const refreshActiveTab = useCallback(async () => {
    if (activeTab === 'home') {
      await Promise.allSettled([
        refreshBackendReservations(),
        loadBackendAccountMatches(),
        Promise.resolve().then(() => onBackendProfileRefresh?.()),
      ]);
      return;
    }

    if (activeTab === 'matches') {
      await loadBackendMatchFeed();
      return;
    }

    if (activeTab === 'profile') {
      await Promise.allSettled([
        loadBackendAccountMatches(),
        loadInvitations(),
        loadNotifications(),
        Promise.resolve().then(() => onBackendProfileRefresh?.()),
      ]);
      return;
    }

    if (activeTab === 'leaderboard') {
      await Promise.allSettled([
        loadBackendAccountMatches(),
        Promise.resolve().then(() => onBackendProfileRefresh?.()),
      ]);
    }
  }, [
    activeTab,
    loadBackendAccountMatches,
    loadBackendMatchFeed,
    loadInvitations,
    loadNotifications,
    onBackendProfileRefresh,
    refreshBackendReservations,
  ]);

  const fetchData = useCallback(async () => {
    if (!ME_ID) {
      setLoading(false);
      return;
    }

    try {
      await Promise.all([
        loadBackendMatchFeed(),
        loadBackendAccountMatches(),
        loadInvitations(),
        loadNotifications(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [
    ME_ID,
    loadBackendMatchFeed,
    loadBackendAccountMatches,
    loadInvitations,
    loadNotifications,
  ]);

  // --- 2. ЗАГРУЗКА ДАННЫХ ---
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!backendMatchesReady) return undefined;

    let wasHidden = document.visibilityState !== 'visible';
    const pollNotifications = () => {
      if (
        document.visibilityState !== 'visible' ||
        backendNotificationPollInFlightRef.current
      ) return;

      const request = loadNotifications({ background: true });
      backendNotificationPollInFlightRef.current = request;
      void request.finally(() => {
        if (backendNotificationPollInFlightRef.current === request) {
          backendNotificationPollInFlightRef.current = null;
        }
      });
    };
    const refreshNotificationsAfterResume = () => {
      if (document.visibilityState !== 'visible') {
        wasHidden = true;
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;
      pollNotifications();
    };

    const intervalId = globalThis.setInterval(pollNotifications, 5_000);
    document.addEventListener(
      'visibilitychange',
      refreshNotificationsAfterResume,
    );
    return () => {
      globalThis.clearInterval(intervalId);
      document.removeEventListener(
        'visibilitychange',
        refreshNotificationsAfterResume,
      );
      backendNotificationRequestRef.current += 1;
    };
  }, [backendMatchesReady, loadNotifications]);

  useEffect(() => {
    if (activeTab === 'profile') {
      void loadInvitations();
    }
  }, [
    activeTab,
    loadInvitations,
  ]);

  useEffect(() => {
    if (activeTab === 'home') {
      void refreshBackendReservations();
    }
  }, [activeTab, refreshBackendReservations]);

  useEffect(() => {
    if (
      activeTab !== 'home' ||
      typeof backendBookingAvailabilityActions?.listCourts !== 'function'
    ) return undefined;

    const serviceIds = selectMissingBookingCourtServiceIds(
      backendReservations,
      backendCourtNamesById,
      attemptedBookingCourtServicesRef.current,
    );
    if (serviceIds.length === 0) return undefined;
    for (const serviceId of serviceIds) {
      attemptedBookingCourtServicesRef.current.add(serviceId);
    }

    let active = true;
    void (async () => {
      for (const serviceId of serviceIds) {
        if (!active) return;
        let result;
        try {
          result = await backendBookingAvailabilityActions.listCourts(serviceId);
        } catch {
          if (!active) return;
          continue;
        }
        if (!active) return;
        if (result?.outcome === 'courts_loaded') {
          mergeBackendCourtCatalog(result.courts);
        }
      }
    })();
    return () => { active = false; };
  }, [
    activeTab,
    backendBookingAvailabilityActions,
    backendCourtNamesById,
    backendReservations,
    mergeBackendCourtCatalog,
  ]);

  useEffect(() => {
    const refreshVisibleAccountData = () => {
      if (document.visibilityState === 'visible') {
        setBackendMatchNow(Math.floor(Date.now() / 1_000));
        void loadBackendMatchFeed();
        void loadBackendAccountMatches();
        void (
          activeTab === 'home'
            ? refreshBackendReservations()
            : loadBackendReservations()
        );
        void loadInvitations();
      }
    };

    window.addEventListener('focus', refreshVisibleAccountData);
    document.addEventListener(
      'visibilitychange',
      refreshVisibleAccountData,
    );

    return () => {
      window.removeEventListener('focus', refreshVisibleAccountData);
      document.removeEventListener(
        'visibilitychange',
        refreshVisibleAccountData,
      );
    };
  }, [
    activeTab,
    loadBackendAccountMatches,
    loadBackendMatchFeed,
    loadBackendReservations,
    loadInvitations,
    refreshBackendReservations,
  ]);

  useEffect(() => {
    const nowMilliseconds = Date.now();
    const nextStartsAt = [
      ...backendFeedMatches,
      ...backendAccountMatches,
    ].reduce((next, match) => {
      const startsAt = Number(match?.startsAt);
      if (!Number.isSafeInteger(startsAt)) return next;
      const startsAtMilliseconds = startsAt * 1_000;
      if (startsAtMilliseconds <= nowMilliseconds) return next;
      return next === null || startsAtMilliseconds < next
        ? startsAtMilliseconds
        : next;
    }, null);
    if (nextStartsAt === null) return undefined;

    const timeoutId = window.setTimeout(
      () => setBackendMatchNow(Math.floor(Date.now() / 1_000)),
      Math.min(
        Math.max(nextStartsAt - nowMilliseconds + 25, 25),
        2_147_000_000,
      ),
    );
    return () => window.clearTimeout(timeoutId);
  }, [
    backendAccountMatches,
    backendFeedMatches,
    backendMatchNow,
  ]);

  // --- 3. ПОЛЬЗОВАТЕЛЬ ---
  const currentUser = useMemo(() => {
    const p = mapBackendProfileToCurrentUser(backendProfile);
    
    const numericRating = Number.isFinite(p.rating) ? p.rating : 3.0;
    const RATINGS_ORDER = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
    const levelLabel = getLevelForRating(numericRating)?.label || 'D';
    const ratingIdx = Math.max(0, RATINGS_ORDER.indexOf(levelLabel));

    return {
      id: ME_ID,
      rating: numericRating,
      numericRating,
      ratingIdx,
      level: levelLabel,
      isVerified: p.is_verified === true,
      is_verified: p.is_verified === true,
      firstName: p.first_name,
      lastName: p.last_name,
      phone: p.phone || '',
      side_preference: p.side_preference || 'Both',
      username: p.username,
      photo_url: p.photo_url || '',
      full_photo_url: p.full_photo_url || '',
      accountId: backendProfile?.accountId ?? null,
      role: p.role,
      isAdmin: p.is_admin === true,
      initialLevelLabel: normalizeInitialLevelLabel(
        playerOnboardingInitialLevelLabel,
      ),
    };
  }, [
    backendProfile,
    ME_ID,
    playerOnboardingInitialLevelLabel,
  ]);

  const backendMatchCurrentUser = useMemo(() => ({
    ...currentUser,
    id: backendProfile?.accountId ?? null,
    role: backendProfile?.role ?? 'player',
  }), [backendProfile?.accountId, backendProfile?.role, currentUser]);
  const matchCurrentUser = backendMatchCurrentUser;
  const getMatchSource = useCallback((matchId, explicitMatch = null) => (
    resolveMatchSource(
      matchId,
      explicitMatch ?? selectedMatch,
      [...backendAccountMatches, ...backendFeedMatches],
    )
  ), [
    backendAccountMatches,
    backendFeedMatches,
    selectedMatch,
  ]);
  const storeBackendMatch = useCallback((updatedMatch) => {
    if (!isBackendOwnedMatch(updatedMatch)) return null;
    backendFeedRequestRef.current += 1;
    backendAccountRequestRef.current += 1;
    setBackendFeedLoading(false);
    setBackendMatchNow(Math.floor(Date.now() / 1_000));
    setBackendFeedMatches((previous) => {
      const existing = previous.find(
        (match) => match.id === updatedMatch.id,
      );
      if (
        existing &&
        !shouldApplyBackendMatchDetail(
          existing,
          updatedMatch.id,
          updatedMatch,
        )
      ) {
        return previous;
      }
      if (updatedMatch.isPrivate) {
        return previous.filter(
          (match) => match.id !== updatedMatch.id,
        );
      }
      return existing
        ? previous.map((match) =>
            match.id === updatedMatch.id ? updatedMatch : match)
        : [updatedMatch, ...previous];
    });
    setBackendAccountMatches((previous) => {
      const existing = previous.find(
        (match) => match.id === updatedMatch.id,
      );
      if (
        existing &&
        !shouldApplyBackendMatchDetail(
          existing,
          updatedMatch.id,
          updatedMatch,
        )
      ) {
        return previous;
      }
      const belongsToAccount =
        updatedMatch.ownerId === backendProfile?.accountId ||
        updatedMatch.participants?.includes(
          backendProfile?.accountId,
        );
      if (updatedMatch.isPrivate || !belongsToAccount) {
        return previous.filter(
          (match) => match.id !== updatedMatch.id,
        );
      }
      return existing
        ? previous.map((match) =>
            match.id === updatedMatch.id ? updatedMatch : match)
        : [updatedMatch, ...previous];
    });
    setSelected((previous) =>
      shouldApplyBackendMatchDetail(
        previous,
        updatedMatch.id,
        updatedMatch,
      )
        ? updatedMatch
        : previous);
    return updatedMatch;
  }, [backendProfile?.accountId]);

  const loadBackendMatchMessages = useCallback(async (
    matchId,
    { older = false, background = false } = {},
  ) => {
    if (!backendMatchesReady || !backendMatchActions || !matchId) {
      return null;
    }
    if (older && backendChatMatchRef.current !== matchId) return null;

    const cursor = older ? backendChatCursor : undefined;
    if (older && cursor === null) return [];
    const requestId = backendChatRequestRef.current + 1;
    backendChatRequestRef.current = requestId;
    if (!older && !background) {
      backendChatMatchRef.current = matchId;
      setBackendChatMessages([]);
      setBackendChatCursor(null);
      setBackendChatLoadError('');
      setBackendChatLoading(true);
    } else if (older) {
      setBackendChatLoadingOlder(true);
    }

    try {
      const result = await backendMatchActions.listMatchMessages(
        matchId,
        50,
        cursor,
      );
      if (
        backendChatRequestRef.current !== requestId ||
        backendChatMatchRef.current !== matchId
      ) {
        return null;
      }
      if (result.outcome !== 'messages_loaded') {
        throw new Error('BACKEND_MATCH_CHAT_LIST_REJECTED');
      }
      const messages = result.messages
        .map(mapBackendMatchMessageToApp)
        .filter(Boolean)
        .reverse();
      if (messages.length !== result.messages.length) {
        throw new Error('BACKEND_MATCH_CHAT_MAPPING_REJECTED');
      }
      setBackendChatMessages((previous) => {
        const combined = older
          ? [...messages, ...previous]
          : background
            ? [...previous, ...messages]
            : messages;
        return combined.reduce(
          (next, message) => appendUniqueMessage(next, message),
          [],
        );
      });
      if (!background) {
        setBackendChatCursor(result.nextCursor ?? null);
      }
      setBackendChatLoadError('');
      return messages;
    } catch {
      if (
        backendChatRequestRef.current === requestId &&
        backendChatMatchRef.current === matchId &&
        !older &&
        !background
      ) {
        setBackendChatLoadError(
          'Не удалось загрузить сообщения. Попробуйте ещё раз.',
        );
      }
      return null;
    } finally {
      if (
        backendChatRequestRef.current === requestId &&
        backendChatMatchRef.current === matchId
      ) {
        if (!background) {
          setBackendChatLoading(false);
          setBackendChatLoadingOlder(false);
        }
      }
    }
  }, [
    backendChatCursor,
    backendMatchActions,
    backendMatchesReady,
  ]);

  const isAdmin = currentUser?.isAdmin === true;

  const handleSendMessage = async (matchId, _sender, text) => {
    if (!backendMatchesReady || !backendMatchActions) {
      showToast?.(
        'Чат пока недоступен. Попробуйте ещё раз.',
        'error',
      );
      throw new Error('BACKEND_MATCH_CHAT_NOT_READY');
    }
    const result = await backendMatchActions.sendMatchMessage(
      matchId,
      text,
    );
    if (result.outcome !== 'message_sent') {
      showToast?.(
        result.reason === 'match_closed'
          ? 'Чат этого матча уже закрыт.'
          : 'Не удалось отправить сообщение.',
        'error',
      );
      throw new Error('BACKEND_MATCH_CHAT_SEND_REJECTED');
    }
    const message = mapBackendMatchMessageToApp(result.message);
    if (!message) {
      showToast?.('Не удалось отправить сообщение.', 'error');
      throw new Error('BACKEND_MATCH_CHAT_MAPPING_REJECTED');
    }
    if (backendChatMatchRef.current === matchId) {
      setBackendChatMessages((previous) =>
        appendUniqueMessage(previous, message));
    }
    return message;
  };

  const getJoinMatchErrorMessage = (error) => {
    const message = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase();

    if (message.includes('pending invitation')) {
      return 'В эту игру вас пригласили. Примите или отклоните приглашение';
    }
    if (message.includes('full') || message.includes('slot') || message.includes('no free')) {
      return 'Свободное место уже занято. Обновите матч и попробуйте другой.';
    }
    if (message.includes('private')) {
      return 'Это приватный матч. Присоединиться можно только по приглашению организатора.';
    }
    if (message.includes('rating') || message.includes('level')) {
      return 'Ваш уровень не входит в диапазон этого матча.';
    }
    if (message.includes('already') || message.includes('participant')) {
      return 'Вы уже участвуете в этом матче.';
    }
    if (message.includes('started') || message.includes('completed') || message.includes('cancel')) {
      return 'Участие в матче сейчас недоступно.';
    }

    return 'Не удалось присоединиться к матчу. Попробуйте еще раз.';
  };

  const handleJoinMatch = async (matchId, explicitMatch = null) => {
    const matchSource = getMatchSource(matchId, explicitMatch);
    if (!backendMatchesReady || !isBackendOwnedMatch(matchSource)) {
      const unavailableError = new Error('backend_match_session_required');
      showToast?.('Сессия истекла. Войдите через Telegram ещё раз.', 'error');
      throw unavailableError;
    }
    const result = await backendMatchActions.joinMatch(matchId);
    if (result.outcome !== 'participant_joined') {
      const safeError = new Error(
        result.reason ?? 'match_join_failed',
      );
      showToast?.(getJoinMatchErrorMessage(safeError), 'error');
      throw safeError;
    }
    const updatedMatch = await handleRefreshMatch(matchId, matchSource);
    if (!updatedMatch) {
      const optimisticMatch = applyBackendParticipantResult(
        matchSource,
        result.participant,
        backendMatchCurrentUser,
      );
      if (optimisticMatch) storeBackendMatch(optimisticMatch);
      showToast?.(
        'Вы присоединились к матчу. Детали обновятся после перезагрузки ленты.',
        'info',
      );
      return optimisticMatch ?? matchSource;
    }
    return updatedMatch;
  };

  const handleLeaveMatch = async (matchId, explicitMatch = null) => {
    const matchSource = getMatchSource(matchId, explicitMatch);
    if (!backendMatchesReady || !isBackendOwnedMatch(matchSource)) {
      const unavailableError = new Error('backend_match_session_required');
      showToast?.('Сессия истекла. Войдите через Telegram ещё раз.', 'error');
      throw unavailableError;
    }
    const result = await backendMatchActions.leaveMatch(matchId);
    if (result.outcome !== 'participant_left') {
      const safeError = new Error(
        result.reason ?? 'match_leave_failed',
      );
      showToast?.('Не удалось выйти из матча. Попробуйте ещё раз.', 'error');
      throw safeError;
    }
    const confirmedMatch = applyBackendParticipantResult(
      matchSource,
      result.participant,
      backendMatchCurrentUser,
    );
    if (confirmedMatch) storeBackendMatch(confirmedMatch);
    const refreshedMatch = await handleRefreshMatch(
      matchId,
      confirmedMatch ?? matchSource,
    );
    const updatedMatch = preferConfirmedBackendMatchMutation(
      confirmedMatch,
      refreshedMatch,
    );
    if (!refreshedMatch) {
      showToast?.(
        'Вы вышли из матча. Детали обновятся после перезагрузки ленты.',
        'info',
      );
    }
    return updatedMatch ?? matchSource;
  };

  // ── Logout ──
  const handleLogout = async () => {
    if (typeof onLogout !== 'function') {
      showToast?.('Не удалось выйти из аккаунта. Попробуйте еще раз.', 'error');
      throw new Error('BACKEND_LOGOUT_UNAVAILABLE');
    }
    await onLogout();
    localStorage.clear();
  };

  const handleUpdateMatchDescription = async (matchId, description) => {
    if (!backendMatchesReady || !backendMatchActions) {
      showToast?.('Сервис матчей временно недоступен.', 'error');
      throw new Error('BACKEND_MATCH_UPDATE_UNAVAILABLE');
    }
    const result = await backendMatchActions.updateMatchDescription(
      matchId,
      description,
    );
    if (result.outcome !== 'match_description_updated') {
      showToast?.(
        result.reason === 'content_not_allowed'
          ? 'Комментарий содержит недопустимые слова. Исправьте текст.'
          : 'Не удалось сохранить комментарий матча.',
        'error',
      );
      throw new Error(result.reason ?? 'match_update_failed');
    }
    const updated = result.match;
    const apply = (candidate) =>
      candidate?.id === matchId
        ? {
            ...candidate,
            description: updated.description,
            version: updated.matchVersion,
          }
        : candidate;
    setBackendFeedMatches((previous) => previous.map(apply));
    setBackendAccountMatches((previous) => previous.map(apply));
    setSelected((previous) => apply(previous));
    showToast?.('Комментарий матча обновлён', 'success');
    return Object.freeze({
      id: matchId,
      description: updated.description,
      version: updated.matchVersion,
    });
  };

  // --- 4. TOAST (now handled by AuthGate, but keeping this for other app-specific toasts) ---
  // ── Navigation helpers ──
  const openCreateMatch = () => {
    if (!backendMatchesReady) {
      showToast?.(
        'Профиль ещё загружается. Попробуйте открыть создание матча позже.',
        backendMatchMode === 'error' ? 'error' : 'info',
      );
      return;
    }
    tg?.HapticFeedback?.impactOccurred('medium');
    setScreen('create-match');
  };

  const openMatchDetails = (match) => {
    if (!isBackendOwnedMatch(match)) return;
    const detailRequestId = backendDetailRequestRef.current + 1;
    backendDetailRequestRef.current = detailRequestId;
    tg?.HapticFeedback?.impactOccurred('light');
    setSelected(match);
    setScreen('match-details');
    if (!backendMatchesReady) return;
    if (
      (match.ownerId ?? match.owner_id) === backendProfile?.accountId
    ) {
      void loadBackendOutgoingInvitations(match.id);
    } else {
      backendInvitationRequestRef.current += 1;
      setOutgoingInvitations([]);
    }
    void backendMatchActions.loadMatch(match.id).then((result) => {
      if (backendDetailRequestRef.current !== detailRequestId) return;
      if (result.outcome !== 'match_loaded') return;
      const detailedMatch = mapBackendMatchToApp(
        result.match,
        backendProfile,
        backendCourtNamesById,
      );
      if (!detailedMatch) return;
      storeBackendMatch(detailedMatch);
    });
  };

  useEffect(() => {
    const deepLink = notificationDeepLinkRef.current;
    if (deepLink === null) return;
    if (deepLink.screen === 'booking') {
      notificationDeepLinkRef.current = null;
      setSelectedBookingReservationId(deepLink.reservationId);
      setScreen(null);
      setActiveTab('booking');
      return;
    }
    if (!backendMatchesReady || backendMatchActions === null) return;
    if (notificationDeepLinkInFlightRef.current) return;
    notificationDeepLinkInFlightRef.current = true;
    let cancelled = false;
    void backendMatchActions
      .loadMatch(deepLink.matchId)
      .then((result) => {
        if (cancelled) return;
        notificationDeepLinkRef.current = null;
        notificationDeepLinkInFlightRef.current = false;
        if (result.outcome !== 'match_loaded') {
          showToast?.('Матч недоступен или уже завершён.', 'info');
          return;
        }
        const match = mapBackendMatchToApp(
          result.match,
          backendProfile,
          backendCourtNamesById,
        );
        if (!match) return;
        storeBackendMatch(match);
        setActiveTab('matches');
        setSelected(match);
        setScreen('match-details');
      })
      .catch(() => {
        if (cancelled) return;
        notificationDeepLinkRef.current = null;
        notificationDeepLinkInFlightRef.current = false;
        showToast?.('Матч недоступен или уже завершён.', 'info');
      });
    return () => {
      cancelled = true;
      notificationDeepLinkInFlightRef.current = false;
    };
  }, [
    backendCourtNamesById,
    backendMatchActions,
    backendMatchesReady,
    backendProfile,
    showToast,
    storeBackendMatch,
  ]);

  const closeMatchDetails = () => {
    backendDetailRequestRef.current += 1;
    backendInvitationRequestRef.current += 1;
    backendChatRequestRef.current += 1;
    backendChatMatchRef.current = null;
    setBackendChatMessages([]);
    setBackendChatCursor(null);
    setBackendChatLoadError('');
    setBackendChatLoading(false);
    setBackendChatLoadingOlder(false);
    setOutgoingInvitations([]);
    setSelected(null);
    setScreen(null);
  };

  const beginInvitationAction = (key) => {
    if (invitationActionRef.current.has(key)) return false;
    invitationActionRef.current.add(key);
    setInvitationActions(new Set(invitationActionRef.current));
    return true;
  };

  const endInvitationAction = (key) => {
    invitationActionRef.current.delete(key);
    setInvitationActions(new Set(invitationActionRef.current));
  };

  const handleRefreshMatch = async (matchId, explicitMatch = null) => {
    const matchSource = getMatchSource(matchId, explicitMatch);
    if (!isBackendOwnedMatch(matchSource) || !backendMatchesReady) return null;
    const detailRequestId = backendDetailRequestRef.current + 1;
    backendDetailRequestRef.current = detailRequestId;
    const result = await backendMatchActions.loadMatch(matchId);
    if (backendDetailRequestRef.current !== detailRequestId) return null;
    if (result.outcome !== 'match_loaded') return null;
    const updatedMatch = mapBackendMatchToApp(
      result.match,
      backendProfile,
      backendCourtNamesById,
    );
    if (!updatedMatch) return null;
    const acceptedMatch = preferConfirmedBackendMatchMutation(
      matchSource,
      updatedMatch,
    );
    if (acceptedMatch !== updatedMatch) return acceptedMatch;
    storeBackendMatch(acceptedMatch);
    return acceptedMatch;
  };

  const markAppNotificationRead = async (notification) => {
    const notificationId = notification?.notification_id;
    if (!notificationId) return null;
    if (
      notification.notification_provider !== 'backend' ||
      !backendMatchesReady ||
      typeof backendMatchActions?.markMatchNotificationRead !== 'function'
    ) {
      throw new Error('BACKEND_NOTIFICATION_MARK_READ_UNAVAILABLE');
    }
    const result = await backendMatchActions.markMatchNotificationRead(
      notificationId,
    );
    if (result.outcome !== 'notification_read') {
      throw new Error('BACKEND_NOTIFICATION_MARK_READ_REJECTED');
    }
    const readAt = new Date(result.notification.readAt * 1_000).toISOString();
    backendNotificationRequestRef.current += 1;
    setNotificationCenter((prev) => {
      const current = prev.items.find(
        (item) => item.notification_id === notificationId,
      );
      return {
        items: prev.items.map((item) => item.notification_id === notificationId
          ? { ...item, read_at: readAt }
          : item),
        unreadCount: current && !current.read_at
          ? Math.max(0, prev.unreadCount - 1)
          : prev.unreadCount,
      };
    });
    return readAt;
  };

  const handleViewNotification = async (notification) => {
    if (!notification) return;

    if (!notification.read_at && notification.notification_id) {
      try {
        await markAppNotificationRead(notification);
      } catch (error) {
        console.error(`Не удалось отметить уведомление прочитанным: ${error.message}`);
        showToast?.('Не удалось обновить уведомление. Попробуйте ещё раз.', 'error');
        return;
      }
    }

    if (notification.match_id) {
      try {
        if (notification.notification_provider !== 'backend') {
          throw new Error('BACKEND_NOTIFICATION_PROVIDER_REQUIRED');
        }
        const result = await backendMatchActions.loadMatch(
          notification.match_id,
        );
        if (result.outcome !== 'match_loaded') {
          throw new Error('BACKEND_NOTIFICATION_MATCH_UNAVAILABLE');
        }
        const match = mapBackendMatchToApp(
          result.match,
          backendProfile,
          backendCourtNamesById,
        );
        if (!match) throw new Error('BACKEND_NOTIFICATION_MATCH_INVALID');
        storeBackendMatch(match);
        if (match) openMatchDetails(match);
      } catch (error) {
        console.error(`Не удалось открыть матч из уведомления: ${error.message}`);
        showToast?.('Связанный матч больше недоступен.', 'info');
      }
    }

    loadNotifications();
  };

  const handleSearchInvitationPlayers = async (query, limit = 5) => {
    if (!backendMatchesReady) return [];
    const result = await backendMatchActions.searchPlayers(query, limit);
    if (result.outcome !== 'players_loaded') {
      throw backendInvitationError(result.reason);
    }
    return result.players
      .filter((player) => player.playerId !== backendProfile?.accountId)
      .map(mapBackendPublicPlayerToApp)
      .filter(Boolean);
  };

  const handleCreateInvitation = async (matchId, player, slotIndex) => {
    const key = `create:${matchId}:${slotIndex}`;
    if (!beginInvitationAction(key)) return null;

    try {
      const matchSource = getMatchSource(matchId);
      if (!isBackendOwnedMatch(matchSource) || !backendMatchesReady) {
        throw backendInvitationError('temporary_unavailable');
      }
      const result = await backendMatchActions.createMatchInvitation(
        matchId,
        player.id,
        slotIndex + 1,
      );
      if (result.outcome !== 'invitation_created') {
        throw backendInvitationError(result.reason);
      }
      const invitation = mapBackendInvitationToApp(result.invitation);
      if (!invitation) {
        throw backendInvitationError('internal_error');
      }
      setOutgoingInvitations((prev) => [
        ...prev.filter((item) => item.id !== invitation.id),
        invitation,
      ]);
      showToast?.(
        `Приглашение для ${player.first_name || player.firstName || 'игрока'} отправлено`,
        'success',
      );
      return invitation;
    } catch (error) {
      if (error?.message !== 'BACKEND_MATCH_INVITATION_REJECTED') {
        console.error(`Ошибка create_match_invitation: ${error.message}`);
      }
      const backendReason = error?.reason;
      showToast?.(
        backendReason === 'already_invited'
          ? 'Этому игроку уже отправлено приглашение.'
          : backendReason === 'already_participant'
            ? 'Этот игрок уже участвует в матче.'
            : backendReason === 'rating_verification_required'
              ? 'Для рейтингового матча нужен подтверждённый рейтинг игрока.'
              : backendReason === 'rating_out_of_range'
                ? 'Уровень игрока не входит в диапазон этого матча.'
                : backendReason
                  ? 'Не удалось отправить приглашение. Обновите матч и попробуйте ещё раз.'
                  : 'Не удалось отправить приглашение. Попробуйте ещё раз.',
        'error',
      );
      if (
        isBackendInvitationStaleReason(backendReason)
      ) {
        await loadBackendOutgoingInvitations(matchId);
      }
      throw error;
    } finally {
      endInvitationAction(key);
    }
  };

  const handleCancelInvitation = async (invitationId) => {
    const key = `cancel:${invitationId}`;
    if (!beginInvitationAction(key)) return null;
    const invitation = outgoingInvitations.find(
      (item) => item.id === invitationId,
    );
    const backendInvitation = (
      invitation?.backendOwned === true ||
      isBackendOwnedMatch(
        getMatchSource(invitation?.match_id ?? selectedMatch?.id),
      )
    );

    try {
      if (!backendInvitation || !backendMatchesReady) {
        throw backendInvitationError('temporary_unavailable');
      }
      const result =
        await backendMatchActions.cancelMatchInvitation(invitationId);
      if (result.outcome !== 'invitation_cancelled') {
        throw backendInvitationError(result.reason);
      }
      setOutgoingInvitations((prev) =>
        prev.filter((item) => item.id !== invitationId));
      showToast?.('Приглашение отменено. Слот снова свободен.', 'info');
      return true;
    } catch (error) {
      if (error?.message !== 'BACKEND_MATCH_INVITATION_REJECTED') {
        console.error(`Ошибка cancel_match_invitation: ${error.message}`);
      }
      if (
        isBackendInvitationStaleReason(error?.reason)
      ) {
        setOutgoingInvitations(prev => prev.filter((item) => item.id !== invitationId));
        showToast?.('Приглашение уже обработано на другом устройстве.', 'info');
        await loadBackendOutgoingInvitations(
          invitation?.match_id ?? selectedMatch?.id,
        );
        return false;
      }
      showToast?.('Не удалось отменить приглашение. Попробуйте ещё раз.', 'error');
      throw error;
    } finally {
      endInvitationAction(key);
    }
  };

  const handleAcceptInvitation = async (invitation) => {
    const invitationId = invitation.invitation_id;
    const key = `accept:${invitationId}`;
    if (!beginInvitationAction(key)) return null;

    try {
      if (invitation.backendOwned !== true || !backendMatchesReady) {
        throw backendInvitationError('temporary_unavailable');
      }
      const result =
        await backendMatchActions.acceptMatchInvitation(invitationId);
      if (result.outcome !== 'invitation_accepted') {
        throw backendInvitationError(result.reason);
      }
      hideHandledIncomingInvitation(invitationId);
      const updatedMatch = await handleRefreshMatch(
        invitation.match_id,
        { id: invitation.match_id, backendOwned: true },
      );
      await Promise.all([loadInvitations(), loadBackendMatchFeed()]);
      showToast?.('Приглашение принято. Вы добавлены в состав.', 'success');
      if (updatedMatch) openMatchDetails(updatedMatch);
      return updatedMatch;
    } catch (error) {
      if (isBackendInvitationStaleReason(error?.reason)) {
        hideHandledIncomingInvitation(invitationId);
        showToast?.('Приглашение уже обработано или устарело.', 'info');
        await Promise.all([loadInvitations(), loadBackendMatchFeed()]);
        return null;
      }
      if (error?.message !== 'BACKEND_MATCH_INVITATION_REJECTED') {
        console.error(`Ошибка accept_match_invitation: ${error.message}`);
      }
      showToast?.('Не удалось принять приглашение. Попробуйте ещё раз.', 'error');
      throw error;
    } finally {
      endInvitationAction(key);
    }
  };

  const handleDeclineInvitation = async (invitation) => {
    const invitationId = invitation.invitation_id;
    const key = `decline:${invitationId}`;
    if (!beginInvitationAction(key)) return null;

    try {
      if (invitation.backendOwned !== true || !backendMatchesReady) {
        throw backendInvitationError('temporary_unavailable');
      }
      const result =
        await backendMatchActions.declineMatchInvitation(invitationId);
      if (result.outcome !== 'invitation_declined') {
        throw backendInvitationError(result.reason);
      }
      hideHandledIncomingInvitation(invitationId);
      const updatedMatch = await handleRefreshMatch(
        invitation.match_id,
        { id: invitation.match_id, backendOwned: true },
      );
      await loadInvitations();
      showToast?.('Вы отказались от приглашения. Слот освобождён.', 'info');
      return updatedMatch ?? true;
    } catch (error) {
      if (isBackendInvitationStaleReason(error?.reason)) {
        hideHandledIncomingInvitation(invitationId);
        showToast?.('Приглашение уже обработано на другом устройстве.', 'info');
        const [, updatedMatch] = await Promise.all([
          loadInvitations(),
          handleRefreshMatch(
            invitation.match_id,
            { id: invitation.match_id, backendOwned: true },
          ),
        ]);
        return updatedMatch ?? false;
      }
      if (error?.message !== 'BACKEND_MATCH_INVITATION_REJECTED') {
        console.error(`Ошибка decline_match_invitation: ${error.message}`);
      }
      showToast?.('Не удалось отказаться от приглашения. Попробуйте ещё раз.', 'error');
      throw error;
    } finally {
      endInvitationAction(key);
    }
  };

  // ── Match creation: build object and persist ──
  const handleMatchSuccess = async (data) => {
    const isRated = data.isRatingMatch === true || data.is_rating_match === true;

    if (!backendMatchesReady) {
      const unavailableProfile = new Error(
        'backend_match_profile_required',
      );
      showToast?.(
        'Профиль ещё не готов. Откройте создание матча позже.',
        'error',
      );
      throw unavailableProfile;
    }
    if (
      data.isPrivate === true &&
      !BACKEND_PRIVATE_MATCH_CREATION_ENABLED
    ) {
      const unsupportedPrivateMatch = new Error(
        'backend_private_match_creation_unavailable',
      );
      showToast?.(
        'Приватные матчи временно недоступны. Создайте открытый матч.',
        'error',
      );
      throw unsupportedPrivateMatch;
    }
    const draft = createBackendMatchDraft({
      ...data,
      isRatingMatch: isRated,
    });
    if (!draft) {
      const invalidDraft = new Error('match_invalid_request');
      showToast?.('Проверьте параметры матча и попробуйте ещё раз.', 'error');
      throw invalidDraft;
    }
    const result = await backendMatchActions.createMatch(draft);
    if (result.outcome !== 'match_created') {
      const safeError = new Error(
        result.reason ?? 'match_create_failed',
      );
      showToast?.(
        result.reason === 'content_not_allowed'
          ? 'Комментарий содержит недопустимые слова. Исправьте текст.'
          : 'Не удалось создать матч. Попробуйте ещё раз.',
        'error',
      );
      throw safeError;
    }
    if (
      result.match?.courtBookingStatus !== 'confirmed' ||
      result.match?.courtReservationId !== data.reservationId
    ) {
      const unlinkedMatch = new Error('match_reservation_binding_missing');
      showToast?.('Матч не опубликован: подтверждённая бронь не привязана.', 'error');
      throw unlinkedMatch;
    }
    const createdMatch = mapBackendMatchToApp(
      result.match,
      backendProfile,
      backendCourtNamesById,
    );
    if (!createdMatch) {
      const malformedMatch = new Error('match_response_invalid');
      showToast?.('Матч создан, но ответ сервера не распознан. Обновите ленту.', 'error');
      throw malformedMatch;
    }
    if (!createdMatch.isPrivate) {
      storeBackendMatch(createdMatch);
      setScreen(null);
      setActiveTab('matches');
      return result;
    }
    setSelected(createdMatch);
    setScreen('match-details');
    return result;
  };

  // Upcoming = ALL non-completed matches user participates in (open / upcoming / private booking).
  const upcomingMatches = mergeAccountUpcomingMatches(
    backendAccountMatches,
    backendProfile?.accountId,
    backendMatchNow,
  );
  const backendBookingEvents = useMemo(
    () => selectBackendReservationsForHome(
      backendReservations,
      Date.now(),
      backendCourtNamesById,
    ),
    [backendCourtNamesById, backendReservations],
  );
  const homeUpcomingEvents = useMemo(
    () => [...upcomingMatches, ...backendBookingEvents],
    [backendBookingEvents, upcomingMatches],
  );
  const completedMatches = getUserMatchHistory(backendAccountMatches, ME_ID);
  const openMatches = selectFutureBackendMatches(
    backendFeedMatches,
    backendMatchNow,
  );

  // Real profile stats derived from allMatches + live rating.
  const profileStats = useMemo(() => {
    const numericRating = currentUser?.rating || currentUser?.numericRating || 3.0;
    const matchesCount = completedMatches?.length || 0;
    const orderedOutcomes = [...(completedMatches || [])]
      .sort((left, right) => {
        const leftDate = new Date(left.completedAt ?? left.completed_at ?? left.dateISO ?? 0).getTime();
        const rightDate = new Date(right.completedAt ?? right.completed_at ?? right.dateISO ?? 0).getTime();
        return rightDate - leftDate;
      })
      .map((match) => getUserMatchOutcome(match, currentUser?.id));
    const winsCount = orderedOutcomes.filter((outcome) => outcome === 'win').length;
    const lossesCount = orderedOutcomes.filter((outcome) => outcome === 'loss').length;
    const decidedCount = winsCount + lossesCount;
    const winRate = decidedCount > 0 ? Math.round((winsCount / decidedCount) * 100) : 0;
    return {
      numericRating,
      matchesCount,
      winsCount,
      lossesCount,
      winRate,
      recentForm: orderedOutcomes.slice(0, 5),
    };
  }, [completedMatches, currentUser]);

  if (loading || !currentUser) {
    return <BallLoader />;
  }

  // ── Full-screen routes (hide BottomNav) ──
  if (screen === 'create-match') {
    return (
      <MatchCreationScreen
        availabilityActions={backendBookingAvailabilityActions}
        bookingClient={privateBookingClient}
        courtNamesById={backendCourtNamesById}
        onCourtCatalogChange={mergeBackendCourtCatalog}
        onOpenProfile={() => {
          setScreen(null);
          setActiveTab('profile');
        }}
        onBack={() => setScreen(null)}
        onSuccess={handleMatchSuccess}
        user={backendMatchCurrentUser}
        allowPrivateMatches={BACKEND_PRIVATE_MATCH_CREATION_ENABLED}
        showToast={showToast}
      />
    );
  }

  if (screen === 'match-details' && selectedMatch) {
    return (
      <MatchDetailsScreen
        match={selectedMatch}
        currentUser={matchCurrentUser}
        onBack={closeMatchDetails}
        onJoinSuccess={() => {
          closeMatchDetails();
          setActiveTab('matches');
        }}
        onUpdateDescription={handleUpdateMatchDescription}
        onJoinMatch={handleJoinMatch}
        onLeaveMatch={handleLeaveMatch}
        onRefreshMatch={handleRefreshMatch}
        onLoadWaitlist={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.listMatchWaitlist
            : null
        }
        onJoinWaitlist={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.joinMatchWaitlist
            : null
        }
        onLeaveWaitlist={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.leaveMatchWaitlist
            : null
        }
        onLoadLineup={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.readMatchLineup
            : null
        }
        onAssignLineupSlot={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.assignMatchLineupSlot
            : null
        }
        onReleaseLineupSlot={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.releaseMatchLineupSlot
            : null
        }
        onLoadResult={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.readMatchResult
            : null
        }
        onSubmitResult={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.submitMatchResult
            : null
        }
        onConfirmResult={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.confirmMatchResult
            : null
        }
        onDisputeResult={
          isBackendOwnedMatch(selectedMatch)
            ? backendMatchActions?.disputeMatchResult
            : null
        }
        incomingInvitation={incomingInvitations.find((invitation) => invitation.match_id === selectedMatch.id) ?? null}
        pendingInvitations={outgoingInvitations.filter((invitation) => invitation.match_id === selectedMatch.id)}
        invitationActions={invitationActions}
        onAcceptInvitation={handleAcceptInvitation}
        onDeclineInvitation={handleDeclineInvitation}
        onCreateInvitation={handleCreateInvitation}
        onCancelInvitation={handleCancelInvitation}
        onSearchPlayers={
          isBackendOwnedMatch(selectedMatch)
            ? handleSearchInvitationPlayers
            : null
        }
        allMessages={backendChatMessages}
        messagesLoading={backendChatLoading}
        messagesLoadError={backendChatLoadError}
        hasOlderMessages={
          isBackendOwnedMatch(selectedMatch) &&
          backendChatCursor !== null
        }
        olderMessagesLoading={backendChatLoadingOlder}
        onLoadOlderMessages={
          isBackendOwnedMatch(selectedMatch)
            ? () => loadBackendMatchMessages(
                selectedMatch.id,
                { older: true },
              )
            : null
        }
        onRefreshMessages={
          isBackendOwnedMatch(selectedMatch)
            ? () => loadBackendMatchMessages(
                selectedMatch.id,
                { background: true },
              )
            : null
        }
        onRetryMessages={() => loadBackendMatchMessages(selectedMatch.id)}
        onSendMessage={handleSendMessage}
        showToast={showToast}
      />
    );
  }

  if (screen === 'edit-profile') {
    return (
      <EditProfileScreen
        user={currentUser}
        onBack={() => setScreen(null)}
        showToast={showToast}
        onBackendProfileSave={onBackendProfileSave}
        onPhotoUpload={onBackendProfilePhotoUpload}
        onPhotoDelete={onBackendProfilePhotoDelete}
        onLogout={handleLogout}
      />
    );
  }

  if (screen === 'admin') {
    return (
      <AdminScreen
        user={currentUser}
        adminActions={backendMatchActions}
        onBack={() => setScreen(null)}
      />
    );
  }
    
  

  return (
    <div className="app-container">
      {/* isDevMode check needs to be updated if role is in profile table */}
      {/* Dev mode badge — visible only for admin accounts */}
      {isAdmin && (
        <div style={{
          position: 'fixed', top: '10px', right: '10px', zIndex: 9999,
          background: 'rgba(234,67,53,0.12)', border: '1px solid rgba(234,67,53,0.35)',
          borderRadius: '8px', padding: '4px 10px',
          color: '#f87171', fontSize: '10px', fontWeight: 700,
          letterSpacing: '0.08em', pointerEvents: 'none',
          backdropFilter: 'blur(4px)',
        }}>
          РЕЖИМ РАЗРАБОТЧИКА
        </div>
      )}

      <main className="content">
        <PullToRefresh
          key={activeTab}
          onRefresh={activeTab === 'booking' ? null : refreshActiveTab}
          disabled={activeTab === 'booking'}
          testId={`pull-to-refresh-${activeTab}`}
        >
        {activeTab === 'home' && (
          <Home
            upcomingMatches={homeUpcomingEvents}
            completedMatches={completedMatches}
            onViewDetails={openMatchDetails}
            onBookCourt={() => {
              setSelectedBookingReservationId(null);
              setActiveTab('booking');
            }}
            onOpenBooking={(reservationId) => {
              setSelectedBookingReservationId(reservationId);
              setActiveTab('booking');
            }}
            user={currentUser}
            showToast={showToast}
          />
        )}

        {activeTab === 'profile' && (
          <PlayerProfile
            user={currentUser}
            stats={profileStats}
            upcomingMatches={upcomingMatches} // This needs to be passed `currentUser`
            completedMatches={completedMatches}
            resultMatches={completedMatches}
            onViewDetails={openMatchDetails}
            notifications={notificationCenter.items}
            notificationsLoading={notificationsLoading || invitationsLoading}
            notificationsLoadError={notificationsLoadError || invitationsLoadError}
            invitations={incomingInvitations}
            invitationActions={invitationActions}
            onRetryNotifications={() => Promise.all([loadNotifications(), loadInvitations()])}
            onViewNotification={handleViewNotification}
            onAcceptInvitation={handleAcceptInvitation}
            onDeclineInvitation={handleDeclineInvitation}
            onCreateMatch={openCreateMatch}
            onBookCourt={() => {
              setSelectedBookingReservationId(null);
              setActiveTab('booking');
            }}
            onLogout={handleLogout}
            onOpenSettings={() => setScreen('edit-profile')} // This needs showToast
            onOpenAdmin={() => {
              if (isAdmin) setScreen('admin');
            }}
            onPhotoUpload={onBackendProfilePhotoUpload}
            onPhotoDelete={onBackendProfilePhotoDelete}
            // showToast is already passed to App, no need to pass it here again
            showToast={showToast}
          />
        )}

        {activeTab === 'leaderboard' && (
          <div className="tab-placeholder" style={{ padding: '40px 16px', color: 'rgba(245,241,232,0.62)', textAlign: 'center' }}>
            <h2 style={{ color: '#F5F1E8', marginBottom: '8px' }}>Рейтинг клуба</h2>
            <p style={{ marginBottom: '8px' }}>Рейтинг клуба появится после первых игр.</p>
            <p style={{ fontSize: '13px', lineHeight: 1.5 }}>
              Сейчас в MVP показываем личный уровень и историю матчей в профиле.
            </p>
          </div>
        )}

        {activeTab === 'matches' && (
          <MatchFeed
            matches={openMatches}
            currentUser={backendMatchCurrentUser}
            playerRating={backendMatchCurrentUser.ratingIdx}
            onJoin={(match) => console.log('join', match.id)}
            onViewDetails={openMatchDetails} // This needs showToast
            onCreateMatch={openCreateMatch} // This needs showToast
            loading={backendMatchMode === 'loading' || backendFeedLoading}
            loadError={backendFeedError}
            onRetry={loadBackendMatchFeed}
          />
        )}

        {activeTab === 'booking' && (
          <BookingScreen
            availabilityActions={backendBookingAvailabilityActions}
            initialReservationId={selectedBookingReservationId}
            onCloseReservation={() => {
              setSelectedBookingReservationId(null);
              setActiveTab('home');
            }}
            courtNamesById={backendCourtNamesById}
            onCourtCatalogChange={mergeBackendCourtCatalog}
            bookingClient={privateBookingClient}
            onOpenProfile={() => {
              setSelectedBookingReservationId(null);
              setActiveTab('profile');
            }}
            showToast={showToast}
          />
        )}
        </PullToRefresh>
      </main>

      <BottomNav
        active={activeTab}
        setActive={(nextTab) => {
          if (nextTab === 'booking') {
            setSelectedBookingReservationId(null);
          }
          setActiveTab(nextTab);
        }}
        isAdmin={isAdmin}
        profileBadgeCount={
          notificationCenter.unreadCount +
          incomingInvitations.length
        }
      />
    </div>
  );
}
