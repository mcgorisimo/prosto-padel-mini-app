import React from 'react';

const STATUS_MESSAGES = Object.freeze({
  checking: 'Проверяем вход через Telegram…',
  temporary_unavailable:
    'Вход через Telegram временно недоступен. Попробуйте снова позже.',
  invalid_telegram_data:
    'Данные Telegram недействительны или устарели. Переоткройте Mini App.',
  conflict_reopen_required:
    'Не удалось повторить вход. Полностью переоткройте Mini App.',
  outside_telegram:
    'Вход через Telegram доступен только внутри Mini App.',
  account_unavailable:
    'Вход через Telegram недоступен для этого аккаунта.',
  internal_error:
    'Не удалось безопасно завершить вход через Telegram.',
  session_restored:
    'Сессия Telegram восстановлена.',
  session_expired:
    'Сессия Telegram истекла. Переоткройте Mini App.',
});

const PROFILE_UNAVAILABLE_MESSAGE =
  'Не удалось загрузить ваш профиль. Полностью переоткройте Mini App.';

export default function TelegramBackendLoginStatus({
  status,
  accountKind,
}) {
  if (status === 'disabled' || status === 'idle') return null;

  let message = status === 'profile_unavailable'
    ? PROFILE_UNAVAILABLE_MESSAGE
    : STATUS_MESSAGES[status];
  let tone = 'rgba(245,241,232,0.96)';
  let background = 'rgba(7,31,22,0.96)';
  let border = 'rgba(216,243,74,0.28)';

  if (status === 'authenticated' || status === 'session_restored') {
    if (status === 'authenticated') {
      message = accountKind === 'new'
        ? 'Вход через Telegram подтверждён: новый аккаунт создан.'
        : 'Вход через Telegram подтверждён: аккаунт найден.';
    }
    tone = '#050F0B';
    background = 'rgba(216,243,74,0.96)';
    border = 'rgba(216,243,74,0.45)';
  } else if (status !== 'checking') {
    border = 'rgba(255,111,97,0.38)';
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="telegram-backend-login-status"
      data-status={status}
      style={{
        position: 'fixed',
        top: 'max(12px, env(safe-area-inset-top))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        width: 'calc(100% - 32px)',
        maxWidth: '390px',
        boxSizing: 'border-box',
        padding: '10px 14px',
        borderRadius: '14px',
        border: `1px solid ${border}`,
        background,
        color: tone,
        boxShadow: '0 12px 36px rgba(0,0,0,0.34)',
        fontSize: '12px',
        fontWeight: 700,
        lineHeight: 1.45,
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      {message}
    </div>
  );
}
