import React, { useState, useMemo } from 'react';
import PadelButton from './ui/PadelButton';
import PadelCard from './ui/PadelCard';

const FORMATS = [
  { id: 'individual', label: 'Индивидуальная', mark: '1', maxGuests: 0 },
  { id: 'split',      label: 'Сплит',          mark: '2', maxGuests: 1 },
  { id: 'group',      label: 'Групповая',      mark: '4', maxGuests: 3 },
];

function Section({ title, children }) {
  return (
    <div className="mb-5">
      {title && (
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function Toggle({ value, onChange, label, hint }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <div className="text-sm font-semibold text-white">{label}</div>
        {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-12 h-7 rounded-full transition-colors ${value ? 'bg-yellow-500' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

export default function TrainingModal({ match, onClose, onConfirm, showToast }) {
  const [format, setFormat] = useState('individual');
  const [withCoach, setWithCoach] = useState(true);
  const [trainingDuration, setTrainingDuration] = useState(match.duration || 1);
  const [guests, setGuests] = useState([]);

  const selectedFormat = useMemo(() => FORMATS.find(f => f.id === format), [format]);
  const maxGuests = selectedFormat.maxGuests;

  const handleGuestChange = (index, value) => {
    const newGuests = [...guests];
    newGuests[index] = value;
    setGuests(newGuests);
  };

  const handleCopyLink = () => {
    const link = 'https://t.me/+qTqqdOIDHOU1ZTcy';
    navigator.clipboard?.writeText(link);
    showToast?.('Ссылка на Telegram-группу скопирована', 'info');
  };

  const handleConfirm = () => {
    // Добавляем проверку, что match вообще существует
    if (!match) {
      console.error("Ошибка: данные бронирования не найдены");
      return;
    }
    const trainingData = {
      matchId: match?.id || 'unknown',
      format: selectedFormat?.label || 'Индивидуальная',
      withCoach,
      duration: trainingDuration,
      guests: (guests || []).filter(g => g && g.trim() !== ''),
      court: match?.courtName || 'Не указан',
      isTraining: true,
      trainingStatus: 'pending_coach',
      type: 'private', // Тренировка всегда является приватной бронью
    };

    // ОТПРАВКА КОНСЬЕРЖУ
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.sendData(JSON.stringify(trainingData));
    }

    // Вызываем родительскую функцию, чтобы обновить статус на главной
    onConfirm(trainingData);
  };

  const durationOptions = useMemo(() => {
    const options = [];
    const max = match.duration || 2;
    for (let d = 1; d <= max; d += 0.5) {
      options.push(d);
    }
    return options;
  }, [match.duration]);

  return (
    <div onClick={onClose} className="app-modal-overlay fixed inset-0 z-[9999] flex items-end justify-center p-3">
      <PadelCard
        onClick={(e) => e.stopPropagation()}
        padding="lg"
        className="app-modal-panel w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl"
      >
        <div className="flex justify-between items-start mb-5">
          <div>
            <h2 className="text-white text-lg font-bold">Настройка тренировки</h2>
            <p className="text-slate-400 text-xs mt-1">{match.date}, {match.time}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-2xl hover:text-white">✕</button>
        </div>

        <Section title="Формат">
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map(f => (
              <button
                key={f.id}
                onClick={() => { setFormat(f.id); setGuests([]); }}
                className={`p-3 rounded-2xl border transition-all ${format === f.id ? 'bg-accent-light/10 border-accent-light/35' : 'bg-white/[0.04] border-warm-white/10'}`}
              >
                <div className="text-lg font-black text-accent-light">{f.mark}</div>
                <div className={`mt-1 text-[10px] font-bold uppercase tracking-tighter ${format === f.id ? 'text-white' : 'text-slate-400'}`}>
                  {f.label}
                </div>
              </button>
            ))}
          </div>
        </Section>

        {maxGuests > 0 && (
          <Section title={`Участники (кроме вас)`}>
            <div className="space-y-2">
              {Array.from({ length: maxGuests }).map((_, i) => (
                <input
                  key={i}
                  type="text"
                  value={guests[i] || ''}
                  onChange={(e) => handleGuestChange(i, e.target.value)}
                  placeholder={`Имя друга ${i + 1}`}
                  className="w-full bg-white/[0.04] text-warm-white placeholder-warm-white/35 rounded-2xl border border-warm-white/10 p-3 text-sm focus:border-accent-light outline-none transition-all"
                />
              ))}
            </div>
            <button onClick={handleCopyLink} className="mt-3 text-accent-light text-xs font-bold flex items-center gap-1">
              Скопировать ссылку на Telegram-группу
            </button>
          </Section>
        )}

        <Section title="Персонал">
          <div className="bg-slate-800/30 border border-slate-800 rounded-2xl p-4">
            <Toggle
              value={withCoach}
              onChange={setWithCoach}
              label="Нужен тренер"
              hint="Мы подберем лучшего свободного профи"
            />
          </div>
        </Section>

        <Section title="Время">
          <div className="grid grid-cols-4 gap-2">
            {durationOptions.map(d => (
              <button
                key={d}
                onClick={() => setTrainingDuration(d)}
                className={`py-2 rounded-lg text-sm font-bold border transition-all ${trainingDuration === d ? 'bg-yellow-500 text-black border-yellow-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
              >
                {d}ч
              </button>
            ))}
          </div>
          {trainingDuration < (match.duration || 0) && (
            <div className="text-[10px] text-warm-white/50 mt-3 bg-white/[0.03] p-2 rounded-lg border border-dashed border-warm-white/10">
              После тренировки у вас останется <strong>{(match.duration - trainingDuration)}ч</strong> для свободной игры.
            </div>
          )}
        </Section>

        <div className="mt-8 space-y-3">
          <PadelButton variant="yellow" size="lg" fullWidth onClick={handleConfirm}>
            Отправить запрос консьержу
          </PadelButton>
          <button onClick={onClose} className="w-full text-slate-500 text-sm font-semibold py-2">
            Отмена
          </button>
        </div>
      </PadelCard>
    </div>
  );
}
