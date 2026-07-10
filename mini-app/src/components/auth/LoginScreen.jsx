import React, { useEffect, useState } from 'react';

const C = {
  bg: '#050F0B',
  card: 'rgba(255,255,255,0.045)',
  border: 'rgba(245,241,232,0.12)',
  lime: '#D8F34A',
  coral: '#FF6F61',
  text: '#F5F1E8',
  muted: 'rgba(245, 241, 232, 0.64)',
};

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

export default function LoginScreen({ onBack, onSuccess, loading, error: parentError }) {
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  const displayError = localError || parentError;

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (parentError) setLocalError('');
  }, [parentError]);

  const handleEmailLogin = () => {
    if (!email.trim() || !email.includes('@')) {
      setLocalError('Введите корректный email');
      return;
    }
    if (password.length < 6) {
      setLocalError('Пароль должен быть не менее 6 символов');
      return;
    }
    setLocalError('');
    onSuccess({ email: email.trim().toLowerCase(), password });
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
              Вход
            </h1>
          </div>
        </div>
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
          <label style={labelSx}>Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="player@example.com"
            autoComplete="email"
            style={{ ...inputSx, marginBottom: '18px' }}
            onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(216,243,74,0.55)'}
            onBlur={(e) => e.currentTarget.style.borderColor = C.border}
          />

          <label style={labelSx}>Пароль</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            onKeyDown={(e) => e.key === 'Enter' && handleEmailLogin()}
            style={{ ...inputSx, marginBottom: '20px' }}
            onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(216,243,74,0.55)'}
            onBlur={(e) => e.currentTarget.style.borderColor = C.border}
          />

          <button
            onClick={handleEmailLogin}
            disabled={loading}
            style={{
              width: '100%',
              padding: '17px',
              background: C.lime,
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
            {loading ? 'Входим...' : 'Войти'}
          </button>

          {displayError && (
            <div style={{
              background: 'rgba(255,111,97,0.08)',
              borderRadius: '16px',
              padding: '12px 14px',
              marginTop: '16px',
              border: '1px solid rgba(255,111,97,0.25)',
              color: '#ffb0a8',
              fontSize: '13px',
              lineHeight: 1.5,
            }}>
              {displayError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
