import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';
import { isUnconfiguredTrainingSchedule } from '../lib/trainingScheduleClient';
import PadelButton from './ui/PadelButton';
import PadelCard from './ui/PadelCard';

export default function TrainingScreen({ readSchedule, onBack }) {
  const { tg } = useTelegram();
  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const heading = useRef(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const back = tg?.BackButton;
    if (!back) return;
    back.show();
    back.onClick(onBack);
    return () => { back.offClick(onBack); back.hide(); };
  }, [tg, onBack]);

  useEffect(() => {
    let active = true;
    setState('loading');
    Promise.resolve().then(() => active ? readSchedule?.() : undefined).then((result) => {
      if (active) setState(isUnconfiguredTrainingSchedule(result) ? 'not_configured' : 'error');
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [readSchedule, attempt]);

  return (
    <main className="min-h-screen bg-app-bg px-4 pb-10 text-warm-white" style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}>
      <header className="mb-6 flex items-center gap-3">
        <button type="button" aria-label="Назад" onClick={onBack} className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-warm-white/10">
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-black">Групповые тренировки</h1>
      </header>
      <PadelCard padding="lg" className="text-center" aria-busy={state === 'loading'}>
        <CalendarDays size={32} className="mx-auto mb-4 text-accent-light" aria-hidden="true" />
        {state === 'loading' && <p role="status" className="text-sm text-warm-white/70">Загружаем расписание…</p>}
        {state === 'not_configured' && <div role="status">
          <h2 className="text-lg font-bold">Расписание групповых занятий скоро появится</h2>
          <p className="mt-3 text-sm leading-relaxed text-warm-white/70">Здесь будут занятия клуба с тренером и временем проведения.</p>
        </div>}
        {state === 'error' && <>
          <p role="alert" className="text-sm text-warm-white/70">Не удалось загрузить расписание. Попробуйте ещё раз.</p>
          <PadelButton variant="ghost" size="md" className="mt-4 min-h-[48px] motion-reduce:transform-none motion-reduce:transition-none" onClick={() => { setState('loading'); setAttempt((value) => value + 1); }}>Повторить</PadelButton>
        </>}
      </PadelCard>
    </main>
  );
}
