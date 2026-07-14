import React, { useEffect, useMemo, useState } from 'react';
import PadelButton from './ui/PadelButton';
import PadelCard from './ui/PadelCard';
import { getPublicPlayerProfiles } from '../lib/profileApi';

const FORMATS = [
  { id: 'individual', label: 'Индивидуальная', mark: '1', maxGuests: 0 },
  { id: 'split', label: 'Сплит', mark: '2', maxGuests: 1 },
  { id: 'group', label: 'Групповая', mark: '4', maxGuests: 3 },
];

const TRAINERS = [
  { id: 'auto', name: 'Подберём свободного тренера' },
  { id: 'coach-alex', name: 'Алексей Смирнов' },
  { id: 'coach-maria', name: 'Мария Орлова' },
  { id: 'coach-dmitry', name: 'Дмитрий Волков' },
];

function Section({ title, children }) {
  return (
    <div className="mb-5">
      {title && (
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-warm-white/42">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function Toggle({ value, onChange, label, hint }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <div className="text-sm font-semibold text-warm-white">{label}</div>
        {hint && <div className="mt-1 text-xs text-warm-white/48">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-7 w-12 rounded-full transition-colors ${value ? 'bg-accent-light' : 'bg-white/[0.10]'}`}
      >
        <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

function displayGuest(guest) {
  if (!guest) return '';
  if (guest.name) return guest.name;
  return [guest.firstName, guest.lastName].filter(Boolean).join(' ');
}

function ParticipantPicker({ index, value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || value) {
      setResults([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await getPublicPlayerProfiles({
          search: trimmed,
          select: 'id, first_name, last_name, username, rating, is_verified',
          limit: 8,
          diagnosticContext: 'training-participant-picker.search',
        });
        setResults(data ?? []);
      } catch (error) {
        console.error('Training participant search error:', error);
        setResults([]);
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, value]);

  if (value) {
    return (
      <div className="rounded-2xl border border-accent-light/20 bg-accent-light/8 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-warm-white">{displayGuest(value)}</div>
            <div className="mt-1 text-xs text-warm-white/46">
              {value.manual ? 'Добавлен вручную' : 'Игрок клуба'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
            className="rounded-full border border-warm-white/10 px-3 py-1 text-xs font-bold text-warm-white/55"
          >
            Убрать
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-warm-white/10 bg-white/[0.035] p-3">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Участник ${index + 1}: имя, фамилия или username`}
        className="w-full rounded-xl border border-warm-white/10 bg-app-bg/70 p-3 text-sm text-warm-white outline-none transition-colors placeholder:text-warm-white/34 focus:border-accent-light/45"
      />

      {loading && (
        <div className="px-1 py-3 text-xs text-warm-white/42">Ищем игрока...</div>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-2 space-y-2">
          {results.map((player) => (
            <button
              key={player.id}
              type="button"
              onClick={() => {
                onChange({
                  id: player.id,
                  firstName: player.first_name,
                  lastName: player.last_name,
                  numericRating: player.rating || 3.0,
                  isVerified: player.is_verified === true,
                });
                setQuery('');
                setResults([]);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-warm-white/8 bg-white/[0.04] p-3 text-left"
            >
              <span>
                <span className="block text-sm font-bold text-warm-white">
                  {[player.first_name, player.last_name].filter(Boolean).join(' ')}
                </span>
                <span className="mt-1 block text-xs text-warm-white/42">
                  {`Рейтинг ${(player.rating || 3.0).toFixed(2)}`}
                </span>
              </span>
              <span className="text-xs font-bold text-accent-light">Выбрать</span>
            </button>
          ))}
        </div>
      )}

      {query.trim().length >= 2 && (
        <button
          type="button"
          onClick={() => {
            onChange({ name: query.trim(), manual: true });
            setQuery('');
            setResults([]);
          }}
          className="mt-2 w-full rounded-xl border border-warm-white/10 px-3 py-2 text-left text-xs font-bold text-warm-white/64"
        >
          Добавить вручную: {query.trim()}
        </button>
      )}
    </div>
  );
}

export default function TrainingModal({ match, onClose, onConfirm }) {
  const [format, setFormat] = useState('individual');
  const [withCoach, setWithCoach] = useState(true);
  const [trainingDuration, setTrainingDuration] = useState(match.duration || 1);
  const [guests, setGuests] = useState([]);
  const [trainerId, setTrainerId] = useState('auto');

  const selectedFormat = useMemo(() => FORMATS.find(f => f.id === format) ?? FORMATS[0], [format]);
  const selectedTrainer = useMemo(() => TRAINERS.find(trainer => trainer.id === trainerId) ?? TRAINERS[0], [trainerId]);
  const maxGuests = selectedFormat.maxGuests;

  const durationOptions = useMemo(() => {
    const options = [];
    const max = match.duration || 2;
    for (let d = 1; d <= max; d += 0.5) {
      options.push(d);
    }
    return options;
  }, [match.duration]);

  const handleGuestChange = (index, value) => {
    setGuests((prev) => {
      const next = [...prev];
      next[index] = value;
      return next.slice(0, maxGuests);
    });
  };

  const handleConfirm = () => {
    if (!match) {
      console.error('Ошибка: данные бронирования не найдены');
      return;
    }

    const pickedGuests = (guests || []).filter(Boolean);
    const coachName = withCoach && trainerId !== 'auto' ? selectedTrainer.name : null;
    const trainingData = {
      matchId: match?.id || 'unknown',
      format: selectedFormat.label,
      formatId: selectedFormat.id,
      withCoach,
      duration: trainingDuration,
      guests: pickedGuests,
      coachId: withCoach && trainerId !== 'auto' ? trainerId : null,
      coachName,
      coachStatus: withCoach
        ? coachName
          ? 'Запросим подтверждение'
          : 'Мы подберём свободного тренера'
        : null,
      court: match?.courtName || 'Не указан',
      isTraining: true,
      trainingStatus: 'pending_coach',
      type: 'private',
    };

    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.sendData(JSON.stringify(trainingData));
    }

    onConfirm(trainingData);
  };

  return (
    <div onClick={onClose} className="app-modal-overlay fixed inset-0 z-[9999] flex items-end justify-center p-3">
      <PadelCard
        onClick={(event) => event.stopPropagation()}
        padding="lg"
        className="app-modal-panel w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-warm-white">Настройка тренировки</h2>
            <p className="mt-1 text-xs text-warm-white/48">{match.date}, {match.time}</p>
          </div>
          <button onClick={onClose} className="text-2xl text-warm-white/46 hover:text-warm-white">×</button>
        </div>

        <Section title="Формат">
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setFormat(item.id);
                  setGuests([]);
                }}
                className={`rounded-2xl border p-3 transition-all ${format === item.id ? 'border-accent-light/35 bg-accent-light/10' : 'border-warm-white/10 bg-white/[0.04]'}`}
              >
                <div className="text-lg font-black text-accent-light">{item.mark}</div>
                <div className={`mt-1 text-[10px] font-bold uppercase ${format === item.id ? 'text-warm-white' : 'text-warm-white/46'}`}>
                  {item.label}
                </div>
              </button>
            ))}
          </div>
        </Section>

        {maxGuests > 0 && (
          <Section title="Участники">
            <div className="space-y-2">
              {Array.from({ length: maxGuests }).map((_, index) => (
                <ParticipantPicker
                  key={`${format}-${index}`}
                  index={index}
                  value={guests[index]}
                  onChange={(value) => handleGuestChange(index, value)}
                />
              ))}
            </div>
          </Section>
        )}

        <Section title="Тренер">
          <div className="rounded-2xl border border-warm-white/10 bg-white/[0.035] p-4">
            <Toggle
              value={withCoach}
              onChange={setWithCoach}
              label="Нужен тренер"
              hint="Мы подберём свободного тренера"
            />

            {withCoach && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-bold text-warm-white/58">Выбрать тренера</div>
                {TRAINERS.map((trainer) => {
                  const active = trainerId === trainer.id;
                  return (
                    <button
                      key={trainer.id}
                      type="button"
                      onClick={() => setTrainerId(trainer.id)}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors ${active ? 'border-accent-light/28 bg-accent-light/10' : 'border-warm-white/10 bg-white/[0.03]'}`}
                    >
                      <span className="text-sm font-bold text-warm-white">{trainer.name}</span>
                      {active && trainer.id !== 'auto' && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-accent-light">
                          Запросим подтверждение
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Section>

        <Section title="Время">
          <div className="grid grid-cols-4 gap-2">
            {durationOptions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTrainingDuration(item)}
                className={`rounded-lg border py-2 text-sm font-bold transition-all ${trainingDuration === item ? 'border-accent-light bg-accent-light text-app-bg' : 'border-warm-white/10 bg-white/[0.04] text-warm-white/50'}`}
              >
                {item}ч
              </button>
            ))}
          </div>
          {trainingDuration < (match.duration || 0) && (
            <div className="mt-3 rounded-lg border border-dashed border-warm-white/10 bg-white/[0.03] p-2 text-[10px] text-warm-white/50">
              После тренировки у вас останется <strong>{match.duration - trainingDuration}ч</strong> для свободной игры.
            </div>
          )}
        </Section>

        <div className="mt-8 space-y-3">
          <PadelButton variant="yellow" size="lg" fullWidth onClick={handleConfirm}>
            Отправить запрос
          </PadelButton>
          <button onClick={onClose} className="w-full py-2 text-sm font-semibold text-warm-white/42">
            Отмена
          </button>
        </div>
      </PadelCard>
    </div>
  );
}
