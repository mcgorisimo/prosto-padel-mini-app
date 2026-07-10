import React, { useMemo, useState } from 'react';
import BookingModal from './BookingModal';
import { COURTS, HOURS, toMin, fromMin, generateDates } from '../lib/booking';
import { isPrimeTime } from '../lib/pricing';

const isPublicMatch = (match) =>
  match?.type === 'match' && match?.isPrivate === false;

const getFilledCount = (match) =>
  Array.isArray(match?.filledSlots) ? match.filledSlots.filter(Boolean).length : 0;

function getSlotStatus(match, userId) {
  const isParticipant = Array.isArray(match.participants) && match.participants.includes(userId);
  const isOwner = match.owner_id === userId || match.ownerId === userId;

  if (match.isTraining) return 'training';
  if (isParticipant || isOwner) return isPublicMatch(match) ? 'my_game' : 'my_booking';
  if (match.isPrivate || !isPublicMatch(match)) return 'booked';
  return 'match';
}

function buildSchedule(allMatches, dateISO, userId) {
  const slots = {};
  const isToday = dateISO === new Date().toISOString().slice(0, 10);
  const validationTime = isToday ? new Date(Date.now() + 15 * 60 * 1000) : null;

  HOURS.forEach((time) => {
    slots[time] = {};
    COURTS.forEach((court) => {
      let initialStatus = 'available';
      if (validationTime) {
        const slotDateTime = new Date(`${dateISO}T${time}:00`);
        if (slotDateTime < validationTime) initialStatus = 'booked';
      }
      slots[time][court.id] = { status: initialStatus, matchId: null };
    });
  });

  for (const match of allMatches ?? []) {
    if (!match || match.status === 'completed') continue;
    if (match.dateISO !== dateISO) continue;
    if (!match.courtId || !slots[HOURS[0]]?.[match.courtId]) continue;

    const startMin = toMin(match.time);
    const durationCells = Math.max(1, Math.round((match.duration ?? 0.5) * 2));
    const status = getSlotStatus(match, userId);

    for (let i = 0; i < durationCells; i++) {
      const time = fromMin(startMin + i * 30);
      if (!slots[time]?.[match.courtId]) continue;
      slots[time][match.courtId] = {
        status,
        matchId: match.id,
        isStart: false,
        matchData: match,
      };
    }

    const startTime = fromMin(startMin);
    if (slots[startTime]?.[match.courtId]) {
      slots[startTime][match.courtId].isStart = true;
      slots[startTime][match.courtId].durationCells = durationCells;
    }
  }

  return slots;
}

const SLOT_BASE =
  'w-full h-full p-2 border-r border-b border-warm-white/10 flex items-center justify-center text-xs transition-colors ';

const slotClassFor = (status, isPrime) => {
  switch (status) {
    case 'available':
      return SLOT_BASE + 'cursor-pointer ' +
        (isPrime ? 'bg-accent-light/5 hover:bg-accent-light/10' : 'bg-transparent hover:bg-white/[0.045]');
    case 'booked':
      return SLOT_BASE + 'bg-white/[0.05] opacity-45 cursor-not-allowed';
    case 'training':
      return SLOT_BASE + 'bg-white/[0.06] text-warm-white/44 cursor-not-allowed';
    case 'match':
      return SLOT_BASE + 'cursor-pointer bg-accent-light/10 text-accent-light font-medium hover:bg-accent-light/15';
    case 'my_game':
      return SLOT_BASE +
        'cursor-pointer bg-accent-light/15 text-accent-light font-semibold ' +
        'border-accent-light/45 ring-1 ring-accent-light/30 hover:bg-accent-light/20';
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

const slotContentFor = (slot) => {
  switch (slot.status) {
    case 'available':
      return <span className="text-warm-white/30">+</span>;
    case 'booked':
      return <span className="text-warm-white/36">Занято</span>;
    case 'training':
      return <span className="text-[10px] leading-tight text-center">Тренировка</span>;
    case 'match': {
      const count = getFilledCount(slot.matchData);
      return <span className="text-[10px] leading-tight text-center">{count > 0 ? `Матч ${count}/4` : 'Идёт набор'}</span>;
    }
    case 'my_game':
      return <span className="text-[10px] leading-tight text-center">Моя игра</span>;
    case 'my_booking':
      return <span className="text-[10px] leading-tight text-center">Моя бронь</span>;
    case 'maintenance':
      return <span>ТО</span>;
    default:
      return null;
  }
};

export default function BookingCalendar({ allMatches = [], userId, onOpenMatch, onBookSlot, showToast }) {
  const [selectedDate, setSelectedDate] = useState(generateDates()[0]);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const dateISO = selectedDate.dateISO;
  const gridWidth = `calc(4rem + ${COURTS.length} * 6rem)`;
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

    if (slot.status === 'match' || slot.status === 'my_game') {
      onOpenMatch?.(match.id);
      return;
    }

    if (match.owner_id === userId || match.ownerId === userId) {
      onOpenMatch?.(match.id);
      return;
    }

    showToast?.('Этот слот занят', 'info');
  };

  const handleBookConfirm = async (booking) => {
    try {
      await onBookSlot?.(booking);
      setSelectedSlot(null);
    } catch {
      showToast?.('Бронь не сохранена. Попробуйте еще раз.', 'error');
    }
  };

  return (
    <div className="flex flex-col h-full bg-app-bg text-warm-white">
      <style>{`
        .court-grid-scroll {
          overflow-x: auto !important;
          overflow-y: auto !important;
          scrollbar-width: thin;
          scrollbar-color: rgba(216,243,74,0.42) rgba(255,255,255,0.06);
          -webkit-overflow-scrolling: touch;
        }
        .court-grid-scroll::-webkit-scrollbar {
          height: 8px;
          width: 8px;
        }
        .court-grid-scroll::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.06);
          border-radius: 999px;
        }
        .court-grid-scroll::-webkit-scrollbar-thumb {
          background: rgba(216,243,74,0.42);
          border-radius: 999px;
        }
      `}</style>
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

      <div className="px-4 py-2 shrink-0 border-b border-warm-white/10">
        <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-warm-white/42">
          <span>Корты</span>
          <span className="text-accent-light/80">Свайп 1-8</span>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-40 w-8 bg-gradient-to-l from-app-bg to-transparent" />
        <div
          className="court-grid-scroll h-full"
          style={{
            touchAction: 'pan-x pan-y',
            overscrollBehaviorX: 'contain',
            scrollSnapType: 'x proximity',
            scrollPaddingLeft: '4rem',
          }}
        >
        <div
          className="grid relative"
          style={{
            gridTemplateColumns: `4rem repeat(${COURTS.length}, 6rem)`,
            gridTemplateRows: `auto repeat(${HOURS.length}, 3rem)`,
            width: gridWidth,
            minWidth: gridWidth,
          }}
        >
          <div className="w-16 shrink-0 sticky top-0 left-0 z-30 bg-surface border-r border-b border-warm-white/10 p-2 flex items-center justify-center text-xs font-medium text-warm-white/42 shadow-[8px_0_16px_rgba(5,15,11,0.32)]" style={{ gridColumn: 1, gridRow: 1 }}>
            Время
          </div>

          {COURTS.map((court, index) => (
            <div key={court.id} className="w-24 shrink-0 sticky top-0 z-20 bg-surface border-b border-warm-white/10 p-2 flex flex-col items-center justify-center border-r border-warm-white/10" style={{ gridColumn: index + 2, gridRow: 1, scrollSnapAlign: 'start' }}>
              <span className="text-sm font-medium">{court.name}</span>
              <span className="text-[10px] text-warm-white/42 uppercase">(P)</span>
            </div>
          ))}

          {HOURS.map((hour, index) => {
            const isPrime = isPrimeTime(hour, dateISO);
            const isHalfHour = hour.endsWith(':30');
            return (
              <div
                key={hour}
                className={`w-16 shrink-0 sticky left-0 z-10 border-r border-b border-warm-white/10 flex flex-col items-center justify-center text-xs font-medium ${
                  isPrime ? 'bg-accent-light/5 text-accent-light' : 'bg-app-bg text-warm-white/56'
                } ${isHalfHour ? 'opacity-70' : ''}`}
                style={{ gridColumn: 1, gridRow: index + 2, boxShadow: '8px 0 16px rgba(5,15,11,0.24)' }}
              >
                <span>{hour}</span>
                {isPrime && !isHalfHour && <span className="text-[8px] text-accent-light/80">Тариф</span>}
              </div>
            );
          })}

          {HOURS.map((hour, hourIndex) =>
            COURTS.map((court, courtIndex) => {
              const slot = schedule[hour][court.id];
              if (slot.status !== 'available' && !slot.isStart) return null;

              const isPrime = isPrimeTime(hour, dateISO);
              const style = slot.isStart ? { gridRow: `span ${slot.durationCells}`, zIndex: 10 } : {};

              return (
                <div key={`${hour}-${court.id}`} className="w-24 shrink-0" style={{ gridColumn: courtIndex + 2, gridRow: hourIndex + 2, scrollSnapAlign: 'start', ...style }}>
                  <div onClick={() => handleSlotClick(slot, court, hour)} className={slotClassFor(slot.status, isPrime)}>
                    {slotContentFor(slot)}
                  </div>
                </div>
              );
            })
          )}
        </div>
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
