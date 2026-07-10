import React, { useEffect, useState } from 'react';
import { ChevronRight, User, Shield, Lock, UserCog } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';
import PersonalInfoScreen from './PersonalInfoScreen';
import PrivacyScreen from './PrivacyScreen';
import SecurityScreen from './SecurityScreen';
import AccountScreen from './AccountScreen';
import Toast from "./Toast";// Import Toast component

const C = {
  bg:      '#020617',
  card:    '#0f172a',
  border:  '#1E2755',
  text:    '#FFFFFF',
  muted:   '#8B9CC8',
};

const SECTIONS = [
  { key: 'personal', icon: User,    label: 'Личная информация'    },
  { key: 'privacy',  icon: Shield,  label: 'Конфиденциальность'   },
  { key: 'security', icon: Lock,    label: 'Безопасность'         },
  { key: 'account',  icon: UserCog, label: 'Управление аккаунтом' },
];

function SettingsRow({ icon: Icon, label, onClick, isLast }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 18px',
        background: 'transparent',
        border: 'none',
        borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
        color: C.text,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      }}
      onMouseDown={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseUp={(e)   => { e.currentTarget.style.background = 'transparent'; }}
      onMouseLeave={(e)=> { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <Icon size={20} color={C.muted} strokeWidth={1.8} />
        <span style={{ fontSize: '15px', fontWeight: 500 }}>{label}</span>
      </span>
      <ChevronRight size={18} color="#475569" strokeWidth={2} />
    </button>
  );
}

export default function EditProfileScreen({ user, onBack, showToast }) {
  const { tg } = useTelegram();
  const [subScreen, setSubScreen] = useState(null);

  // Telegram BackButton — only on the menu list. Sub-screens manage their own.
  useEffect(() => {
    if (subScreen !== null) return;
    const back = tg?.BackButton;
    if (!back) return;
    back.show();
    back.onClick(onBack);
    return () => {
      back.offClick(onBack);
      back.hide();
    };
  }, [tg, onBack, subScreen]);

  const handleNavigate = (sectionKey) => {
    tg?.HapticFeedback?.impactOccurred?.('light');
    setSubScreen(sectionKey);
  };

  if (subScreen === 'personal') {
    return <PersonalInfoScreen user={user} onBack={() => setSubScreen(null)} showToast={showToast} />;
  }
  if (subScreen === 'privacy') {
    return <PrivacyScreen user={user} onBack={() => setSubScreen(null)} showToast={showToast} />;
  }
  if (subScreen === 'security') {
    return <SecurityScreen user={user} onBack={() => setSubScreen(null)} showToast={showToast} />;
  }
  if (subScreen === 'account') {
    return <AccountScreen user={user} onBack={() => setSubScreen(null)} showToast={showToast} />;
  }

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
          Настройки
        </h1>
      </header>

      <div style={{
        background: C.card,
        margin: '12px 16px',
        borderRadius: '14px',
        border: `1px solid ${C.border}`,
        overflow: 'hidden',
      }}>
        {SECTIONS.map((section, idx) => (
          <SettingsRow
            key={section.key}
            icon={section.icon}
            label={section.label}
            onClick={() => handleNavigate(section.key)}
            isLast={idx === SECTIONS.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
