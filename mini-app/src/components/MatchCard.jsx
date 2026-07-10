import React from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const RATINGS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];

const C = {
  bg:      '#0A0F2E',
  card:    '#0f172a',
  border:  '#1E2755',
  accent:  '#1E3AE8',
  text:    '#FFFFFF',
  muted:   '#8B9CC8',
  gold:    '#D4AF37',
};

const LUNDA_NUM_START = [1.0, 1.5, 2.5, 3.0, 3.5, 4.0, 4.5];
const ratingFromIdx = (idx) =>
  (typeof idx === 'number' && idx >= 0 && idx < LUNDA_NUM_START.length) ? LUNDA_NUM_START[idx] : null;

const fmtPrice = (n) => n.toLocaleString('ru-RU') + ' ₽';

// ─── Sub-components ───────────────────────────────────────────────────────────

function LevelBadge({ minIdx, maxIdx }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: 'rgba(100, 116, 139, 0.15)', borderRadius: '8px',
      padding: '4px 8px', border: '1px solid rgba(100, 116, 139, 0.3)',
    }}>
      <span style={{ fontSize: '10px' }}>🏆</span>
      <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 700 }}>
        {RATINGS[minIdx]} – {RATINGS[maxIdx]}
      </span>
    </div>
  );
}

function PrimeBadge() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: 'rgba(212,175,55,0.15)', borderRadius: '8px',
      padding: '4px 8px', border: '1px solid rgba(212,175,55,0.35)',
    }}>
      <span style={{ fontSize: '11px' }}>👑</span>
      <span style={{ color: C.gold, fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em' }}>PRIME</span>
    </div>
  );
}

function SingleBadge() {
  return (
    <div style={{
      display: 'inline-flex',
      background: 'rgba(100,116,139,0.15)', borderRadius: '8px',
      padding: '4px 8px', border: '1px solid rgba(100,116,139,0.2)',
    }}>
      <span style={{ color: '#64748b', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em' }}>Single</span>
    </div>
  );
}

function BookingStatusBadge({ status, scenario }) {
  const isConfirmed = status === 'confirmed' || scenario === 'social';

  if (isConfirmed) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(34,197,94,0.1)', borderRadius: '8px', padding: '4px 8px', border: '1px solid rgba(34,197,94,0.3)' }}>
        <span style={{ color: '#22C55E', fontSize: '10px', fontWeight: 700 }}>
          ✅ Корт забронирован
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(100,116,139,0.1)', borderRadius: '8px', padding: '4px 8px', border: '1px solid rgba(100,116,139,0.2)' }}>
      <span style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 700 }}>
        ⚪ Корт не забронирован
      </span>
    </div>
  );
}

function CardPlayerAvatar({ player }) {
  const initials = [player?.firstName?.[0], player?.lastName?.[0]].filter(Boolean).join('') || '?';

  // Use numericRating if available, otherwise fall back to a rating derived from the level index.
  const rating = player?.numericRating ?? ratingFromIdx(player?.ratingIdx);
  const ratingStr = typeof rating === 'number' ? rating.toFixed(1) : '—';

  return (
    <div className="relative shrink-0">
      <div className="relative w-10 h-10 aspect-square rounded-full">
        {player?.photo_url ? (
          <img src={player.photo_url} alt={player.firstName} className="w-full h-full rounded-full object-cover" />
        ) : (
          <div className="w-full h-full rounded-full bg-blue-600 flex items-center justify-center font-bold text-white text-sm border-2 border-slate-700">
            {initials}
          </div>
        )}
        {/* Rating Badge */}
        <div className="absolute w-5 h-5 -top-1 -right-1 bg-green-600 rounded-full flex items-center justify-center border-2 border-slate-900">
          <span className="text-white font-bold text-[10px] leading-none">
            {ratingStr}
          </span>
        </div>
      </div>
    </div>
  );
}

function PlayerSlots({ filledSlots = [], total }) {
  const players = filledSlots.filter(Boolean);
  const emptyCount = total - players.length;

  return (
    <div className="flex items-center">
      <div className="flex gap-2">
        {players.map((p, i) => <CardPlayerAvatar key={p.id || i} player={p} />)}
        {emptyCount > 0 && Array.from({ length: emptyCount }).map((_, i) => (
          <div key={`empty-${i}`} className="w-10 h-10 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center shrink-0">
            <span className="text-slate-500 text-sm">?</span>
          </div>
        ))}
      </div>
      <span className="ml-4 text-slate-400 text-sm font-medium">{players.length}/{total}</span>
    </div>
  );
}

// ─── MatchCard ────────────────────────────────────────────────────────────────

export default function MatchCard({ match, playerRating, onJoin, onViewDetails }) {
  const {
    title,
    description,
    date,
    time,
    duration,
    courtType = 'panoramic',
    isPrime   = false,
    ratingMin,
    ratingMax,
    filledSlots = [],
    courtName,
    status,
    scenario,
  } = match;

  const isPanoramic    = courtType === 'panoramic';
  const maxSlots       = courtType === 'single' ? 2 : 4;
  const hourlyRate     = courtType === 'single' ? 3000 : (isPrime ? 8000 : 5000);
  const pricePerPlayer = Math.round((hourlyRate * duration) / maxSlots);

  const isConfirmed = status === 'confirmed' || scenario === 'social';
  const isFull     = (filledSlots?.length ?? 0) >= maxSlots;
  const levelMatch = playerRating >= ratingMin && playerRating <= ratingMax;
  const canJoin    = !isFull && levelMatch;

  return (
    <div
      onClick={() => onViewDetails?.(match)}
      className="cursor-pointer transition-all duration-150 ease-in-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-600/25 active:scale-[0.98]"
      style={{
        background: 'linear-gradient(160deg, #0f172a 0%, #0d1432 100%)',
        borderRadius: '16px',
        border: isConfirmed
          ? '1px solid rgba(34,197,94,0.4)'
          : (isPanoramic && isPrime ? '1px solid rgba(212,175,55,0.4)' : `1px solid ${C.border}`),
        boxShadow: isConfirmed
          ? '0 0 0 1px rgba(34,197,94,0.1), 0 4px 24px rgba(34,197,94,0.15)'
          : (isPanoramic && isPrime
            ? '0 0 0 1px rgba(212,175,55,0.08), 0 4px 24px rgba(212,175,55,0.07)'
            : '0 4px 20px rgba(10,15,46,0.5)'),
        padding: '16px',
        position: 'relative',
        overflow: 'hidden',
      }}>

      {/* Gold top strip for prime panoramic */}
      {isPanoramic && isPrime && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
          background: 'linear-gradient(90deg, transparent, #D4AF37 50%, transparent)',
        }} />
      )}

      {/* Row 1: badges */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <BookingStatusBadge status={status} scenario={scenario} />
          {isConfirmed && (
            <div style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 500 }}>
              (бронь подтверждена)
            </div>
          )}
        </div>
        <LevelBadge minIdx={ratingMin} maxIdx={ratingMax} />
      </div>

      {/* Row 2: host + court */}
      <div style={{ marginBottom: '12px' }}>
        {title && (
          <div style={{ color: C.text, fontSize: '16px', fontWeight: 700, marginBottom: '3px' }}>
            {title}
          </div>
        )}
        <div style={{ color: isPanoramic && isPrime ? C.gold : C.muted, fontSize: '12px', fontWeight: 500 }}>
          {courtName ? `📍 ${courtName}` : (isPanoramic ? '✦ Ультрапанорама' : 'Сингл-корт')}
        </div>
      </div>

      {description && (
        <div style={{
          color: C.muted, fontSize: '12px', fontStyle: 'italic', lineHeight: 1.5, marginBottom: '14px',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          "{description}"
        </div>
      )}

      {/* Row 3: meta */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '14px' }}>
        {[['📅', date], ['🕒', time], ['⏱', `${duration}ч`]].map(([icon, val]) => (
          <div key={val} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '12px' }}>{icon}</span>
            <span style={{ color: C.muted, fontSize: '12px', fontWeight: 500 }}>{val}</span>
          </div>
        ))}
      </div>

      {/* Row 4: slots */}
      <div style={{ marginBottom: '14px' }}>
        <PlayerSlots filledSlots={filledSlots} total={maxSlots} />
      </div>

      <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', marginBottom: '14px' }} />

      {/* Row 5: price + CTA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

        {/* Split price */}
        <div>
          <div style={{
            color: isPrime ? C.gold : C.text,
            fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1,
          }}>
            {fmtPrice(pricePerPlayer)}
          </div>
          <div style={{ color: C.muted, fontSize: '11px', marginTop: '3px' }}>
            с человека · {fmtPrice(hourlyRate)}/ч ÷ {maxSlots}
          </div>
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'right' }}>
          <button
            onClick={(e) => { e.stopPropagation(); canJoin && onJoin?.(match); }}
            disabled={!canJoin}
            style={{
              padding: '10px 16px',
              background: canJoin
                ? isPrime
                  ? 'linear-gradient(135deg, #b7860a, #D4AF37)'
                  : 'linear-gradient(135deg, #1E3AE8, #3b82f6)'
                : 'rgba(100,116,139,0.12)',
              color:  canJoin ? '#fff' : '#475569',
              border: canJoin ? 'none' : '1px solid rgba(100,116,139,0.2)',
              borderRadius: '10px',
              fontSize: '13px', fontWeight: 700,
              cursor: canJoin ? 'pointer' : 'not-allowed',
              boxShadow: canJoin
                ? isPrime
                  ? '0 4px 14px rgba(212,175,55,0.3)'
                  : '0 4px 14px rgba(30,58,232,0.3)'
                : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {isFull ? 'Мест нет' : canJoin ? 'Присоединиться →' : 'Уровень не подходит'}
          </button>

          {/* Hint under button */}
          {!isFull && !levelMatch && (
            <div style={{ color: '#475569', fontSize: '10px', marginTop: '4px' }}>
              Ваш уровень: {RATINGS[playerRating]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
