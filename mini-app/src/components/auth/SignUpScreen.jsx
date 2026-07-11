import React, { useEffect, useState } from 'react';

const C = {
  bg: '#050F0B',
  card: 'rgba(255,255,255,0.045)',
  border: 'rgba(245,241,232,0.12)',
  accent: '#D8F34A',
  coral: '#FF6F61',
  text: '#F5F1E8',
  muted: 'rgba(245, 241, 232, 0.64)',
};

const LEVEL_OPTIONS = [
  { label: 'Новичок', ratingIdx: 0, initialRating: 1.5 },
  { label: 'D — начинающий', ratingIdx: 0, initialRating: 1.8 },
  { label: 'C — любитель', ratingIdx: 2, initialRating: 2.8 },
  { label: 'B — продвинутый', ratingIdx: 4, initialRating: 3.8 },
  { label: 'A — эксперт', ratingIdx: 6, initialRating: 4.8 },
];

const labelSx = {
  display: 'block',
  fontSize: '10px',
  fontWeight: 800,
  color: C.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.13em',
  marginBottom: '8px',
};

const inputSx = {
  width: '100%',
  padding: '15px 16px',
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${C.border}`,
  borderRadius: '18px',
  color: C.text,
  fontSize: '16px',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

export default function SignUpScreen({ onBack, onSuccess, loading, error: parentError }) {
  const [show, setShow] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [levelOptionIndex, setLevelOptionIndex] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (parentError) setError('');
  }, [parentError]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!firstName.trim()) return setError('Введите имя');
    if (!email.trim() || !email.includes('@')) return setError('Введите корректный email');
    if (password.length < 6) return setError('Пароль должен быть не менее 6 символов');
    setError('');

    const selectedLevel = LEVEL_OPTIONS[levelOptionIndex];

    onSuccess({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          rating: selectedLevel.initialRating,
          self_assessed_level: selectedLevel.label,
        },
      },
    });
  };

  const displayError = error || parentError;
  const focusProps = {
    onFocus: (e) => e.currentTarget.style.borderColor = 'rgba(216,243,74,0.55)',
    onBlur: (e) => e.currentTarget.style.borderColor = C.border,
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'radial-gradient(circle at 50% -8%, rgba(216,243,74,0.08), transparent 24rem), linear-gradient(180deg, #071F16 0%, #050F0B 62%)',
      paddingBottom: '44px',
    }}>
      <div style={{ padding: '20px 18px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onBack}
            style={{ width: '44px', height: '44px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: '16px', color: C.text, fontSize: '22px', cursor: 'pointer', lineHeight: 1 }}
            aria-label="Назад"
          >
            ←
          </button>
          <div>
            <div style={{ color: C.muted, fontSize: '10px', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Просто Падел
            </div>
            <h1 style={{ color: C.text, fontSize: '24px', fontWeight: 850, margin: '2px 0 0' }}>
              Создать профиль
            </h1>
          </div>
        </div>
        <p style={{ color: C.muted, fontSize: '13px', margin: '12px 0 0 56px', lineHeight: 1.55 }}>
          Создайте профиль игрока «Просто Падел»: укажите примерный уровень, удобную сторону, матчи и клубные события.
        </p>
      </div>

      <div style={{
        padding: '18px',
        opacity: show ? 1 : 0,
        transform: show ? 'none' : 'translateY(16px)',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
      }}>
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '28px',
          padding: '20px',
          boxShadow: '0 24px 70px rgba(0,0,0,0.30)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
            <div>
              <label style={labelSx}>Имя *</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Александр"
                autoComplete="given-name"
                style={inputSx}
                {...focusProps}
              />
            </div>
            <div>
              <label style={labelSx}>Фамилия</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Иванов"
                autoComplete="family-name"
                style={inputSx}
                {...focusProps}
              />
            </div>
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={labelSx}>Email *</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="player@example.com"
              autoComplete="email"
              style={inputSx}
              {...focusProps}
            />
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={labelSx}>Пароль *</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              style={inputSx}
              {...focusProps}
            />
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={labelSx}>Самооценка уровня</label>
            <div style={{ position: 'relative' }}>
              <select
                value={levelOptionIndex}
                onChange={(e) => setLevelOptionIndex(Number(e.target.value))}
                style={{
                  ...inputSx,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  paddingRight: '40px',
                  cursor: 'pointer',
                }}
                {...focusProps}
              >
                {LEVEL_OPTIONS.map((opt, i) => (
                  <option key={i} value={i}>{opt.label}</option>
                ))}
              </select>
              <span style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: C.muted,
                fontSize: '12px',
                pointerEvents: 'none',
              }}>
                ▾
              </span>
            </div>
            <div style={{ color: C.muted, fontSize: '11px', lineHeight: 1.5, marginTop: '8px' }}>
              Клуб подтвердит рейтинг после первых игр или тренировки.
            </div>
          </div>

          {displayError && (
            <div style={{
              background: 'rgba(255,111,97,0.08)',
              borderRadius: '16px',
              padding: '12px 14px',
              marginBottom: '16px',
              border: '1px solid rgba(255,111,97,0.28)',
              color: '#ffb0a8',
              fontSize: '13px',
              lineHeight: 1.5,
            }}>
              {displayError}
            </div>
          )}

          <button
            onClick={(e) => handleSubmit(e)}
            disabled={loading}
            style={{
              width: '100%',
              padding: '17px',
              background: C.accent,
              color: C.bg,
              border: '1px solid rgba(216,243,74,0.38)',
              borderRadius: '20px',
              fontSize: '16px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 16px 40px rgba(216,243,74,0.16)',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Создаем...' : 'Создать профиль'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '16px', color: 'rgba(245,241,232,0.40)', fontSize: '11px', lineHeight: 1.5 }}>
          Регистрируясь, вы принимаете правила клуба «Просто Падел»
        </div>
      </div>
    </div>
  );
}
