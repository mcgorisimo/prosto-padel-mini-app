import React, { useState, useEffect } from 'react';
import PadelCard from './ui/PadelCard';
import PadelButton from './ui/PadelButton';
import { getTotalPrice, fmtPrice, isPrimeTime } from '../lib/pricing';

const RATINGS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
const T = {
  surface: 'rgba(255,255,255,0.045)',
  border:  'rgba(245,241,232,0.10)',
  accent:  '#D8F34A',
  accentL: '#D8F34A',
  text:    '#F5F1E8',
  muted:   'rgba(245,241,232,0.62)',
  bg:      '#050F0B',
};

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      {title && (
        <div style={{ fontSize: '10px', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px' }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function RatingRangeSlider({ minIdx, maxIdx, onChange }) {
  const max = RATINGS.length - 1;
  const pct = (i) => `${(i / max) * 100}%`;

  return (
    <Section title="Уровень игроков">
      <style>{`
        .rating-range { position:absolute; top:-7px; left:0; width:100%;
          -webkit-appearance:none; appearance:none; background:transparent; pointer-events:none; }
        .rating-range::-webkit-slider-thumb {
          -webkit-appearance:none; appearance:none;
          width:20px; height:20px; border-radius:50%;
          background:#F5F1E8; border:3px solid ${T.accent};
          pointer-events:all; cursor:pointer;
          box-shadow: 0 0 0 3px rgba(216,243,74,0.16);
        }
        .rating-range::-moz-range-thumb {
          width:20px; height:20px; border-radius:50%;
          background:#F5F1E8; border:3px solid ${T.accent};
          pointer-events:all; cursor:pointer;
        }
      `}</style>

      <div style={{ background: T.surface, borderRadius: '12px', padding: '16px', border: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', marginBottom: '12px' }}>
          {RATINGS.map((r, i) => (
            <span key={r} style={{ flex: 1, textAlign: 'center', fontSize: '12px', fontWeight: 600, color: i >= minIdx && i <= maxIdx ? T.accentL : T.border, transition: 'color 0.2s' }}>{r}</span>
          ))}
        </div>
        <div style={{ position: 'relative', height: '6px', borderRadius: '3px', background: T.border, margin: '0 0 20px' }}>
          <div style={{ position: 'absolute', left: pct(minIdx), right: `${100 - (maxIdx / max) * 100}%`, top: 0, bottom: 0, background: T.accent, borderRadius: '3px' }} />
          <input className="rating-range" type="range" min={0} max={max} value={minIdx}
            onChange={e => onChange(Math.min(Number(e.target.value), maxIdx - 1), maxIdx)}
            style={{ zIndex: maxIdx === max ? 5 : 3 }} />
          <input className="rating-range" type="range" min={0} max={max} value={maxIdx}
            onChange={e => onChange(minIdx, Math.max(Number(e.target.value), minIdx + 1))}
            style={{ zIndex: 4 }} />
        </div>
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <span style={{ color: T.text, fontWeight: 700, fontSize: '16px' }}>{RATINGS[minIdx]} — {RATINGS[maxIdx]}</span>
        </div>
      </div>
    </Section>
  );
}

const DURATION_OPTIONS = [
  { value: 1.0, label: '1 ч'   },
  { value: 1.5, label: '1.5 ч' },
  { value: 2.0, label: '2 ч'   },
  { value: 2.5, label: '2.5 ч' },
];

// ─── Collision check ─────────────────────────────────────────────────────────

const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };

/**
 * Checks whether a (courtId × dateISO × startTime × duration) interval collides
 * with any existing non-completed match on that court/day.
 * Returns true if available, false if blocked.
 */
export function checkAvailability(allMatches, courtId, dateISO, startTime, duration) {
  const startMin = toMin(startTime);
  const endMin   = startMin + duration * 60;
  for (const m of allMatches ?? []) {
    if (!m || m.status === 'completed') continue;
    if (m.courtId !== courtId || m.dateISO !== dateISO) continue;
    const mStart = toMin(m.time);
    const mEnd   = mStart + (m.duration ?? 0) * 60;
    if (startMin < mEnd && endMin > mStart) return false;
  }
  return true;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BookingModal({ slot, allMatches = [], onClose, onConfirm, showToast }) {
  const [duration,    setDuration]    = useState(1.5);
  const [bookingType, setBookingType] = useState('private'); // 'private' | 'public'
  const [ratingMin,   setRatingMin]   = useState(2); // C
  const [ratingMax,   setRatingMax]   = useState(5); // B+
  const [timeError,   setTimeError]   = useState('');
  const [description, setDescription] = useState('');

  const isPrivate = bookingType === 'private';

  if (!slot) return null;

  const total      = getTotalPrice(slot.time, duration, slot.court.type);
  const prepay     = total; // Always 100% payment
  const prime      = isPrimeTime(slot.time);

  // Per-option availability — drives disabled state on duration buttons.
  const availability = DURATION_OPTIONS.reduce((acc, d) => {
    acc[d.value] = checkAvailability(allMatches, slot.court.id, slot.dateISO, slot.time, d.value);
    return acc;
  }, {});

  useEffect(() => {
    if (!slot) return;
    const isToday = slot.dateISO === new Date().toISOString().slice(0, 10);
    if (!isToday) {
      setTimeError('');
      return;
    }
    const now = new Date();
    const validationTime = new Date(now.getTime() + 15 * 60 * 1000);
    const selectedDateTime = new Date(`${slot.dateISO}T${slot.time}:00`);

    if (selectedDateTime < validationTime) {
      setTimeError('Нельзя забронировать время в прошлом');
    } else {
      setTimeError('');
    }
  }, [slot]);

  // If the currently-selected duration just became unavailable
  // (e.g., user reopens modal after another booking), fall back silently.
  const selectedAvailable = availability[duration];

  const handleConfirm = () => {
    if (!selectedAvailable || timeError) return;
    onConfirm({
      court:         slot.court,
      time:          slot.time,
      dateISO:       slot.dateISO,
      duration,
      type:          isPrivate ? 'private' : 'match',
      isPrivate,
      ratingMin,
      ratingMax,
      description,
      paymentStatus: 'full', // Always full payment
      total,
      prepay,
    });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-3"
    >
      <PadelCard
        onClick={(e) => e.stopPropagation()}
        padding="lg"
        className="w-full max-w-md max-h-[92dvh] overflow-y-auto"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-white text-lg font-bold leading-tight">Бронирование</h2>
            <p className="text-slate-400 text-xs mt-1">
              {slot.court.name} · {slot.time}{prime && ' · Prime'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 text-2xl leading-none px-1 hover:text-slate-200"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* Court summary */}
        <div className="mb-4 rounded-2xl bg-white/[0.04] border border-warm-white/10 p-3">
          <div className="text-xs text-slate-400 mb-0.5">Тип корта</div>
          <div className="text-sm text-slate-100 font-medium">
            {slot.court.type === 'panoramic' ? 'Ультрапанорамный корт' : 'Сингл-корт'}
          </div>
        </div>

        {/* Duration */}
        <div className="mb-4">
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-2">
            Длительность
          </div>
          <div className="grid grid-cols-4 gap-2">
            {DURATION_OPTIONS.map((d) => {
              const active    = duration === d.value;
              const available = availability[d.value];
              return (
                <button
                  key={d.value}
                  onClick={() => available && setDuration(d.value)}
                  disabled={!available}
                  className={[
                    'py-2.5 rounded-lg text-sm font-medium transition-colors',
                    !available
                      ? 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed line-through'
                      : active
                        ? 'bg-accent-light text-app-bg'
                        : 'bg-white/[0.04] text-warm-white/70 border border-warm-white/10 hover:bg-white/[0.06]',
                  ].join(' ')}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {!selectedAvailable && (
            <div className="text-xs text-red-400 mt-2">
              Слот занят другим игроком — выберите другую длительность.
            </div>
          )}
        </div>

        {/* Booking Type Toggle */}
        <div className="grid grid-cols-2 gap-2 mb-4 p-1 bg-app-bg rounded-2xl border border-warm-white/10">
          {[
            { value: 'private', label: 'Просто бронь' },
            { value: 'public',  label: 'Создать матч' }
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setBookingType(opt.value)}
              className={`px-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                bookingType === opt.value
                  ? 'bg-accent-light text-app-bg'
                  : 'text-warm-white/60 hover:bg-white/[0.05]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Open match settings (level, description) */}
        {bookingType === 'public' && (
          <>
            <RatingRangeSlider
              minIdx={ratingMin}
              maxIdx={ratingMax}
              onChange={(min, max) => { setRatingMin(min); setRatingMax(max); }}
            />
            <Section title="Описание матча (необязательно)">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Например: играем в спокойном темпе, для удовольствия."
                rows={2}
                className="w-full bg-white/[0.04] text-warm-white placeholder-warm-white/35 rounded-2xl border border-warm-white/10 p-3 text-sm focus:ring-accent-light focus:border-accent-light"
              />
            </Section>
          </>
        )}

        {/* Price summary */}
        <div className="mb-4 rounded-2xl bg-app-bg/70 border border-accent-light/24 p-3">
          <div className="text-accent-light font-bold text-base mb-1">
            Стоимость брони: {fmtPrice(total)}
          </div>
          <div className="text-xs text-slate-300 leading-relaxed mt-2">
            Сейчас бронь подтверждается без онлайн-оплаты.
            Онлайн-оплата будет доступна позже.
          </div>
        </div>

        {timeError && (
          <div className="text-sm text-red-500 text-center mb-3">
            {timeError}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          <PadelButton variant="ghost" size="md" onClick={onClose}>
            Отмена
          </PadelButton>
          <PadelButton
            variant="yellow"
            size="md"
            fullWidth
            disabled={!selectedAvailable || !!timeError}
            onClick={handleConfirm}
          >
            {isPrivate ? 'Подтвердить бронь' : 'Создать матч'}
          </PadelButton>
        </div>
      </PadelCard>
    </div>
  );
}
