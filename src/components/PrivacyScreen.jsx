import React, { useEffect } from 'react';
import { useTelegram } from '../hooks/useTelegram';

const C = {
  bg:     '#020617',
  card:   '#0f172a',
  border: '#1E2755',
  text:   '#FFFFFF',
  muted:  '#8B9CC8',
};

export default function PrivacyScreen({ onBack }) {
  const { tg } = useTelegram();

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
          background: C.card,
          borderRadius: '14px',
          border: `1px solid ${C.border}`,
          padding: '16px',
        }}>
          <div style={{ color: C.text, fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
            Как используется профиль
          </div>
          <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.55 }}>
            Ваш профиль используется для участия в матчах клуба: имя, уровень и игровая сторона помогают другим игрокам понимать состав матча.
          </div>
          <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.55, marginTop: '10px' }}>
            Отдельные настройки видимости появятся позже. Сейчас профиль отображается только в рамках игровых сценариев клуба.
          </div>
        </div>
      </div>
    </div>
  );
}
