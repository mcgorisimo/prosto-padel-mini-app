import React, { useState } from 'react';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const C = {
  slate:   '#020617', // slate-950 — фон чека
  surface: '#141B3D',
  bg:      '#0A0F2E',
  border:  '#1E2755',
  accent:  '#1E3AE8',
  text:    '#FFFFFF',
  muted:   '#8B9CC8',
  gold:    '#D4AF37',
  green:   '#22C55E',
  red:     '#EF4444',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = (n) => n.toLocaleString('ru-RU') + ' ₽';

const fmtHours = (h) => {
  const full = Math.floor(h);
  const half = h % 1 !== 0;
  if (full === 0) return '30 мин';
  if (!half)      return `${full}ч`;
  return `${full}ч 30мин`;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryChip({ icon, label, value }) {
  return (
    <div style={{
      flex: 1, background: C.bg, borderRadius: '10px',
      padding: '10px 8px', border: `1px solid ${C.border}`, textAlign: 'center',
    }}>
      <div style={{ fontSize: '16px', marginBottom: '3px' }}>{icon}</div>
      <div style={{ color: C.muted, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: C.text, fontWeight: 700, fontSize: '13px', marginTop: '2px' }}>{value}</div>
    </div>
  );
}

function PriceReceipt({ breakdown, totalPrice }) {
  return (
    <div style={{
      background: C.slate, borderRadius: '14px', padding: '18px',
      marginBottom: '20px', border: '1px solid rgba(212,175,55,0.15)',
    }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '14px' }}>
        ✦ Расчёт стоимости
      </div>

      {breakdown.map((line, i) => {
        const isPrime = line.label === 'Prime Time';
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <div style={{ color: isPrime ? C.gold : C.muted, fontSize: '13px', fontWeight: 600 }}>
                {isPrime ? '✦ Prime Time' : '☀ Дневное время'}
              </div>
              <div style={{ color: '#475569', fontSize: '11px', marginTop: '2px' }}>
                {fmtHours(line.hours)} × {line.rate.toLocaleString('ru-RU')} ₽/ч
              </div>
            </div>
            <span style={{ color: isPrime ? C.gold : C.text, fontWeight: 700, fontSize: '15px' }}>
              {fmtPrice(line.amount)}
            </span>
          </div>
        );
      })}

      <div style={{ height: '1px', background: 'rgba(212,175,55,0.2)', margin: '14px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: C.text, fontWeight: 700, fontSize: '15px' }}>Итого</span>
        <span style={{ color: C.gold, fontWeight: 800, fontSize: '28px', letterSpacing: '-0.02em' }}>
          {fmtPrice(totalPrice)}
        </span>
      </div>
    </div>
  );
}

function ConfirmedState() {
  return (
    <div style={{
      textAlign: 'center', padding: '22px 16px',
      background: 'rgba(34,197,94,0.08)', borderRadius: '14px',
      border: '1px solid rgba(34,197,94,0.25)',
    }}>
      <div style={{ fontSize: '36px', marginBottom: '8px' }}>✅</div>
      <div style={{ color: C.green, fontWeight: 700, fontSize: '17px', marginBottom: '4px' }}>
        Бронирование подтверждено!
      </div>
      <div style={{ color: C.muted, fontSize: '12px' }}>Детали сохранены в приложении</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MatchConfirmationModal({ time, duration, breakdown, totalPrice, user, onConfirm, onCancel }) {
  const [name, setName]         = useState([user?.first_name, user?.last_name].filter(Boolean).join(' '));
  const [phone, setPhone]       = useState('');
  const [phoneError, setPhError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = () => {
    if (!phone.trim()) { setPhError(true); return; }
    setConfirmed(true);
    setTimeout(() => onConfirm({ name, phone }), 1800);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.82)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        background: C.surface, borderRadius: '20px 20px 0 0',
        width: '100%', maxWidth: '480px',
        border: `1px solid ${C.border}`,
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Sticky drag handle */}
        <div style={{ padding: '12px 20px 0', position: 'sticky', top: 0, background: C.surface, zIndex: 1 }}>
          <div style={{ width: '40px', height: '4px', background: C.border, borderRadius: '2px', margin: '0 auto 16px' }} />
        </div>

        <div style={{ padding: '0 20px 44px' }}>
          {/* Header */}
          <h3 style={{ color: C.text, fontSize: '20px', fontWeight: 700, margin: '0 0 4px' }}>
            Подтверждение бронирования
          </h3>
          <p style={{ color: C.muted, fontSize: '13px', marginBottom: '20px' }}>
            Ультрапанорамный корт · 2×2 · {fmtHours(duration)}
          </p>

          {/* Summary chips */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <SummaryChip icon="🕐" label="Начало"  value={time} />
            <SummaryChip icon="⏱" label="Длит."   value={fmtHours(duration)} />
            <SummaryChip icon="👥" label="Формат"  value="2×2" />
          </div>

          {/* Price receipt */}
          <PriceReceipt breakdown={breakdown} totalPrice={totalPrice} />

          {/* Contact fields */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
              Контактные данные
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ваше имя"
              style={inputSx(false)}
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhError(false); }}
              placeholder="+7 (___) ___-__-__"
              style={inputSx(phoneError)}
            />
            {phoneError && (
              <div style={{ color: C.red, fontSize: '12px', marginTop: '-6px', marginBottom: '10px' }}>
                Укажите номер для подтверждения брони
              </div>
            )}
          </div>

          {/* Cancellation policy */}
          <div style={{
            display: 'flex', gap: '8px', alignItems: 'flex-start',
            background: 'rgba(30,58,232,0.07)', borderRadius: '10px',
            padding: '10px 12px', marginBottom: '20px',
          }}>
            <span style={{ fontSize: '14px', flexShrink: 0 }}>ℹ️</span>
            <span style={{ color: C.muted, fontSize: '12px', lineHeight: 1.5 }}>
              Бесплатная отмена возможна за{' '}
              <strong style={{ color: C.text }}>24 часа</strong> до начала матча.
              После этого срока стоимость корта не возвращается.
            </span>
          </div>

          {/* CTA */}
          {confirmed ? (
            <ConfirmedState />
          ) : (
            <>
              <button onClick={handleConfirm} style={{
                width: '100%', padding: '18px',
                background: 'linear-gradient(135deg, #1E3AE8 0%, #3b82f6 100%)',
                color: '#fff', border: 'none', borderRadius: '14px',
                fontSize: '16px', fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(30,58,232,0.4)',
                marginBottom: '12px',
              }}>
                Подтвердить бронирование
              </button>
              <button onClick={onCancel} style={{
                width: '100%', padding: '15px', background: 'transparent',
                color: C.muted, border: `1px solid ${C.border}`,
                borderRadius: '12px', fontSize: '15px', cursor: 'pointer',
              }}>
                Назад
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputSx = (error) => ({
  width: '100%', padding: '13px 14px',
  background: '#0A0F2E',
  border: `1px solid ${error ? '#EF4444' : '#1E2755'}`,
  borderRadius: '10px', color: '#fff', fontSize: '15px',
  outline: 'none', marginBottom: '10px', boxSizing: 'border-box',
  transition: 'border-color 0.2s',
});
