import React, { useEffect, useState } from 'react';

const tg = typeof window !== 'undefined' && window.Telegram?.WebApp
  ? window.Telegram.WebApp
  : null;

const C = {
  bg: '#050F0B',
  deep: '#071F16',
  text: '#F5F1E8',
  muted: 'rgba(245, 241, 232, 0.68)',
  lime: '#D8F34A',
  coral: '#FF6F61',
  border: 'rgba(245,241,232,0.10)',
};

function CourtBackground() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `
          radial-gradient(circle at 50% 0%, rgba(216,243,74,0.10), transparent 22rem),
          radial-gradient(circle at 14% 20%, rgba(255,111,97,0.08), transparent 15rem),
          linear-gradient(180deg, #071F16 0%, #050F0B 58%, #050F0B 100%)
        `,
      }} />

      <div style={{
        position: 'absolute',
        top: '10%',
        left: '8%',
        right: '8%',
        height: '34%',
        border: '1px solid rgba(245,241,232,0.07)',
        borderRadius: '24px',
      }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: '1px', background: 'rgba(245,241,232,0.045)' }} />
        <div style={{ position: 'absolute', left: '10%', right: '10%', top: '50%', height: '1px', background: 'rgba(245,241,232,0.045)' }} />
      </div>
    </div>
  );
}

export default function WelcomeScreen({ onSignUp, onLogin }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 40);
    return () => clearTimeout(t);
  }, []);

  const fadeStyle = (delay = 0) => ({
    opacity: show ? 1 : 0,
    transform: show ? 'none' : 'translateY(18px)',
    transition: `opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s`,
  });

  const handlePress = (callback) => {
    tg?.HapticFeedback?.impactOccurred?.('light');
    callback();
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: C.bg,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <style>{`
        .welcome-btn {
          transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .welcome-btn:active {
          transform: scale(0.985);
        }
      `}</style>

      <CourtBackground />

      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: '28px 22px 40px',
      }}>
        <div style={{ ...fadeStyle(0), marginTop: '24px' }}>
          <div style={{
            background: 'rgba(255,255,255,0.045)',
            border: `1px solid ${C.border}`,
            borderRadius: '28px',
            padding: '24px',
            boxShadow: '0 24px 80px rgba(0,0,0,0.34)',
            backdropFilter: 'blur(18px)',
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '20px',
              background: 'rgba(216,243,74,0.10)',
              border: '1px solid rgba(216,243,74,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '30px',
              fontWeight: 900,
              color: C.lime,
              marginBottom: '22px',
              boxShadow: '0 18px 42px rgba(0,0,0,0.30)',
            }}>
              П
            </div>

            <div style={{ color: C.muted, fontSize: '11px', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '8px' }}>
              Клубное приложение
            </div>

            <h1 style={{ color: C.text, fontSize: '34px', fontWeight: 850, lineHeight: 1.04, margin: '0 0 14px' }}>
              Просто Падел
            </h1>

            <p style={{ color: C.muted, fontSize: '16px', lineHeight: 1.6, margin: 0 }}>
              Профиль игрока, матчи, бронирования и события клуба в ТРЦ «Отрада».
            </p>

            <div style={{
              height: '1px',
              margin: '24px 0 0',
              background: 'linear-gradient(90deg, rgba(216,243,74,0.38), rgba(245,241,232,0.05))',
            }} />
          </div>
        </div>

        <div style={{ ...fadeStyle(0.12), marginTop: '18px' }}>
          <button
            className="welcome-btn"
            onClick={() => handlePress(onSignUp)}
            style={{
              width: '100%',
              padding: '17px 18px',
              background: C.lime,
              color: C.bg,
              border: '1px solid rgba(216,243,74,0.38)',
              borderRadius: '20px',
              fontSize: '16px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 16px 40px rgba(216,243,74,0.16)',
              marginBottom: '12px',
            }}
          >
            Создать профиль
          </button>

          <button
            className="welcome-btn"
            onClick={() => handlePress(onLogin)}
            style={{
              width: '100%',
              padding: '16px 18px',
              background: 'rgba(245,241,232,0.03)',
              color: C.text,
              border: '1px solid rgba(245,241,232,0.18)',
              borderRadius: '20px',
              fontSize: '16px',
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            У меня есть аккаунт
          </button>

          <div style={{ textAlign: 'center', marginTop: '22px', color: 'rgba(245,241,232,0.42)', fontSize: '11px', letterSpacing: '0.04em', lineHeight: 1.5 }}>
            prostopdl.ru · ТРЦ «Отрада», Пятницкое ш., 1
          </div>
        </div>
      </div>
    </div>
  );
}
