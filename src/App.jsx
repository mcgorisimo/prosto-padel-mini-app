import React, { useState, useEffect, useMemo, useCallback } from 'react';
import PlayerProfile from './components/PlayerProfile';
import BottomNav from './components/BottomNav';
import MatchCreationScreen from './components/MatchCreationScreen';
import MatchDetailsScreen from './components/MatchDetailsScreen';
import MatchFeed from './components/MatchFeed';
import Home from './components/Home';
import EditProfileScreen from './components/EditProfileScreen';
import BookingScreen from './components/BookingScreen';
import AdminScreen from './components/AdminScreen';
import { supabase } from './lib/supabaseClient';
import { useTelegram } from './hooks/useTelegram';
import { isPrimeTime } from './lib/pricing';
import { calculateRatingChange, getLevelForRating, MIN_RATING, MAX_RATING } from './lib/ratingEngine';
import { isRatingMatch } from './lib/matchRating';
import { getMyProfile, getPublicPlayerProfiles, logSupabaseError } from './lib/profileApi';

// в”Ђв”Ђв”Ђ Seed data (shown until user creates real matches) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const SEED_MATCHES = [];

// в”Ђв”Ђв”Ђ Selectors over allMatches (single source of truth) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

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

function summarizeMatchForDiagnostics(match) {
  const filledSlots = match?.filledSlots ?? match?.filled_slots;
  const participants = match?.participants;

  return {
    matchId: match?.id ?? null,
    type: match?.type ?? null,
    status: match?.status ?? null,
    isPrivate: match?.isPrivate ?? match?.is_private ?? null,
    ratingMin: match?.ratingMin ?? match?.rating_min ?? null,
    ratingMax: match?.ratingMax ?? match?.rating_max ?? null,
    participantsCount: Array.isArray(participants) ? participants.length : null,
    filledSlotsCount: Array.isArray(filledSlots) ? filledSlots.filter(Boolean).length : null,
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

// в”Ђв”Ђв”Ђ App в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export default function App({ session, showToast }) { // Accept showToast as a prop
  const { user, tg } = useTelegram();
  
  // --- 1. РЎРўР•Р™РўР« ---
  const ME_ID = session?.user?.id;
  const [profile, setProfile] = useState(null);
  const [allMatches, setAllMatches] = useState([]);
  const [allMessages, setAllMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab]    = useState('home');
  const [toast, setToast]            = useState(null);
  const [selectedMatch, setSelected] = useState(null);

  const fetchProfile = useCallback(async () => {
    if (!ME_ID) return null;

    try {
      const data = await getMyProfile();
      if (data) setProfile(data);
      return data ?? null;
    } catch (error) {
      console.error(`РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё РїСЂРѕС„РёР»СЏ РёР· Supabase: ${error.message}`);
      return null;
    }
  }, [ME_ID]);

  // --- 2. Р—РђР“Р РЈР—РљРђ Р”РђРќРќР«РҐ ---
  useEffect(() => {
    const fetchData = async () => {
      if (!ME_ID) return;

      // Fetch profile
      await fetchProfile();

      // Fetch matches
      const { data: matchesData, error: matchesError } = await supabase.from('matches').select('*').order('created_at', { ascending: false });
      if (matchesError) {
        console.error(`РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё РјР°С‚С‡РµР№ РёР· Supabase: ${matchesError.message}`);
        if (matchesError.code === 'PGRST404') console.warn("РўР°Р±Р»РёС†Р° 'matches' РЅРµ РЅР°Р№РґРµРЅР° РІ Supabase.");
      }
      if (matchesData) setAllMatches(matchesData.map(normalizeMatch));

      // Fetch messages
      const { data: messagesData, error: messagesError } = await supabase.from('messages').select('*').order('created_at', { ascending: true });
      if (messagesError) {
        console.error(`РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё СЃРѕРѕР±С‰РµРЅРёР№ РёР· Supabase: ${messagesError.message}`);
        if (messagesError.code === 'PGRST404') console.warn("РўР°Р±Р»РёС†Р° 'messages' РЅРµ РЅР°Р№РґРµРЅР° РІ Supabase.");
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
  }, [ME_ID, fetchProfile]);

  useEffect(() => {
    if (activeTab === 'profile') {
      fetchProfile();
    }
  }, [activeTab, fetchProfile]);

  useEffect(() => {
    const refreshVisibleProfile = () => {
      if (document.visibilityState === 'visible') {
        fetchProfile();
      }
    };

    window.addEventListener('focus', fetchProfile);
    document.addEventListener('visibilitychange', refreshVisibleProfile);

    return () => {
      window.removeEventListener('focus', fetchProfile);
      document.removeEventListener('visibilitychange', refreshVisibleProfile);
    };
  }, [fetchProfile]);

  // --- 3. РџРћР›Р¬Р—РћР’РђРўР•Р›Р¬ ---
  const currentUser = useMemo(() => {
    // 1. Р”РѕСЃС‚Р°РµРј РјРµС‚Р°РґР°РЅРЅС‹Рµ РёР· СЃРµСЃСЃРёРё (С‚Р°Рј С‚РѕС‡РЅРѕ Р»РµР¶Р°С‚ РёРјСЏ Рё С„Р°РјРёР»РёСЏ РёР· С„РѕСЂРјС‹ СЂРµРіРёСЃС‚СЂР°С†РёРё)
    const meta = session?.user?.user_metadata || {};
    
    // 2. Р•СЃР»Рё РїСЂРѕС„РёР»СЏ РІ Р‘Р” РµС‰Рµ РЅРµС‚, Р±РµСЂРµРј РґР°РЅРЅС‹Рµ РёР· meta
    const p = profile || { 
      first_name: meta.first_name || 'РќРѕРІС‹Р№', 
      last_name: meta.last_name || 'РРіСЂРѕРє', 
      rating: 3.0, 
      role: 'user' 
    };
    
    const numericRating = p.rating || 3.0;
    const RATINGS_ORDER = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
    const levelLabel = getLevelForRating(numericRating)?.label || 'D';
    const ratingIdxFor  = (n) => Math.max(0, RATINGS_ORDER.indexOf(levelLabel));

    return {
      id: ME_ID, // С‚СѓС‚ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ session?.user?.id (РµСЃР»Рё С‚С‹ РµС‰Рµ РЅРµ Р·Р°РјРµРЅРёР» ME_ID РІРµР·РґРµ)
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
  }, [profile, session, user?.username]); // <-- РґРѕР±Р°РІРёР»Рё session РІ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё

  const isAdmin = currentUser?.role === 'admin';

  // в”Ђв”Ђ Delete match: remove from allMatches (persisted via useLocalStorage) в”Ђв”Ђ
  const handleDeleteMatch = async (matchId) => {
    const { data, error } = await supabase
      .from('matches')
      .delete()
      .eq('id', matchId)
      .select('id');

    if (error) {
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ РјР°С‚С‡. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    if (!data?.[0]) {
      const emptyDeleteError = new Error('Match delete returned no rows');
      showToast?.('РњР°С‚С‡ РЅРµ РѕС‚РјРµРЅРµРЅ. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР°.', 'error');
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
          diagnosticContext: 'match-rating-fetch.profiles',
        });
        (data ?? []).forEach(profileRow => {
          profileRatings[profileRow.id] = Number(profileRow.rating) || 3.0;
        });
      } catch (error) {
        showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЂРµР№С‚РёРЅРіРё РёРіСЂРѕРєРѕРІ. Р РµР·СѓР»СЊС‚Р°С‚ РЅРµ СЃРѕС…СЂР°РЅС‘РЅ.', 'error');
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

  // в”Ђв”Ђ Complete match: regular matches finish immediately; rated matches wait for score confirmation в”Ђв”Ђ
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

    const { data, error } = await supabase
      .from('matches')
      .update(updatePayload)
      .eq('id', matchId)
      .select();
    
    if (error) {
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚ РјР°С‚С‡Р°. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Match completion update returned no rows');
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РІРµСЂС€РёС‚СЊ РјР°С‚С‡. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР°.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(match => match.id === matchId ? updatedMatch : match));
    showToast?.(
      isRated ? 'РЎС‡С‘С‚ РѕС‚РїСЂР°РІР»РµРЅ РЅР° РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ' : 'РњР°С‚С‡ Р·Р°РІРµСЂС€РµРЅ Рё РґРѕР±Р°РІР»РµРЅ РІ РёСЃС‚РѕСЂРёСЋ',
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
      showToast?.('РЎС‡С‘С‚ РЅРµ РїРѕРґС‚РІРµСЂР¶РґС‘РЅ: С‚СЂРµР±СѓРµС‚СЃСЏ СЃРµСЂРІРµСЂРЅРѕРµ РїСЂРёРјРµРЅРµРЅРёРµ СЂРµР№С‚РёРЅРіР°.', 'error');
      throw error;
    }

    const updatedMatch = await fetchMatchById(matchId);
    setAllMatches(prev => prev.map(match => match.id === matchId ? updatedMatch : match));
    setSelected(prev => prev?.id === matchId ? updatedMatch : prev);

    if (currentUser?.id && ratingChanges[currentUser.id]) {
      setProfile(prev => ({ ...(prev || {}), rating: ratingChanges[currentUser.id].after }));
    }

    showToast?.('РЎС‡С‘С‚ РїРѕРґС‚РІРµСЂР¶РґС‘РЅ. Р РµР№С‚РёРЅРі РѕР±РЅРѕРІР»С‘РЅ.', 'success');
    return updatedMatch;
  };

  const handleDisputeScore = async (matchId) => {
    const { data, error } = await supabase
      .from('matches')
      .update({
        status: 'disputed',
        score_status: 'disputed',
        score_disputed_by: currentUser.id,
      })
      .eq('id', matchId)
      .select();

    if (error) {
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РѕСЃРїРѕСЂРёС‚СЊ СЃС‡С‘С‚. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Score dispute update returned no rows');
      showToast?.('РЎС‡С‘С‚ РЅРµ РѕСЃРїРѕСЂРµРЅ. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР°.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(match => match.id === matchId ? updatedMatch : match));
    setSelected(prev => prev?.id === matchId ? updatedMatch : prev);
    showToast?.('РЎС‡С‘С‚ РѕСЃРїРѕСЂРµРЅ. РћР±СЂР°С‚РёС‚РµСЃСЊ Рє Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ РєР»СѓР±Р°.', 'info');
    return updatedMatch;
  };

  // в”Ђв”Ђ Booking from BookingScreen в”Ђв”Ђ
  // Always creates a match in allMatches; the calendar derives slot statuses from it.
  // isPrivate=true  в†’ status='upcoming', paymentStatus='full', invisible in MatchFeed.
  // isPrivate=false в†’ status='open',     paymentStatus='partial', appears in MatchFeed.
const handleBookSlot = async (booking) => {
    // РџСЂРѕРІРµСЂРєР°: РµСЃС‚СЊ Р»Рё ID РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ?
    if (!ME_ID) {
      console.error("РћС€РёР±РєР°: ME_ID РЅРµ РѕРїСЂРµРґРµР»РµРЅ");
      return;
    }

    const target = new Date(booking.dateISO);
    const dateStr = target.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' Рі.', '');
    const isRated = !booking.isPrivate && (booking.isRatingMatch === true || booking.is_rating_match === true);

    // Р‘РµР·РѕРїР°СЃРЅРѕ СЃРѕР±РёСЂР°РµРј РґР°РЅРЅС‹Рµ РѕСЂРіР°РЅРёР·Р°С‚РѕСЂР° (СЃ Р·Р°С‰РёС‚РѕР№ РѕС‚ null)
    const ownerSlot = {
      id:          ME_ID,
      firstName:   currentUser?.firstName || 'РРіСЂРѕРє',
      lastName:    currentUser?.lastName || '',
      ratingIdx:   currentUser?.ratingIdx || 0,
      numericRating: currentUser?.numericRating || 3.0,
      isVerified:  currentUser?.isVerified || false,
      isOrganizer: true,
    };

    const newMatch = {
      owner_id:      ME_ID, // РСЃРїРѕР»СЊР·СѓРµРј ME_ID РЅР°РїСЂСЏРјСѓСЋ, РѕРЅ РЅР°РґРµР¶РЅРµРµ
      date:          dateStr,
      dateISO:       booking.dateISO,
      time:          booking.time,
      duration:      booking.duration || 1.5,
      courtId:       booking.court?.id || '1',
      courtName:     booking.court?.name || 'РљРѕСЂС‚',
      courtType:     booking.court?.type || 'standard',
      isPrime:       isPrimeTime(booking?.time || '00:00', booking.dateISO),
      type:          booking.type || 'match',
      ratingMin:     booking.ratingMin ?? 0,
      ratingMax:     booking.ratingMax ?? 6,
      description:   booking.description || '',
      scenario:      booking.scenario || (booking.isPrivate ? 'private' : 'community'),
      status:        booking.isPrivate ? 'upcoming' : 'open',
      isPrivate:     !!booking.isPrivate,
      is_rating_match: isRated,
      paymentStatus: booking.paymentStatus || 'partial',
      filledSlots:   [ownerSlot],
      participants:  [ME_ID], // Р­С‚Рѕ Р’РђР–РќРћ РґР»СЏ С„РёР»СЊС‚СЂР° РЅР° РіР»Р°РІРЅРѕР№!
    };

    const { data, error } = await supabase.from('matches').insert([newMatch]).select();
    
    if (error) {
      console.error("РљР РРўРР§Р•РЎРљРђРЇ РћРЁРР‘РљРђ Р‘Р”:", error);
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ Р±СЂРѕРЅСЊ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    const insertedRow = data?.[0];
    if (!insertedRow) {
      const emptyInsertError = new Error('Booking creation returned no rows');
      showToast?.('Р‘СЂРѕРЅСЊ РЅРµ СЃРѕС…СЂР°РЅРµРЅР°. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР° Рё РїРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw emptyInsertError;
    }

    setAllMatches(prev => [normalizeMatch(insertedRow), ...prev]);
    // Р•СЃР»Рё СЌС‚Рѕ РїСѓР±Р»РёС‡РЅС‹Р№ РјР°С‚С‡ вЂ” РёРґРµРј РІ Р»РµРЅС‚Сѓ, РµСЃР»Рё РїСЂРёРІР°С‚ вЂ” РѕСЃС‚Р°РµРјСЃСЏ РІ РєР°Р»РµРЅРґР°СЂРµ
    if (!booking.isPrivate) {
      setActiveTab('matches');
    }
  };

  // в”Ђв”Ђв”Ђ 2. РСЃРїСЂР°РІР»РµРЅРЅС‹Р№ handleRevertToPrivate в”Ђв”Ђв”Ђ
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
        // РЎР±СЂР°СЃС‹РІР°РµРј СЃР»РѕС‚С‹ РґРѕ С‚РѕР»СЊРєРѕ РІР»Р°РґРµР»СЊС†Р°
        filledSlots: [{ 
          id: ME_ID, 
          firstName: currentUser?.firstName || 'РРіСЂРѕРє', 
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
      console.error("РћС€РёР±РєР° РїСЂРё РѕС‚РјРµРЅРµ РјР°С‚С‡Р°:", error);
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РїРµСЂРµРІРµСЃС‚Рё РјР°С‚С‡ РІ РїСЂРёРІР°С‚РЅС‹Р№ СЂРµР¶РёРј', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Revert to private returned no rows');
      showToast?.('Р‘СЂРѕРЅСЊ РЅРµ РѕР±РЅРѕРІР»РµРЅР°. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР°.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(m => m.id === matchId ? updatedMatch : m));
    setSelected(prev => prev?.id === matchId ? updatedMatch : prev);
    showToast('РњР°С‚С‡ РѕС‚РјРµРЅРµРЅ, Р±СЂРѕРЅСЊ РїРµСЂРµРІРµРґРµРЅР° РІ Р»РёС‡РЅСѓСЋ С‚СЂРµРЅРёСЂРѕРІРєСѓ', 'info');
    setActiveTab('home'); 
  };

  const handleUpdateMatch = async (matchId, updates) => {
    const dateISO = updates.dateISO ?? updates.date;
    const dateLabel = dateISO
      ? new Date(dateISO).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' Рі.', '')
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
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ РјР°С‚С‡Р°. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Match edit returned no rows');
      showToast?.('РР·РјРµРЅРµРЅРёСЏ РЅРµ СЃРѕС…СЂР°РЅРµРЅС‹. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР° РёР»Рё СЃС‚Р°С‚СѓСЃ РјР°С‚С‡Р°.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(m => m.id === updatedMatch.id ? updatedMatch : m));
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);
    showToast?.('РњР°С‚С‡ РѕР±РЅРѕРІР»РµРЅ', 'success');
    return updatedMatch;
  };

  const handleSendMessage = async (matchId, sender, text) => {
    const senderId = sender?.id ?? ME_ID;

    if (!senderId) {
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ РёРіСЂРѕРєР°. РџРѕРїСЂРѕР±СѓР№С‚Рµ РІРѕР№С‚Рё Р·Р°РЅРѕРІРѕ.', 'error');
      throw new Error('Cannot send message without sender id');
    }

    const newMessage = {
      match_id: matchId,
      sender_id: senderId,
      sender_name: sender?.firstName || 'РРіСЂРѕРє',
      text,
    };

    const { data, error } = await supabase.from('messages').insert([newMessage]).select();

    if (error) {
      console.error(`РћС€РёР±РєР° РїСЂРё РѕС‚РїСЂР°РІРєРµ СЃРѕРѕР±С‰РµРЅРёСЏ: ${error.message}`);
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ', 'error');
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
          coachName: trainingData.coachName,
          coachId: trainingData.coachId,
          coachStatus: trainingData.coachStatus,
        },
        trainingStatus: 'pending_coach',
      })
      .eq('id', trainingData.matchId)
      .select();

    if (error) {
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°РїСЂРѕСЃ РЅР° С‚СЂРµРЅРёСЂРѕРІРєСѓ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Training setup returned no rows');
      showToast?.('РўСЂРµРЅРёСЂРѕРІРєР° РЅРµ СЃРѕС…СЂР°РЅРµРЅР°. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР°.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(m => m.id === updatedMatch.id ? updatedMatch : m));
    setSelected(prev => prev?.id === updatedMatch.id ? updatedMatch : prev);
    showToast('Р—Р°РїСЂРѕСЃ РЅР° С‚СЂРµРЅРёСЂРѕРІРєСѓ РѕС‚РїСЂР°РІР»РµРЅ. РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ РєР»СѓР±Р° РїРѕРґС‚РІРµСЂРґРёС‚ С‚СЂРµРЅРµСЂР° Рё РґРµС‚Р°Р»Рё.', 'success');
  };

  const handleConvertToPublic = async (matchId, isRatingMatch = false) => {
    const { data, error } = await supabase
      .from('matches')
      .update({
        type: 'match',
        isPrivate: false,
        scenario: 'social',
        status: 'open',
        is_rating_match: isRatingMatch === true,
        isTraining: false,
        trainingDetails: null,
        trainingStatus: null,
      })
      .eq('id', matchId)
      .select();

    if (error) {
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ СЃР±РѕСЂ РёРіСЂРѕРєРѕРІ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Convert to public returned no rows');
      showToast?.('РњР°С‚С‡ РЅРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅ. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР°.', 'error');
      throw emptyUpdateError;
    }

    const updatedMatch = normalizeMatch(updatedRow);
    setAllMatches(prev => prev.map(m => m.id === updatedMatch.id ? updatedMatch : m));
    openMatchDetails(updatedMatch);
  };

  // в”Ђв”Ђ Slot changes: persist filledSlots, recompute participants + status в”Ђв”Ђ
  const handleSlotsChange = async (matchId, newFilledSlots) => {
    const currentMatch = allMatches.find(m => m.id === matchId);
    const { participants, status: derivedStatus } = deriveParticipantsAndStatus(newFilledSlots, currentMatch?.status);
    const status = currentMatch?.isPrivate === true ? currentMatch.status : derivedStatus;
    const { data, error } = await supabase
      .from('matches')
      .update({ filledSlots: newFilledSlots, participants, status })
      .eq('id', matchId)
      .select();

    if (error) {
      console.error(`РћС€РёР±РєР° РїСЂРё СЃРѕС…СЂР°РЅРµРЅРёРё СЃР»РѕС‚Р°: ${error.message}`);
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ СЃР»РѕС‚. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    const updatedRow = data?.[0];
    if (!updatedRow) {
      const emptyUpdateError = new Error('Match slot update returned no rows');
      console.error(emptyUpdateError);
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ СЃР»РѕС‚. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР° Рє РјР°С‚С‡Сѓ.', 'error');
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
      showToast?.('РЎР»РѕС‚ РЅРµ СЃРѕС…СЂР°РЅРёР»СЃСЏ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
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

    if (message.includes('full') || message.includes('slot') || message.includes('no free')) {
      return 'РЎРІРѕР±РѕРґРЅРѕРµ РјРµСЃС‚Рѕ СѓР¶Рµ Р·Р°РЅСЏС‚Рѕ. РћР±РЅРѕРІРёС‚Рµ РјР°С‚С‡ Рё РїРѕРїСЂРѕР±СѓР№С‚Рµ РґСЂСѓРіРѕР№.';
    }
    if (message.includes('private')) {
      return 'Р­С‚Рѕ РїСЂРёРІР°С‚РЅС‹Р№ РјР°С‚С‡. РџСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ РјРѕР¶РЅРѕ С‚РѕР»СЊРєРѕ РїРѕ РїСЂРёРіР»Р°С€РµРЅРёСЋ РѕСЂРіР°РЅРёР·Р°С‚РѕСЂР°.';
    }
    if (message.includes('rating') || message.includes('level')) {
      return 'Р’Р°С€ СѓСЂРѕРІРµРЅСЊ РЅРµ РІС…РѕРґРёС‚ РІ РґРёР°РїР°Р·РѕРЅ СЌС‚РѕРіРѕ РјР°С‚С‡Р°.';
    }
    if (message.includes('already') || message.includes('participant')) {
      return 'Р’С‹ СѓР¶Рµ СѓС‡Р°СЃС‚РІСѓРµС‚Рµ РІ СЌС‚РѕРј РјР°С‚С‡Рµ.';
    }
    if (message.includes('started') || message.includes('completed') || message.includes('cancel')) {
      return 'РЈС‡Р°СЃС‚РёРµ РІ РјР°С‚С‡Рµ СЃРµР№С‡Р°СЃ РЅРµРґРѕСЃС‚СѓРїРЅРѕ.';
    }

    return 'РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ Рє РјР°С‚С‡Сѓ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.';
  };

  const handleJoinMatch = async (matchId) => {
    const existingMatch = allMatches.find(match => match.id === matchId) ?? selectedMatch;
    const { data, error } = await supabase.rpc('join_match', { p_match_id: matchId });

    if (error) {
      logSupabaseError('join_match', error, summarizeMatchForDiagnostics(existingMatch));
      showToast?.(getJoinMatchErrorMessage(error), 'error');
      throw error;
    }

    const returnedRow = Array.isArray(data)
      ? data[0]
      : data?.match ?? data;

    if (!returnedRow?.id) {
      const emptyRpcError = new Error('join_match returned no match row');
      console.error(emptyRpcError);
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РјР°С‚С‡ РїРѕСЃР»Рµ РїСЂРёСЃРѕРµРґРёРЅРµРЅРёСЏ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
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

  const handleLeaveMatch = async (matchId) => {
    const existingMatch = allMatches.find(match => match.id === matchId) ?? selectedMatch;
    const { data, error } = await supabase.rpc('leave_match', { p_match_id: matchId });

    if (error) {
      logSupabaseError('leave_match', error, summarizeMatchForDiagnostics(existingMatch));
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹Р№С‚Рё РёР· РјР°С‚С‡Р°. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    const returnedRow = Array.isArray(data)
      ? data[0]
      : data?.match ?? data;

    if (!returnedRow?.id) {
      const emptyRpcError = new Error('leave_match returned no match row');
      console.error(emptyRpcError);
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РјР°С‚С‡ РїРѕСЃР»Рµ РІС‹С…РѕРґР°. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
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

  // в”Ђв”Ђ Dev reset (clears localStorage and reloads) в”Ђв”Ђ
  const handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  // в”Ђв”Ђ Logout в”Ђв”Ђ
  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹Р№С‚Рё РёР· Р°РєРєР°СѓРЅС‚Р°. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
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

  // в”Ђв”Ђ Navigation helpers в”Ђв”Ђ
  const openCreateMatch = () => {
    tg?.HapticFeedback?.impactOccurred('medium');
    setScreen('create-match');
  };

  const openMatchDetails = (match) => {
    tg?.HapticFeedback?.impactOccurred('light');
    setSelected(match);
    setScreen('match-details');
  };

  // в”Ђв”Ђ Match creation: build object and persist в”Ђв”Ђ
  const handleMatchSuccess = async (data) => {
    const isRated = data.isRatingMatch === true || data.is_rating_match === true;

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
      showToast?.('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РјР°С‚С‡. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.', 'error');
      throw error;
    }

    const insertedRow = insertedData?.[0];
    if (!insertedRow) {
      const emptyInsertError = new Error('Match creation returned no rows');
      showToast?.('РњР°С‚С‡ РЅРµ СЃРѕР·РґР°РЅ. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІР° РґРѕСЃС‚СѓРїР°.', 'error');
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
    // Р’РѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµРј СЃС‚СЂРѕРіРёР№ С„РёР»СЊС‚СЂ: С‚РѕР»СЊРєРѕ РїСѓР±Р»РёС‡РЅС‹Рµ, РЅРµ Р·Р°РІРµСЂС€РµРЅРЅС‹Рµ РјР°С‚С‡Рё
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
    // Р‘РµР·РѕРїР°СЃРЅРѕ Р±РµСЂРµРј СЂРµР№С‚РёРЅРі
    const numericRating = currentUser?.rating || currentUser?.numericRating || 3.0;
    const matchesCount = completedMatches?.length || 0;
    
    const winsCount = (completedMatches || []).filter(m => {
      const myId = currentUser?.id; // РСЃРїРѕР»СЊР·СѓРµРј ID С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
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

  // в”Ђв”Ђ Full-screen routes (hide BottomNav) в”Ђв”Ђ
  if (screen === 'create-match') {
    return (
      <MatchCreationScreen
        allMatches={allMatches}
        onBack={() => setScreen(null)}
        onSuccess={handleMatchSuccess}
        user={currentUser}
        showToast={showToast}
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
        onConfirmScore={handleConfirmScore}
        onDisputeScore={handleDisputeScore}
        onUpdate={handleUpdateMatch}
        onSlotsChange={handleSlotsChange}
        onJoinMatch={handleJoinMatch}
        onLeaveMatch={handleLeaveMatch}
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
      {/* Dev mode badge вЂ” visible only for admin accounts */}
      {currentUser.role === 'admin' && (
        <div style={{
          position: 'fixed', top: '10px', right: '10px', zIndex: 9999,
          background: 'rgba(234,67,53,0.12)', border: '1px solid rgba(234,67,53,0.35)',
          borderRadius: '8px', padding: '4px 10px',
          color: '#f87171', fontSize: '10px', fontWeight: 700,
          letterSpacing: '0.08em', pointerEvents: 'none',
          backdropFilter: 'blur(4px)',
        }}>
          Р Р•Р–РРњ Р РђР—Р РђР‘РћРўР§РРљРђ
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
            <h2 style={{ color: '#F5F1E8', marginBottom: '8px' }}>Р РµР№С‚РёРЅРі РєР»СѓР±Р°</h2>
            <p style={{ marginBottom: '8px' }}>Р РµР№С‚РёРЅРі РєР»СѓР±Р° РїРѕСЏРІРёС‚СЃСЏ РїРѕСЃР»Рµ РїРµСЂРІС‹С… РёРіСЂ.</p>
            <p style={{ fontSize: '13px', lineHeight: 1.5 }}>
              РЎРµР№С‡Р°СЃ РІ MVP РїРѕРєР°Р·С‹РІР°РµРј Р»РёС‡РЅС‹Р№ СѓСЂРѕРІРµРЅСЊ Рё РёСЃС‚РѕСЂРёСЋ РјР°С‚С‡РµР№ РІ РїСЂРѕС„РёР»Рµ.
            </p>
          </div>
        )}

        {activeTab === 'matches' && (
          <MatchFeed
            matches={openMatches}
            currentUser={currentUser}
            playerRating={currentUser.ratingIdx}
            onJoin={(match) => console.log('join', match.id)}
            onViewDetails={openMatchDetails} // This needs showToast
            onCreateMatch={openCreateMatch} // This needs showToast
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

      <BottomNav active={activeTab} setActive={setActiveTab} isAdmin={isAdmin} />
    </div>
  );
}
