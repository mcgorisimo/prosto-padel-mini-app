import React, { useEffect, useState } from 'react';
import { useTelegram } from '../hooks/useTelegram';

const C = {
  bg:     '#020617',
  card:   '#0f172a',
  border: '#1E2755',
  accent: '#2563eb',
  text:   '#FFFFFF',
  muted:  '#8B9CC8',
};

const PRIVACY_KEY = 'dp_privacy_invite';

const OPTIONS = [
  { value: 'all',      label: 'Все игроки',       hint: 'Любой пользователь клуба может пригласить вас'  },
  { value: 'partners', label: 'Только напарники', hint: 'Только те, с кем вы уже играли'                 },
  { value: 'nobody',   label: 'Никто',            hint: 'Скрыть приглашения. Создавать матчи можете сами' },
];

function RadioRow({ option, selected, onSelect, isLast }) {
  return (
    <button
      onClick={() => onSelect(option.value)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '14px',
        padding: '14px 16px',
        background: 'transparent',
        border: 'none',
        borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: `2px solid ${selected ? C.accent : '#475569'}`,
        flexShrink: 0,
        marginTop: '2px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 0.15s ease',
      }}>
        {selected && (
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: C.accent,
          }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: C.text, fontSize: '15px', fontWeight: 500, marginBottom: '3px' }}>
          {option.label}
        </div>
        <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.4 }}>
          {option.hint}
        </div>
      </div>
    </button>
  );
}

export default function PrivacyScreen({ onBack }) {
  const { tg } = useTelegram();
  const [selected, setSelected] = useState(
    () => localStorage.getItem(PRIVACY_KEY) || 'all'
  );

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

  const handleSelect = (value) => {
    setSelected(value);
    localStorage.setItem(PRIVACY_KEY, value);
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
          Конфиденциальность
        </h1>
      </header>

      <div style={{ padding: '20px 16px 0' }}>
        <div style={{
          color: C.muted,
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '8px',
          paddingLeft: '4px',
        }}>
          Кто может приглашать меня в игру
        </div>

        <div style={{
          background: C.card,
          borderRadius: '14px',
          border: `1px solid ${C.border}`,
          overflow: 'hidden',
        }}>
          {OPTIONS.map((opt, i) => (
            <RadioRow
              key={opt.value}
              option={opt}
              selected={selected === opt.value}
              onSelect={handleSelect}
              isLast={i === OPTIONS.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
