import React, { useState, useEffect, useMemo } from 'react';
import PlayerProfile from './components/PlayerProfile';
import BottomNav from './components/BottomNav';
import MatchCreationScreen from './components/MatchCreationScreen';
import MatchDetailsScreen from './components/MatchDetailsScreen';
import MatchFeed from './components/MatchFeed';
import Home from './components/Home';
import EditProfileScreen from './components/EditProfileScreen';
import BookingCalendar from './components/BookingCalendar';
import AdminScreen from './components/AdminScreen';
import { supabase } from './lib/supabaseClient';
import { useTelegram } from './hooks/useTelegram';
import { COURTS, checkAvailability } from './lib/booking';
import { isPrimeTime } from './lib/pricing';
import { getCurrentRating, getLevelForRating } from './lib/ratingEngine';

// ─── Seed data (shown until user creates real matches) ────────────────────────

const SEED_MATCHES = [];

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
    paymentStatus: row.paymentStatus ?? row.payment_status,
    ownerPaid: row.ownerPaid ?? row.owner_paid,
    holdAmount: row.holdAmount ?? row.hold_amount,
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
  if (prevStatus === 'searching' || prevStatus === 'confirmed') {
    status = prevStatus;
  } else if (prevStatus !== 'completed' && prevStatus !== 'finished' && prevStatus !== 'cancelled' && prevStatus !== 'canceled') {
    status = filled.length >= 4 ? 'upcoming' : 'open';
  }
  return { participants, status };
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App({ session, showToast }) { // Accept showToast as a prop
  const { user, tg } = useTelegram();
  
  // --- 1. СТЕЙТЫ ---
  const ME_ID = session?.user?.id;
  const [profile, setProfile] = useState(null);
  const [allMatches, setAllMatches] = useState([]);
  const [allMessages, setAllMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab]    = useState('home');
  const [toast, setToast]            = useState(null);
  const [selectedMatch, setSelected] = useState(null);

  // --- 2. ЗАГРУЗКА ДАННЫХ ---
  useEffect(() => {
    const fetchData = async () => {
      if (!ME_ID) return;

      // Fetch profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', ME_ID) // Строгий фильтр по ID текущего пользователя
        .single();
      if (profileError && profileError.code !== 'PGRST116') { // PGRST116 = no rows found, which is ok
          console.error(`Ошибка при получении профиля из Supabase: ${profileError.message}`);
      }
      if (profileData) setProfile(profileData);

      // Fetch matches
      const { data: matchesData, error: matchesError } = await supabase.from('matches').select('*').order('created_at', { ascending: false });
      if (matchesError) {
        console.error(`Ошибка при получении матчей из Supabase: ${matchesError.message}`);
        if (matchesError.code === 'PGRST404') console.warn("Таблица 'matches' не найдена в Supabase.");
      }
      if (matchesData) setAllMatches(matchesData.map(normalizeMatch));

      // Fetch messages
      const { data: messagesData, error: messagesError } = await supabase.from('messages').select('*').order('created_at', { ascending: true });
      if (messagesError) {
        console.error(`Ошибка при получении сообщений из Supabase: ${messagesError.message}`);
        if (messagesError.code === 'PGRST404') console.warn("Таблица 'messages' не найдена в Supabase.");
      }
      if (messagesData) setAllMessages(messagesData.map(normalizeMessage));

      setLoading(false);
    };

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

    return () => {
      supabase.removeChannel(matchesSubscription);
      supabase.removeChannel(messagesSubscription);
    };
  }, [ME_ID]);

  // --- 3. ПОЛЬЗОВАТЕЛЬ ---
  const currentUser = useMemo(() => {
    // 1. Достаем метаданные из сессии (там точно лежат имя и фамилия из формы регистрации)
    const meta = session?.user?.user_metadata || {};
    
    // 2. Если профиля в БД еще нет, берем данные из meta
    const p = profile || { 
      first_name: meta.first_name || 'Новый', 
      last_name: meta.last_name || 'Игрок', 
      rating: 3.0, 
      role: 'user' 
    };
    
    const numericRating = p.rating || 3.0;
    const RATINGS_ORDER = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
    const levelLabel = getLevelForRating(numericRating)?.label || 'D';
    const ratingIdxFor  = (n) => Math.max(0, RATINGS_ORDER.indexOf(levelLabel));

    return {
      id: ME_ID, // тут должен быть session?.user?.id (если ты еще не заменил ME_ID везде)
      rating: numericRating,
      numericRating,
      ratingIdx: ratingIdxFor(numericRating),
      isVerified: p.is_verified === true,
      is_verified: p.is_verified === true,
      firstName: p.first_name,
      lastName: p.last_name,
      phone: p.phone || '',
      side_preference: p.side_preference || 'Both',
      username: user?.username || meta.username || '',
      role: p.role,
    };
  }, [profile, session, user?.username]); // <-- добавили session в зависимости

  // ── Delete match: remove from allMatches (persisted via useLocalStorage) ──
  const handleDeleteMatch = async (matchId) => {
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

  // ── Complete match: mark status + persist final score, teams, ratingChanges ──
  const handleCompleteMatch = async (matchId, result) => {
    const teamsFlat = [...(result.team1 ?? []), ...(result.team2 ?? [])];
    const teamParticipants = teamsFlat.filter(p => p?.id != null).map(p => p.id);
    
    const { data, error } = await supabase
      .from('matches')
      .update({
        status:        'completed',
        completedAt:   new Date().toISOString(),
        finalScore:    result.score,
        isTeam1Win:    result.isTeam1Win,
        team1:         result.team1,
        team2:         result.team2,
        ratingChanges: result.ratingChanges,
        participants: teamParticipants.length > 0 ? teamParticipants : undefined,
      })
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
    showToast?.('Матч завершен и добавлен в историю', 'success');
    return updatedMatch;
  };

  // ── Booking from BookingCalendar ──
  // Always creates a match in allMatches; the calendar derives slot statuses from it.
  // isPrivate=true  → status='upcoming', paymentStatus='full', invisible in MatchFeed.
  // isPrivate=false → status='open',     paymentStatus='partial', appears in MatchFeed.
const handleBookSlot = async (booking) => {
    // Проверка: есть ли ID пользователя?
    if (!ME_ID) {
      console.error("Ошибка: ME_ID не определен");
      return;
    }

    const target = new Date(booking.dateISO);
    const dateStr = target.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', '');

    // Безопасно собираем данные организатора (с защитой от null)
    const ownerSlot = {
      id:          ME_ID,
      firstName:   currentUser?.firstName || 'Игрок',
      lastName:    currentUser?.lastName || '',
      ratingIdx:   currentUser?.ratingIdx || 0,
      numericRating: currentUser?.numericRating || 3.0,
      isVerified:  currentUser?.isVerified || false,
      isOrganizer: true,
    };

    const newMatch = {
      owner_id:      ME_ID, // Используем ME_ID напрямую, он надежнее
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
      scenario:      booking.isPrivate ? 'private' : 'community',
      status:        booking.isPrivate ? 'upcoming' : 'open',
      isPrivate:     !!booking.isPrivate,
      paymentStatus: booking.paymentStatus || 'partial',
      filledSlots:   [ownerSlot],
      participants:  [ME_ID], // Это ВАЖНО для фильтра на главной!
    };

    const { data, error } = await supabase.from('matches').insert([newMatch]).select();
    
    if (error) {
      console.error("КРИТИЧЕСКАЯ ОШИБКА БД:", error);
      showToast?.('Не удалось сохранить бронь. Попробуйте еще раз.', 'error');
      throw error;
    }

    const insertedRow = data?.[0];
    if (!insertedRow) {
      const emptyInsertError = new Error('Booking creation returned no rows');
      showToast?.('Бронь не сохранена. Проверьте права доступа и попробуйте еще раз.', 'error');
      throw emptyInsertError;
    }

    setAllMatches(prev => [normalizeMatch(insertedRow), ...prev]);
    // Если это публичный матч — идем в ленту, если приват — остаемся в календаре
    if (!booking.isPrivate) {
      setActiveTab('matches');
    }
  };

  // ─── 2. Исправленный handleRevertToPrivate ───
  const handleRevertToPrivate = async (matchId) => {
    const { data, error } = await supabase
      .from('matches')
      .update({
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
      })
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
    const { data, error } = await supabase
      .from('matches')
      .update({
        isTraining: true,
        trainingDetails: {
          format: trainingData.format,
          withCoach: trainingData.withCoach,
          duration: trainingData.duration,
          guests: trainingData.guests,
        },
        trainingStatus: 'pending_coach',
      })
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
    showToast('Запрос на тренировку отправлен администратору', 'success');
  };

  const handleConvertToPublic = async (matchId) => {
    const { data, error } = await supabase
      .from('matches')
      .update({
        type: 'match',
        isPrivate: false,
        scenario: 'social',
        status: 'open',
      })
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
    const { participants, status } = deriveParticipantsAndStatus(newFilledSlots, allMatches.find(m => m.id === matchId)?.status);
    const { data, error } = await supabase
      .from('matches')
      .update({ filledSlots: newFilledSlots, participants, status })
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
    const statusSaved = updatedMatch.status === status;

    if (!slotsSaved || !participantsSaved || !statusSaved) {
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

  // ── Dev reset (clears localStorage and reloads) ──
  const handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  // ── Logout ──
  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast?.('Не удалось выйти из аккаунта. Попробуйте еще раз.', 'error');
      throw error;
    }
    localStorage.clear();
    window.location.reload();
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
    tg?.HapticFeedback?.impactOccurred('medium');
    setScreen('create-match');
  };

  const openMatchDetails = (match) => {
    tg?.HapticFeedback?.impactOccurred('light');
    setSelected(match);
    setScreen('match-details');
  };

  // Open match details by id — used from BookingCalendar where we only know the matchId.
  const openMatchById = (id) => {
    const match = allMatches.find(m => m.id === id);
    if (!match) return;
    openMatchDetails(match);
  };

  // ── Match creation: build object and persist ──
  const handleMatchSuccess = async (data) => {
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
  // Public feed shows only non-private open matches.
  const openMatches = allMatches.filter(m => {
    // Восстанавливаем строгий фильтр: только публичные, не завершенные матчи
    const isPublicFeedMatch = m.type === 'match' && m.isPrivate === false && m.status !== 'completed';
    if (!isPublicFeedMatch) {
      return false;
    }
    const matchStartDateTime = new Date(`${m.dateISO}T${m.time || '00:00'}:00`);
    const matchEndDateTime = new Date(matchStartDateTime.getTime() + (m.duration || 1.5) * 3600 * 1000);
    return matchEndDateTime > new Date();
  });

  // Real profile stats derived from allMatches + live rating.
  const profileStats = useMemo(() => {
    // Безопасно берем рейтинг
    const numericRating = currentUser?.rating || currentUser?.numericRating || 3.0;
    const matchesCount = completedMatches?.length || 0;
    
    const winsCount = (completedMatches || []).filter(m => {
      const myId = currentUser?.id; // Используем ID текущего пользователя
      // Ensure myId is defined before using it in .some() to prevent errors
      if (!myId) {
        console.warn("currentUser.id is undefined when calculating winsCount.");
        return false;
      }
      if (!m.team1 && !m.team2) { // Handle cases where teams might be undefined
        return false;
      }

      const inT1 = (m.team1 || []).some(p => p?.id === myId);
      const inT2 = (m.team2 || []).some(p => p?.id === myId);
      if (inT1) return !!m.isTeam1Win;
      if (inT2) return !m.isTeam1Win;
      return false;
    }).length;

    const winRate = matchesCount > 0 ? Math.round((winsCount / matchesCount) * 100) : 0;
    return { numericRating, matchesCount, winsCount, winRate };
  }, [completedMatches, currentUser]);

  if (loading || !currentUser) {
    return <div style={{ background: '#050F0B', minHeight: '100dvh' }} />; // Or a proper loading spinner
  }

  // ── Full-screen routes (hide BottomNav) ──
  if (screen === 'create-match') {
    return (
      <MatchCreationScreen
        allMatches={allMatches}
        onBack={() => setScreen(null)}
        onSuccess={handleMatchSuccess}
        user={currentUser}
      />
    );
  }

  if (screen === 'match-details' && selectedMatch) {
    return (
      <MatchDetailsScreen
        match={allMatches.find(m => m.id === selectedMatch.id) ?? selectedMatch}
        currentUser={currentUser}
        onBack={() => setScreen(null)}
        onJoinSuccess={() => { setScreen(null); setActiveTab('matches'); }}
        onDelete={handleDeleteMatch}
        onComplete={handleCompleteMatch}
        onUpdate={handleUpdateMatch}
        onSlotsChange={handleSlotsChange}
        allMessages={allMessages}
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
            onViewDetails={openMatchDetails}
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
            playerRating={currentUser.ratingIdx}
            onJoin={(match) => console.log('join', match.id)}
            onViewDetails={openMatchDetails} // This needs showToast
            onCreateMatch={openCreateMatch} // This needs showToast
            onReset={currentUser?.role === 'admin' ? handleReset : null}
          />
        )}

        {activeTab === 'booking' && (
  <div style={{ height: 'calc(100dvh - 78px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', overflow: 'visible', touchAction: 'pan-x pan-y' }}>
    <BookingCalendar
      allMatches={allMatches}
      userId={ME_ID} // Передаем твой ID
      userRating={currentUser?.numericRating} // Передаем рейтинг для проверки входа
      onOpenMatch={openMatchById}
      onBookSlot={handleBookSlot}
      showToast={showToast}
    />
  </div>
)}
      </main>

      <BottomNav active={activeTab} setActive={setActiveTab} />
    </div>
  );
}
