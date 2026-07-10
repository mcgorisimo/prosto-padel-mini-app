import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';

const C = {
  bg:     '#020617',
  card:   '#0f172a',
  border: '#1E2755',
  text:   '#FFFFFF',
  muted:  '#8B9CC8',
  loss:   '#EF4444',
};

export default function AccountScreen({ onBack, showToast }) {
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

  const handleDelete = () => {
    const message =
      'Удалить аккаунт?\n\n' +
      'Все данные (имя, статистика, матчи, настройки) будут стёрты безвозвратно. ' +
      'Это действие нельзя отменить.';

    const proceed = () => {
      localStorage.clear();
      showToast('Аккаунт удален!', 'error');
      window.location.reload();
    };

    if (tg?.showConfirm) {
      tg.showConfirm(message, (confirmed) => {
        if (confirmed) proceed();
      });
    } else if (window.confirm(message)) {
      proceed();
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
          color: C.muted,
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '8px',
          paddingLeft: '4px',
        }}>
          Опасная зона
        </div>

        <div style={{
          background: 'rgba(239, 68, 68, 0.04)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '14px',
          padding: '16px',
        }}>
          <div style={{
            color: C.text,
            fontSize: '15px',
            fontWeight: 600,
            marginBottom: '6px',
          }}>
            Удаление аккаунта
          </div>
          <div style={{
            color: C.muted,
            fontSize: '13px',
            lineHeight: 1.5,
            marginBottom: '14px',
          }}>
            Это действие безвозвратно удалит все ваши данные: профиль, историю матчей, рейтинг, настройки. Восстановить их не получится.
          </div>

          <button
            onClick={handleDelete}
            style={{
              width: '100%',
              padding: '12px',
              background: 'transparent',
              color: C.loss,
              border: `1px solid ${C.loss}`,
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 0.15s ease',
            }}
            onMouseDown={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
            onMouseUp={(e)   => { e.currentTarget.style.background = 'transparent'; }}
            onMouseLeave={(e)=> { e.currentTarget.style.background = 'transparent'; }}
          >
            <Trash2 size={16} />
            Удалить аккаунт
          </button>
        </div>
      </div>
    </div>
  );
}
