import React, { useEffect, useState } from 'react';
import { CalendarDays, Dumbbell, LayoutGrid, Swords } from 'lucide-react';
import PadelButton from './ui/PadelButton';
import PadelCard from './ui/PadelCard';
import TrainingModal from './TrainingModal';
import { CLUB } from '../lib/clubConfig';
import { getBackendBookingStatusPresentation } from '../lib/backendBookingHomeAdapter';
import { resolvePlayerLevelPresentation } from '../lib/playerLevelPresentation';

const getDisplayDate = (dateISO) => {
  if (!dateISO || typeof dateISO !== 'string') return 'Дата не указана';

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const todayISO = today.toISOString().slice(0, 10);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  if (dateISO.includes(todayISO)) return 'Сегодня';
  if (dateISO.includes(tomorrowISO)) return 'Завтра';

  try {
    return new Date(dateISO).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  } catch (e) {
    return 'Дата';
  }
};

const EVENT_CATEGORY_VISUALS = {
  all: { accentRgb: '245, 241, 232', Icon: LayoutGrid },
  bookings: { accentRgb: '251, 220, 138', Icon: CalendarDays },
  matches: { accentRgb: '216, 243, 74', Icon: Swords },
  trainings: { accentRgb: '245, 241, 232', Icon: Dumbbell },
};

function CountdownBadge({ matchDateISO, matchTime }) {
  const [timeRemaining, setTimeRemaining] = useState(null);

  useEffect(() => {
    const calculateRemaining = () => {
      const matchDateTime = new Date(`${matchDateISO}T${matchTime || '00:00'}:00`);
      const now = new Date();
      const diffMs = matchDateTime.getTime() - now.getTime();
      const diffMinutes = Math.round(diffMs / (1000 * 60));
      setTimeRemaining(diffMinutes);
    };
    calculateRemaining();
    const interval = setInterval(calculateRemaining, 60000);
    return () => clearInterval(interval);
  }, [matchDateISO, matchTime]);

  if (timeRemaining === null || timeRemaining <= 0 || timeRemaining > 180) return null;

  const hours = Math.floor(timeRemaining / 60);
  const minutes = timeRemaining % 60;

  return (
    <span className="inline-flex items-center rounded-full border border-accent-light/[0.16] bg-accent-light/[0.07] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-light/80">
      {hours > 0 ? `${hours}ч ` : ''}{minutes}мин
    </span>
  );
}

function ActionModal({ match, onClose, onConvertToMatch, onSetupTraining }) {
  const [step, setStep] = useState('actions');

  if (!match) return null;

  const handleConvert = (isRatingMatch) => {
    onConvertToMatch(match.id, isRatingMatch);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="app-modal-overlay fixed inset-0 z-[9998] flex items-center justify-center p-4"
    >
      <PadelCard onClick={(e) => e.stopPropagation()} padding="lg" className="app-modal-panel w-full max-w-sm">
        <h3 className="mb-2 text-center text-lg font-bold text-warm-white">
          {step === 'match-type' ? 'Тип матча' : 'Действие с бронью'}
        </h3>
        <p className="mb-6 text-center text-sm text-warm-white/60">
          {getDisplayDate(match.dateISO)}, {match.time}
        </p>
        {step === 'actions' ? (
          <div className="flex flex-col gap-3">
            <PadelButton
              variant="ghost"
              size="lg"
              fullWidth
              onClick={() => {
                onSetupTraining(match);
                onClose();
              }}
            >
              Тренировка
            </PadelButton>
            <PadelButton
              variant="yellow"
              size="lg"
              fullWidth
              onClick={() => setStep('match-type')}
            >
              Создать открытый матч
            </PadelButton>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <PadelButton variant="ghost" size="lg" fullWidth onClick={() => handleConvert(false)}>
              Обычный матч
            </PadelButton>
            <PadelButton variant="yellow" size="lg" fullWidth onClick={() => handleConvert(true)}>
              Рейтинговый матч
            </PadelButton>
            <p className="text-center text-xs leading-relaxed text-warm-white/48">
              Рейтинг изменится после подтверждения счёта.
            </p>
          </div>
        )}
        <button onClick={onClose} className="mt-5 w-full text-center text-sm text-warm-white/45">
          Отмена
        </button>
      </PadelCard>
    </div>
  );
}

function UpcomingRow({ match, onClick }) {
  const isMatch = match.type === 'match';
  const isTraining = match.isTraining;
  const isTrainingPending = isTraining && match.trainingStatus === 'pending_coach';
  const backendBookingStatus = match.isBackendReservation
    ? getBackendBookingStatusPresentation(match.reservationStatus)
    : null;
  const coachName = match.trainingDetails?.coachName;
  const courtLabel = match.courtName || (match.courtType === 'panoramic' ? 'Ультрапанорама' : 'Корт');
  const label = isMatch ? 'Матч' : isTraining ? 'Тренировка' : 'Бронь';
  const categoryId = isMatch ? 'matches' : isTraining ? 'trainings' : 'bookings';
  const { accentRgb, Icon: EventIcon } = EVENT_CATEGORY_VISUALS[categoryId];

  return (
    <PadelCard
      as="button"
      type="button"
      onClick={onClick}
      padding="md"
      className="home-event-card mb-2 w-full cursor-pointer border-l-4 text-left transition-transform active:scale-[0.99]"
      style={{ '--event-accent-rgb': accentRgb }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="home-event-kind-badge inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
              <EventIcon size={11} strokeWidth={2} aria-hidden="true" />
              {label}
            </span>
            <CountdownBadge matchDateISO={match.dateISO} matchTime={match.time} />
          </div>
          <div className="mb-1 text-xl font-bold text-warm-white">{match.time}</div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-warm-white/62">
            <span className="home-event-date-badge">{getDisplayDate(match.dateISO)}</span>
            <span>{courtLabel}</span>
          </div>
          {match.description && (
            <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-warm-white/56">
              {match.description}
            </div>
          )}
          {coachName && (
            <div className="mt-2 text-xs font-semibold text-accent-light">
              Тренер: {coachName}
            </div>
          )}
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
          backendBookingStatus?.tone === 'cancelled'
            ? 'border-[#FF6B5E]/20 bg-[#FF6B5E]/[0.07] text-[#FF8A80]/90'
            : isTrainingPending || backendBookingStatus?.tone === 'pending'
            ? 'border-[#FBDC8A]/20 bg-[#FBDC8A]/[0.07] text-[#FBDC8A]/80'
            : 'border-accent-light/[0.18] bg-accent-light/[0.07] text-accent-light/80'
        }`}>
          {backendBookingStatus?.label ?? (isTrainingPending ? 'Ожидает' : 'Подтверждено')}
        </span>
      </div>
    </PadelCard>
  );
}

export default function Home({
  upcomingMatches = [],
  onBookCourt,
  onOpenBooking,
  onViewDetails,
  onConvertToPublic,
  onSetupTraining,
  showToast,
  user,
  onOpenMatches,
  onOpenRating,
}) {
  const [actionMatch, setActionMatch] = useState(null);
  const [trainingSetupMatch, setTrainingSetupMatch] = useState(null);
  const [eventsFilter, setEventsFilter] = useState('all');

  const gamesWithPartners = upcomingMatches.filter(m => m.type === 'match');
  const myTrainings = upcomingMatches.filter(m => m.type === 'private' && m.isTraining);
  const personalBookings = upcomingMatches.filter(m => m.type === 'private' && !m.isTraining);
  const featuredEvent = [...gamesWithPartners, ...myTrainings, ...personalBookings]
    .sort((a, b) => new Date(`${a.dateISO}T${a.time || '00:00'}:00`) - new Date(`${b.dateISO}T${b.time || '00:00'}:00`))[0];
  const levelPresentation = resolvePlayerLevelPresentation({
    numericRating: user?.numericRating,
    isVerified: user?.isVerified,
    initialLevelLabel: user?.initialLevelLabel,
  });
  const playerName = user?.firstName || 'Игрок';
  const myEvents = [...personalBookings, ...gamesWithPartners, ...myTrainings]
    .sort((a, b) => new Date(`${a.dateISO}T${a.time || '00:00'}:00`) - new Date(`${b.dateISO}T${b.time || '00:00'}:00`));
  const eventTabs = [
    { id: 'all', label: 'Все', count: myEvents.length, ...EVENT_CATEGORY_VISUALS.all },
    { id: 'bookings', label: 'Брони', count: personalBookings.length, ...EVENT_CATEGORY_VISUALS.bookings },
    { id: 'matches', label: 'Матчи', count: gamesWithPartners.length, ...EVENT_CATEGORY_VISUALS.matches },
    { id: 'trainings', label: 'Тренировки', count: myTrainings.length, ...EVENT_CATEGORY_VISUALS.trainings },
  ];
  const visibleEvents = myEvents.filter((event) => {
    if (eventsFilter === 'bookings') return event.type === 'private' && !event.isTraining;
    if (eventsFilter === 'matches') return event.type === 'match';
    if (eventsFilter === 'trainings') return event.type === 'private' && event.isTraining;
    return true;
  });
  const bookingUnavailableText = 'Бронирование через приложение скоро будет обновлено';
  const handleBookCourt = () => {
    if (onBookCourt) {
      onBookCourt();
      return;
    }
    showToast?.(bookingUnavailableText, 'info');
  };

  const handleUpcomingClick = (match) => {
    if (match.isBackendReservation) {
      onOpenBooking?.(match.reservationId);
      return;
    }

    if (match.type === 'match') {
      onViewDetails(match);
      return;
    }

    if (match.type === 'private') {
      if (match.isTraining) setTrainingSetupMatch(match);
      else setActionMatch(match);
    }
  };

  return (
    <div className="min-h-screen bg-app-bg px-4 pb-24 pt-5" style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))' }}>
      <header className="mb-5">
        <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-warm-white/48">
          {CLUB.name}
        </div>
        <h1 className="text-[32px] font-black leading-tight text-warm-white">
          Привет, {playerName}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-warm-white/58">
          {CLUB.location}, {CLUB.address}
        </p>
      </header>

      <PadelCard padding="lg" className="mb-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-warm-white/48">
              <span data-testid="home-player-level-label">
                {levelPresentation.homeLabel}
              </span>
            </div>
            <div
              className="text-4xl font-black tabular-nums text-accent-light"
              data-testid="home-player-level-value"
            >
              {levelPresentation.homeValue}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-warm-white">{upcomingMatches.length}</div>
            <div className="text-xs text-warm-white/50">событий</div>
          </div>
        </div>
      </PadelCard>

      <section className="mb-7 space-y-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.20em] text-warm-white/42">
          Ближайшее событие
        </div>

        {featuredEvent ? (
          <>
            <UpcomingRow match={featuredEvent} onClick={() => handleUpcomingClick(featuredEvent)} />
            {upcomingMatches.length > 1 && (
              <button
                type="button"
                onClick={() => setEventsFilter('all')}
                className="w-full rounded-2xl border border-warm-white/10 px-4 py-3 text-sm font-bold text-warm-white/70"
              >
                Смотреть все события
              </button>
            )}
          </>
        ) : (
          <PadelCard className="border-dashed py-8 text-center">
            <p className="text-sm text-warm-white/58">У вас пока нет активных броней.</p>
            {onBookCourt ? (
              <PadelButton variant="ghost" size="md" onClick={onBookCourt} className="mt-4">
                Выбрать время
              </PadelButton>
            ) : (
              <p className="mt-4 text-xs leading-relaxed text-warm-white/46">{bookingUnavailableText}</p>
            )}
          </PadelCard>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[0.20em] text-warm-white/42">
              Мои события
            </div>
            <p className="mt-1 text-sm text-warm-white/52">
              Брони, матчи и тренировки в одном месте
            </p>
          </div>
          <Dumbbell size={20} strokeWidth={1.8} className="mb-1 text-accent-light/70" />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {eventTabs.map((tab) => {
            const active = eventsFilter === tab.id;
            const TabIcon = tab.Icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEventsFilter(tab.id)}
                aria-pressed={active}
                className={`home-event-tab ${active ? 'is-active' : ''}`}
                style={{ '--event-accent-rgb': tab.accentRgb }}
              >
                <TabIcon size={14} strokeWidth={2} aria-hidden="true" />
                <span>{tab.label}</span>
                <span className="home-event-tab-count">{tab.count}</span>
              </button>
            );
          })}
        </div>

        {visibleEvents.length > 0 ? (
          <div>
            {visibleEvents.map((event) => (
              <UpcomingRow
                key={event.id}
                match={event}
                onClick={() => handleUpcomingClick(event)}
              />
            ))}
          </div>
        ) : (
          <PadelCard className="border-dashed py-8 text-center">
            <p className="text-sm text-warm-white/58">В этой категории пока пусто.</p>
            {eventsFilter === 'bookings' && onBookCourt && (
              <PadelButton variant="ghost" size="md" onClick={handleBookCourt} className="mt-4">
                Выбрать время
              </PadelButton>
            )}
          </PadelCard>
        )}
      </section>

      {actionMatch && (
        <ActionModal
          match={actionMatch}
          onClose={() => setActionMatch(null)}
          onConvertToMatch={onConvertToPublic}
          onSetupTraining={setTrainingSetupMatch}
        />
      )}

      {trainingSetupMatch && (
        <TrainingModal
          match={trainingSetupMatch}
          onClose={() => setTrainingSetupMatch(null)}
          showToast={showToast}
          onConfirm={(data) => { onSetupTraining(data); setTrainingSetupMatch(null); }}
        />
      )}
    </div>
  );
}
