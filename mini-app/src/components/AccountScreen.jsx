import React, { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';

const C = {
  bg:     '#020617',
  card:   '#0f172a',
  border: '#1E2755',
  accent: '#2563eb',
  text:   '#FFFFFF',
  muted:  '#8B9CC8',
  loss:   '#EF4444',
};

export default function AccountScreen({ onBack, onLogout, showToast }) {
  const { tg } = useTelegram();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const back = tg?.BackButton;
    if (!back) return;
    back.show();
    back.onClick(onBack);
    return () => {
      back.offClick(onBack);
      back.hide();
    };
  }, [tg, onBack]);

  const handleLogout = async () => {
    if (typeof onLogout !== 'function') return;
    setIsLoggingOut(true);
    setError('');

    try {
      await onLogout();
    } catch (err) {
      const message = 'Не удалось выйти из аккаунта. Попробуйте еще раз.';
      setError(message);
      showToast?.(message, 'error');
      setIsLoggingOut(false);
    }
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: '40px' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '18px 12px 14px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <button onClick={onBack} aria-label="Назад" style={{
          background: 'transparent',
          border: 'none',
          color: C.muted,
          fontSize: '28px',
          lineHeight: 1,
          cursor: 'pointer',
          padding: '4px 10px',
        }}>
          ‹
        </button>
        <h1 style={{
          color: C.text,
          fontSize: '17px',
          fontWeight: 700,
          margin: 0,
          letterSpacing: '-0.01em',
        }}>
          Управление аккаунтом
        </h1>
      </header>

      <div style={{ padding: '20px 16px 0' }}>
        <div style={{
          background: C.card,
          borderRadius: '14px',
          border: `1px solid ${C.border}`,
          padding: '16px',
          marginBottom: '14px',
        }}>
          <div style={{ color: C.text, fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
            Сессия
          </div>
          <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.55, marginBottom: '14px' }}>
            Выход завершит текущую сессию на этом устройстве. После этого нужно будет войти заново.
          </div>

          <button
            onClick={handleLogout}
            disabled={isLoggingOut || typeof onLogout !== 'function'}
            style={{
              width: '100%',
              padding: '12px',
              background: isLoggingOut ? '#334155' : C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: isLoggingOut ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <LogOut size={16} />
            {isLoggingOut ? 'Выходим...' : 'Выйти из аккаунта'}
          </button>

          {error && (
            <div style={{
              marginTop: '10px',
              color: C.loss,
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.24)',
              borderRadius: '10px',
              padding: '10px 12px',
              fontSize: '13px',
              lineHeight: 1.4,
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          background: C.card,
          borderRadius: '14px',
          border: `1px solid ${C.border}`,
          padding: '16px',
        }}>
          <div style={{ color: C.text, fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
            Удаление аккаунта
          </div>
          <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.55 }}>
            Удаление аккаунта сейчас выполняется через администратора клуба. Мы поможем удалить профиль и связанные данные по запросу.
          </div>
        </div>
      </div>
    </div>
  );
}
