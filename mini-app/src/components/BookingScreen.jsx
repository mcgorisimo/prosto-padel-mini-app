import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Clock3, LockKeyhole, UsersRound, X } from 'lucide-react';
import { BOOKING_DURATIONS, COURTS, WORKING_HOURS, checkAvailability, fromMin } from '../lib/booking';
import { fmtPrice, getPerPlayerPrice, getTotalPrice } from '../lib/pricing';

const ANY_COURT = 'any';
const BOOKING_FORMATS = [
  {
    id: 'private',
    title: 'Частная бронь',
    description: 'Только ваша бронь. В ленте матчей не показывается.',
    Icon: LockKeyhole,
  },
  {
    id: 'public',
    title: 'Бронь + сбор игроков',
    description: 'Создаём матч с кортом. Игроки смогут присоединиться.',
    Icon: UsersRound,
  },
];

const MATCH_TYPE_OPTIONS = [
  { id: 'casual', title: 'Обычный матч' },
  { id: 'rating', title: 'Рейтинговый матч' },
];

const TIME_SECTIONS = [
  { id: 'morning', title: 'Утро', from: 7 * 60, to: 12 * 60 },
  { id: 'day', title: 'День', from: 12 * 60, to: 17 * 60 },
  { id: 'evening', title: 'Вечер', from: 17 * 60, to: 24 * 60 },
];

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function toLocalISO(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
}

function buildDates(days = 14) {
  const today = new Date();

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);

    return {
      date,
      dateISO: toLocalISO(date),
      eyebrow: index === 0 ? 'Сегодня' : index === 1 ? 'Завтра' : WEEKDAYS_SHORT[date.getDay()],
      label: `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`,
    };
  });
}

function buildTimes() {
  const out = [];
  const start = WORKING_HOURS.startHour * 60;
  const end = WORKING_HOURS.endHour * 60;

  for (let minute = start; minute < end; minute += WORKING_HOURS.slotStepMinutes) {
    out.push({ time: fromMin(minute), minute });
  }

  return out;
}

function isPastSlot(dateISO, time) {
  const now = new Date();
  const slotDate = new Date(`${dateISO}T${time}:00`);
  return slotDate < new Date(now.getTime() + 15 * 60 * 1000);
}

function formatDuration(duration) {
  return `${duration.toString().replace('.', ',')} ч`;
}

function getSlotLabel(state) {
  if (state === 'selected') return 'Выбрано';
  if (state === 'free') return 'Свободно';
  if (state === 'outside') return 'Вне времени';
  if (state === 'past') return 'Прошло';
  return 'Занято';
}

export default function BookingScreen({ allMatches = [], onBookSlot, showToast, isRatingVerified = true }) {
  const dates = useMemo(() => buildDates(14), []);
  const times = useMemo(buildTimes, []);
  const [selectedDateISO, setSelectedDateISO] = useState(dates[0]?.dateISO);
  const [duration, setDuration] = useState(1.5);
  const [courtId, setCourtId] = useState(ANY_COURT);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [bookingFormat, setBookingFormat] = useState('private');
  const [matchType, setMatchType] = useState('casual');
  const [isSaving, setIsSaving] = useState(false);
  const [successText, setSuccessText] = useState('');
  const isSavingRef = useRef(false);

  const selectedDate = dates.find((item) => item.dateISO === selectedDateISO) ?? dates[0];
  const selectedCourt = selectedSlot?.court ?? COURTS.find((court) => court.id === courtId);
  const isPublicFormat = bookingFormat === 'public';
  const isRatingMatchBlocked = isPublicFormat && matchType === 'rating' && !isRatingVerified;

  const getAvailableCourt = (time) => {
    const candidates = courtId === ANY_COURT
      ? COURTS
      : COURTS.filter((court) => court.id === courtId);

    return candidates.find((court) =>
      checkAvailability(allMatches, court.id, selectedDateISO, time, duration)
    );
  };

  const getSlotState = (time, minute) => {
    const endMinute = minute + duration * 60;
    const isSelected = selectedSlot?.time === time && selectedSlot?.dateISO === selectedDateISO;

    if (endMinute > WORKING_HOURS.endHour * 60) {
      return { state: isSelected ? 'outside' : 'outside', court: null };
    }

    if (isPastSlot(selectedDateISO, time)) {
      return { state: isSelected ? 'past' : 'past', court: null };
    }

    const court = getAvailableCourt(time);
    if (!court) {
      return { state: isSelected ? 'unavailable' : 'unavailable', court: null };
    }

    return { state: isSelected ? 'selected' : 'free', court };
  };

  const sectionedSlots = TIME_SECTIONS.map((section) => ({
    ...section,
    slots: times.filter(({ minute }) => minute >= section.from && minute < section.to),
  }));

  useEffect(() => {
    if (!selectedSlot) return;
    const minute = Number(selectedSlot.time.split(':')[0]) * 60 + Number(selectedSlot.time.split(':')[1]);
    const next = getSlotState(selectedSlot.time, minute);
    if (next.state !== 'selected') {
      setSelectedSlot(null);
    } else if (next.court?.id && next.court.id !== selectedSlot.court?.id) {
      setSelectedSlot((prev) => prev ? { ...prev, court: next.court } : prev);
    }
  }, [selectedDateISO, duration, courtId, allMatches]);

  useEffect(() => {
    document.body.classList.toggle('booking-sheet-open', Boolean(selectedSlot));

    return () => {
      document.body.classList.remove('booking-sheet-open');
    };
  }, [selectedSlot]);

  const totalPrice = selectedSlot
    ? getTotalPrice(selectedSlot.time, duration, selectedSlot.court.type, selectedDateISO)
    : 0;
  const perPlayerPrice = selectedSlot
    ? getPerPlayerPrice(selectedSlot.time, duration, selectedSlot.court.type, selectedDateISO)
    : 0;

  const handleSelectSlot = (time, minute) => {
    const slot = getSlotState(time, minute);
    if (slot.state !== 'free' && slot.state !== 'selected') return;

    setSuccessText('');
    setSelectedSlot({
      dateISO: selectedDateISO,
      time,
      court: slot.court,
    });
  };

  const handleCloseConfirm = () => {
    if (isSavingRef.current) return;
    setSelectedSlot(null);
  };

  const handleConfirm = async () => {
    if (!selectedSlot || isSavingRef.current || isRatingMatchBlocked) return;

    const isRatingBookingMatch = isPublicFormat && matchType === 'rating';

    isSavingRef.current = true;
    setIsSaving(true);
    try {
      await onBookSlot?.({
        court: selectedSlot.court,
        time: selectedSlot.time,
        dateISO: selectedDateISO,
        duration,
        type: isPublicFormat ? 'match' : 'private',
        isPrivate: !isPublicFormat,
        scenario: isPublicFormat ? 'social' : 'private',
        paymentStatus: isPublicFormat ? 'partial' : 'full',
        isRatingMatch: isRatingBookingMatch,
        is_rating_match: isRatingBookingMatch,
        ratingMin: 0,
        ratingMax: 6,
        description: isPublicFormat
          ? 'Бронь корта с открытым сбором игроков'
          : 'Частная бронь корта',
        total: totalPrice,
        pricePerPerson: perPlayerPrice,
      });

      const message = 'Бронь создана. Оплата сейчас подтверждается через администратора клуба.';
      setSuccessText(message);
      showToast?.(message, 'success');
      setSelectedSlot(null);
    } catch (error) {
      console.error(error);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <div className="booking-screen min-h-screen bg-app-bg px-4 text-warm-white">
      <header className="booking-hero">
        <div className="booking-hero-icon flex items-center justify-center text-coral">
          <CalendarDays size={20} />
        </div>
        <h1 className="booking-title text-[30px] font-black leading-tight">Бронирование корта</h1>
        <p className="booking-subtitle text-sm leading-relaxed text-warm-white/58">
          Выберите удобное время, длительность и формат брони.
        </p>
      </header>

      <section className="booking-section booking-section-dates">
        <div className="booking-section-label">
          Дата
        </div>
        <div className="booking-horizontal-scroll booking-date-strip" style={{ scrollbarWidth: 'none' }}>
          {dates.map((item) => {
            const active = item.dateISO === selectedDateISO;
            return (
              <button
                key={item.dateISO}
                type="button"
                onClick={() => {
                  setSelectedDateISO(item.dateISO);
                  setSelectedSlot(null);
                  setSuccessText('');
                }}
                className={[
                  'booking-date-card min-w-[86px] text-left',
                  active
                    ? 'is-active text-warm-white'
                    : 'text-warm-white/70',
                ].join(' ')}
              >
                <div className="text-[11px] font-extrabold uppercase tracking-[0.08em]">{item.eyebrow}</div>
                <div className="mt-1 text-lg font-black">{item.label}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="booking-section booking-control-panel">
        <div className="booking-section-label">
          Длительность
        </div>
        <div className="booking-duration-control grid grid-cols-4">
          {BOOKING_DURATIONS.map((item) => {
            const active = duration === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setDuration(item);
                  setSuccessText('');
                }}
                className={[
                  'booking-duration-option px-2 text-sm font-extrabold',
                  active ? 'is-active text-app-bg' : 'text-warm-white/62',
                ].join(' ')}
              >
                {formatDuration(item)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="booking-section booking-control-panel">
        <div className="booking-section-label">
          Корт
        </div>
        <div className="booking-court-strip flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {[{ id: ANY_COURT, name: 'Любой свободный' }, ...COURTS].map((court) => {
            const active = courtId === court.id;
            return (
              <button
                key={court.id}
                type="button"
                onClick={() => {
                  setCourtId(court.id);
                  setSelectedSlot(null);
                  setSuccessText('');
                }}
                className={[
                  'booking-court-chip shrink-0 px-4 text-sm font-bold',
                  active
                    ? 'is-active text-accent-light'
                    : 'text-warm-white/64',
                ].join(' ')}
              >
                {court.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="booking-times">
        {sectionedSlots.map((section) => (
          <div key={section.id} className="booking-time-section">
            <div className="booking-time-heading flex items-center justify-between">
              <h2 className="text-base font-black">{section.title}</h2>
              <span className="text-[11px] text-warm-white/34">шаг 30 минут</span>
            </div>
            <div className="booking-time-grid grid grid-cols-3">
              {section.slots.map(({ time, minute }) => {
                const { state } = getSlotState(time, minute);
                const disabled = state !== 'free' && state !== 'selected';
                return (
                  <button
                    key={time}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectSlot(time, minute)}
                    className={[
                      'booking-time-slot min-h-[70px] px-3 text-left',
                      state === 'selected'
                        ? 'is-selected text-warm-white'
                        : state === 'free'
                          ? 'is-free text-warm-white'
                          : `is-disabled is-${state} text-warm-white/28`,
                    ].join(' ')}
                  >
                    <div className="booking-slot-time flex items-center gap-1.5 text-base font-black tabular-nums">
                      <Clock3 className="booking-slot-icon" size={13} />
                      {time}
                    </div>
                    <div className="booking-slot-status mt-1 text-[10px] font-semibold">{getSlotLabel(state)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {selectedSlot && (
        <div className="booking-sheet-overlay" role="presentation" onClick={handleCloseConfirm}>
          <div
            className="booking-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение брони"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="booking-sheet-header">
              <div className="booking-sheet-grabber" aria-hidden="true" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-warm-white/42">
                    Подтверждение
                  </div>
                  <h2 className="text-xl font-black">
                    {selectedDate?.eyebrow}, {selectedDate?.label}
                  </h2>
                  <p className="mt-1 text-sm text-warm-white/60">
                    {selectedSlot.time} · {formatDuration(duration)} · {selectedCourt?.name}
                  </p>
                </div>
                <button
                  type="button"
                  className="booking-sheet-close"
                  aria-label="Закрыть подтверждение"
                  disabled={isSaving}
                  onClick={handleCloseConfirm}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="booking-sheet-body">
              <div className="mb-4 grid grid-cols-2 gap-2">
                <div className="booking-price-tile p-3">
                  <div className="text-xs text-warm-white/46">Цена за корт</div>
                  <div data-testid="booking-total-price" className="mt-1 text-lg font-black">{fmtPrice(totalPrice)}</div>
                </div>
                <div className="booking-price-tile p-3">
                  <div className="text-xs text-warm-white/46">На игрока при 4</div>
                  <div data-testid="booking-per-player-price" className="mt-1 text-lg font-black">{fmtPrice(perPlayerPrice)}</div>
                </div>
              </div>

              <div className="mb-4 grid gap-2">
                {BOOKING_FORMATS.map((format) => {
                  const active = bookingFormat === format.id;
                  const Icon = format.Icon;
                  return (
                    <button
                      key={format.id}
                      type="button"
                      onClick={() => {
                        setBookingFormat(format.id);
                        if (format.id === 'private') setMatchType('casual');
                      }}
                      className={[
                        'booking-format-option flex items-start gap-3 p-3 text-left',
                        active
                          ? 'is-active'
                          : '',
                      ].join(' ')}
                    >
                      <span className={[
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        active ? 'bg-accent-light text-app-bg' : 'bg-white/[0.06] text-warm-white/60',
                      ].join(' ')}>
                        <Icon size={18} />
                      </span>
                      <span>
                        <span className="block text-sm font-black">{format.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-warm-white/52">
                          {format.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {isPublicFormat && (
                <div className="booking-match-type mb-4">
                  <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-warm-white/42">
                    Тип матча
                  </div>
                  <div className="booking-match-type-control">
                    {MATCH_TYPE_OPTIONS.map((option) => {
                      const active = matchType === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setMatchType(option.id)}
                          className={['booking-match-type-option', active ? 'is-active' : ''].join(' ')}
                        >
                          {option.title}
                        </button>
                      );
                    })}
                  </div>
                  {matchType === 'rating' && (
                    <>
                      <p className="mt-2 text-xs leading-relaxed text-warm-white/52">
                        Рейтинг изменится после подтверждения счёта.
                      </p>
                      {isRatingMatchBlocked && (
                        <p className="mt-2 text-xs font-semibold leading-relaxed text-coral">
                          Для рейтингового матча нужен подтверждённый рейтинг.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <p className="text-xs leading-relaxed text-warm-white/52">
                Бронь создаётся без онлайн-оплаты. Администратор клуба подтвердит оплату отдельно.
              </p>
            </div>

            <div className="booking-sheet-footer">
              <button
                type="button"
                disabled={isSaving || isRatingMatchBlocked}
                onClick={handleConfirm}
                className="booking-confirm-cta"
              >
                {isSaving ? 'Сохраняем...' : isPublicFormat ? 'Создать матч' : 'Создать бронь'}
              </button>
            </div>
          </div>
        </div>
      )}

      {successText && (
        <div className="booking-success p-4 text-sm font-semibold leading-relaxed text-accent-light">
          {successText}
        </div>
      )}
    </div>
  );
}
