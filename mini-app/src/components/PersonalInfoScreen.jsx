import React, { useEffect, useState } from 'react';
import { Lock as LockIcon } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useTelegram } from '../hooks/useTelegram';

const C = {
  bg:      '#020617',
  card:    '#0f172a',
  surface: '#141B3D',
  border:  '#1E2755',
  accent:  '#2563eb',
  text:    '#FFFFFF',
  muted:   '#8B9CC8',
  gold:    '#D4AF37',
  win:     '#22C55E',
  loss:    '#EF4444',
};

const KEYS = {
  firstName:     'dp_firstName',
  lastName:      'dp_lastName',
  birthday:      'dp_birthday',
  phone:         'dp_phone',
  email:         'dp_email',
  language:      'dp_language',
  preferredSide: 'dp_preferredSide',
  gender:        'dp_gender',
};
const NAME_COUNT_KEY = 'dp_nameCount';

const SIDE_OPTIONS = [
  { value: 'Left',  label: 'Лев.' },
  { value: 'Both',  label: 'Оба'  },
  { value: 'Right', label: 'Прав.' },
];
const LANG_OPTIONS = [
  { value: 'RU', label: 'Русский' },
  { value: 'EN', label: 'English' },
];
const GENDER_OPTIONS = [
  { value: 'male',   label: '♂ Мужской' },
  { value: 'female', label: '♀ Женский' },
];

// ─── Reusable bits ──────────────────────────────────────────────────────────

function Field({ label, hint, locked, children }) {
  return (
    <label style={{ display: 'block', marginBottom: '14px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        color: C.muted, fontSize: '11px', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: '6px',
      }}>
        {label}
        {locked && <LockIcon size={12} color={C.muted} />}
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

// ─── Helpers ────────────────────────────────────────────────────────────────

const isValidEmail = (s) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// ─── Screen ─────────────────────────────────────────────────────────────────
export default function PersonalInfoScreen({ user, onBack, showToast }) {
  const { tg } = useTelegram(); // <--- Здесь больше не должно быть user!

  const initialNameCount = Number(localStorage.getItem(NAME_COUNT_KEY)) || 0;
  const nameLocked = initialNameCount >= 1;

const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName]   = useState(user?.lastName || '');
  const [birthday, setBirthday]   = useState(user?.birthday || '');
  const [phone, setPhone]         = useState(user?.phone || '');
  const [email, setEmail]         = useState(user?.email || '');
  
  const [language, setLanguage] = useState(
    () => localStorage.getItem(KEYS.language) || 'RU'
  );
  const [preferredSide, setPreferredSide] = useState(user?.side_preference || 'Both');
  const [gender, setGender] = useState(
    () => localStorage.getItem(KEYS.gender) || 'male'
  );

  const [emailError, setEmailError] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

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
    try {
      // 1. Отправляем новые данные прямо в Supabase
      if (user?.id) {
        const { error } = await supabase
          .from('profiles')
          .update({
            first_name: firstName,
            last_name: lastName,
            phone: phone,
            side_preference: preferredSide,
            // Если в таблице есть поле email, раскомментируй строку ниже:
            // email: email 
          })
          .eq('id', user.id);

        if (error) throw error;
      }

      // 2. Безопасный вызов уведомления (чтобы больше не было ошибки!)
      if (typeof showToast === 'function') {
        showToast('Профиль успешно обновлен!', 'success');
      } else {
        alert('Профиль успешно обновлен!'); // Запасной вариант, если showToast потерялся
      }

      // 3. Выходим назад в меню настроек
      if (onBack) onBack();

    } catch (err) {
      console.error('Ошибка сохранения профиля:', err);
      if (typeof showToast === 'function') {
        showToast('Ошибка при сохранении', 'error');
      } else {
        alert('Ошибка при сохранении');
      }
    }
  };

  const tgUsername = user?.username ? `@${user.username}` : '';

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
        <Field label="Имя" locked={nameLocked} hint={nameLocked ? 'Изменение через администратора клуба' : null}>
          <TextInput
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Гор"
            disabled={nameLocked}
            autoComplete="given-name"
          />
        </Field>

        <Field label="Фамилия" locked={nameLocked} hint={nameLocked ? null : 'Имя и фамилию можно изменить только один раз'}>
          <TextInput
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Бахшян"
            disabled={nameLocked}
            autoComplete="family-name"
          />
        </Field>

        <Field label="Дата рождения">
          <TextInput
            type="date"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
          />
        </Field>

        <Field label="Пол">
          <Segmented value={gender} onChange={setGender} options={GENDER_OPTIONS} />
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
            type="text" // Assuming user object might have a username
            value={user?.username ? `@${user.username}` : ''}
            placeholder="@username не задан"
            disabled
            readOnly
          />
        </Field>

        <Field
          label="Email"
          hint={emailError ? 'Похоже, в email опечатка' : null}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(false); }}
            placeholder="example@mail.ru"
            inputMode="email"
            autoComplete="email"
            style={{
              ...inputBaseSx,
              borderColor: emailError ? C.loss : C.border,
            }}
          />
        </Field>

        <Field label="Язык интерфейса">
          <Segmented value={language} onChange={setLanguage} options={LANG_OPTIONS} />
        </Field>

        <Field label="Предпочтительная сторона" hint="Ваш выбор поможет другим игрокам при поиске партнера">
          <Segmented value={preferredSide} onChange={setPreferredSide} options={SIDE_OPTIONS} />
        </Field>
      </div>

      {/* Sticky save button */}
      <div style={{
        position: 'fixed',
        left: 0, right: 0, bottom: 0,
        maxWidth: '480px',
        margin: '0 auto',
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
        background: 'linear-gradient(to top, #020617 60%, rgba(2,6,23,0))',
      }}>
        <button onClick={handleSave} style={{
          width: '100%',
          padding: '15px',
          background: savedFlash
            ? 'linear-gradient(135deg, #16a34a, #22c55e)'
            : 'linear-gradient(135deg, #1E3AE8, #2563eb)',
          color: '#fff',
          border: 'none',
          borderRadius: '14px',
          fontSize: '15px',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 18px rgba(37,99,235,0.35)',
          transition: 'background 0.2s ease',
        }}>
          {savedFlash ? '✓ Сохранено' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
