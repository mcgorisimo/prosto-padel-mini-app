import React, { useState, useEffect, useRef } from 'react';
import { COURTS, HOURS, WORKING_HOURS, checkAvailability } from '../lib/booking';
import { getTotalPrice, isPrimeTime, fmtPrice as fmtPriceLib } from '../lib/pricing';

// ─── Constants ────────────────────────────────────────────────────────────────

const RATINGS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];

const START_HOUR = WORKING_HOURS.startHour;
const END_HOUR   = WORKING_HOURS.endHour;

const TIME_SLOTS = HOURS;

const isPrime = (time, dateISO) => isPrimeTime(time, dateISO);

const toMin = (time) => {
  let [h, m] = (time || '0:0').split(':').map(Number);
  if (h < START_HOUR) h += 24;
  return h * 60 + m;
};

const courtTotal = (time, dur, ct, dateISO) =>
  getTotalPrice(time, dur, ct, dateISO);

const maxDuration = (time) => {
  let [h, m] = time.split(':').map(Number);
  if (h < START_HOUR) h += 24;
  const remaining = (END_HOUR * 60 - (h * 60 + m)) / 60;
  return Math.max(0.5, Math.floor(remaining * 2) / 2);
};

const generateDates = () => {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    dates.push({
      dateObj: date,
      dayOfWeek: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
      dayOfMonth: date.getDate(),
      dateISO: date.toISOString().slice(0, 10), // For internal use
    });
  }
  return dates;
};

const fmtPrice = fmtPriceLib;

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  bg:      '#050F0B',
  surface: 'rgba(255,255,255,0.045)',
  border:  'rgba(245,241,232,0.10)',
  accent:  '#D8F34A',
  accentL: '#D8F34A',
  text:    '#F5F1E8',
  muted:   'rgba(245,241,232,0.62)',
  gold:    '#FF6F61',
  win:     '#D8F34A',
};

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '16px', background: 'rgba(255,255,255,0.035)', border: `1px solid ${T.border}`, borderRadius: '20px', padding: '14px' }}>
      {title && (
        <div style={{ fontSize: '11px', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px' }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Scenario Selector (Step 0) ───────────────────────────────────────────────

const SCENARIO_DEFS = [
  {
    id: 'community',
    mark: '01',
    title: 'Только сбор игроков',
    badge: 'Community Search',
    desc: 'Матч создается в ленте без бронирования корта. Онлайн-оплата будет доступна позже.',
    pros: ['Договоритесь о корте сами'],
    warn: 'Бронь корта сейчас подтверждается вне приложения',
    color: T.muted,
    bg: 'rgba(255,255,255,0.045)',
    border: 'rgba(245,241,232,0.10)',
  },
  {
    id: 'social',
    mark: '02',
    title: 'Бронь + Сбор',
    badge: 'Confirmed & Reserved',
    desc: 'Организатор выбирает время. Сейчас бронь подтверждается без онлайн-оплаты.',
    pros: ['Корт гарантирован за вами'],
    warn: 'Онлайн-оплата будет доступна позже',
    color: T.gold,
    bg: 'rgba(216,243,74,0.08)',
    border: 'rgba(216,243,74,0.22)',
  },
];

function ScenarioSelector({ onSelect }) {
  return (
    <div style={{ padding: '0 16px' }}>
      <div style={{ color: T.muted, fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
        Выберите способ организации игры
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {SCENARIO_DEFS.map(({ id, mark, title, badge, desc, pros, warn, color, bg, border }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: bg, borderRadius: '16px', border: `1px solid ${border}`, padding: '20px', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <span style={{ color, fontSize: '12px', fontWeight: 900, letterSpacing: '0.12em', lineHeight: 1 }}>{mark}</span>
              <div>
                <div style={{ color: T.text, fontWeight: 700, fontSize: '16px' }}>{title}</div>
                <div style={{ color, fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', marginTop: '2px' }}>{badge}</div>
              </div>
            </div>
            <div style={{ color: T.muted, fontSize: '12px', lineHeight: 1.6, marginBottom: '12px' }}>{desc}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {pros.map(text => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: T.win, fontSize: '12px' }}>✓</span>
                  <span style={{ color: T.muted, fontSize: '12px' }}>{text}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                <span style={{ color: id === 'community' ? T.muted : T.gold, fontSize: '12px', fontWeight: 900 }}>!</span>
                <span style={{ color: id === 'community' ? T.muted : T.gold, fontSize: '12px' }}>{warn}</span>
              </div>
            </div>
            <div style={{ marginTop: '14px', textAlign: 'right' }}>
              <span style={{ color, fontSize: '13px', fontWeight: 700 }}>Выбрать</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 1. TimePicker ────────────────────────────────────────────────────────────

function TimePicker({ time, onTime, duration, onDuration, maxDur, selectedDate }) {
  const card = { background: 'rgba(255,255,255,0.045)', borderRadius: '16px', border: `1px solid ${T.border}`, padding: '12px 16px' };
  const canIncrease = duration + 0.5 <= maxDur;

  const scrollContainerRef = useRef(null);
  const firstAvailableNodeRef = useRef(null);

  const isToday = selectedDate.dateISO === new Date().toISOString().slice(0, 10);

  useEffect(() => {
    // This effect runs when the component mounts and when the date changes.
    if (isToday && firstAvailableNodeRef.current) {
      // A small timeout can help ensure the DOM is fully ready for scrolling.
      setTimeout(() => {
        firstAvailableNodeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    } else if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [isToday, selectedDate.dateISO]);

  let firstAvailableFound = false;
  const now = new Date();
  const validationTime = isToday ? now.getTime() + 15 * 60 * 1000 : 0;

  return (
    <Section title="Время и продолжительность">
      <div style={{ ...card, display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ color: T.muted, fontSize: '14px', flex: 1 }}>Продолжительность</span>
        <button onClick={() => onDuration(Math.max(0.5, duration - 0.5))} style={styles.dBtn}>−</button>
        <span style={{ color: T.text, fontWeight: 700, fontSize: '16px', width: '52px', textAlign: 'center' }}>{duration}ч</span>
        <button onClick={() => canIncrease && onDuration(duration + 0.5)} style={{ ...styles.dBtn, opacity: canIncrease ? 1 : 0.3, cursor: canIncrease ? 'pointer' : 'default' }}>
          +
        </button>
      </div>
      {!canIncrease && (
        <div style={{ fontSize: '11px', color: T.gold, marginBottom: '10px', paddingLeft: '4px' }}>
          Максимум для этого слота — {maxDur}ч (клуб закрывается в 00:00)
        </div>
      )}
      <div ref={scrollContainerRef} className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
        {TIME_SLOTS.map((slot) => {
          const prime  = isPrime(slot, selectedDate.dateISO);
          const active = time === slot;
          const slotDateTime = new Date(`${selectedDate.dateISO}T${slot}:00`);
          const isPast = isToday && slotDateTime.getTime() < validationTime;

          const setFirstAvailableRef = (node) => {
            if (node && !isPast && !firstAvailableFound) {
              firstAvailableNodeRef.current = node;
              firstAvailableFound = true;
            }
          };

          return (
            <button
              key={slot}
              ref={setFirstAvailableRef}
              onClick={() => onTime(slot)}
              disabled={isPast}
              style={{
                padding: '9px 0 7px', borderRadius: '10px',
                border: active ? '1px solid rgba(216,243,74,0.34)' : prime ? '1px solid rgba(216,243,74,0.22)' : `1px solid ${T.border}`,
                background: active ? 'rgba(216,243,74,0.14)' : prime ? 'rgba(216,243,74,0.07)' : 'rgba(255,255,255,0.045)',
                color: active ? T.accent : prime ? T.accent : T.muted,
                fontSize: '13px', fontWeight: active ? 700 : 500, lineHeight: 1.2,
                transition: 'opacity 0.2s, background 0.2s, color 0.2s',
                ...(isPast ? { opacity: 0.2, cursor: 'not-allowed', pointerEvents: 'none', filter: 'grayscale(1)' } : { cursor: 'pointer' }),
              }}
            >
              {slot}
              {prime && !active && <div style={{ fontSize: '8px', letterSpacing: '0.04em', marginTop: '2px', opacity: 0.85 }}>PRIME</div>}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ─── 2. CourtTypeToggle ───────────────────────────────────────────────────────

function CourtTypeToggle({ value, onChange }) {
  const opts = [
    { val: 'panoramic', label: 'Ультрапанорама', note: '4 игрока · тариф по дате и времени' },
  ];
  return (
    <Section title="Тип корта">
      <div style={{ display: 'flex', gap: '8px' }}>
        {opts.map(({ val, label, note }) => {
          const active = value === val;
          return (
            <button key={val} onClick={() => onChange(val)} style={{
              flex: 1, padding: '12px 8px', borderRadius: '12px', cursor: 'pointer', textAlign: 'center',
              background: active ? 'rgba(216,243,74,0.12)' : 'rgba(255,255,255,0.045)',
              color: active ? T.accentL : T.muted,
              border: active ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
              fontWeight: active ? 700 : 500, fontSize: '13px',
            }}>
              <div>{label}</div>
              <div style={{ fontSize: '10px', marginTop: '3px', opacity: 0.7 }}>{note}</div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ─── 3. RatingRangeSlider ─────────────────────────────────────────────────────

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
          <div style={{ position: 'absolute', left: pct(minIdx), right: `${100 - (maxIdx / max) * 100}%`, top: 0, bottom: 0, background: 'rgba(216,243,74,0.55)', borderRadius: '3px' }} />
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
        <div style={{ color: T.muted, fontSize: '12px', textAlign: 'center', lineHeight: 1.5 }}>
          К матчу смогут присоединиться только игроки этого уровня
        </div>
      </div>
    </Section>
  );
}

function CourtSelector({ courtType, selectedDate, time, duration, allMatches, selectedId, onChange }) {
  const courtsOfType = COURTS.filter(c => c.type === courtType);

  return (
    <Section title="Номер корта">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        {courtsOfType.map(court => {
          const isAvailable = checkAvailability(allMatches, court.id, selectedDate.dateISO, time, duration);
          const isActive = court.id === selectedId;

          return (
            <button
              key={court.id}
              disabled={!isAvailable}
              onClick={() => onChange(court.id)}
              style={{
                padding: '12px 0',
                borderRadius: '10px',
                border: isActive ? 'none' : `1px solid ${isAvailable ? T.border : 'rgba(239,68,68,0.2)'}`,
                background: isActive ? 'rgba(216,243,74,0.12)' : (isAvailable ? 'rgba(255,255,255,0.045)' : 'rgba(255,111,97,0.05)'),
                color: isActive ? T.accent : (isAvailable ? T.muted : '#FF6F61'),
                fontSize: '13px',
                fontWeight: isActive ? 700 : (isAvailable ? 500 : 600),
                cursor: isAvailable ? 'pointer' : 'not-allowed',
                lineHeight: 1.2,
                opacity: isAvailable ? 1 : 0.8,
              }}
            >
              {isAvailable ? court.name.replace('Корт ', '') : 'Занят'}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Social Payment Sheet ─────────────────────────────────────────────────────

function SocialPaymentSheet({ time, duration, courtType, dateISO, onConfirm, onClose }) {
  const isP       = isPrime(time, dateISO);
  const total     = courtTotal(time, duration, courtType, dateISO);

  return (
    <div
      onClick={onClose}
      className="app-modal-overlay"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 9999, touchAction: 'pan-y' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="app-modal-panel"
        style={{ background: '#07160F', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: '480px', padding: '0 20px calc(48px + env(safe-area-inset-bottom, 0px))', border: '1px solid rgba(245,241,232,0.16)', maxHeight: '92dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div style={{ padding: '12px 0 20px', textAlign: 'center' }}>
          <div style={{ width: '40px', height: '4px', background: T.border, borderRadius: '2px', display: 'inline-block' }} />
        </div>

        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ color: '#fff', fontSize: '18px', fontWeight: 700 }}>Подтверждение брони</div>
          <div style={{ color: T.muted, fontSize: '12px', marginTop: '4px' }}>
            {courtType === 'panoramic' ? 'Ультрапанорамный корт' : 'Корт'} · {time} · {duration}ч
          </div>
        </div>

        {/* Price breakdown */}
        <div style={{ background: T.surface, borderRadius: '14px', padding: '16px', marginBottom: '16px', border: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: T.muted, fontSize: '12px' }}>Стоимость брони</div>
            </div>
            <div style={{ color: '#fff', fontSize: '20px', fontWeight: 800 }}>{fmtPrice(total)}</div>
          </div>
        </div>

        <div style={{ background: 'rgba(216,243,74,0.06)', borderRadius: '16px', padding: '14px', border: '1px solid rgba(216,243,74,0.18)', marginBottom: '20px' }}>
          <div style={{ color: T.accentL, fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>
            Гарантированная бронь
          </div>
          <div style={{ color: T.muted, fontSize: '12px', lineHeight: 1.7 }}>
            Сейчас бронь подтверждается без онлайн-оплаты. Онлайн-оплата будет доступна позже.
          </div>
        </div>

        <button
          onClick={onConfirm}
          style={{
            width: '100%', padding: '16px', marginBottom: '10px',
            background: 'rgba(216,243,74,0.12)',
            color: T.accent, border: '1px solid rgba(216,243,74,0.32)', borderRadius: '16px', fontSize: '15px', fontWeight: 800, cursor: 'pointer',
          }}
        >
          Подтвердить бронь
        </button>
        <button onClick={onClose} style={{ width: '100%', padding: '14px', background: 'transparent', color: T.muted, border: `1px solid ${T.border}`, borderRadius: '16px', fontSize: '15px', cursor: 'pointer' }}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function PrivacyToggle({ value, onChange }) {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: T.surface,
      borderRadius: '12px',
      padding: '14px',
      border: `1px solid ${T.border}`,
      cursor: 'pointer',
      marginBottom: '16px'
    }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: '20px', height: '20px', accentColor: T.accent, flexShrink: 0, cursor: 'pointer' }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ color: T.text, fontSize: '14px', fontWeight: 600 }}>Приватный матч</div>
        <div style={{ color: T.muted, fontSize: '12px', marginTop: '3px', lineHeight: 1.4 }}>
          Доступ только по прямой ссылке. Матч не будет виден в общей ленте.
        </div>
      </div>
    </label>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MatchCreationScreen({ onBack, onSuccess, user, allMatches, showToast }) {
  const [step,       setStep]       = useState(0); // 0 = scenario select, 1 = form
  const [scenario,   setScenario]   = useState(null); // 'community' | 'social'
  const [time,       setTime]       = useState('10:00');
  const [duration,   setDuration]   = useState(1.5);
  const [courtType,  setCourtType]  = useState('panoramic');
  const [selectedCourtId, setSelectedCourtId] = useState(null);
  const [ratingMin,  setRatingMin]  = useState(2);
  const [ratingMax,  setRatingMax]  = useState(5);
  const [showSocial, setShowSocial] = useState(false);
  const [selectedDate, setSelectedDate] = useState(generateDates()[0]); // Default to today
  const [timeError,   setTimeError]   = useState('');
  const [title,       setTitle]      = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const isToday = selectedDate.dateISO === new Date().toISOString().slice(0, 10);
    if (!isToday) {
      setTimeError('');
      return;
    }
    const now = new Date();
    const validationTime = new Date(now.getTime() + 15 * 60 * 1000);
    const selectedDateTime = new Date(`${selectedDate.dateISO}T${time}:00`);

    if (selectedDateTime < validationTime) {
      setTimeError('Нельзя забронировать время в прошлом');
    } else {
      setTimeError('');
    }
  }, [selectedDate, time]);

  const handleTimeSelect = (newTime) => {
    setTime(newTime);
    const cap = maxDuration(newTime);
    if (duration > cap) setDuration(Math.max(0.5, cap));
  };

  const handleCourtTypeChange = (newType) => {
    setCourtType(newType);
    setSelectedCourtId(null); // Reset court selection when type changes
  };

  const handleScenarioSelect = (s) => {
    setScenario(s);
    setStep(1);
  };

  const handleBack = () => {
    if (step === 1) { setStep(0); setScenario(null); }
    else onBack?.();
  };

  const handleCTA = async () => {
    if (saving) return;
    const selectedCourt = COURTS.find(c => c.id === selectedCourtId);
  if (scenario === 'community') {
    setSaving(true);
    try {
      await onSuccess?.({
      time,
      duration, 
      courtType, 
      courtId: selectedCourt?.id,
      courtName: selectedCourt?.name,
      ratingMin, 
      ratingMax, 
      scenario: 'community', 
      status: 'searching',
      isPrivate: isPrivate,
      dateISO: selectedDate.dateISO,
      date: selectedDate.dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', ''),
      title,
      description,
      });
    } catch {
      showToast?.('Матч не создан. Попробуйте еще раз.', 'error');
    } finally {
      setSaving(false);
    }
  } else {
    if (!selectedCourt) return;
    setShowSocial(true);
    // The actual success call is in handleSocialConfirm
  }
};

  const handleSocialConfirm = async () => {
    if (saving) return;
    const selectedCourt = COURTS.find(c => c.id === selectedCourtId);
    if (!selectedCourt) return;
    setSaving(true);
    try {
      await onSuccess?.({
      time, duration, courtType, ratingMin, ratingMax,
  scenario: 'social',
  status: 'confirmed',
      ownerPaid: courtTotal(time, duration, courtType, selectedDate.dateISO),
      holdAmount: 0,
      isPrivate: isPrivate,
      courtId: selectedCourt.id,
      courtName: selectedCourt.name,
  dateISO: selectedDate.dateISO,
  date: selectedDate.dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', ''),
      title,
      description,
      });
      setShowSocial(false);
    } catch {
      showToast?.('Матч не создан. Попробуйте еще раз.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isP       = isPrime(time, selectedDate.dateISO);
  const total     = courtTotal(time, duration, courtType, selectedDate.dateISO);
  const scenarioDef = SCENARIO_DEFS.find(s => s.id === scenario);
  const canBook = (scenario === 'social' ? !!selectedCourtId : true) && !timeError;

  return (
    <div style={{ background: T.bg, minHeight: '100dvh', maxHeight: '100dvh', overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', paddingBottom: 'calc(116px + env(safe-area-inset-bottom, 0px))' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '20px 16px 16px', gap: '12px' }}>
        <button onClick={handleBack} style={{ background: 'none', border: 'none', color: T.muted, fontSize: '22px', cursor: 'pointer', lineHeight: 1, padding: '4px' }}>
          ←
        </button>
        <h1 style={{ color: T.text, fontSize: '20px', fontWeight: 700, margin: 0 }}>
          {step === 0 ? 'Создать матч' : scenarioDef?.title ?? 'Создать матч'}
        </h1>
      </div>

      {step === 0 ? (
        <ScenarioSelector onSelect={handleScenarioSelect} />
      ) : (
        <>
          {/* Scenario chip — tap to change */}
          <div style={{ padding: '0 16px 16px' }}>
            <div
              onClick={() => { setStep(0); setScenario(null); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: scenarioDef?.bg, borderRadius: '8px', padding: '5px 10px',
                border: `1px solid ${scenarioDef?.border}`, cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.12em' }}>{scenarioDef?.mark}</span>
              <span style={{ color: scenarioDef?.color, fontSize: '12px', fontWeight: 700 }}>{scenarioDef?.badge}</span>
              <span style={{ color: T.muted, fontSize: '11px' }}>· изменить</span>
            </div>
          </div>

          {/* Form */}
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <Section title="Дата игры">
  <div className="overflow-x-auto flex gap-2 pb-2.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
    {generateDates().map((day) => {
      const isActive = day.dateISO === selectedDate?.dateISO;
      return (
        <button
          key={day.dateISO}
          onClick={() => setSelectedDate(day)}
          style={{
            flexShrink: 0, minWidth: '60px', padding: '10px', borderRadius: '12px',
            border: isActive ? '1px solid rgba(216,243,74,0.36)' : '1px solid rgba(245,241,232,0.10)',
            background: isActive ? 'rgba(216,243,74,0.14)' : 'rgba(255,255,255,0.045)',
            color: isActive ? '#D8F34A' : 'rgba(245,241,232,0.62)',
            cursor: 'pointer', textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '10px', textTransform: 'uppercase', marginBottom: '4px' }}>{day.dayOfWeek}</div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>{day.dayOfMonth}</div>
        </button>
      );
    })}
  </div>
</Section>
            <TimePicker
              time={time} onTime={handleTimeSelect}
              duration={duration} onDuration={d => setDuration(Math.min(d, maxDuration(time)))}
              maxDur={maxDuration(time)}
              selectedDate={selectedDate}
            />
            <CourtTypeToggle value={courtType} onChange={handleCourtTypeChange} />
            <CourtSelector
              courtType={courtType}
              selectedDate={selectedDate}
              time={time}
              duration={duration}
              allMatches={allMatches}
              selectedId={selectedCourtId}
              onChange={setSelectedCourtId}
            />
            <RatingRangeSlider
              minIdx={ratingMin} maxIdx={ratingMax}
              onChange={(a, b) => { setRatingMin(a); setRatingMax(b); }}
            />
            <Section title="Название матча (необязательно)">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Например: Турнир выходного дня"
                style={{
                  width: '100%', padding: '12px 14px',
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: '12px', color: T.text, fontSize: '15px',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </Section>
            <Section title="Комментарий (необязательно)">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Например: играем в спокойном темпе, для удовольствия."
                rows={2}
                style={{
                  width: '100%', padding: '12px 14px',
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: '12px', color: T.text, fontSize: '15px',
                  outline: 'none', boxSizing: 'border-box', resize: 'none',
                }}
              />
            </Section>
          </div>

          {/* Community warning */}
          {scenario === 'community' && (
            <div style={{ margin: '0 16px 16px', background: 'rgba(212,175,55,0.06)', borderRadius: '12px', padding: '12px 16px', border: '1px solid rgba(212,175,55,0.25)', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '14px', fontWeight: 900, flexShrink: 0 }}>!</span>
              <div style={{ color: T.gold, fontSize: '12px', lineHeight: 1.6 }}>
                <strong>Корт не забронирован.</strong> Сейчас это заявка на сбор игроков без онлайн-оплаты. Бронь корта нужно подтвердить отдельно.
              </div>
            </div>
          )}

          {/* Social price preview */}
          {scenario === 'social' && (
            <div style={{
              margin: '0 16px 16px',
              background: 'rgba(216,243,74,0.06)',
              borderRadius: '18px', padding: '12px 16px',
              border: '1px solid rgba(216,243,74,0.18)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: T.muted, fontSize: '12px' }}>Предварительная стоимость</span>
                <span style={{ color: isP ? T.gold : T.accentL, fontWeight: 800, fontSize: '18px' }}>{fmtPrice(total)}</span>
              </div>
            </div>
          )}

          {timeError && (
            <div style={{ margin: '0 16px 16px', fontSize: '12px', textAlign: 'center', color: '#ef4444' }}>
              {timeError}
            </div>
          )}

          {/* Privacy Toggle */}
          <div style={{ padding: '0 16px' }}>
            <PrivacyToggle value={isPrivate} onChange={setIsPrivate} />
          </div>

          {/* CTA */}
          <div style={{ padding: '0 16px' }}>
            <button
              onClick={handleCTA}
              disabled={!canBook || saving}
              style={{
                ...styles.ctaBtn,
                background: 'rgba(216,243,74,0.12)',
                color: T.accent,
                border: '1px solid rgba(216,243,74,0.32)',
                opacity: canBook && !saving ? 1 : 0.5,
                cursor: canBook && !saving ? 'pointer' : 'not-allowed',
              }}
            >
              {saving
                ? 'Сохраняем...'
                : scenario === 'community'
                ? 'Создать матч'
                : canBook
                  ? 'Создать матч'
                  : 'Выберите свободный корт'
              }
            </button>
          </div>
        </>
      )}

      {showSocial && (
        <SocialPaymentSheet
          time={time}
          duration={duration}
          courtType={courtType}
          dateISO={selectedDate.dateISO}
          onConfirm={handleSocialConfirm}
          onClose={() => setShowSocial(false)}
        />
      )}
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const styles = {
  dBtn: {
    width: '34px', height: '34px', borderRadius: '8px',
    border: `1px solid ${T.border}`, background: T.bg,
    color: '#fff', fontSize: '20px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1, flexShrink: 0,
  },
  ctaBtn: {
    width: '100%', padding: '18px',
    background: 'rgba(216,243,74,0.12)',
    color: '#D8F34A', border: '1px solid rgba(216,243,74,0.32)', borderRadius: '18px',
    fontSize: '16px', fontWeight: 800, cursor: 'pointer',
    boxShadow: '0 14px 36px rgba(216,243,74,0.16)',
  },
};
