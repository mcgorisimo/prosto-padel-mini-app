import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock3, MapPin, RefreshCw, UserRound, UsersRound } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';
import PadelButton from './ui/PadelButton';
import PadelCard from './ui/PadelCard';

const REFRESH_INTERVAL_MILLISECONDS = 5 * 60_000;
const MOSCOW_TIMEZONE = 'Europe/Moscow';
const initialView = Object.freeze({ state: 'loading', sessions: Object.freeze([]), lastUpdatedAt: null });

const dateKey = (iso) => new Intl.DateTimeFormat('en-CA', {
  timeZone: MOSCOW_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso));
const dateLabel = (iso) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long',
}).format(new Date(iso));
const timeLabel = (iso) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));
const updatedLabel = (iso) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TIMEZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));
const sessionLevelLabel = (title) => title.replace(/^Групповая тренировка(?:\s*[—–:-]\s*|\s+)/iu, '').trim() || title;

function viewFromResult(result) {
  if (result?.outcome === 'loaded') return { state: 'loaded', sessions: result.sessions, lastUpdatedAt: result.lastUpdatedAt };
  if (result?.outcome === 'empty') return { state: 'empty', sessions: [], lastUpdatedAt: result.lastUpdatedAt };
  if (result?.outcome === 'not_configured') return { state: 'not_configured', sessions: [], lastUpdatedAt: null };
  if (result?.outcome === 'unavailable') return { state: 'unavailable', sessions: [], lastUpdatedAt: null };
  if (result?.outcome === 'stale') return { state: 'stale', sessions: [], lastUpdatedAt: result.lastUpdatedAt };
  return { state: 'error', sessions: [], lastUpdatedAt: null };
}

function TrainingSessionCard({ session }) {
  const endsAt = new Date(Date.parse(session.startsAt) + session.durationSeconds * 1_000).toISOString();
  return (
    <PadelCard as="article" padding="sm" className="space-y-3" data-testid="training-session-card">
      <div>
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-accent-light">
            <Clock3 size={17} aria-hidden="true" className="shrink-0" />
            <span>{timeLabel(session.startsAt)}–{timeLabel(endsAt)}</span>
          </p>
          <span className="shrink-0 rounded-full bg-accent-light/12 px-3 py-1 text-xs font-bold text-accent-light">
            Осталось {session.remaining} из {session.capacity}
          </span>
        </div>
        <h3 className="mt-2 break-words text-base font-black leading-snug">{sessionLevelLabel(session.title)}</h3>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-warm-white/75">
        <p className="flex min-w-0 items-center gap-2">
          <MapPin size={17} aria-hidden="true" className="shrink-0 text-warm-white/50" />
          <span className="break-words">{session.courtName ?? 'Корт уточняется'}</span>
        </p>
        <p className="flex min-w-0 items-center gap-2">
          <UserRound size={17} aria-hidden="true" className="shrink-0 text-warm-white/50" />
          <span className="break-words">{session.coachName ?? 'Тренер уточняется'}</span>
        </p>
        <p className="flex min-w-0 items-center gap-2">
          <UsersRound size={17} aria-hidden="true" className="shrink-0 text-warm-white/50" />
          <span>Занято {session.occupied} из {session.capacity}</span>
        </p>
      </div>
    </PadelCard>
  );
}

function RetryState({ state, lastUpdatedAt, onRetry }) {
  const copy = {
    unavailable: ['Расписание временно недоступно', 'Не удалось подтвердить свежие данные YCLIENTS.'],
    stale: ['Расписание нужно обновить', 'Предыдущее расписание скрыто, пока свежесть данных не подтверждена.'],
    error: ['Не удалось прочитать расписание', 'Получен неожиданный ответ. Попробуйте ещё раз.'],
  }[state];
  return (
    <PadelCard padding="lg" className="text-center">
      <RefreshCw size={30} className="mx-auto mb-4 text-accent-light" aria-hidden="true" />
      <div role="alert">
        <h2 className="text-lg font-bold">{copy[0]}</h2>
        <p className="mt-3 text-sm leading-relaxed text-warm-white/70">{copy[1]}</p>
        {lastUpdatedAt && <p className="mt-2 text-xs text-warm-white/50">Последнее успешное обновление: {updatedLabel(lastUpdatedAt)} МСК</p>}
      </div>
      <PadelButton variant="ghost" size="md" className="mt-5 min-h-[48px] motion-reduce:transform-none motion-reduce:transition-none" onClick={onRetry}>
        Повторить
      </PadelButton>
    </PadelCard>
  );
}

export default function TrainingScreen({ readSchedule, onBack }) {
  const { tg } = useTelegram();
  const [view, setView] = useState(initialView);
  const heading = useRef(null);
  const generation = useRef(0);
  const inFlight = useRef(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const back = tg?.BackButton;
    if (!back) return;
    back.show();
    back.onClick(onBack);
    return () => { back.offClick(onBack); back.hide(); };
  }, [tg, onBack]);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const requestGeneration = generation.current;
    setView((current) => ({ state: 'loading', sessions: [], lastUpdatedAt: current.lastUpdatedAt }));
    const request = Promise.resolve().then(() => readSchedule?.()).then((result) => {
      if (generation.current === requestGeneration) setView(viewFromResult(result));
    }).catch(() => {
      if (generation.current === requestGeneration) setView({ state: 'error', sessions: [], lastUpdatedAt: null });
    }).finally(() => {
      if (inFlight.current === request) inFlight.current = null;
    });
    inFlight.current = request;
    return request;
  }, [readSchedule]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) refresh(); });
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_INTERVAL_MILLISECONDS);
    const onForeground = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      if (generation.current === currentGeneration) generation.current += 1;
    };
  }, [refresh]);

  const groups = useMemo(() => {
    const result = [];
    for (const session of view.sessions) {
      const key = dateKey(session.startsAt);
      const previous = result.at(-1);
      if (previous?.key === key) previous.sessions.push(session);
      else result.push({ key, label: dateLabel(session.startsAt), sessions: [session] });
    }
    return result;
  }, [view.sessions]);

  return (
    <main data-testid="training-schedule-screen" className="min-h-screen bg-app-bg px-4 pb-10 text-warm-white" style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}>
      <header className="mb-6 flex items-center gap-3">
        <button type="button" aria-label="Назад" onClick={onBack} className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-warm-white/10">
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <h1 ref={heading} tabIndex={-1} className="min-w-0 break-words text-2xl font-black">Групповые тренировки</h1>
      </header>

      {view.state === 'loading' && <PadelCard padding="lg" className="text-center" aria-busy="true">
        <CalendarDays size={32} className="mx-auto mb-4 text-accent-light" aria-hidden="true" />
        <p role="status" className="text-sm text-warm-white/70">Загружаем свежее расписание…</p>
      </PadelCard>}

      {view.state === 'not_configured' && <PadelCard padding="lg" className="text-center">
        <CalendarDays size={32} className="mx-auto mb-4 text-accent-light" aria-hidden="true" />
        <div role="status">
          <h2 className="text-lg font-bold">Расписание групповых занятий скоро появится</h2>
          <p className="mt-3 text-sm leading-relaxed text-warm-white/70">Здесь будут занятия клуба с подтверждёнными данными YCLIENTS.</p>
        </div>
      </PadelCard>}

      {view.state === 'empty' && <PadelCard padding="lg" className="text-center">
        <CalendarDays size={32} className="mx-auto mb-4 text-accent-light" aria-hidden="true" />
        <div role="status">
          <h2 className="text-lg font-bold">Пока нет групповых тренировок</h2>
          <p className="mt-3 text-sm leading-relaxed text-warm-white/70">Новые занятия появятся здесь после добавления в расписание клуба.</p>
          <p className="mt-2 text-xs text-warm-white/50">Обновлено: {updatedLabel(view.lastUpdatedAt)} МСК</p>
        </div>
      </PadelCard>}

      {['unavailable', 'stale', 'error'].includes(view.state) &&
        <RetryState state={view.state} lastUpdatedAt={view.lastUpdatedAt} onRetry={refresh} />}

      {view.state === 'loaded' && <div className="space-y-6">
        <p role="status" className="text-xs text-warm-white/55">Обновлено: {updatedLabel(view.lastUpdatedAt)} МСК</p>
        {groups.map((group) => <section key={group.key} aria-labelledby={`training-date-${group.key}`}>
          <h2 id={`training-date-${group.key}`} className="mb-3 text-sm font-bold capitalize text-warm-white/70">{group.label}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {group.sessions.map((session) => <TrainingSessionCard key={session.id} session={session} />)}
          </div>
        </section>)}
      </div>}
    </main>
  );
}
