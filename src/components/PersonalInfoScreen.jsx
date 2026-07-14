import React, { useEffect, useState } from 'react';
import { useTelegram } from '../hooks/useTelegram';
import { updateMyProfile } from '../lib/profileApi';

const C = {
  bg:      '#020617',
  card:    '#0f172a',
  border:  '#1E2755',
  accent:  '#2563eb',
  text:    '#FFFFFF',
  muted:   '#8B9CC8',
  loss:    '#EF4444',
};

const SIDE_OPTIONS = [
  { value: 'Left',  label: 'Лев.' },
  { value: 'Both',  label: 'Оба'  },
  { value: 'Right', label: 'Прав.' },
];

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: '14px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        color: C.muted, fontSize: '11px', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: '6px',
      }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ color: '#475569', fontSize: '11px', marginTop: '5px', lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </label>
  );
}

const inputBaseSx = {
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
  transition: 'border-color 0.15s ease',
};

function TextInput({ disabled, ...props }) {
  return (
    <input
      {...props}
      disabled={disabled}
      style={{
        ...inputBaseSx,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'not-allowed' : 'text',
      }}
      onFocus={(e) => { if (!disabled) e.target.style.borderColor = C.accent; }}
      onBlur={(e)  => { e.target.style.borderColor = C.border; }}
    />
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{
      display: 'flex',
      background: C.bg,
      borderRadius: '10px',
      padding: '3px',
      border: `1px solid ${C.border}`,
    }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: '8px',
              border: 'none',
              background: active ? C.accent : 'transparent',
              color: active ? '#fff' : C.muted,
              fontSize: '13px',
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              transition: 'all 0.18s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PersonalInfoScreen({ user, onBack, showToast, onProfileSaved }) {
  const { tg } = useTelegram();
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName]   = useState(user?.lastName || '');
  const [phone, setPhone]         = useState(user?.phone || '');
  const [preferredSide, setPreferredSide] = useState(user?.side_preference || user?.sidePreference || 'Both');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Telegram BackButton
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

  const handleSave = async () => {
    if (!user?.id) {
      const message = 'Не удалось определить профиль. Войдите заново и попробуйте еще раз.';
      setSaveError(message);
      showToast?.(message, 'error');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        side_preference: preferredSide,
      };

      const data = await updateMyProfile(payload);
      if (
        data.first_name !== payload.first_name ||
        data.last_name !== payload.last_name ||
        (data.phone || '') !== payload.phone ||
        (data.side_preference || 'Both') !== payload.side_preference
      ) {
        throw new Error('Profile update was not persisted');
      }

      onProfileSaved?.(data);
      showToast?.('Профиль сохранен', 'success');
      onBack?.();
    } catch (err) {
      const message = 'Профиль не сохранен. Проверьте подключение и попробуйте еще раз.';
      setSaveError(message);
      showToast?.(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: '120px' }}>
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
          Личная информация
        </h1>
      </header>

      <div style={{ padding: '20px 16px 0' }}>
        <Field label="Имя">
          <TextInput
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Имя"
            autoComplete="given-name"
          />
        </Field>

        <Field label="Фамилия">
          <TextInput
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Фамилия"
            autoComplete="family-name"
          />
        </Field>

        <Field label="Телефон">
          <TextInput
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 (___) ___-__-__"
            inputMode="tel"
            autoComplete="tel"
          />
        </Field>

        <Field label="Telegram" hint="Юзернейм меняется в настройках Telegram">
          <TextInput
            type="text"
            value={user?.username ? `@${user.username}` : ''}
            placeholder="@username не задан"
            disabled
            readOnly
          />
        </Field>

        <Field label="Предпочтительная сторона" hint="Ваш выбор поможет другим игрокам при поиске партнера">
          <Segmented value={preferredSide} onChange={setPreferredSide} options={SIDE_OPTIONS} />
        </Field>

        {saveError && (
          <div style={{
            color: C.loss,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.24)',
            borderRadius: '10px',
            padding: '10px 12px',
            fontSize: '13px',
            lineHeight: 1.4,
          }}>
            {saveError}
          </div>
        )}
      </div>

      <div style={{
        position: 'fixed',
        left: 0, right: 0, bottom: 0,
        maxWidth: '480px',
        margin: '0 auto',
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
        background: 'linear-gradient(to top, #020617 60%, rgba(2,6,23,0))',
      }}>
        <button onClick={handleSave} disabled={isSaving} style={{
          width: '100%',
          padding: '15px',
          background: isSaving ? '#334155' : 'linear-gradient(135deg, #1E3AE8, #2563eb)',
          color: '#fff',
          border: 'none',
          borderRadius: '14px',
          fontSize: '15px',
          fontWeight: 700,
          cursor: isSaving ? 'default' : 'pointer',
          boxShadow: '0 4px 18px rgba(37,99,235,0.35)',
          transition: 'background 0.2s ease',
        }}>
          {isSaving ? 'Сохраняем...' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
