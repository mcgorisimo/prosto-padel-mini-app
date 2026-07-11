import React, { useEffect, useState } from 'react';
import { CalendarDays, ClipboardList, UsersRound } from 'lucide-react';
import AdminPlayersScreen from './AdminPlayersScreen';
import { useTelegram } from '../hooks/useTelegram';

const C = {
  bg: '#050F0B',
  card: 'rgba(255,255,255,0.045)',
  surface: '#071F16',
  border: 'rgba(245,241,232,0.12)',
  accent: '#D8F34A',
  text: '#F5F1E8',
  muted: 'rgba(245,241,232,0.62)',
  coral: '#FF6F61',
};

const SECTIONS = [
  {
    key: 'players',
    title: 'Игроки клуба',
    text: 'Скоро: база зарегистрированных игроков',
    Icon: UsersRound,
  },
  {
    key: 'calendar',
    title: 'Календарь клуба',
    text: 'Скоро: полный календарь клуба',
    Icon: CalendarDays,
  },
  {
    key: 'requests',
    title: 'Матчи и заявки',
    text: 'Скоро: управление матчами и заявками',
    Icon: ClipboardList,
  },
];

function Header({ onBack }) {
  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '18px 12px 14px',
      borderBottom: `1px solid ${C.border}`,
      background: C.bg,
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
        fontWeight: 800,
        margin: 0,
      }}>
        Админ-панель
      </h1>
    </header>
  );
}

export default function AdminScreen({ user, onBack }) {
  const { tg } = useTelegram();
  const isAdmin = user?.role === 'admin';
  const [section, setSection] = useState(null);

  useEffect(() => {
    if (section) return;
    const back = tg?.BackButton;
    if (!back) return;
    back.show();
    back.onClick(onBack);
    return () => {
      back.offClick(onBack);
      back.hide();
    };
  }, [tg, onBack, section]);

  if (section === 'players') {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: '40px' }}>
        <Header onBack={() => setSection(null)} />
        <AdminPlayersScreen user={user} onBack={() => setSection(null)} />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: '40px' }}>
      <Header onBack={onBack} />

      {!isAdmin ? (
        <div style={{ padding: '24px 16px 0' }}>
          <div style={{
            background: 'rgba(255,111,97,0.08)',
            border: '1px solid rgba(255,111,97,0.24)',
            borderRadius: '16px',
            padding: '16px',
          }}>
            <div style={{ color: C.text, fontSize: '16px', fontWeight: 800, marginBottom: '8px' }}>
              Раздел доступен только администратору
            </div>
            <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.55, marginBottom: '14px' }}>
              Для управления клубом нужен админский профиль.
            </div>
            <button onClick={onBack} style={{
              width: '100%',
              padding: '12px',
              background: 'transparent',
              color: C.coral,
              border: `1px solid ${C.coral}`,
              borderRadius: '12px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}>
              Назад
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.55, marginBottom: '16px' }}>
            Рабочее пространство клуба. Разделы ниже пока подготовлены без загрузки данных.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {SECTIONS.map(({ key, title, text, Icon }) => {
              const isClickable = key === 'players';
              const Tag = isClickable ? 'button' : 'div';

              return (
              <Tag key={title} onClick={isClickable ? () => setSection(key) : undefined} style={{
                width: '100%',
                textAlign: 'left',
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '16px',
                padding: '16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                cursor: isClickable ? 'pointer' : 'default',
              }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  background: C.surface,
                  color: C.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon size={19} strokeWidth={1.9} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: C.text, fontSize: '15px', fontWeight: 800, marginBottom: '5px' }}>
                    {title}
                  </div>
                  <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.45 }}>
                    {text}
                  </div>
                </div>
              </Tag>
            );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
