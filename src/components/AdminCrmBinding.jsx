import { useEffect, useRef, useState } from 'react';

const messages = {
  not_configured: 'Ручная привязка пока не включена на сервере.',
  forbidden: 'Нет права подтверждать связь с YCLIENTS.',
  not_found: 'Карточка в клубе не найдена. Проверьте ID.',
  review_required:
    'Данные изменились или карточка уже связана. Нужна проверка администратора.',
  unknown:
    'Результат пока неизвестен. Повторите подтверждение: вторая связь не создастся.',
  linked: 'Аккаунт игрока связан с карточкой YCLIENTS.',
};
const button = {
  width: '100%',
  padding: '12px',
  borderRadius: 12,
  background: 'rgba(216,243,74,0.12)',
  border: '1px solid rgba(216,243,74,0.32)',
  color: '#D8F34A',
  fontWeight: 700,
  marginTop: 12,
};
export default function AdminCrmBinding({ player, actions }) {
  const [clientId, setClientId] = useState('');
  const [preview, setPreview] = useState(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [linked, setLinked] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const run = async (confirm) => {
    if (pending.current || linked || (confirm && (!checked || !preview)))
      return;
    if (
      !confirm &&
      (!/^[1-9][0-9]{0,15}$/u.test(clientId) ||
        !Number.isSafeInteger(Number(clientId)))
    ) {
      setMessage('Укажите числовой ID карточки клиента YCLIENTS.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setMessage('');
    const current = generation.current;
    try {
      const result = confirm
        ? await actions?.confirmManualCrmBinding?.(player.id, preview.draftId)
        : await actions?.previewManualCrmBinding?.(player.id, Number(clientId));
      if (current !== generation.current) return;
      if (result?.outcome === 'preview') {
        setPreview(result);
        setChecked(false);
      } else {
        setMessage(
          messages[result?.outcome] ??
            'Не удалось выполнить запрос. Проверьте доступ и попробуйте снова.',
        );
        if (result?.outcome === 'linked') {
          setLinked(true);
          setPreview(null);
        }
        if (
          ['review_required', 'forbidden', 'not_found'].includes(
            result?.outcome,
          )
        ) {
          setPreview(null);
          setChecked(false);
        }
      }
    } catch {
      if (current === generation.current) setMessage(messages.unknown);
    } finally {
      if (current === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <section
      aria-label="Связь с YCLIENTS"
      style={{
        marginTop: 14,
        padding: 16,
        borderRadius: 16,
        border: '1px solid rgba(245,241,232,0.12)',
        background: 'rgba(255,255,255,0.045)',
        color: '#F5F1E8',
      }}
    >
      <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Связь с YCLIENTS</h3>
      <p style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.75 }}>
        При личной проверке убедитесь, что игрок пользуется этим аккаунтом
        приложения и карточка клуба принадлежит ему. SMS не требуется.
      </p>
      {!linked && (
        <>
          <label style={{ display: 'block', fontSize: 13 }}>
            ID карточки клиента в YCLIENTS
            <input
              inputMode="numeric"
              value={clientId}
              disabled={busy}
              onChange={(event) => {
                setClientId(event.target.value);
                setPreview(null);
                setChecked(false);
                setMessage('');
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 12,
                marginTop: 7,
                borderRadius: 12,
                background: '#071F16',
                color: '#F5F1E8',
                border: '1px solid rgba(245,241,232,0.12)',
                fontSize: 16,
              }}
            />
          </label>
          <button style={button} disabled={busy} onClick={() => run(false)}>
            {busy ? 'Проверяем…' : 'Проверить карточку'}
          </button>
        </>
      )}
      {preview && (
        <div style={{ marginTop: 14, fontSize: 14 }}>
          <strong>{preview.name}</strong>
          <div style={{ margin: '5px 0 12px' }}>
            Телефон: {preview.phoneHint}
          </div>
          <label style={{ display: 'flex', gap: 10, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(e) => setChecked(e.target.checked)}
            />
            Я лично проверил: аккаунт игрока и эта карточка принадлежат одному
            человеку.
          </label>
          <button
            style={button}
            disabled={busy || !checked}
            onClick={() => run(true)}
          >
            Подтвердить связь
          </button>
        </div>
      )}
      {message && (
        <p role="status" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {message}
        </p>
      )}
    </section>
  );
}
