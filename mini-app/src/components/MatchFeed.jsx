import React, { useMemo, useState } from 'react';
import { MapPin, Plus, UsersRound } from 'lucide-react';
import { getCourtCapacity, getPerPlayerPrice } from '../lib/pricing';
import { getMatchLevelRequirement } from '../lib/matchLevelRequirement';
import { getMatchBookingStatus } from '../lib/matchBookingStatus';

const C = {
  bg: '#050F0B',
  card: 'rgba(255,255,255,0.045)',
  border: 'rgba(245,241,232,0.10)',
  text: '#F5F1E8',
  muted: 'rgba(245,241,232,0.58)',
  lime: '#D8F34A',
  coral: '#FF6F61',
};

const getSideBadge = (sideStr) => {
  if (!sideStr) return 'LR';
  const lower = sideStr.toLowerCase();
  if (lower.includes('лев') || lower === 'l') return 'L';
  if (lower.includes('прав') || lower === 'r') return 'R';
  return 'LR';
};

const calculateEndTime = (startTime, duration = 1.5) => {
  if (!startTime) return '';
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + (duration * 60);
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMins = Math.round(totalMinutes % 60);
  const f = (n) => String(n).padStart(2, '0');
  return `${f(endHours)}:${f(endMins)}`;
};

const FILTERS = [
  { id: 'all', label: 'Все', empty: 'Пока нет открытых матчей' },
  { id: 'fit', label: 'Подходят мне', empty: 'Нет матчей, подходящих вашему рейтингу' },
  { id: 'booked', label: 'С бронью', empty: 'Нет матчей с бронью' },
  { id: 'unbooked', label: 'Без брони', empty: 'Нет матчей без брони' },
  { id: 'mine', label: 'Мои', empty: 'У вас пока нет активных матчей' },
];

const inactiveStatuses = new Set(['completed', 'finished', 'cancelled', 'canceled']);

const getMatchStartMs = (match) => {
  const date = match?.dateISO ?? match?.date_iso;
  const time = match?.time || '00:00';
  const timestamp = new Date(`${date}T${time}:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
};

const isFutureActiveMatch = (match) => {
  if (!match || inactiveStatuses.has(String(match.status || '').toLowerCase())) return false;

  const startMs = getMatchStartMs(match);
  if (startMs === Number.MAX_SAFE_INTEGER) return true;

  const durationMs = (match.duration || 1.5) * 60 * 60 * 1000;
  return startMs + durationMs > Date.now();
};

const isUserInMatch = (match, userId) => {
  if (!userId) return false;

  const participants = Array.isArray(match?.participants) ? match.participants : [];
  const filledSlots = Array.isArray(match?.filledSlots) ? match.filledSlots.filter(Boolean) : [];

  return (
    match?.ownerId === userId ||
    match?.owner_id === userId ||
    participants.includes(userId) ||
    filledSlots.some(player => player?.id === userId)
  );
};

const canCurrentUserJoin = (match, currentUser) => {
  if (!currentUser || !isFutureActiveMatch(match)) return false;
  if (isUserInMatch(match, currentUser.id)) return false;

  const filledSlots = Array.isArray(match?.filledSlots) ? match.filledSlots.filter(Boolean) : [];
  const maxSlots = getCourtCapacity(match?.courtType || match?.court_type || 'standard');
  if (filledSlots.length >= maxSlots) return false;

  const ratingMin = match?.ratingMin ?? match?.rating_min ?? 0;
  const ratingMax = match?.ratingMax ?? match?.rating_max ?? 6;
  const ratingIdx = currentUser.ratingIdx ?? 0;
  const levelOk = ratingIdx >= ratingMin && ratingIdx <= ratingMax;
  const requiresVerifiedRating = match?.requiresVerifiedRating === true || match?.requires_verified_rating === true;
  const verifiedOk = !requiresVerifiedRating || currentUser.isVerified === true;

  return levelOk && verifiedOk;
};

function JoinButton({ onClick }) {
  const [pressed, setPressed] = useState(false);

  return (
    <span
      role="button"
      tabIndex={0}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      style={{
        background: 'rgba(216,243,74,0.10)',
        color: C.lime,
        padding: '11px 16px',
        borderRadius: '16px',
        border: '1px solid rgba(216,243,74,0.34)',
        fontSize: '14px',
        fontWeight: '800',
        cursor: 'pointer',
        transition: 'all 0.15s ease-out',
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
        outline: 'none',
        WebkitTapHighlightColor: 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      Присоединиться
    </span>
  );
}

function PlayerSlot({ player }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '64px', overflow: 'visible' }}>
      <div style={{
        position: 'relative',
        width: '52px',
        height: '52px',
        marginBottom: '8px',
        overflow: 'visible',
      }}>
        <div style={{
          width: '46px',
          height: '46px',
          borderRadius: '50%',
          background: player ? 'linear-gradient(145deg, #12382A, #071F16)' : 'rgba(255,255,255,0.03)',
          border: player ? '1px solid rgba(216,243,74,0.20)' : '1px dashed rgba(245,241,232,0.14)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: player ? C.text : 'rgba(245,241,232,0.24)',
          fontWeight: 850,
          overflow: 'hidden',
        }}>
          {player?.photoUrl ? (
            <img src={player.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            player?.firstName?.[0] || '+'
          )}
        </div>
        {player && (
          <div style={{
            position: 'absolute',
            top: '-3px',
            right: '-1px',
            zIndex: 4,
            background: '#071F16',
            color: C.lime,
            minWidth: '28px',
            height: '18px',
            padding: '0 5px',
            borderRadius: '999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '8.5px',
            fontWeight: '900',
            border: '1px solid rgba(216,243,74,0.42)',
            boxShadow: '0 6px 14px rgba(0,0,0,0.28)',
            lineHeight: 1,
          }}>
            {player.numericRating || '3.0'}
          </div>
        )}
        {player && (
          <div style={{
            position: 'absolute',
            bottom: '1px',
            right: '1px',
            zIndex: 3,
            background: 'rgba(255,111,97,0.95)',
            color: C.bg,
            width: '17px',
            height: '17px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '8px',
            fontWeight: '900',
            border: `2px solid ${C.bg}`,
          }}>
            {getSideBadge(player.sidePreference || player.side_preference)}
          </div>
        )}
      </div>
      <span style={{
        color: player ? C.text : 'rgba(245,241,232,0.34)',
        fontSize: '10px',
        fontWeight: 750,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        width: '100%',
        textAlign: 'center',
      }}>
        {player ? player.firstName : 'Свободно'}
      </span>
    </div>
  );
}

function MatchCard({ match, onViewDetails }) {
  const filledSlots = Array.isArray(match.filledSlots) ? match.filledSlots.filter(Boolean) : [];
  const filledCount = filledSlots.length;
  const pricePerPerson = match.pricePerPerson || getPerPlayerPrice(match.time, match.duration || 1.5, match.courtType, match.dateISO);
  const levelRequirement = getMatchLevelRequirement(match);

  const bookingStatus = getMatchBookingStatus(match);
  const statusText = bookingStatus.label;
  const statusColor = bookingStatus.isBooked ? C.lime : C.muted;

  return (
    <button
      type="button"
      onClick={() => onViewDetails(match)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: C.card,
        borderRadius: '26px',
        padding: '18px',
        marginBottom: '12px',
        border: `1px solid ${C.border}`,
        position: 'relative',
        transition: 'transform 0.15s ease, background 0.2s ease',
        boxShadow: '0 18px 54px rgba(0,0,0,0.26)',
        overflow: 'visible',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
        <div style={{
          color: statusColor,
          padding: '5px 10px',
          borderRadius: '999px',
          fontSize: '11px',
          fontWeight: '750',
          border: `1px solid ${bookingStatus.isBooked ? 'rgba(216,243,74,0.24)' : 'rgba(245,241,232,0.16)'}`,
          background: bookingStatus.isBooked ? 'rgba(216,243,74,0.08)' : 'rgba(245,241,232,0.06)',
        }}>
          {statusText}
        </div>

        <div style={{
          color: C.lime,
          padding: '5px 10px',
          borderRadius: '999px',
          fontSize: '11px',
          fontWeight: '800',
          background: 'rgba(216,243,74,0.08)',
          border: '1px solid rgba(216,243,74,0.20)',
        }}>
          {levelRequirement.summaryLabel}
        </div>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <h2 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: '900', color: C.text, lineHeight: 1.15 }}>
          {match.ownerName || match.title || 'Открытый матч'}
        </h2>
        <div style={{ color: C.muted, fontSize: '13px', fontWeight: '650', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <MapPin size={14} strokeWidth={2} />
          <span>{match.courtName || `Корт ${match.courtId}`}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', color: C.text, fontSize: '13px', fontWeight: '700' }}>
        <span>{match.date}</span>
        <span style={{ color: C.muted }}>·</span>
        <span>{match.time} — {calculateEndTime(match.time, match.duration)}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', marginBottom: '16px', padding: '4px 0' }}>
        {[0, 1, 2, 3].map((slotIndex) => (
          <PlayerSlot key={slotIndex} player={filledSlots[slotIndex]} />
        ))}
        <div style={{ alignSelf: 'center', marginLeft: 'auto', color: C.text, fontSize: '14px', fontWeight: '850', opacity: 0.72, display: 'flex', alignItems: 'center', gap: '5px' }}>
          <UsersRound size={16} />
          {filledCount}/4
        </div>
      </div>

      <div style={{ height: '1px', background: 'rgba(245,241,232,0.08)', marginBottom: '16px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: '900', color: C.text }}>
            {pricePerPerson} ₽
          </div>
          <div style={{ fontSize: '11px', color: C.muted }}>с человека</div>
        </div>

        <JoinButton onClick={() => onViewDetails(match)} />
      </div>
    </button>
  );
}

export default function MatchFeed({ matches = [], currentUser, onViewDetails, onCreateMatch }) {
  const [activeFilter, setActiveFilter] = useState('all');
  const activeFilterDef = FILTERS.find(filter => filter.id === activeFilter) ?? FILTERS[0];

  const activeSortedMatches = useMemo(() => {
    return [...matches]
      .filter(isFutureActiveMatch)
      .sort((a, b) => getMatchStartMs(a) - getMatchStartMs(b));
  }, [matches]);

  const visibleMatches = useMemo(() => {
    if (activeFilter === 'fit') {
      return activeSortedMatches.filter(match => canCurrentUserJoin(match, currentUser));
    }

    if (activeFilter === 'booked') {
      return activeSortedMatches.filter(match => getMatchBookingStatus(match).isBooked);
    }

    if (activeFilter === 'unbooked') {
      return activeSortedMatches.filter(match => !getMatchBookingStatus(match).isBooked);
    }

    if (activeFilter === 'mine') {
      return activeSortedMatches.filter(match => isUserInMatch(match, currentUser?.id));
    }

    return activeSortedMatches;
  }, [activeFilter, activeSortedMatches, currentUser]);

  return (
    <div style={{
      padding: '20px 16px 104px',
      background: 'radial-gradient(circle at 50% -8%, rgba(216,243,74,0.07), transparent 24rem), #050F0B',
      minHeight: '100dvh',
      overflowX: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <div style={{ color: 'rgba(245,241,232,0.46)', fontSize: '10px', fontWeight: '900', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '5px' }}>
            Клубная лента
          </div>
          <h1 style={{ color: C.text, fontSize: '30px', fontWeight: '950', margin: 0, lineHeight: 1 }}>
            Матчи
          </h1>
        </div>
        <button
          onClick={onCreateMatch}
          style={{
            width: '46px',
            height: '46px',
            borderRadius: '16px',
            background: 'rgba(216,243,74,0.12)',
            border: '1px solid rgba(216,243,74,0.36)',
            color: C.lime,
            cursor: 'pointer',
            boxShadow: '0 14px 34px rgba(216,243,74,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Создать матч"
        >
          <Plus size={21} strokeWidth={2.4} />
        </button>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          paddingBottom: '12px',
          marginBottom: '8px',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {FILTERS.map(filter => {
          const isActive = activeFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => setActiveFilter(filter.id)}
              style={{
                flex: '0 0 auto',
                padding: '9px 13px',
                borderRadius: '999px',
                border: isActive ? '1px solid rgba(216,243,74,0.62)' : `1px solid ${C.border}`,
                background: isActive ? 'rgba(216,243,74,0.14)' : 'rgba(255,255,255,0.035)',
                color: isActive ? C.lime : C.muted,
                fontSize: '12px',
                fontWeight: 850,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: isActive ? '0 10px 26px rgba(216,243,74,0.12)' : 'none',
              }}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {visibleMatches.length > 0 ? (
        visibleMatches.map(m => <MatchCard key={m.id} match={m} onViewDetails={onViewDetails} />)
      ) : (
        <div style={{ textAlign: 'center', color: 'rgba(245,241,232,0.45)', marginTop: '64px', fontSize: '14px' }}>
          {activeFilterDef.empty}
        </div>
      )}
    </div>
  );
}
