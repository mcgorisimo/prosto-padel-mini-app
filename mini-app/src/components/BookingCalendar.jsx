import React, { useState, useMemo } from 'react';
import BookingModal from './BookingModal';
import { COURTS, HOURS, toMin, fromMin, generateDates } from '../lib/booking';
import { RATING_CONFIG } from '../lib/ratingEngine';

// ─── Static configuration ────────────────────────────────────────────────────
const RATINGS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];

// ─── Time helpers ────────────────────────────────────────────────────────────

// ─── Schedule derivation ─────────────────────────────────────────────────────
// Build a { [time]: { [courtId]: {status, matchId} } } map from real matches.

function buildSchedule(allMatches, dateISO, userId) {
  const slots = {};
  const isToday = dateISO === new Date().toISOString().slice(0, 10);
  const validationTime = isToday ? new Date(new Date().getTime() + 15 * 60 * 1000) : null;

  HOURS.forEach((t) => {
    slots[t] = {};
    COURTS.forEach((c) => {
      let initialStatus = 'available';
      if (validationTime) {
        const slotDateTime = new Date(`${dateISO}T${t}:00`);
        if (slotDateTime < validationTime) {
          initialStatus = 'booked';
        }
      }
      slots[t][c.id] = { status: initialStatus, matchId: null };
    });
  });

  for (const m of allMatches ?? []) {
    if (!m || m.status === 'completed') continue;
    if (m.dateISO !== dateISO) continue;
    if (!m.courtId || !slots[HOURS[0]]?.[m.courtId]) continue;

    const startMin = toMin(m.time);
    const durationCells = Math.round((m.duration ?? 0) * 2); // 30-min units
    
    let status;
    if (m.owner_id === userId) {
      status = 'my_booking';
    } else if (m.isPrivate) {
      status = 'booked';
    } else {
      status = 'match';
    }

    // Mark all cells of the booking
    for (let i = 0; i < durationCells; i++) {
      const t = fromMin(startMin + i * 30);
      if (!slots[t] || !slots[t][m.courtId]) continue;
      slots[t][m.courtId] = { status, matchId: m.id, isStart: false, matchData: m };
    }

    // Mark the first cell specifically so we can render one block
    const startTime = fromMin(startMin);
    if (slots[startTime]?.[m.courtId]) {
      slots[startTime][m.courtId].isStart = true;
      slots[startTime][m.courtId].durationCells = durationCells;
    }
  }
  return slots;
}

// ─── Slot styling ────────────────────────────────────────────────────────────

const SLOT_BASE =
  'w-full h-full p-2 border-r border-b border-warm-white/10 flex items-center justify-center text-xs transition-colors ';

const slotClassFor = (status, isPrime) => {
  switch (status) {
    case 'available':
      return SLOT_BASE + 'cursor-pointer ' +
        (isPrime ? 'bg-accent-light/5 hover:bg-accent-light/10' : 'bg-transparent hover:bg-white/[0.045]');
    case 'booked':
      return SLOT_BASE + 'bg-white/[0.05] opacity-45 cursor-not-allowed';
    case 'match':
      return SLOT_BASE + 'cursor-pointer bg-accent-light/10 text-accent-light font-medium hover:bg-accent-light/15';
    case 'my_booking':
      return SLOT_BASE +
        'cursor-pointer bg-coral/10 text-warm-white font-semibold ' +
        'border-coral/45 ring-1 ring-coral/30 hover:bg-coral/15';
    case 'maintenance':
      return SLOT_BASE + 'bg-maintenance text-red-300/70 cursor-not-allowed';
    default:
      return SLOT_BASE;
  }
};

const slotContentFor = (status) => {
  switch (status) {
    case 'available':   return <span className="text-warm-white/30">+</span>;
    case 'booked':      return <span className="text-warm-white/36">Занято</span>;
    case 'match':       return <span className="text-[10px] leading-tight text-center">Открытая игра</span>;
    case 'my_booking':  return <span className="text-[10px] leading-tight text-center">Моя игра</span>;
    case 'maintenance': return <span>ТО</span>;
    default:            return null;
  }
};

// ─── Main component ──────────────────────────────────────────────────────────

export default function BookingCalendar({ allMatches = [], userId, userRating, onOpenMatch, onBookSlot, showToast }) {
  const [selectedDate, setSelectedDate] = useState(generateDates()[0]);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const dateISO  = selectedDate.dateISO;
  const schedule = useMemo(
    () => buildSchedule(allMatches, dateISO, userId),
    [allMatches, dateISO, userId]
  );

  const handleSlotClick = (slot, court, time) => {
    const match = slot.matchData;

    if (slot.status === 'available') {
      setSelectedSlot({ court, time, dateISO });
      return;
    }

    if (!match) return;

    if (match.owner_id === userId) { // My match
      onOpenMatch?.(match.id);
    } else if (match.isPrivate) { // Other's private
      showToast?.('Этот корт занят для приватной игры', 'info');
    } else { // Other's public
      const minRatingValue = RATING_CONFIG.levels[match.ratingMin]?.min ?? 0;
      const maxRatingValue = RATING_CONFIG.levels[match.ratingMax]?.max ?? 10;
      const levelOk = userRating >= minRatingValue && userRating <= maxRatingValue;

      if (levelOk) {
        onOpenMatch?.(match.id);
      } else {
        showToast?.(`Ваш рейтинг (${userRating.toFixed(1)}) не подходит для матча (${RATINGS[match.ratingMin]}-${RATINGS[match.ratingMax]})`, 'error');
      }
    }
  };

  const handleBookConfirm = (booking) => {
    onBookSlot?.(booking);
    setSelectedSlot(null);
  };

  return (
    <div className="flex flex-col h-full bg-app-bg text-warm-white">
      {/* Header & Day Selector */}
      <div className="p-4 border-b border-warm-white/10 shrink-0">
        <h2 className="text-2xl font-black mb-3">Бронирование</h2>
        <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="flex gap-2 pb-2">
            {generateDates().map((day) => {
              const isActive = day.dateISO === selectedDate.dateISO;
              return (
                <button
                  key={day.dateISO}
                  onClick={() => setSelectedDate(day)}
                  style={{
                    flexShrink: 0,
                    padding: '8px 12px',
                    borderRadius: '10px',
                    border: isActive ? '1px solid rgba(216,243,74,0.36)' : '1px solid rgba(245,241,232,0.10)',
                    background: isActive ? 'rgba(216,243,74,0.14)' : 'rgba(255,255,255,0.045)',
                    color: isActive ? '#D8F34A' : 'rgba(245,241,232,0.62)',
                    fontSize: '13px',
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    lineHeight: 1.2,
                    textAlign: 'center',
                  }}
                >
                  <div className="uppercase">{day.dayOfWeek.replace('.', '')}</div>
                  <div className="text-base font-bold mt-0.5">{day.dayOfMonth}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div
          className="grid relative"
          style={{
            gridTemplateColumns: `4rem repeat(${COURTS.length}, 6rem)`, // w-16, w-24
            gridTemplateRows: `auto repeat(${HOURS.length}, 3rem)`, // h-12
            minWidth: '100%',
          }}
        >
          {/* Top Sticky Header (Time + Courts) */}
          <div className="w-16 shrink-0 sticky top-0 left-0 z-30 bg-surface border-r border-b border-warm-white/10 p-2 flex items-center justify-center text-xs font-medium text-warm-white/42" style={{ gridColumn: 1, gridRow: 1 }}>
            Время
          </div>
          {COURTS.map((court, i) => (
            <div key={court.id} className="w-24 shrink-0 sticky top-0 z-20 bg-surface border-b border-warm-white/10 p-2 flex flex-col items-center justify-center border-r border-warm-white/10" style={{ gridColumn: i + 2, gridRow: 1 }}>
              <span className="text-sm font-medium">{court.name}</span>
              <span className="text-[10px] text-warm-white/42 uppercase">
                {court.type === 'panoramic' ? '(P)' : '(S)'}
              </span>
            </div>
          ))}

          {/* Time Gutter Column */}
          {HOURS.map((hour, i) => {
            const hourNum = parseInt(hour.split(':')[0], 10);
            const isPrime = hourNum >= 17;
            const isHalfHour = hour.endsWith(':30');
            return (
              <div key={hour} className={`w-16 shrink-0 sticky left-0 z-10 border-r border-b border-warm-white/10 flex flex-col items-center justify-center text-xs font-medium ${
                  isPrime ? 'bg-accent-light/5 text-accent-light' : 'bg-app-bg text-warm-white/56'
                } ${isHalfHour ? 'opacity-70' : ''}`} style={{ gridColumn: 1, gridRow: i + 2 }}>
                <span>{hour}</span>
                {isPrime && !isHalfHour && <span className="text-[8px] text-accent-light/80">Prime</span>}
              </div>
            );
          })}

          {/* All Slots */}
          {HOURS.map((hour, hourIndex) =>
            COURTS.map((court, courtIndex) => {
              const slot = schedule[hour][court.id];
              if (slot.status !== 'available' && !slot.isStart) return null; // Render nothing if it's a covered slot

              const isPrime = parseInt(hour.split(':')[0], 10) >= 17;
              const style = slot.isStart ? { gridRow: `span ${slot.durationCells}`, zIndex: 10 } : {};

              return (
                <div key={`${hour}-${court.id}`} className="w-24 shrink-0" style={{ gridColumn: courtIndex + 2, gridRow: hourIndex + 2, ...style }}>
                  <div onClick={() => handleSlotClick(slot, court, hour)} className={slotClassFor(slot.status, isPrime)}>
                    {slotContentFor(slot.status)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {selectedSlot && (
        <BookingModal
          slot={selectedSlot}
          allMatches={allMatches}
          onClose={() => setSelectedSlot(null)}
          onConfirm={handleBookConfirm}
        />
      )}
    </div>
  );
}
