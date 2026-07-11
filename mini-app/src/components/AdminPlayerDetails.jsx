import React, { useMemo, useState } from 'react';
import { getLevelForRating } from '../lib/ratingEngine';
import { supabase } from '../lib/supabaseClient';

const C = {
  bg: '#050F0B',
  card: 'rgba(255,255,255,0.045)',
  surface: '#071F16',
  border: 'rgba(245,241,232,0.12)',
  accent: '#D8F34A',
  text: '#F5F1E8',
  muted: 'rgba(245,241,232,0.62)',
  coral: '#FF6F61',
  win: '#D8F34A',
};

const SELECT_FIELDS = 'id, first_name, last_name, phone, rating, is_verified, role, side_preference, created_at';

const formatName = (player) =>
  [player?.first_name, player?.last_name].filter(Boolean).join(' ') || 'Игрок без имени';

const formatRating = (rating) =>
  Number.isFinite(Number(rating)) ? Number(rating).toFixed(2) : '3.00';

const isPlayerRatingVerified = (player) => player?.is_verified === true;

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '11px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ color: C.muted, fontSize: '12px' }}>{label}</span>
      <span style={{ color: C.text, fontSize: '13px', fontWeight: 700, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  );
}

export default function AdminPlayerDetails({ user, player, onBack, onSaved }) {
  const isAdmin = user?.role === 'admin';
  const [rating, setRating] = useState(formatRating(player?.rating));
  const [isVerified, setIsVerified] = useState(isPlayerRatingVerified(player));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const numericRating = Number(rating);
  const level = useMemo(
    () => getLevelForRating(Number.isFinite(numericRating) ? numericRating : 3.0),
    [numericRating]
  );

  const handleSave = async () => {
    if (!isAdmin || !player?.id) return;
    if (!Number.isFinite(numericRating) || numericRating < 0 || numericRating > 10) {
      setError('Укажите рейтинг от 0 до 10.');
      setSuccess('');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        rating: Math.round(numericRating * 100) / 100,
        is_verified: isVerified,
      };

      const { data, error: updateError } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', player.id)
        .select(SELECT_FIELDS)
        .single();

      if (updateError) throw updateError;
      if (!data?.id) throw new Error('Profile update returned no row');
      if (Number(data.rating) !== payload.rating || isPlayerRatingVerified(data) !== payload.is_verified) {
        throw new Error('Profile update was not persisted');
      }

      onSaved?.(data);
      setRating(formatRating(data.rating));
      setIsVerified(isPlayerRatingVerified(data));
      setSuccess('Рейтинг игрока сохранен.');
    } catch {
      setError('Изменения не сохранены. Проверьте доступ и попробуйте еще раз.');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: '24px 16px 0' }}>
        <div style={{ background: 'rgba(255,111,97,0.08)', border: '1px solid rgba(255,111,97,0.24)', borderRadius: '16px', padding: '16px' }}>
          <div style={{ color: C.text, fontSize: '16px', fontWeight: 800, marginBottom: '8px' }}>
            Раздел доступен только администратору
          </div>
          <button onClick={onBack} style={{ width: '100%', padding: '12px', background: 'transparent', color: C.coral, border: `1px solid ${C.coral}`, borderRadius: '12px', fontSize: '14px', fontWeight: 700 }}>
            Назад
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 16px 0' }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: '13px', fontWeight: 700, padding: '0 0 14px', cursor: 'pointer' }}>
        ← К списку игроков
      </button>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px', marginBottom: '14px' }}>
        <div style={{ color: C.text, fontSize: '18px', fontWeight: 850, marginBottom: '4px' }}>
          {formatName(player)}
        </div>
        <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.45 }}>
          Карточка игрока клуба
        </div>

        <div style={{ marginTop: '14px' }}>
          <InfoRow label="Телефон" value={player?.phone} />
          <InfoRow label="Роль" value={player?.role || 'user'} />
          <InfoRow label="Сторона" value={player?.side_preference} />
          <InfoRow label="Статус рейтинга" value={isVerified ? 'Подтверждён' : 'Не подтверждён'} />
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
        <div style={{ color: C.text, fontSize: '15px', fontWeight: 800, marginBottom: '12px' }}>
          Рейтинг игрока
        </div>

        <label style={{ display: 'block', marginBottom: '14px' }}>
          <div style={{ color: C.muted, fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '7px' }}>
            Числовой рейтинг
          </div>
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            style={{
              width: '100%',
              padding: '13px 14px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              color: C.text,
              fontSize: '16px',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px', marginBottom: '14px' }}>
          <div>
            <div style={{ color: C.text, fontSize: '14px', fontWeight: 800 }}>Уровень {level.label}</div>
            <div style={{ color: C.muted, fontSize: '12px', marginTop: '2px' }}>Определяется по текущей шкале рейтинга</div>
          </div>
          <div style={{ color: level.color, fontSize: '18px', fontWeight: 900 }}>
            {level.label}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: C.text, fontSize: '14px', fontWeight: 700, marginBottom: '14px' }}>
          <input
            type="checkbox"
            checked={isVerified}
            onChange={(e) => setIsVerified(e.target.checked)}
            style={{ width: '18px', height: '18px' }}
          />
          Подтверждённый рейтинг
        </label>

        {error && (
          <div style={{ color: C.coral, background: 'rgba(255,111,97,0.08)', border: '1px solid rgba(255,111,97,0.24)', borderRadius: '12px', padding: '10px 12px', fontSize: '13px', lineHeight: 1.45, marginBottom: '12px' }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ color: C.win, background: 'rgba(216,243,74,0.08)', border: '1px solid rgba(216,243,74,0.24)', borderRadius: '12px', padding: '10px 12px', fontSize: '13px', lineHeight: 1.45, marginBottom: '12px' }}>
            {success}
          </div>
        )}

        <button onClick={handleSave} disabled={saving} style={{
          width: '100%',
          padding: '14px',
          background: saving ? '#334155' : 'rgba(216,243,74,0.12)',
          color: C.accent,
          border: '1px solid rgba(216,243,74,0.32)',
          borderRadius: '14px',
          fontSize: '15px',
          fontWeight: 800,
          cursor: saving ? 'default' : 'pointer',
        }}>
          {saving ? 'Сохраняем...' : 'Сохранить рейтинг'}
        </button>
      </div>
    </div>
  );
}
