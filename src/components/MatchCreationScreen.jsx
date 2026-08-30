import { useMemo, useState } from 'react';
import BookingScreen from './BookingScreen';

const RATINGS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
const MATCH_COMMENT_MAX_LENGTH = 240;
const commentCodePointLength = (value) => [...String(value ?? '')].length;

const T = {
  bg: '#050F0B',
  surface: 'rgba(255,255,255,0.045)',
  border: 'rgba(245,241,232,0.10)',
  accent: '#D8F34A',
  accentL: '#D8F34A',
  text: '#F5F1E8',
  muted: 'rgba(245,241,232,0.62)',
  gold: '#FF6F61',
};

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: '16px', background: 'rgba(255,255,255,0.035)', border: `1px solid ${T.border}`, borderRadius: '20px', padding: '14px' }}>
      {title && (
        <div style={{ fontSize: '11px', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px' }}>
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

export const MATCH_SCENARIO_DEFS = Object.freeze([
  Object.freeze({
    id: 'community',
    mark: '01',
    title: 'Только сбор игроков',
    badge: 'Community Search',
    desc: 'Создайте открытый сбор игроков с заранее подтверждённым кортом.',
    pros: ['Корт бронируется до публикации матча'],
    warn: 'Доступность и цена подтверждаются через YCLIENTS',
    color: T.muted,
    bg: 'rgba(255,255,255,0.045)',
    border: 'rgba(245,241,232,0.10)',
  }),
  Object.freeze({
    id: 'social',
    mark: '02',
    title: 'Матч с кортом',
    badge: 'Court booking',
    desc: 'Выберите параметры матча, затем забронируйте корт тем же способом.',
    pros: ['Матч создаётся только после подтверждения брони'],
    warn: 'Онлайн-оплата подключается отдельным этапом',
    color: T.gold,
    bg: 'rgba(216,243,74,0.08)',
    border: 'rgba(216,243,74,0.22)',
  }),
]);

export const SOCIAL_MATCH_CONFIRMATION_COPY = Object.freeze({
  title: 'Подтверждение корта',
  priceLabel: 'Полная стоимость корта',
  noticeTitle: 'Бронь обязательна',
  noticeBody: 'Матч будет создан только после подтверждённой брони YCLIENTS.',
  confirmLabel: 'Выбрать корт и время',
});

function ScenarioSelector({ onSelect }) {
  return (
    <div style={{ padding: '0 16px' }}>
      <p style={{ color: T.muted, fontSize: '13px', margin: '0 0 20px', lineHeight: 1.5 }}>
        Выберите формат организации игры
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {MATCH_SCENARIO_DEFS.map((definition) => (
          <button
            key={definition.id}
            type="button"
            data-testid={`match-scenario-${definition.id}`}
            onClick={() => onSelect(definition.id)}
            style={{ display: 'block', width: '100%', minHeight: '48px', textAlign: 'left', background: definition.bg, borderRadius: '16px', border: `1px solid ${definition.border}`, padding: '20px', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <span style={{ color: definition.color, fontSize: '12px', fontWeight: 900, letterSpacing: '0.12em' }}>{definition.mark}</span>
              <div>
                <div style={{ color: T.text, fontWeight: 700, fontSize: '16px' }}>{definition.title}</div>
                <div style={{ color: definition.color, fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', marginTop: '2px' }}>{definition.badge}</div>
              </div>
            </div>
            <div style={{ color: T.muted, fontSize: '12px', lineHeight: 1.6, marginBottom: '12px' }}>{definition.desc}</div>
            <div style={{ color: T.muted, fontSize: '12px', lineHeight: 1.55 }}>
              <div><span style={{ color: T.accent }}>✓</span> {definition.pros[0]}</div>
              <div style={{ marginTop: '4px', color: definition.color }}>! {definition.warn}</div>
            </div>
            <div style={{ marginTop: '14px', textAlign: 'right', color: definition.color, fontSize: '13px', fontWeight: 700 }}>Выбрать</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RatingRangeSlider({ minIdx, maxIdx, onChange }) {
  const max = RATINGS.length - 1;
  const pct = (index) => `${(index / max) * 100}%`;

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
          {RATINGS.map((rating, index) => (
            <span key={rating} style={{ flex: 1, textAlign: 'center', fontSize: '12px', fontWeight: 600, color: index >= minIdx && index <= maxIdx ? T.accentL : T.border, transition: 'color 0.2s' }}>{rating}</span>
          ))}
        </div>
        <div style={{ position: 'relative', height: '6px', borderRadius: '3px', background: T.border, margin: '0 0 20px' }}>
          <div style={{ position: 'absolute', left: pct(minIdx), right: `${100 - (maxIdx / max) * 100}%`, top: 0, bottom: 0, background: 'rgba(216,243,74,0.55)', borderRadius: '3px' }} />
          <input aria-label="Минимальный уровень игроков" className="rating-range" type="range" min={0} max={max} value={minIdx} onChange={(event) => onChange(Math.min(Number(event.target.value), maxIdx - 1), maxIdx)} style={{ zIndex: maxIdx === max ? 5 : 3 }} />
          <input aria-label="Максимальный уровень игроков" className="rating-range" type="range" min={0} max={max} value={maxIdx} onChange={(event) => onChange(minIdx, Math.max(Number(event.target.value), minIdx + 1))} style={{ zIndex: 4 }} />
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

function RatingMatchToggle({ value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', background: T.surface, borderRadius: '12px', padding: '14px', border: value ? '1px solid rgba(216,243,74,0.34)' : `1px solid ${T.border}`, cursor: 'pointer', marginBottom: '16px' }}>
      <input data-testid="match-rating-toggle" type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} style={{ width: '20px', height: '20px', accentColor: T.accent, flexShrink: 0, cursor: 'pointer', marginTop: '2px' }} />
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', color: T.text, fontSize: '14px', fontWeight: 600 }}>Рейтинговая игра</span>
        <span style={{ display: 'block', color: T.muted, fontSize: '12px', marginTop: '3px', lineHeight: 1.45 }}>Рейтинговая игра влияет на клубный рейтинг после завершения матча. Участникам нужен подтверждённый рейтинг.</span>
      </span>
    </label>
  );
}

function PrivacyToggle({ value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '12px', background: T.surface, borderRadius: '12px', padding: '14px', border: `1px solid ${T.border}`, cursor: 'pointer', marginBottom: '16px' }}>
      <input data-testid="match-private-toggle" type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} style={{ width: '20px', height: '20px', accentColor: T.accent, flexShrink: 0, cursor: 'pointer' }} />
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', color: T.text, fontSize: '14px', fontWeight: 600 }}>Приватный матч</span>
        <span style={{ display: 'block', color: T.muted, fontSize: '12px', marginTop: '3px', lineHeight: 1.4 }}>Доступ только по прямой ссылке. Матч не будет виден в общей ленте.</span>
      </span>
    </label>
  );
}

export function isPrivateMatchCreationEnabled(allowPrivateMatches, isPrivate) {
  return allowPrivateMatches === true && isPrivate === true;
}

export function createMatchBookingMetadata({ scenario, ratingMin, ratingMax, description, isPrivate, isRatingMatch, allowPrivateMatches }) {
  if (!['community', 'social'].includes(scenario)) return null;
  const privateMatch = isPrivateMatchCreationEnabled(allowPrivateMatches, isPrivate);
  return Object.freeze({
    scenario: privateMatch ? 'private' : scenario,
    isPrivate: privateMatch,
    isRatingMatch: privateMatch ? false : isRatingMatch === true,
    description: typeof description === 'string' ? description : '',
    ...(privateMatch ? {} : { ratingMin, ratingMax }),
  });
}

export default function MatchCreationScreen({
  onBack,
  onSuccess,
  user,
  availabilityActions = null,
  bookingClient = null,
  courtNamesById = {},
  onCourtCatalogChange = null,
  onOpenProfile = null,
  showToast,
  allowPrivateMatches = true,
}) {
  const [step, setStep] = useState('scenario');
  const [scenario, setScenario] = useState(null);
  const [ratingMin, setRatingMin] = useState(2);
  const [ratingMax, setRatingMax] = useState(5);
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isRatingMatch, setIsRatingMatch] = useState(false);

  const scenarioDefinition = MATCH_SCENARIO_DEFS.find((item) => item.id === scenario);
  const metadata = useMemo(
    () => createMatchBookingMetadata({ scenario, ratingMin, ratingMax, description, isPrivate, isRatingMatch, allowPrivateMatches }),
    [allowPrivateMatches, description, isPrivate, isRatingMatch, ratingMax, ratingMin, scenario],
  );

  const handleBack = () => {
    if (step === 'booking') {
      setStep('details');
    } else if (step === 'details') {
      setStep('scenario');
      setScenario(null);
    } else {
      onBack?.();
    }
  };

  const continueToBooking = () => {
    if (isRatingMatch && !isPrivate && user?.isVerified !== true) {
      showToast?.('Для рейтинговой игры нужен подтверждённый рейтинг.', 'error');
      return;
    }
    if (metadata !== null) setStep('booking');
  };

  const completeConfirmedReservation = async (reservation) => {
    if (metadata === null || reservation?.status !== 'confirmed') {
      showToast?.('Матч не создан: бронь ещё не подтверждена.', 'error');
      return false;
    }
    return onSuccess?.({ ...metadata, reservationId: reservation.reservationId });
  };

  if (step === 'booking') {
    return (
      <BookingScreen
        availabilityActions={availabilityActions}
        bookingClient={bookingClient}
        reservationPurpose="match"
        onConfirmedReservation={completeConfirmedReservation}
        onBack={handleBack}
        courtNamesById={courtNamesById}
        onCourtCatalogChange={onCourtCatalogChange}
        onOpenProfile={onOpenProfile}
        showToast={showToast}
      />
    );
  }

  return (
    <div style={{ background: T.bg, minHeight: '100dvh', overflowY: 'auto', paddingBottom: 'calc(116px + env(safe-area-inset-bottom, 0px))' }}>
      <header style={{ display: 'flex', alignItems: 'center', padding: '20px 16px 16px', gap: '12px' }}>
        <button type="button" aria-label="Назад" onClick={handleBack} style={{ minWidth: '44px', minHeight: '44px', background: 'none', border: 'none', color: T.muted, fontSize: '22px', cursor: 'pointer', lineHeight: 1, padding: '4px' }}>←</button>
        <h1 style={{ color: T.text, fontSize: '20px', fontWeight: 700, margin: 0 }}>
          {step === 'scenario' ? 'Создать матч' : scenarioDefinition?.title ?? 'Создать матч'}
        </h1>
      </header>

      {step === 'scenario' ? (
        <ScenarioSelector onSelect={(nextScenario) => { setScenario(nextScenario); setStep('details'); }} />
      ) : (
        <>
          <div style={{ padding: '0 16px 16px' }}>
            <button type="button" onClick={() => { setStep('scenario'); setScenario(null); }} style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: scenarioDefinition?.bg, borderRadius: '8px', padding: '5px 10px', border: `1px solid ${scenarioDefinition?.border}`, cursor: 'pointer' }}>
              <span style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.12em' }}>{scenarioDefinition?.mark}</span>
              <span style={{ color: scenarioDefinition?.color, fontSize: '12px', fontWeight: 700 }}>{scenarioDefinition?.badge}</span>
              <span style={{ color: T.muted, fontSize: '11px' }}>· изменить</span>
            </button>
          </div>

          <div style={{ padding: '0 16px' }}>
            {!isPrivate && <RatingRangeSlider minIdx={ratingMin} maxIdx={ratingMax} onChange={(minimum, maximum) => { setRatingMin(minimum); setRatingMax(maximum); }} />}

            <Section title="Комментарий (необязательно)">
              <textarea
                value={description}
                onChange={(event) => {
                  if (commentCodePointLength(event.target.value) <= MATCH_COMMENT_MAX_LENGTH) setDescription(event.target.value);
                }}
                placeholder="Например: играем в спокойном темпе, для удовольствия."
                rows={3}
                style={{ width: '100%', padding: '12px 14px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: '12px', color: T.text, fontSize: '15px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
              />
              <div style={{ marginTop: '6px', color: T.muted, fontSize: '11px', textAlign: 'right' }}>{commentCodePointLength(description)}/{MATCH_COMMENT_MAX_LENGTH}</div>
            </Section>

            {!isPrivate && <RatingMatchToggle value={isRatingMatch} onChange={setIsRatingMatch} />}
            {allowPrivateMatches && (
              <PrivacyToggle
                value={isPrivate}
                onChange={(nextValue) => { setIsPrivate(nextValue); if (nextValue) setIsRatingMatch(false); }}
              />
            )}

            <div style={{ marginBottom: '16px', borderRadius: '14px', border: '1px solid rgba(216,243,74,0.18)', background: 'rgba(216,243,74,0.06)', padding: '12px 14px', color: T.muted, fontSize: '12px', lineHeight: 1.55 }}>
              Следующий шаг — единая сетка свободных слотов 30 минут. Матч появится только после подтверждения и привязки брони.
            </div>

            <button type="button" data-testid="match-continue-to-booking" onClick={continueToBooking} style={{ width: '100%', minHeight: '52px', padding: '16px', background: 'rgba(216,243,74,0.12)', color: T.accent, border: '1px solid rgba(216,243,74,0.32)', borderRadius: '18px', fontSize: '16px', fontWeight: 800, cursor: 'pointer', boxShadow: '0 14px 36px rgba(216,243,74,0.16)' }}>
              Выбрать корт и время
            </button>
          </div>
        </>
      )}
    </div>
  );
}
