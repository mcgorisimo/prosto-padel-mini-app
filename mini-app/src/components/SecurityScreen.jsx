import React, { useEffect, useState } from 'react';
import { useTelegram } from '../hooks/useTelegram';

const C = {
  bg:     '#020617',
  card:   '#0f172a',
  border: '#1E2755',
  accent: '#2563eb',
  text:   '#FFFFFF',
  muted:  '#8B9CC8',
  win:    '#22C55E',
  loss:   '#EF4444',
};

const TWO_FA_KEY = 'dp_security_2fa';

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      aria-pressed={value}
      style={{
        width: '46px',
        height: '28px',
        borderRadius: '14px',
        background: value ? C.accent : '#1e293b',
        border: 'none',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.2s ease',
        flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute',
        top: '3px',
        left: value ? '21px' : '3px',
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.2s ease',
        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      }} />
    </button>
  );
}

const inputSx = {
  width: '100%',
  padding: '12px 14px',
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: '10px',
  color: C.text,
  fontSize: '15px',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  marginBottom: '8px',
};
export default function SecurityScreen({ onBack, showToast }) {
  const { tg } = useTelegram();

  const [oldPwd, setOldPwd]         = useState('');
  const [newPwd, setNewPwd]         = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [twoFA, setTwoFA]           = useState(
    () => localStorage.getItem(TWO_FA_KEY) === 'true'
  );
  const [pwdMessage, setPwdMessage] = useState(null);

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

  const handleChangePassword = () => {
    if (!oldPwd || !newPwd || !confirmPwd) {
      setPwdMessage({ type: 'error', text: 'Заполните все поля' });
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMessage({ type: 'error', text: 'Новый пароль и подтверждение не совпадают' });
      return;
    }
    if (newPwd.length < 6) {
      setPwdMessage({ type: 'error', text: 'Минимум 6 символов в новом пароле' });
      return;
    }

    setPwdMessage({ type: 'success', text: 'Демо: в продакшене пароль будет изменён' });
    showToast('Пароль успешно изменен!', 'success');
    tg?.HapticFeedback?.notificationOccurred?.('success');
    setTimeout(() => setPwdMessage(null), 3500);
  };

  const handleToggle2FA = (newValue) => {
    setTwoFA(newValue);
    localStorage.setItem(TWO_FA_KEY, String(newValue));
    tg?.HapticFeedback?.selectionChanged?.();
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
          Безопасность
        </h1>
      </header>

      <div style={{ padding: '20px 16px 0' }}>
        {/* 2FA card */}
        <div style={{
          background: C.card,
          borderRadius: '14px',
          border: `1px solid ${C.border}`,
          padding: '16px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: C.text, fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
              Двухфакторная аутентификация
            </div>
            <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.4 }}>
              {twoFA
                ? 'Включена. Код подтверждения через Telegram'
                : 'Дополнительная защита аккаунта при входе'}
            </div>
          </div>
          <Toggle value={twoFA} onChange={handleToggle2FA} />
        </div>

        {/* Password change */}
        <div style={{
          color: C.muted,
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '8px',
          paddingLeft: '4px',
        }}>
          Изменить пароль
        </div>
        <div style={{
          background: C.card,
          borderRadius: '14px',
          border: `1px solid ${C.border}`,
          padding: '16px',
        }}>
          <input
            type="password"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            placeholder="Текущий пароль"
            style={inputSx}
            autoComplete="current-password"
          />
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="Новый пароль (мин. 6 символов)"
            style={inputSx}
            autoComplete="new-password"
          />
          <input
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="Повторите новый пароль"
            style={{ ...inputSx, marginBottom: '12px' }}
            autoComplete="new-password"
          />

          <button
            onClick={handleChangePassword}
            style={{
              width: '100%',
              padding: '12px',
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Изменить пароль
          </button>

          {pwdMessage && (
            <div style={{
              marginTop: '10px',
              padding: '9px 12px',
              borderRadius: '8px',
              background: pwdMessage.type === 'success'
                ? 'rgba(34,197,94,0.1)'
                : 'rgba(239,68,68,0.1)',
              color: pwdMessage.type === 'success' ? C.win : C.loss,
              fontSize: '12px',
              lineHeight: 1.4,
            }}>
              {pwdMessage.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
