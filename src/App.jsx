import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import PlayerProfile from './components/PlayerProfile';
import BottomNav from './components/BottomNav';
import MatchCreationScreen from './components/MatchCreationScreen';
import MatchDetailsScreen from './components/MatchDetailsScreen';
import MatchFeed from './components/MatchFeed';
import Home from './components/Home';
import EditProfileScreen from './components/EditProfileScreen';
import BookingScreen from './components/BookingScreen';
import AdminScreen from './components/AdminScreen';
import BallLoader from './components/BallLoader';
import { supabase } from './lib/supabaseClient';
import { useTelegram } from './hooks/useTelegram';
import { isPrimeTime, normalizeStoredPrice } from './lib/pricing';
import { calculateRatingChange, getLevelForRating, MIN_RATING, MAX_RATING } from './lib/ratingEngine';
import { isRatingMatch } from './lib/matchRating';
import {
  BACKEND_PRIVATE_MATCH_CREATION_ENABLED,
  createBackendMatchDraft,
  applyBackendParticipantResult,
  isBackendOwnedMatch,
  mapBackendInvitationToApp,
  mapBackendMatchToApp,
  mapBackendPublicPlayerToApp,
  resolveBackendMatchMode,
  resolveMatchSource,
  shouldApplyBackendMatchDetail,
  shouldApplyBackendMatchFeedResponse,
} from './lib/backendMatchAdapter';
import { getMyProfile, getPublicPlayerProfiles } from './lib/profileApi';
import {
  acceptMatchInvitation,
  cancelMatchInvitation,
  createMatchInvitation,
  declineMatchInvitation,
  getIncomingMatchInvitations,
  getInvitationErrorCode,
  getNotificationCenter,
  getOutgoingMatchInvitations,
  markNotificationRead,
  removeMatchParticipant,
} from './lib/invitationApi';

// ─── Seed data (shown until user creates real matches) ────────────────────────

const SEED_MATCHES = [];

const devCreatedBookingMatchIds = new Set();

function getRawMatchPrice(row) {
  return row?.pricePerPerson ?? row?.price_per_person ?? null;
}

function logDevBookingRequest(bookingPayload) {
  if (!import.meta.env.DEV) return;

  console.info('[booking:create_booking] request', {
    p_booking: {
      dateISO: bookingPayload.dateISO,
      time: bookingPayload.time,
      duration: bookingPayload.duration,
      courtId: bookingPayload.courtId,
      type: bookingPayload.type,
      isPrivate: bookingPayload.isPrivate,
      pricePerPerson: bookingPayload.pricePerPerson,
      priceValueType: typeof bookingPayload.pricePerPerson,
    },
  });
}

function rememberDevBookingResponse(row) {
  if (!import.meta.env.DEV || !row?.id) return;

  devCreatedBookingMatchIds.add(String(row.id));
  const rawPrice = getRawMatchPrice(row);
  console.info('[booking:create_booking] response', {
    matchId: String(row.id),
    pricePerPerson: rawPrice,
    priceValueType: typeof rawPrice,
  });
}

function logDevBookingReload(rows) {
  if (!import.meta.env.DEV || devCreatedBookingMatchIds.size === 0) return;

  for (const row of rows ?? []) {
    if (!devCreatedBookingMatchIds.has(String(row?.id))) continue;
    const rawPrice = getRawMatchPrice(row);
    console.info('[booking:matches-reload] observed', {
      matchId: String(row.id),
      pricePerPerson: rawPrice,
      priceValueType: typeof rawPrice,
    });
  }
}

function logDevBookingMatchUpdate(matchId, operation, payload) {
  if (!import.meta.env.DEV || !devCreatedBookingMatchIds.has(String(matchId))) return;

  const hasCamelPrice = Object.prototype.hasOwnProperty.call(payload ?? {}, 'pricePerPerson');
  const hasSnakePrice = Object.prototype.hasOwnProperty.call(payload ?? {}, 'price_per_person');
  console.info('[booking:matches-write] request', {
    matchId: String(matchId),
    operation,
    fields: Object.keys(payload ?? {}).sort(),
    includesPrice: hasCamelPrice || hasSnakePrice,
    pricePerPerson: hasCamelPrice
      ? payload.pricePerPerson
      : hasSnakePrice
        ? payload.price_per_person
        : '(not included)',
  });
}

// ─── Selectors over allMatches (single source of truth) ──────────────────────

function normalizeMatch(row) {
  if (!row) return row;

  return {
    ...row,
    ownerId: row.ownerId ?? row.owner_id,
    filledSlots: row.filledSlots ?? row.filled_slots ?? [],
    ratingMin: row.ratingMin ?? row.rating_min,
    ratingMax: row.ratingMax ?? row.rating_max,
    courtId: row.courtId ?? row.court_id,
    courtName: row.courtName ?? row.court_name,
    courtType: row.courtType ?? row.court_type,
    dateISO: row.dateISO ?? row.date_iso,
    pricePerPerson: normalizeStoredPrice(row.pricePerPerson ?? row.price_per_person),
    paymentStatus: row.paymentStatus ?? row.payment_status,
    ownerPaid: row.ownerPaid ?? row.owner_paid,
    holdAmount: row.holdAmount ?? row.hold_amount,
    completedAt: row.completedAt ?? row.completed_at,
    ratingChanges: row.ratingChanges ?? row.rating_changes,
    isRatingMatch: row.isRatingMatch ?? row.is_rating_match ?? false,
    requiresVerifiedRating: row.requiresVerifiedRating ?? row.requires_verified_rating,
    scoreStatus: row.scoreStatus ?? row.score_status ?? 'none',
    scoreSubmittedBy: row.scoreSubmittedBy ?? row.score_submitted_by,
    scoreConfirmedBy: row.scoreConfirmedBy ?? row.score_confirmed_by,
    scoreDisputedBy: row.scoreDisputedBy ?? row.score_disputed_by,
  };
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

const round3 = (n) => Math.round(n * 1000) / 1000;
const clampRating = (n) => Math.max(MIN_RATING, Math.min(MAX_RATING, n));

// Pure derivation: completed matches the given user participated in.
function getUserMatchHistory(allMatches, userId) {
  return (allMatches ?? []).filter(m =>
    isMatchCompleted(m) && Array.isArray(m.participants) && m.participants.includes(userId)
  );
}

// Recompute participants + status from the canonical filledSlots array.
function deriveParticipantsAndStatus(filledSlots, prevStatus) {
  const filled = (filledSlots ?? []).filter(Boolean);
  const participants = filled
    .filter(p => p?.id != null)
    .map(p => p.id);
  let status = prevStatus;
  if (prevStatus === 'searching') {
    status = 'searching';
  } else if (prevStatus === 'confirmed') {
    status = filled.length >= 4 ? 'confirmed' : 'open';
  } else if (prevStatus !== 'completed' && prevStatus !== 'finished' && prevStatus !== 'cancelled' && prevStatus !== 'canceled') {
    status = filled.length >= 4 ? 'upcoming' : 'open';
  }
  return { participants, status };
}

function getHumanPlayerIds(players) {
  return [...new Set(
    (players ?? [])
      .filter(player => player?.id && player.id !== 'me' && !player.isBot)
      .map(player => player.id)
  )];
}

function getUserMatchOutcome(match, userId) {
  if (!userId || typeof match?.isTeam1Win !== 'boolean') return 'neutral';
  const inTeam1 = (match.team1 ?? []).some((player) => player?.id === userId);
  const inTeam2 = (match.team2 ?? []).some((player) => player?.id === userId);
  if (!inTeam1 && !inTeam2) return 'neutral';
  return (inTeam1 ? match.isTeam1Win : !match.isTeam1Win) ? 'win' : 'loss';
}

function getCreateInvitationErrorMessage(error) {
  const code = getInvitationErrorCode(error);
  if (code.includes('ALREADY_PENDING')) return 'Этому игроку уже отправлено приглашение.';
  if (code.includes('ALREADY_PARTICIPANT')) return 'Этот игрок уже участвует в матче.';
  if (code.includes('SLOT_OCCUPIED') || code.includes('SLOT_RESERVED') || code.includes('MATCH_FULL')) {
    return 'Этот слот уже занят или зарезервирован. Обновите матч и выберите другой.';
  }
  if (code.includes('MATCH_NOT_ACTIVE') || code.includes('MATCH_ALREADY_STARTED') || code.includes('MATCH_NOT_FOUND')) {
    return 'Матч уже недоступен для приглашений.';
  }
  return 'Не удалось отправить приглашение. Попробуйте ещё раз.';
}

function isStaleInvitationError(error) {
  const code = getInvitationErrorCode(error);
  return code.includes('INVITATION_NOT_PENDING')
    || code.includes('INVITATION_NOT_FOUND')
    || code.includes('INVITATION_MATCH_NOT_FOUND')
    || code.includes('INVITATION_MATCH_NOT_ACTIVE')
    || code.includes('INVITATION_MATCH_ALREADY_STARTED')
    || code.includes('INVITATION_SLOT_UNAVAILABLE');
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

export function mergeProfileSources(profile, backendProfile, metadata = {}) {
  const baseProfile = profile || {
    rating: 3.0,
    role: 'user',
  };

  return {
    ...baseProfile,
    first_name: backendProfile
      ? backendProfile.firstName
      : (profile?.first_name || metadata.first_name || 'Новый'),
    last_name: backendProfile
      ? (backendProfile.lastName ?? '')
      : (profile?.last_name || metadata.last_name || 'Игрок'),
    username: backendProfile
      ? (backendProfile.username ?? '')
      : (profile?.username || metadata.username || ''),
    phone: backendProfile &&
      (backendProfile.phone !== null ||
        backendProfile.sidePreference !== null)
      ? (backendProfile.phone ?? '')
      : (profile?.phone || ''),
    side_preference: backendProfile?.sidePreference ??
      profile?.side_preference ??
      'Both',
    rating: typeof backendProfile?.rating === 'number'
      ? backendProfile.rating
      : baseProfile.rating,
    is_verified: typeof backendProfile?.isVerified === 'boolean'
      ? backendProfile.isVerified
      : baseProfile.is_verified,
  };
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App({
  session,
  backendProfile = null,
  backendMatchRequired = false,
  backendMatchLifecycleStatus = 'disabled',
  backendProfileStatus = backendProfile ? 'ready' : 'inactive',
  backendMatchActions = null,
  onBackendProfileSave = null,
  showToast,
  onLogout,
}) { // Accept showToast as a prop
  const { user, tg } = useTelegram();
  
  // --- 1. СТЕЙТЫ ---
  const ME_ID = session?.user?.id;
  const backendMatchMode = resolveBackendMatchMode({
    backendRequired: backendMatchRequired,
    hasBackendActions: backendMatchActions !== null,
    lifecycleStatus: backendMatchLifecycleStatus,
    profileStatus: backendProfileStatus,
    accountId: backendProfile?.accountId,
  });
  const usesBackendMatches = backendMatchMode !== 'legacy';
  const backendMatchesReady = backendMatchMode === 'ready';
  const [profile, setProfile] = useState(null);
  const [allMatches, setAllMatches] = useState([]);
  const [allMessages, setAllMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesLoadError, setMatchesLoadError] = useState('');
  const [backendFeedMatches, setBackendFeedMatches] = useState([]);
  const [backendFeedLoading, setBackendFeedLoading] = useState(false);
  const [backendFeedError, setBackendFeedError] = useState('');
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesLoadError, setMessagesLoadError] = useState('');
  const [activeTab, setActiveTab]    = useState('home');
  const [toast, setToast]            = useState(null);
  const [selectedMatch, setSelected] = useState(null);
  const backendDetailRequestRef = useRef(0);
  const backendFeedRequestRef = useRef(0);
  const backendInvitationRequestRef = useRef(0);
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

  const hideHandledIncomingInvitation = useCallback((invitationId) => {
    if (!invitationId) return;
    handledIncomingInvitationIdsRef.current.add(String(invitationId));
    setIncomingInvitations((prev) => prev.filter(
      (item) => String(item.invitation_id) !== String(invitationId)
    ));
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!ME_ID) return null;

    try {
      const data = await getMyProfile();
      if (data) setProfile(data);
      return data ?? null;
    } catch (error) {
      console.error(`Ошибка при получении профиля из Supabase: ${error.message}`);
      return null;
    }
  }, [ME_ID]);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchesLoadError('');

    try {
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      logDevBookingReload(data ?? []);
      setAllMatches((data ?? []).map(normalizeMatch));
      return data ?? [];
    } catch (error) {
      console.error(`Ошибка при получении матчей из Supabase: ${error.message}`);
      setMatchesLoadError('Не удалось загрузить матчи. Проверьте подключение и попробуйте ещё раз.');
      return null;
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  const loadBackendMatchFeed = useCallback(async () => {
    const requestId = backendFeedRequestRef.current + 1;
    backendFeedRequestRef.current = requestId;
    if (!usesBackendMatches) {
      setBackendFeedMatches([]);
      setBackendFeedError('');
      setBackendFeedLoading(false);
      return null;
    }
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
        .map((record) => mapBackendMatchToApp(record, backendProfile))
        .filter(Boolean);
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
    backendProfile,
    usesBackendMatches,
  ]);

  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    setMessagesLoadError('');

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      setAllMessages((data ?? []).map(normalizeMessage));
      return data ?? [];
    } catch (error) {
      console.error(`Ошибка при получении сообщений из Supabase: ${error.message}`);
      setMessagesLoadError('Не удалось загрузить сообщения. Попробуйте ещё раз.');
      return null;
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    if (!ME_ID && !backendProfile?.accountId) return null;
    setInvitationsLoading(true);
    setInvitationsLoadError('');

    try {
      if (usesBackendMatches) {
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
      }

      const [incoming, outgoing] = await Promise.all([
        getIncomingMatchInvitations(),
        getOutgoingMatchInvitations(ME_ID),
      ]);
      const handledIds = handledIncomingInvitationIdsRef.current;
      const visibleIncoming = incoming.filter(
        (item) => !handledIds.has(String(item.invitation_id))
      );

      // Invitation ids are immutable. Keep handled ids for this app session so
      // an older in-flight RPC response cannot re-add an already handled row.
      setIncomingInvitations(visibleIncoming);
      setOutgoingInvitations(outgoing);
      return visibleIncoming;
    } catch (error) {
      console.error(`Ошибка при получении приглашений: ${error.message}`);
      setInvitationsLoadError('Не удалось загрузить приглашения. Проверьте подключение и попробуйте ещё раз.');
      return null;
    } finally {
      setInvitationsLoading(false);
    }
  }, [
    ME_ID,
    backendMatchActions,
    backendMatchesReady,
    backendProfile?.accountId,
    usesBackendMatches,
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

  const loadNotifications = useCallback(async () => {
    if (!ME_ID) return null;
    setNotificationsLoading(true);
    setNotificationsLoadError('');
    try {
      const center = await getNotificationCenter();
      setNotificationCenter(center);
      return center;
    } catch (error) {
      console.error(`Ошибка при получении уведомлений: ${error.message}`);
      setNotificationsLoadError('Не удалось загрузить уведомления. Проверьте подключение и попробуйте ещё раз.');
      return null;
    } finally {
      setNotificationsLoading(false);
    }
  }, [ME_ID]);

  const fetchData = useCallback(async () => {
    if (!ME_ID) {
      setLoading(false);
      return;
    }

    try {
      await Promise.all([
        fetchProfile(),
        loadMatches(),
        loadBackendMatchFeed(),
        loadMessages(),
        loadInvitations(),
        loadNotifications(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [
    ME_ID,
    fetchProfile,
    loadMatches,
    loadBackendMatchFeed,
    loadMessages,
    loadInvitations,
    loadNotifications,
  ]);

  // --- 2. ЗАГРУЗКА ДАННЫХ ---
  useEffect(() => {
    fetchData();

    const matchesSubscription = supabase.channel('public:matches')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, payload => {
        const nextMatch = normalizeMatch(payload.new);
        if (!nextMatch?.id) {
          fetchData();
          return;
        }

        setAllMatches(prev => {
          if (payload.eventType === 'DELETE') {
            return prev.filter(m => m.id !== payload.old?.id);
          }

          const exists = prev.some(m => m.id === nextMatch.id);
          if (exists) {
            return prev.map(m => m.id === nextMatch.id ? nextMatch : m);
          }
          return [nextMatch, ...prev];
        });
      })
      .subscribe();

    const messagesSubscription = supabase.channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        setAllMessages(prev => appendUniqueMessage(prev, payload.new));
      })
      .subscribe();

    const invitationsSubscription = usesBackendMatches
      ? null
      : supabase.channel('public:match_invitations')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'match_invitations' }, () => {
            loadInvitations();
            loadNotifications();
          })
          .subscribe();

    const notificationsSubscription = supabase.channel('public:notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, loadNotifications)
      .subscribe();

    return () => {
      supabase.removeChannel(matchesSubscription);
      supabase.removeChannel(messagesSubscription);
      if (invitationsSubscription) {
        supabase.removeChannel(invitationsSubscription);
      }
      supabase.removeChannel(notificationsSubscription);
    };
  }, [fetchData]);

  useEffect(() => {
    if (activeTab === 'profile') {
      fetchProfile();
      if (usesBackendMatches) {
        void loadInvitations();
      }
    }
  }, [
    activeTab,
    fetchProfile,
    loadInvitations,
    usesBackendMatches,
  ]);

  useEffect(() => {
    const refreshVisibleAccountData = () => {
      if (document.visibilityState === 'visible') {
        fetchProfile();
        if (usesBackendMatches) {
          void loadInvitations();
        }
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
  }, [fetchProfile, loadInvitations, usesBackendMatches]);

  // --- 3. ПОЛЬЗОВАТЕЛЬ ---
  const currentUser = useMemo(() => {
    // 1. Достаем метаданные из сессии (там точно лежат имя и фамилия из формы регистрации)
    const meta = session?.user?.user_metadata || {};
    
    // 2. Backend owns Telegram identity fields; Supabase still provides the
    // remaining profile fields until their data flows are migrated.
    const p = mergeProfileSources(profile, backendProfile, meta);
    
    const numericRating = Number.isFinite(p.rating) ? p.rating : 3.0;
    const RATINGS_ORDER = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
    const levelLabel = getLevelForRating(numericRating)?.label || 'D';
    const ratingIdxFor  = (n) => Math.max(0, RATINGS_ORDER.indexOf(levelLabel));

    return {
      id: ME_ID, // тут должен быть session?.user?.id (если ты еще не заменил ME_ID везде)
      rating: numericRating,
      numericRating,
      ratingIdx: ratingIdxFor(numericRating),
      level: levelLabel,
      isVerified: p.is_verified === true,
      is_verified: p.is_verified === true,
      firstName: p.first_name,
      lastName: p.last_name,
      phone: p.phone || '',
      side_preference: p.side_preference || 'Both',
      username: p.username || user?.username || meta.username || '',
      role: p.role,
    };
  }, [backendProfile, profile, session, user?.username]); // <-- добавили session в зависимости

  const backendMatchCurrentUser = useMemo(() => ({
    ...currentUser,
    id: backendProfile?.accountId ?? null,
  }), [backendProfile?.accountId, currentUser]);
  const matchCurrentUser = isBackendOwnedMatch(selectedMatch)
    ? backendMatchCurrentUser
    : currentUser;
  const getMatchSource = useCallback((matchId, explicitMatch = null) => (
    resolveMatchSource(
      matchId,
      explicitMatch ?? selectedMatch,
      backendFeedMatches,
      allMatches,
    )
  ), [
    allMatches,
    backendFeedMatches,
    selectedMatch,
  ]);
  const storeBackendMatch = useCallback((updatedMatch) => {
    if (!isBackendOwnedMatch(updatedMatch)) return null;
    backendFeedRequestRef.current += 1;
    setBackendFeedLoading(false);
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
    setSelected((previous) =>
      shouldApplyBackendMatchDetail(
        previous,
        updatedMatch.id,
        updatedMatch,
      )
        ? updatedMatch
        : previous);
    return updatedMatch;
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  // ── Delete match: remove from allMatches (persisted via useLocalStorage) ──
  const handleDeleteMatch = async (matchId) => {
    logDevBookingMatchUpdate(matchId, 'delete', {});
    const { data, error } = await supabase
      .from('matches')
      .delete()
      .eq('id', matchId)
      .select('id');

    if (error) {
      showToast?.('Не удалось отменить матч. Попробуйте еще раз.', 'error');
      throw error;
    }

    if (!data?.[0]) {
      const emptyDeleteError = new Error('Match delete returned no rows');
      showToast?.('Матч не отменен. Проверьте права доступа.', 'error');
      throw emptyDeleteError;
    }

    setAllMatches(prev => prev.filter(m => m.id !== matchId));
    if (selectedMatch?.id === matchId) setSelected(null);
  };

  const buildRatingChanges = async (match, result) => {
    if (!Array.isArray(result.team1) || result.team1.length !== 2 || !Array.isArray(result.team2) || result.team2.length !== 2) {
      return {};
    }

    const allPlayers = [...result.team1, ...result.team2];
    const humanIds = getHumanPlayerIds(allPlayers);
    const profileRatings = {};

    if (humanIds.length > 0) {
      try {
        const data = await getPublicPlayerProfiles({
          ids: humanIds,
          select: 'id, rating',
          limit: null,
        });
        (data ?? []).forEach(profileRow => {
          profileRatings[profileRow.id] = Number(profileRow.rating) || 3.0;
        });
      } catch (error) {
        showToast?.('Не удалось загрузить рейтинги игроков. Результат не сохранён.', 'error');
        throw error;
      }
    }

    const ratingFor = (player) => {
      if (player?.isBot) return Number(player.numericRating) || 3.0;
      if (player?.id && profileRatings[player.id] != null) return profileRatings[player.id];
      if (player?.id === currentUser?.id) return Number(currentUser.rating) || 3.0;
      return Number(player?.numericRating) || 3.0;
    };

    const matchCountFor = (playerId) => allMatches.filter(existingMatch =>
      existingMatch.id !== match.id &&
      isMatchCompleted(existingMatch) &&
      isRatingMatch(existingMatch) &&
      (existingMatch.ratingChanges?.[playerId] ?? existingMatch.rating_changes?.[playerId])
    ).length;

    const team1Ratings = result.team1.map(ratingFor);
    const team2Ratings = result.team2.map(ratingFor);
    const ratingChanges = {};

    const buildChange = (player, team) => {
      const before = ratingFor(player);
      const playerMatchCount = player?.id && !player.isBot ? matchCountFor(player.id) : (player?.matchCount ?? 0);
      const delta = calculateRatingChange(team1Ratings, team2Ratings, result.isTeam1Win, playerMatchCount)[team === 1 ? 'team1Delta' : 'team2Delta'];
      const after = round3(clampRating(before + delta));
      return { before: round3(before), after, delta: round3(delta) };
    };

    result.team1.forEach(player => {
      if (player?.id) ratingChanges[player.id] = buildChange(player, 1);
    });
    result.team2.forEach(player => {
      if (player?.id) ratingChanges[player.id] = buildChange(player, 2);
    });

    return ratingChanges;
  };

  const fetchMatchById = async (matchId) => {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (error) throw error;
    return normalizeMatch(data);
  };

  // ── Complete match: regular matches finish immediately; rated matches wait for score confirmation ──
  const handleCompleteMatch = async (matchId, result) => {
    const match = allMatches.find(m => m.id === matchId) ?? selectedMatch;
    const teamsFlat = [...(result.team1 ?? []), ...(result.team2 ?? [])];
    const teamParticipants = teamsFlat.filter(p => p?.id != null).map(p => p.id);
    const isRated = isRatingMatch(match);
    const updatePayload = {
      status:        isRated ? 'pending_confirmation' : 'completed',
      completedAt:   isRated ? null : new Date().toISOString(),
      finalScore:    result.score,
      isTeam1Win:    result.isTeam1Win,
      team1:         result.team1,
      team2:         result.team2,
      participants: teamParticipants.length > 0 ? teamParticipants : undefined,
      score_status: isRated ? 'pending_confirmation' : 'confirmed',
      score_submitted_by: currentUser.id,
      score_confirmed_by: isRated ? null : currentUser.id,
      score_disputed_by: null,
    };

    logDevBookingMatchUpdate(matchId, 'update:complete', updatePayload);
    const { data, error } = await supabase
      .from('matches')
      .update(updatePayload)
      .eq('id', matchId)
      .select();
    
    if (error) {
      showToast?.('Не удалось сохранить результат матча. Попробуйте еще раз.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Match completion update returned no rows');
      showToast?.('Не удалось завершить матч. Проверьте права доступа.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(match => match.id === matchId ? updatedMatch : match));
    showToast?.(
      isRated ? 'Счёт отправлен на подтверждение' : 'Матч завершен и добавлен в историю',
      'success'
    );
    return updatedMatch;
  };

  const handleConfirmScore = async (matchId) => {
    const match = allMatches.find(m => m.id === matchId) ?? selectedMatch;
    const result = {
      score: match.finalScore ?? match.score,
      isTeam1Win: match.isTeam1Win,
      team1: match.team1,
      team2: match.team2,
    };
    const ratingChanges = await buildRatingChanges(match, result);

    const { error } = await supabase.rpc('confirm_rating_match_score', {
      p_match_id: matchId,
      p_confirmed_by: currentUser.id,
      p_rating_changes: ratingChanges,
    });

    if (error) {
      showToast?.('Счёт не подтверждён: требуется серверное применение рейтинга.', 'error');
      throw error;
    }

    const updatedMatch = await fetchMatchById(matchId);
    setAllMatches(prev => prev.map(match => match.id === matchId ? updatedMatch : match));
    setSelected(prev => prev?.id === matchId ? updatedMatch : prev);

    if (currentUser?.id && ratingChanges[currentUser.id]) {
      setProfile(prev => ({ ...(prev || {}), rating: ratingChanges[currentUser.id].after }));
    }

    showToast?.('Счёт подтверждён. Рейтинг обновлён.', 'success');
    return updatedMatch;
  };

  const handleDisputeScore = async (matchId) => {
    const disputePayload = {
      status: 'disputed',
      score_status: 'disputed',
      score_disputed_by: currentUser.id,
    };
    logDevBookingMatchUpdate(matchId, 'update:dispute-score', disputePayload);
    const { data, error } = await supabase
      .from('matches')
      .update(disputePayload)
      .eq('id', matchId)
      .select();

    if (error) {
      showToast?.('Не удалось оспорить счёт. Попробуйте ещё раз.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Score dispute update returned no rows');
      showToast?.('Счёт не оспорен. Проверьте права доступа.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(match => match.id === matchId ? updatedMatch : match));
    setSelected(prev => prev?.id === matchId ? updatedMatch : prev);
    showToast?.('Счёт оспорен. Обратитесь к администратору клуба.', 'info');
    return updatedMatch;
  };

  // ── Booking from BookingScreen ──
  // Always creates a match in allMatches; the calendar derives slot statuses from it.
  // isPrivate=true  → status='upcoming', paymentStatus='full', invisible in MatchFeed.
  // isPrivate=false → status='open',     paymentStatus='partial', appears in MatchFeed.
const handleBookSlot = async (booking) => {
    if (!ME_ID) {
      const authError = new Error('Booking requires an authenticated user');
      console.error(authError);
      showToast?.('Не удалось определить пользователя. Войдите снова и повторите попытку.', 'error');
      throw authError;
    }

    const target = new Date(booking.dateISO);
    const dateStr = target.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', '');
    const isRated = !booking.isPrivate && (booking.isRatingMatch === true || booking.is_rating_match === true);
    const pricePerPerson = normalizeStoredPrice(
      booking.pricePerPerson ?? booking.price_per_person
    );

    if (pricePerPerson === null || pricePerPerson <= 0) {
      const priceError = new Error('Booking requires a positive per-player price snapshot');
      console.error(priceError);
      showToast?.('Не удалось рассчитать стоимость. Выберите слот ещё раз.', 'error');
      throw priceError;
    }

    const bookingPayload = {
      date:          dateStr,
      dateISO:       booking.dateISO,
      time:          booking.time,
      duration:      booking.duration || 1.5,
      courtId:       booking.court?.id || '1',
      courtName:     booking.court?.name || 'Корт',
      courtType:     booking.court?.type || 'standard',
      isPrime:       isPrimeTime(booking?.time || '00:00', booking.dateISO),
      type:          booking.type || 'match',
      ratingMin:     booking.ratingMin ?? 0,
      ratingMax:     booking.ratingMax ?? 6,
      description:   booking.description || '',
      scenario:      booking.scenario || (booking.isPrivate ? 'private' : 'community'),
      isPrivate:     !!booking.isPrivate,
      isRatingMatch: isRated,
      is_rating_match: isRated,
      paymentStatus: booking.paymentStatus || 'partial',
      // Exact migration 011 JSON contract. JSON keys are case-sensitive.
      pricePerPerson,
    };

    logDevBookingRequest(bookingPayload);
    const { data, error } = await supabase.rpc('create_booking', {
      p_booking: bookingPayload,
    });
    
    if (error) {
      const errorText = [error.message, error.details, error.hint].filter(Boolean).join(' ');
      const isSlotTaken = error.code === '23P01' || errorText.includes('BOOKING_SLOT_TAKEN');

      if (isSlotTaken) {
        showToast?.('Это время уже заняли. Выберите другой интервал', 'error');
        await loadMatches();
        throw error;
      }

      console.error('Ошибка create_booking:', error);
      showToast?.('Не удалось сохранить бронь. Попробуйте еще раз.', 'error');
      throw error;
    }

    const insertedRow = Array.isArray(data) ? data[0] : data;
    if (!insertedRow) {
      const emptyInsertError = new Error('create_booking returned no match row');
      showToast?.('Бронь не сохранена. Проверьте права доступа и попробуйте еще раз.', 'error');
      throw emptyInsertError;
    }

    rememberDevBookingResponse(insertedRow);
    const createdMatch = normalizeMatch(insertedRow);
    setAllMatches(prev => prev.some(match => match.id === createdMatch.id)
      ? prev.map(match => match.id === createdMatch.id ? createdMatch : match)
      : [createdMatch, ...prev]);
    // Re-read the canonical row instead of relying only on the RPC response.
    // This also makes any DEV price diagnostic reflect what was persisted.
    await loadMatches();
    // Если это публичный матч — идем в ленту, если приват — остаемся в календаре
    if (!booking.isPrivate) {
      setActiveTab('matches');
    }

    return createdMatch;
  };

  // ─── 2. Исправленный handleRevertToPrivate ───
  const handleRevertToPrivate = async (matchId) => {
    const revertPayload = {
      type: 'private',
      status: 'upcoming',
      scenario: 'private',
      isPrivate: true,
      ratingMin: null,
      ratingMax: null,
      description: null,
      isTraining: false,
      trainingDetails: null,
      trainingStatus: null,
      // Сбрасываем слоты до только владельца
      filledSlots: [{
        id: ME_ID,
        firstName: currentUser?.firstName || 'Игрок',
        lastName: currentUser?.lastName || '',
        ratingIdx: currentUser?.ratingIdx || 0,
        numericRating: currentUser?.numericRating || 3.0,
        isVerified: currentUser?.isVerified || false,
        isOrganizer: true
      }],
      participants: [ME_ID],
    };
    logDevBookingMatchUpdate(matchId, 'update:revert-private', revertPayload);
    const { data, error } = await supabase
      .from('matches')
      .update(revertPayload)
      .eq('id', matchId)
      .select();

    if (error) {
      console.error("Ошибка при отмене матча:", error);
      showToast?.('Не удалось перевести матч в приватный режим', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Revert to private returned no rows');
      showToast?.('Бронь не обновлена. Проверьте права доступа.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(m => m.id === matchId ? updatedMatch : m));
    setSelected(prev => prev?.id === matchId ? updatedMatch : prev);
    showToast('Матч отменен, бронь переведена в личную тренировку', 'info');
    setActiveTab('home'); 
  };

  const handleUpdateMatch = async (matchId, updates) => {
    const dateISO = updates.dateISO ?? updates.date;
    const dateLabel = dateISO
      ? new Date(dateISO).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', '')
      : undefined;

    const payload = {
      date: dateLabel,
      dateISO,
      time: updates.time,
      duration: updates.duration,
      courtType: updates.courtType,
      title: updates.title,
      description: updates.description,
      isPrime: isPrimeTime(updates?.time || '00:00', dateISO),
    };

    logDevBookingMatchUpdate(matchId, 'update:edit', payload);
    const { data, error } = await supabase
      .from('matches')
      .update(payload)
      .eq('id', matchId)
      .not('status', 'in', '("completed","finished")')
      .select();

    if (error) {
      showToast?.('Не удалось сохранить изменения матча. Попробуйте еще раз.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Match edit returned no rows');
      showToast?.('Изменения не сохранены. Проверьте права доступа или статус матча.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(m => m.id === updatedMatch.id ? updatedMatch : m));
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);
    showToast?.('Матч обновлен', 'success');
    return updatedMatch;
  };

  const handleSendMessage = async (matchId, sender, text) => {
    const senderId = sender?.id ?? ME_ID;

    if (!senderId) {
      showToast?.('Не удалось определить игрока. Попробуйте войти заново.', 'error');
      throw new Error('Cannot send message without sender id');
    }

    const newMessage = {
      match_id: matchId,
      sender_id: senderId,
      sender_name: sender?.firstName || 'Игрок',
      text,
    };

    const { data, error } = await supabase.from('messages').insert([newMessage]).select();

    if (error) {
      console.error(`Ошибка при отправке сообщения: ${error.message}`);
      showToast?.('Не удалось отправить сообщение', 'error');
      throw error;
    }

    if (data?.length) {
      setAllMessages(prev => data.reduce((next, row) => appendUniqueMessage(next, row), prev));
    }
  };

  const handleSetupTraining = async (trainingData) => {
    const trainingPayload = {
      isTraining: true,
      trainingDetails: {
        format: trainingData.format,
        withCoach: trainingData.withCoach,
        duration: trainingData.duration,
        guests: trainingData.guests,
        coachName: trainingData.coachName,
        coachId: trainingData.coachId,
        coachStatus: trainingData.coachStatus,
      },
      trainingStatus: 'pending_coach',
    };
    logDevBookingMatchUpdate(trainingData.matchId, 'update:setup-training', trainingPayload);
    const { data, error } = await supabase
      .from('matches')
      .update(trainingPayload)
      .eq('id', trainingData.matchId)
      .select();

    if (error) {
      showToast?.('Не удалось отправить запрос на тренировку. Попробуйте еще раз.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Training setup returned no rows');
      showToast?.('Тренировка не сохранена. Проверьте права доступа.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(m => m.id === updatedMatch.id ? updatedMatch : m));
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);
    showToast('Запрос на тренировку отправлен. Администратор клуба подтвердит тренера и детали.', 'success');
  };

  const handleConvertToPublic = async (matchId, isRatingMatch = false) => {
    const convertPayload = {
      type: 'match',
      isPrivate: false,
      scenario: 'social',
      status: 'open',
      is_rating_match: isRatingMatch === true,
      isTraining: false,
      trainingDetails: null,
      trainingStatus: null,
    };
    logDevBookingMatchUpdate(matchId, 'update:convert-public', convertPayload);
    const { data, error } = await supabase
      .from('matches')
      .update(convertPayload)
      .eq('id', matchId)
      .select();

    if (error) {
      showToast?.('Не удалось открыть сбор игроков. Попробуйте еще раз.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Convert to public returned no rows');
      showToast?.('Матч не опубликован. Проверьте права доступа.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(m => m.id === updatedMatch.id ? updatedMatch : m));
    openMatchDetails(updatedMatch);
  };

  // ── Slot changes: persist filledSlots, recompute participants + status ──
  const handleSlotsChange = async (matchId, newFilledSlots) => {
    const currentMatch = allMatches.find(m => m.id === matchId);
    const { participants, status: derivedStatus } = deriveParticipantsAndStatus(newFilledSlots, currentMatch?.status);
    const status = currentMatch?.isPrivate === true ? currentMatch.status : derivedStatus;
    const slotsPayload = { filledSlots: newFilledSlots, participants, status };
    logDevBookingMatchUpdate(matchId, 'update:slots', slotsPayload);
    const { data, error } = await supabase
      .from('matches')
      .update(slotsPayload)
      .eq('id', matchId)
      .select();

    if (error) {
      console.error(`Ошибка при сохранении слота: ${error.message}`);
      showToast?.('Не удалось сохранить слот. Попробуйте еще раз.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Match slot update returned no rows');
      console.error(emptyUpdateError);
      showToast?.('Не удалось сохранить слот. Проверьте права доступа к матчу.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    const savedParticipants = updatedMatch.participants ?? [];
    const savedSlots = updatedMatch.filledSlots ?? [];
    const slotsSaved = newFilledSlots.every(slot => !slot?.id || savedSlots.some(savedSlot => savedSlot?.id === slot.id));
    const participantsSaved = participants.every(id => savedParticipants.includes(id));

    if (!slotsSaved || !participantsSaved) {
      const persistError = new Error('Match slot update was not persisted');
      console.error(persistError);
      showToast?.('Слот не сохранился. Попробуйте еще раз.', 'error');
      throw persistError;
    }

    setAllMatches(prev => {
      const exists = prev.some(m => m.id === updatedMatch.id);
      return exists
        ? prev.map(m => m.id === updatedMatch.id ? updatedMatch : m)
        : [updatedMatch, ...prev];
    });
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);

    return updatedMatch;
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
    if (isBackendOwnedMatch(matchSource)) {
      if (!backendMatchesReady) {
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
    }

    const { data, error } = await supabase.rpc('join_match', { p_match_id: matchId });

    if (error) {
      const code = getInvitationErrorCode(error);
      if (code.includes('PENDING INVITATION')) {
        showToast?.('В эту игру вас пригласили. Примите или отклоните приглашение', 'info');
        await Promise.all([loadInvitations(), loadMatches(), loadNotifications()]);
        throw error;
      }
      showToast?.(getJoinMatchErrorMessage(error), 'error');
      throw error;
    }

    const returnedRow = Array.isArray(data)
      ? data[0]
      : data?.match ?? data;

    if (!returnedRow?.id) {
      const emptyRpcError = new Error('join_match returned no match row');
      console.error(emptyRpcError);
      showToast?.('Не удалось обновить матч после присоединения. Попробуйте еще раз.', 'error');
      throw emptyRpcError;
    }

    const updatedMatch = normalizeMatch(returnedRow);

    setAllMatches(prev => {
      const exists = prev.some(m => m.id === updatedMatch.id);
      return exists
        ? prev.map(m => m.id === updatedMatch.id ? updatedMatch : m)
        : [updatedMatch, ...prev];
    });
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);

    return updatedMatch;
  };

  const handleLeaveMatch = async (matchId, explicitMatch = null) => {
    const matchSource = getMatchSource(matchId, explicitMatch);
    if (isBackendOwnedMatch(matchSource)) {
      if (!backendMatchesReady) {
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
      const updatedMatch = await handleRefreshMatch(matchId, matchSource);
      if (!updatedMatch) {
        const optimisticMatch = applyBackendParticipantResult(
          matchSource,
          result.participant,
          backendMatchCurrentUser,
        );
        if (optimisticMatch) storeBackendMatch(optimisticMatch);
        showToast?.(
          'Вы вышли из матча. Детали обновятся после перезагрузки ленты.',
          'info',
        );
        return optimisticMatch ?? matchSource;
      }
      return updatedMatch;
    }

    const { data, error } = await supabase.rpc('leave_match', { p_match_id: matchId });

    if (error) {
      showToast?.('Не удалось выйти из матча. Попробуйте еще раз.', 'error');
      throw error;
    }

    const returnedRow = Array.isArray(data)
      ? data[0]
      : data?.match ?? data;

    if (!returnedRow?.id) {
      const emptyRpcError = new Error('leave_match returned no match row');
      console.error(emptyRpcError);
      showToast?.('Не удалось обновить матч после выхода. Попробуйте еще раз.', 'error');
      throw emptyRpcError;
    }

    const updatedMatch = normalizeMatch(returnedRow);

    setAllMatches(prev => {
      const exists = prev.some(m => m.id === updatedMatch.id);
      return exists
        ? prev.map(m => m.id === updatedMatch.id ? updatedMatch : m)
        : [updatedMatch, ...prev];
    });
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);

    return updatedMatch;
  };

  // ── Dev reset (clears localStorage and reloads) ──
  const handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  // ── Logout ──
  const handleLogout = async () => {
    const usesCoordinatedLogout = typeof onLogout === 'function';
    if (usesCoordinatedLogout) {
      await onLogout();
    } else {
      const { error } = await supabase.auth.signOut();
      if (error) {
        showToast?.('Не удалось выйти из аккаунта. Попробуйте еще раз.', 'error');
        throw error;
      }
    }
    localStorage.clear();
    if (!usesCoordinatedLogout) {
      window.location.reload();
    }
  };

  const handleProfileSaved = (updatedProfile) => {
    setProfile(prev => ({ ...(prev || {}), ...updatedProfile }));
  };

  // --- 4. TOAST (now handled by AuthGate, but keeping this for other app-specific toasts) ---
  // The toast state and showToast function are now managed by AuthGate.
  // This local toast state is for app-specific messages that don't come from AuthGate.
  const [screen, setScreen] = useState(null); // Moved here to be after currentUser

  // ── Navigation helpers ──
  const openCreateMatch = () => {
    if (usesBackendMatches && !backendMatchesReady) {
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
    const detailRequestId = backendDetailRequestRef.current + 1;
    backendDetailRequestRef.current = detailRequestId;
    tg?.HapticFeedback?.impactOccurred('light');
    setSelected(match);
    setScreen('match-details');
    if (isBackendOwnedMatch(match)) {
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
        );
        if (!detailedMatch) return;
        storeBackendMatch(detailedMatch);
      });
      return;
    }
    void Promise.allSettled([loadInvitations(), loadMatches()]);
  };

  const closeMatchDetails = () => {
    backendDetailRequestRef.current += 1;
    backendInvitationRequestRef.current += 1;
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

  const storeUpdatedMatch = (row) => {
    const updatedMatch = normalizeMatch(row);
    setAllMatches(prev => prev.some(match => match.id === updatedMatch.id)
      ? prev.map(match => match.id === updatedMatch.id ? updatedMatch : match)
      : [updatedMatch, ...prev]);
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);
    return updatedMatch;
  };

  const handleRefreshMatch = async (matchId, explicitMatch = null) => {
    const matchSource = getMatchSource(matchId, explicitMatch);
    if (isBackendOwnedMatch(matchSource)) {
      if (!backendMatchesReady) return null;
      const detailRequestId = backendDetailRequestRef.current + 1;
      backendDetailRequestRef.current = detailRequestId;
      const result = await backendMatchActions.loadMatch(matchId);
      if (backendDetailRequestRef.current !== detailRequestId) return null;
      if (result.outcome !== 'match_loaded') return null;
      const updatedMatch = mapBackendMatchToApp(
        result.match,
        backendProfile,
      );
      if (!updatedMatch) return null;
      storeBackendMatch(updatedMatch);
      return updatedMatch;
    }

    const rows = await loadMatches();
    const row = rows?.find((item) => String(item.id) === String(matchId));
    if (!row) return null;
    const updatedMatch = normalizeMatch(row);
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);
    return updatedMatch;
  };

  const markInvitationHandled = async (invitationId) => {
    const notification = notificationCenter.items.find((item) =>
      item.invitation_id === invitationId && !item.read_at
    );

    if (notification?.notification_id) {
      try {
        await markNotificationRead(notification.notification_id);
        setNotificationCenter((prev) => ({
          items: prev.items.map((item) => item.notification_id === notification.notification_id
            ? { ...item, read_at: new Date().toISOString() }
            : item),
          unreadCount: Math.max(0, prev.unreadCount - 1),
        }));
      } catch (error) {
        console.error(`Не удалось отметить уведомление прочитанным: ${error.message}`);
      }
    }
  };

  const handleViewNotification = async (notification) => {
    if (!notification) return;

    if (!notification.read_at && notification.notification_id) {
      try {
        await markNotificationRead(notification.notification_id);
        setNotificationCenter((prev) => ({
          items: prev.items.map((item) => item.notification_id === notification.notification_id
            ? { ...item, read_at: new Date().toISOString() }
            : item),
          unreadCount: Math.max(0, prev.unreadCount - 1),
        }));
      } catch (error) {
        console.error(`Не удалось отметить уведомление прочитанным: ${error.message}`);
        showToast?.('Не удалось обновить уведомление. Попробуйте ещё раз.', 'error');
        return;
      }
    }

    if (notification.match_id) {
      try {
        const match = allMatches.find((item) => item.id === notification.match_id)
          ?? await fetchMatchById(notification.match_id);
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
      if (isBackendOwnedMatch(matchSource)) {
        if (!backendMatchesReady) {
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
      }

      const invitation = await createMatchInvitation({
        matchId,
        invitedUserId: player.id,
        slotIndex,
      });
      setOutgoingInvitations(prev => [
        ...prev.filter((item) => item.id !== invitation.id),
        { ...invitation, invitation_id: invitation.id, player },
      ]);
      showToast?.(`Приглашение для ${player.firstName || 'игрока'} отправлено`, 'success');
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
                  : getCreateInvitationErrorMessage(error),
        'error',
      );
      if (
        isBackendInvitationStaleReason(backendReason) ||
        isStaleInvitationError(error)
      ) {
        if (isBackendOwnedMatch(getMatchSource(matchId))) {
          await loadBackendOutgoingInvitations(matchId);
        } else {
          await loadInvitations();
        }
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
      if (backendInvitation) {
        const result =
          await backendMatchActions.cancelMatchInvitation(invitationId);
        if (result.outcome !== 'invitation_cancelled') {
          throw backendInvitationError(result.reason);
        }
        setOutgoingInvitations((prev) =>
          prev.filter((item) => item.id !== invitationId));
        showToast?.('Приглашение отменено. Слот снова свободен.', 'info');
        return true;
      }

      await cancelMatchInvitation(invitationId);
      setOutgoingInvitations(prev => prev.filter((item) => item.id !== invitationId));
      showToast?.('Приглашение отменено. Слот снова свободен.', 'info');
      return true;
    } catch (error) {
      if (error?.message !== 'BACKEND_MATCH_INVITATION_REJECTED') {
        console.error(`Ошибка cancel_match_invitation: ${error.message}`);
      }
      if (
        isBackendInvitationStaleReason(error?.reason) ||
        isStaleInvitationError(error)
      ) {
        setOutgoingInvitations(prev => prev.filter((item) => item.id !== invitationId));
        showToast?.('Приглашение уже обработано на другом устройстве.', 'info');
        if (backendInvitation) {
          await loadBackendOutgoingInvitations(
            invitation?.match_id ?? selectedMatch?.id,
          );
        } else {
          await loadInvitations();
        }
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
      if (invitation.backendOwned === true) {
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
      }

      const updatedMatch = storeUpdatedMatch(await acceptMatchInvitation(invitationId));
      hideHandledIncomingInvitation(invitationId);
      await markInvitationHandled(invitationId);
      await Promise.all([loadInvitations(), loadMatches(), loadNotifications()]);
      showToast?.('Приглашение принято. Вы добавлены в состав.', 'success');
      openMatchDetails(updatedMatch);
      return updatedMatch;
    } catch (error) {
      if (
        isBackendInvitationStaleReason(error?.reason) ||
        isStaleInvitationError(error)
      ) {
        hideHandledIncomingInvitation(invitationId);
        showToast?.('Приглашение уже обработано или устарело.', 'info');
        await (
          invitation.backendOwned === true
            ? Promise.all([loadInvitations(), loadBackendMatchFeed()])
            : Promise.all([loadInvitations(), loadMatches(), loadNotifications()])
        );
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
      if (invitation.backendOwned === true) {
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
      }

      await declineMatchInvitation(invitationId);
      hideHandledIncomingInvitation(invitationId);
      await markInvitationHandled(invitationId);
      const [, updatedMatch] = await Promise.all([
        loadInvitations(),
        handleRefreshMatch(invitation.match_id),
        loadNotifications(),
      ]);
      showToast?.('Вы отказались от приглашения. Слот освобождён.', 'info');
      return updatedMatch ?? true;
    } catch (error) {
      if (
        isBackendInvitationStaleReason(error?.reason) ||
        isStaleInvitationError(error)
      ) {
        hideHandledIncomingInvitation(invitationId);
        showToast?.('Приглашение уже обработано на другом устройстве.', 'info');
        const [, updatedMatch] = await (
          invitation.backendOwned === true
            ? Promise.all([
                loadInvitations(),
                handleRefreshMatch(
                  invitation.match_id,
                  { id: invitation.match_id, backendOwned: true },
                ),
              ])
            : Promise.all([
                loadInvitations(),
                handleRefreshMatch(invitation.match_id),
                loadNotifications(),
              ])
        );
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

  const handleRemoveParticipant = async (matchId, userId) => {
    try {
      const updatedMatch = storeUpdatedMatch(await removeMatchParticipant(matchId, userId));
      showToast?.('Игрок удалён из матча.', 'info');
      return updatedMatch;
    } catch (error) {
      const code = getInvitationErrorCode(error);
      const message = code.includes('PAID_SLOT_FORBIDDEN')
        ? 'Нельзя удалить игрока с подтверждённой оплатой.'
        : code.includes('MATCH_ALREADY_STARTED') || code.includes('MATCH_NOT_ACTIVE')
          ? 'Состав этого матча уже нельзя изменить.'
          : 'Не удалось удалить игрока. Попробуйте ещё раз.';
      showToast?.(message, 'error');
      throw error;
    }
  };

  // ── Match creation: build object and persist ──
  const handleMatchSuccess = async (data) => {
    const isRated = data.isRatingMatch === true || data.is_rating_match === true;

    if (usesBackendMatches) {
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
        showToast?.('Не удалось создать матч. Попробуйте ещё раз.', 'error');
        throw safeError;
      }
      const createdMatch = mapBackendMatchToApp(
        result.match,
        backendProfile,
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
        return;
      }
      setSelected(createdMatch);
      setScreen('match-details');
      return;
    }

    const ownerSlot = {
      id:          ME_ID,
      firstName:   currentUser.firstName,
      lastName:    currentUser.lastName,
      ratingIdx:   currentUser.ratingIdx,
      numericRating: currentUser.numericRating,
      isVerified:  currentUser.isVerified,
      isOrganizer: true,
    };

    const newMatch = {
      // id is auto-generated
      owner_id:     currentUser.id,
      date:         data.date, // Use selected date from MatchCreationScreen
      dateISO:      data.dateISO, // Use selected dateISO from MatchCreationScreen
      time:         data.time,
      duration:     data.duration,
      courtId:      data.courtId,   // May be assigned if synced
      courtName:    data.courtName, // May be assigned if synced
      courtType:    data.courtType ?? 'panoramic',
      isPrime:      isPrimeTime(data?.time || '00:00', data.dateISO),
      type:         'match', // Always a match when created from this screen
      ratingMin:    data.ratingMin ?? 0,
      ratingMax:    data.ratingMax ?? 6,
      players:      1,
      scenario:     data.scenario,
      title:        data.title,
      description:  data.description,
      // Lifecycle
      status:       data.status,
      filledSlots:  [ownerSlot],
      participants: [ME_ID],
      isPrivate:    !!data.isPrivate,
      is_rating_match: isRated,
      syncToCalendar: !!data.syncToCalendar,
      ownerPaid:    data.ownerPaid,
      holdAmount:   data.holdAmount,
    };

    const { data: insertedData, error } = await supabase.from('matches').insert([newMatch]).select();

    if (error) {
      showToast?.('Не удалось создать матч. Попробуйте еще раз.', 'error');
      throw error;
    }

    const insertedRow = insertedData?.[0];
    if (!insertedRow) {
      const emptyInsertError = new Error('Match creation returned no rows');
      showToast?.('Матч не создан. Проверьте права доступа.', 'error');
      throw emptyInsertError;
    }

    setAllMatches(prev => [normalizeMatch(insertedRow), ...prev]);
    setScreen(null);
    setActiveTab('matches');
  };

  // Upcoming = ALL non-completed matches user participates in (open / upcoming / private booking).
  const upcomingMatches  = allMatches.filter(m => {
    if (!Array.isArray(m.participants) || !m.participants.includes(ME_ID) || m.status === 'completed') {
      return false;
    }
    const matchStartDateTime = new Date(`${m.dateISO}T${m.time || '00:00'}:00`);
    const matchEndDateTime = new Date(matchStartDateTime.getTime() + (m.duration || 1.5) * 3600 * 1000);
    return matchEndDateTime > new Date();
  });
  const completedMatches = getUserMatchHistory(allMatches, ME_ID);
  const profileResultMatches = allMatches.filter((match) => {
    if (!Array.isArray(match.participants) || !match.participants.includes(ME_ID)) return false;
    if (isMatchCompleted(match) || ['cancelled', 'canceled'].includes(match.status)) return true;
    const start = new Date(`${match.dateISO}T${match.time || '00:00'}:00`);
    const end = new Date(start.getTime() + (match.duration || 1.5) * 3600 * 1000);
    return Number.isFinite(end.getTime()) && end <= new Date();
  });
  // Public feed shows only non-private open matches.
  const legacyOpenMatches = allMatches.filter(m => {
    // Восстанавливаем строгий фильтр: только публичные, не завершенные матчи
    const isPublicFeedMatch = m.type === 'match' && m.isPrivate === false && m.status !== 'completed';
    if (!isPublicFeedMatch) {
      return false;
    }
    const matchStartDateTime = new Date(`${m.dateISO}T${m.time || '00:00'}:00`);
    const matchEndDateTime = new Date(matchStartDateTime.getTime() + (m.duration || 1.5) * 3600 * 1000);
    return matchEndDateTime > new Date();
  });
  const openMatches = usesBackendMatches
    ? backendFeedMatches
    : legacyOpenMatches;

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
        allMatches={usesBackendMatches ? backendFeedMatches : allMatches}
        onBack={() => setScreen(null)}
        onSuccess={handleMatchSuccess}
        user={
          usesBackendMatches
            ? backendMatchCurrentUser
            : currentUser
        }
        minimumDuration={usesBackendMatches ? 1 : 0.5}
        allowPrivateMatches={
          !usesBackendMatches ||
          BACKEND_PRIVATE_MATCH_CREATION_ENABLED
        }
        showToast={showToast}
      />
    );
  }

  if (screen === 'match-details' && selectedMatch) {
    return (
      <MatchDetailsScreen
        match={
          selectedMatch.backendOwned
            ? selectedMatch
            : allMatches.find(m => m.id === selectedMatch.id) ?? selectedMatch
        }
        currentUser={matchCurrentUser}
        onBack={closeMatchDetails}
        onJoinSuccess={() => {
          closeMatchDetails();
          setActiveTab('matches');
        }}
        onDelete={handleDeleteMatch}
        onComplete={handleCompleteMatch}
        onConfirmScore={handleConfirmScore}
        onDisputeScore={handleDisputeScore}
        onUpdate={handleUpdateMatch}
        onSlotsChange={handleSlotsChange}
        onJoinMatch={handleJoinMatch}
        onLeaveMatch={handleLeaveMatch}
        onRefreshMatch={handleRefreshMatch}
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
        onRemoveParticipant={handleRemoveParticipant}
        allMessages={allMessages}
        messagesLoading={messagesLoading}
        messagesLoadError={messagesLoadError}
        onRetryMessages={loadMessages}
        onSendMessage={handleSendMessage}
        onRevertToPrivate={handleRevertToPrivate}
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
        onProfileSaved={handleProfileSaved}
        onBackendProfileSave={onBackendProfileSave}
        onLogout={handleLogout}
      />
    );
  }

  if (screen === 'admin') {
    return <AdminScreen user={currentUser} onBack={() => setScreen(null)} />;
  }
    
  

  return (
    <div className="app-container">
      {/* isDevMode check needs to be updated if role is in profile table */}
      {/* Dev mode badge — visible only for admin accounts */}
      {currentUser.role === 'admin' && (
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
        {activeTab === 'home' && (
          <Home
            upcomingMatches={upcomingMatches}
            completedMatches={completedMatches}
            onViewDetails={openMatchDetails}
            onBookCourt={() => setActiveTab('booking')}
            onSetupTraining={handleSetupTraining}
            onConvertToPublic={handleConvertToPublic} // This needs showToast
            user={currentUser}
            showToast={showToast}
            onOpenMatches={() => setActiveTab('matches')}
            onOpenRating={() => setActiveTab('leaderboard')}
          />
        )}

        {activeTab === 'profile' && (
          <PlayerProfile
            user={currentUser}
            stats={profileStats}
            upcomingMatches={upcomingMatches} // This needs to be passed `currentUser`
            completedMatches={completedMatches}
            resultMatches={profileResultMatches}
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
            onBookCourt={() => setActiveTab('booking')}
            onLogout={handleLogout}
            onOpenSettings={() => setScreen('edit-profile')} // This needs showToast
            onOpenAdmin={() => {
              if (currentUser.role === 'admin') setScreen('admin');
            }}
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
            currentUser={
              usesBackendMatches
                ? backendMatchCurrentUser
                : currentUser
            }
            playerRating={
              usesBackendMatches
                ? backendMatchCurrentUser.ratingIdx
                : currentUser.ratingIdx
            }
            onJoin={(match) => console.log('join', match.id)}
            onViewDetails={openMatchDetails} // This needs showToast
            onCreateMatch={openCreateMatch} // This needs showToast
            loading={
              usesBackendMatches
                ? backendMatchMode === 'loading' || backendFeedLoading
                : matchesLoading
            }
            loadError={
              usesBackendMatches ? backendFeedError : matchesLoadError
            }
            onRetry={
              usesBackendMatches ? loadBackendMatchFeed : loadMatches
            }
            onReset={currentUser?.role === 'admin' ? handleReset : null}
          />
        )}

        {activeTab === 'booking' && (
          <BookingScreen
            allMatches={allMatches}
            onBookSlot={handleBookSlot}
            showToast={showToast}
            isRatingVerified={currentUser?.isVerified === true}
          />
        )}
      </main>

      <BottomNav
        active={activeTab}
        setActive={setActiveTab}
        isAdmin={isAdmin}
        profileBadgeCount={
          notificationCenter.unreadCount +
          (usesBackendMatches ? incomingInvitations.length : 0)
        }
      />
    </div>
  );
}
