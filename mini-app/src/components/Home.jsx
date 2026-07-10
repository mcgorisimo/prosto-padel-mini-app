import React, { useEffect, useState } from 'react';
import { CalendarDays, ChartNoAxesCombined, Dumbbell, Trophy } from 'lucide-react';
import PadelButton from './ui/PadelButton';
import PadelCard from './ui/PadelCard';
import TrainingModal from './TrainingModal';
import { CLUB } from '../lib/clubConfig';

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
    <span className="inline-flex items-center rounded-full border border-accent-light/20 bg-accent-light/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-light">
      {hours > 0 ? `${hours}ч ` : ''}{minutes}мин
    </span>
  );
}

function ActionModal({ match, onClose, onConvertToMatch, onSetupTraining }) {
  if (!match) return null;

  return (
    <div
      onClick={onClose}
      className="app-modal-overlay fixed inset-0 z-[9998] flex items-center justify-center p-4"
    >
      <PadelCard onClick={(e) => e.stopPropagation()} padding="lg" className="app-modal-panel w-full max-w-sm">
        <h3 className="mb-2 text-center text-lg font-bold text-warm-white">Действие с бронью</h3>
        <p className="mb-6 text-center text-sm text-warm-white/60">
          {getDisplayDate(match.dateISO)}, {match.time}
        </p>
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
            Оставить как тренировку
          </PadelButton>
          <PadelButton
            variant="yellow"
            size="lg"
            fullWidth
            onClick={() => {
              onConvertToMatch(match.id);
              onClose();
            }}
          >
            Создать открытый матч
          </PadelButton>
        </div>
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
  const coachName = match.trainingDetails?.coachName;
  const courtLabel = match.courtName || (match.courtType === 'panoramic' ? 'Ультрапанорама' : 'Корт');
  const label = isMatch ? 'Матч' : isTraining ? 'Тренировка' : 'Бронь';

  return (
    <PadelCard
      onClick={onClick}
      padding="md"
      className="mb-2 cursor-pointer border-l-4 border-l-accent-light/70 transition-transform active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-warm-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warm-white/64">
              {label}
            </span>
            <CountdownBadge matchDateISO={match.dateISO} matchTime={match.time} />
          </div>
          <div className="mb-1 text-xl font-bold text-warm-white">{match.time}</div>
          <div className="text-sm text-warm-white/62">
            {getDisplayDate(match.dateISO)}, {courtLabel}
          </div>
          {match.title && (
            <div className="mt-2 text-sm font-semibold text-warm-white">{match.title}</div>
          )}
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
          isTrainingPending
            ? 'border-coral/24 bg-coral/10 text-coral'
            : 'border-accent-light/22 bg-accent-light/10 text-accent-light'
        }`}>
          {isTrainingPending ? 'Ожидает' : 'Подтверждено'}
        </span>
      </div>
    </PadelCard>
  );
}

function QuickAction({ icon: Icon, label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[96px] flex-col items-start justify-between rounded-[22px] border border-warm-white/10 bg-white/[0.045] p-4 text-left shadow-[0_16px_42px_rgba(0,0,0,0.22)] transition-transform active:scale-[0.98]"
    >
      <Icon size={22} strokeWidth={1.9} className="text-accent-light" />
      <span>
        <span className="block text-sm font-bold text-warm-white">{label}</span>
        <span className="mt-1 block text-xs leading-snug text-warm-white/50">{hint}</span>
      </span>
    </button>
  );
}

export default function Home({
  upcomingMatches = [],
  onBookCourt,
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

  const gamesWithPartners = upcomingMatches.filter(m => m.type === 'match');
  const myTrainings = upcomingMatches.filter(m => m.type === 'private' && m.isTraining);
  const personalBookings = upcomingMatches.filter(m => m.type === 'private' && !m.isTraining);
  const featuredEvent = [...gamesWithPartners, ...myTrainings, ...personalBookings]
    .sort((a, b) => new Date(`${a.dateISO}T${a.time || '00:00'}:00`) - new Date(`${b.dateISO}T${b.time || '00:00'}:00`))[0];
  const rating = user?.numericRating || 3.0;
  const playerName = user?.firstName || 'Игрок';

  const handleUpcomingClick = (match) => {
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
    <div className="min-h-screen bg-app-bg px-4 pb-24 pt-5">
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
              Уровень игрока
            </div>
            <div className="text-4xl font-black tabular-nums text-accent-light">{rating.toFixed(2)}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-warm-white">{upcomingMatches.length}</div>
            <div className="text-xs text-warm-white/50">активных событий</div>
          </div>
        </div>
      </PadelCard>

      <div className="mb-7 grid grid-cols-2 gap-3">
        <QuickAction icon={CalendarDays} label="Бронь" hint="Корт и время" onClick={onBookCourt} />
        <QuickAction icon={ChartNoAxesCombined} label="Матчи" hint="Открытая лента" onClick={onOpenMatches} />
        <QuickAction icon={Dumbbell} label="Тренировки" hint="С тренером клуба" onClick={() => {
          const training = myTrainings[0] || personalBookings[0];
          if (training) setTrainingSetupMatch(training);
          else onBookCourt?.();
        }} />
        <QuickAction icon={Trophy} label="Рейтинг" hint="Уровень и прогресс" onClick={onOpenRating} />
      </div>

      <section className="space-y-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.20em] text-warm-white/42">
          Ближайшее событие
        </div>

        {featuredEvent ? (
          <>
            <UpcomingRow match={featuredEvent} onClick={() => handleUpcomingClick(featuredEvent)} />
            {upcomingMatches.length > 1 && (
              <button
                type="button"
                onClick={onOpenMatches}
                className="w-full rounded-2xl border border-warm-white/10 px-4 py-3 text-sm font-bold text-warm-white/70"
              >
                Смотреть все матчи
              </button>
            )}
          </>
        ) : (
          <PadelCard className="border-dashed py-8 text-center">
            <p className="text-sm text-warm-white/58">У вас пока нет активных броней.</p>
            <PadelButton variant="ghost" size="md" onClick={onBookCourt} className="mt-4">
              Выбрать время
            </PadelButton>
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
