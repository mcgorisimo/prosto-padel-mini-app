import React, { useState } from 'react';
import { MapPin, Plus, UsersRound } from 'lucide-react';

const C = {
  bg: '#050F0B',
  card: 'rgba(255,255,255,0.045)',
  border: 'rgba(245,241,232,0.10)',
  text: '#F5F1E8',
  muted: 'rgba(245,241,232,0.58)',
  lime: '#D8F34A',
  coral: '#FF6F61',
};

const getLevelLabel = (rating) => {
  if (rating >= 5.5) return 'A';
  if (rating >= 5.0) return 'B+';
  if (rating >= 4.5) return 'B';
  if (rating >= 4.0) return 'C+';
  if (rating >= 3.5) return 'C';
  if (rating >= 3.0) return 'D+';
  return 'D';
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
  const pricePerPerson = match.pricePerPerson || 1875;

  let statusText = 'Не забронировано';
  let statusColor = C.muted;

  if (match.paymentStatus === 'full' || match.isBooked) {
    statusText = 'Бронь подтверждена';
    statusColor = C.lime;
  } else if (match.paymentStatus === 'partial') {
    statusText = 'Без онлайн-оплаты';
    statusColor = C.coral;
  }

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
          border: `1px solid ${statusColor === C.lime ? 'rgba(216,243,74,0.24)' : 'rgba(255,111,97,0.24)'}`,
          background: statusColor === C.lime ? 'rgba(216,243,74,0.08)' : 'rgba(255,111,97,0.08)',
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
          {getLevelLabel(match.ratingMin)} — {getLevelLabel(match.ratingMax)}
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

export default function MatchFeed({ matches, onViewDetails, onCreateMatch }) {
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
      {matches.length > 0 ? (
        matches.map(m => <MatchCard key={m.id} match={m} onViewDetails={onViewDetails} />)
      ) : (
        <div style={{ textAlign: 'center', color: 'rgba(245,241,232,0.45)', marginTop: '64px', fontSize: '14px' }}>
          Пока нет открытых матчей
        </div>
      )}
    </div>
  );
}
