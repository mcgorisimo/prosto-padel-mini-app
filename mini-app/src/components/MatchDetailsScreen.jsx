import React, { useState, useMemo, useEffect, useRef } from 'react';
import { getAvailableBots, getTestBots } from '../lib/testSeed';
import { getCourtCapacity, getPerPlayerPrice, fmtPrice as fmtPriceLib, isPrimeTime } from '../lib/pricing';
import { HOURS, WORKING_HOURS, BOOKING_DURATIONS } from '../lib/booking';
import FinishMatchModal from './FinishMatchModal';
import PadelCard from './ui/PadelCard';
import MatchChat from './MatchChat';
import PadelButton from './ui/PadelButton';
import { getMatchLevelBadges, getMatchLevelRequirement } from '../lib/matchLevelRequirement';
import { getMatchBookingStatus } from '../lib/matchBookingStatus';
import { isRatingMatch, requiresVerifiedRating as getRequiresVerifiedRating } from '../lib/matchRating';
import { getPublicPlayerProfiles } from '../lib/profileApi';
import { getLevelForRating } from '../lib/ratingEngine';

// ─── Constants ────────────────────────────────────────────────────────────────

const RATINGS   = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
const NUMERIC_RATING_LABELS = ['1.0–1.9', '1.5–2.4', '2.5–2.9', '3.0–3.4', '3.5–3.9', '4.0–4.4', '4.5+'];

const C = {
  bg:      '#050F0B',
  card:    'rgba(255,255,255,0.045)',
  surface: '#071F16',
  border:  'rgba(245,241,232,0.10)',
  accent:  '#D8F34A',
  text:    '#F5F1E8',
  muted:   'rgba(245,241,232,0.62)',
  gold:    '#D8F34A',
  win:     '#D8F34A',
  loss:    '#FF6F61',
};

const TIME_SLOTS = HOURS;

const PLAYER_COLORS = ['#FFD700', '#4285F4', '#34A853', '#EA4335'];

const toMin = (time) => {
  if (typeof time !== 'string' || !time.includes(':')) return 0;
  let [h, m] = time.split(':').map(Number);
  if (h < WORKING_HOURS.startHour) h += 24;
  return h * 60 + m;
};

const maxDur = (time) => {
  const remaining = (WORKING_HOURS.endHour * 60 - toMin(time)) / 60;
  return Math.max(0.5, Math.floor(remaining * 2) / 2);
};

const calcPerPlayer = (time, duration, courtType, dateISO) =>
  getPerPlayerPrice(time, duration, courtType, dateISO);

const fmtPrice = fmtPriceLib;
const fmtSetList = (sets) => (sets ?? [])
  .filter(s => (s.t1 ?? 0) + (s.t2 ?? 0) > 0)
  .map(s => `${s.t1}:${s.t2}`)
  .join(', ');
const fmtDelta = (value) => (typeof value === 'number' ? `${value >= 0 ? '+' : ''}${value.toFixed(3)}` : null);

const canManageMatch = (user, match) =>
  user.id === (match.ownerId ?? match.owner_id) || user.role === 'admin';

const getRatingIndexForPlayer = (player) => {
  const explicitIdx = Number(player?.ratingIdx);
  if (Number.isFinite(explicitIdx)) {
    return Math.max(0, Math.min(RATINGS.length - 1, Math.round(explicitIdx)));
  }

  const numericRating = Number(player?.numericRating ?? player?.rating);
  if (!Number.isFinite(numericRating)) return null;

  const levelLabel = getLevelForRating(numericRating)?.label;
  const idx = RATINGS.indexOf(levelLabel);
  return idx >= 0 ? idx : null;
};

const formatPlayerRating = (player) => {
  const numericRating = Number(player?.numericRating ?? player?.rating);
  return Number.isFinite(numericRating) ? numericRating.toFixed(1) : '—';
};

// ─── BottomSheet ──────────────────────────────────────────────────────────────

function BottomSheet({ children, onClose, variant = 'default' }) {
  const isEdit = variant === 'edit';

  return (
    <div
      className="app-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 9999,
        touchAction: 'pan-y',
      }}
    >
      <div
        className={isEdit ? 'app-modal-panel match-edit-sheet' : 'app-modal-panel'}
        onClick={e => e.stopPropagation()}
        style={{
          background: '#07160F',
          borderRadius: '24px 24px 0 0',
          width: '100%', maxWidth: '480px', padding: '0 20px calc(48px + env(safe-area-inset-bottom, 0px))',
          border: '1px solid rgba(245,241,232,0.16)',
          boxShadow: '0 -18px 60px rgba(0,0,0,0.68)',
          maxHeight: '92dvh',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <div style={{ padding: '12px 0 20px', textAlign: 'center' }}>
          <div style={{ width: '40px', height: '4px', background: C.border, borderRadius: '2px', display: 'inline-block' }} />
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Player Mini-Profile ──────────────────────────────────────────────────────

function PlayerMiniProfile({ player, onClose, onRemove, removeLabel = 'Убрать из матча' }) {
  const initials = [player.firstName?.[0], player.lastName?.[0]].filter(Boolean).join('') || '?';
  const isGold   = (player.ratingIdx ?? 0) >= 2;

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(from 0deg, ${isGold ? C.gold : C.accent}, rgba(255,255,255,0.08) 60%, ${isGold ? C.gold : C.accent})`,
          padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: '100%', height: '100%', borderRadius: '50%', background: C.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {player.photo
              ? <img src={player.photo} alt={player.firstName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'linear-gradient(145deg, #12382A, #071F16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700, color: C.text }}>{initials}</div>
            }
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ color: C.text, fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
            {player.firstName} {player.lastName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {player.ratingIdx != null && (
              <>
                <div style={{ background: 'rgba(216,243,74,0.10)', borderRadius: '6px', padding: '2px 8px', border: '1px solid rgba(216,243,74,0.24)', color: C.gold, fontSize: '12px', fontWeight: 700 }}>
                  {RATINGS[player.ratingIdx]}
                </div>
                <div style={{ color: C.muted, fontSize: '11px' }}>{NUMERIC_RATING_LABELS[player.ratingIdx]}</div>
              </>
            )}
            {player.isVerified && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', background: 'linear-gradient(135deg, #f59e0b, #ca8a04)', borderRadius: '5px', padding: '2px 6px' }}>
                <span style={{ color: '#fff', fontSize: '10px', fontWeight: 800 }}>✓ Подтверждён</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {(player.matches != null || player.winRate != null) && (
        <div style={{ display: 'flex', background: C.bg, borderRadius: '12px', padding: '14px', marginBottom: '20px', border: `1px solid ${C.border}` }}>
          {[
            { label: 'Матчей',  value: player.matches ?? '—',                        color: C.text    },
            { label: 'Побед',   value: player.winRate != null ? `${player.winRate}%` : '—', color: C.win  },
            { label: 'Сторона', value: player.side || 'Right',                       color: C.gold },
          ].map(({ label, value, color }, i, arr) => (
            <React.Fragment key={label}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ color, fontSize: '18px', fontWeight: 800, lineHeight: 1 }}>{value}</div>
                <div style={{ color: C.muted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px' }}>{label}</div>
              </div>
              {i < arr.length - 1 && <div style={{ width: '1px', background: C.border, alignSelf: 'stretch' }} />}
            </React.Fragment>
          ))}
        </div>
      )}

      {onRemove && (
        <button data-testid="player-slot-remove-action" onClick={onRemove} style={{ width: '100%', padding: '14px', marginBottom: '10px', background: 'rgba(239,68,68,0.08)', color: C.loss, border: '1px solid rgba(239,68,68,0.24)', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
          {removeLabel}
        </button>
      )}
      <button onClick={onClose} style={{ width: '100%', padding: '14px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '12px', fontSize: '15px', cursor: 'pointer' }}>
        Закрыть
      </button>
    </BottomSheet>
  );
}

// ─── Rating Guard Banner ──────────────────────────────────────────────────────

function RatingGuardBanner({ match, reason }) {
  const { summaryLabel } = getMatchLevelRequirement(match);

  return (
    <div style={{ background: 'rgba(239,68,68,0.07)', borderRadius: '12px', padding: '12px 14px', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '16px' }}>
      <span style={{ fontSize: '14px', fontWeight: 900, flexShrink: 0 }}>!</span>
      <div style={{ color: '#fca5a5', fontSize: '12px', lineHeight: 1.5 }}>
        {reason === 'unverified'
          ? <>Для участия в матчах с ограничением по уровню нужен <strong style={{ color: '#fff' }}>подтверждённый рейтинг</strong>. Подтвердите уровень у администратора клуба.</>
          : <>Ваш уровень не входит в диапазон <strong style={{ color: '#fff' }}>{summaryLabel}</strong> этого матча.</>
        }
      </div>
    </div>
  );
}

// ─── Player Slot ──────────────────────────────────────────────────────────────

function PlayerSlot({ player, onTap, slotIndex = 0, onSlotClick, ratingChange }) {
  const initials = player
    ? [player.firstName?.[0], player.lastName?.[0]].filter(Boolean).join('') || (player.firstName?.[0] ?? '?')
    : null;
  const isPlaceholder = player?.firstName === '—';
  const isOrganizer   = !!player?.isOrganizer;
  const isPendingInvitation = player?.isPendingInvitation === true;
  const hasRealData   = player && !isPlaceholder;
  const isEmpty       = !player; // truly empty — clickable

  const ratingStr = typeof ratingChange?.after === 'number'
    ? ratingChange.after.toFixed(2)
    : typeof player?.numericRating === 'number'
      ? player.numericRating.toFixed(1)
      : null;
  const deltaStr = fmtDelta(ratingChange?.delta);
  const slotColor   = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length];
  const borderColor = isPendingInvitation ? C.loss : hasRealData ? slotColor : C.border;

  const avatarBg = !hasRealData
    ? C.surface
    : isOrganizer
      ? 'linear-gradient(145deg, #b7860a, #D4AF37)'
      : `linear-gradient(145deg, ${slotColor}ee, ${slotColor}99)`;

  let label;
  if (isEmpty)            label = 'Свободно';
  else if (isPlaceholder) label = 'Занято';
  else                    label = player.firstName || 'Занято';

  const handleClick = () => {
    if (hasRealData && !isPendingInvitation) onTap(player);
    else if (isEmpty) onSlotClick?.();
  };

  return (
    <div
      data-testid={`match-player-slot-${slotIndex}`}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', position: 'relative', flexShrink: 0, overflow: 'visible' }}
    >
      {/* Внешний контейнер (Wrapper) для аватара и бейджей */}
      <div
        data-testid={isEmpty ? `match-empty-slot-${slotIndex}` : `match-filled-slot-${slotIndex}`}
        onClick={handleClick}
        style={{
          position: 'relative',
          width: '58px',
          height: '56px',
          cursor: (hasRealData && !isPendingInvitation) || isEmpty ? 'pointer' : 'default',
          overflow: 'visible',
        }}
      >
        {/* Слой Аватара (Круг) */}
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '9999px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: player ? `2px solid ${borderColor}` : `2px dashed ${C.border}`,
            background: player ? C.surface : 'transparent',
            opacity: isEmpty ? 0.65 : 1,
            transition: 'opacity 0.15s, transform 0.1s',
            boxSizing: 'border-box',
          }}
        >
          {player ? (
            isPlaceholder
              ? <span style={{ color: C.muted, fontSize: '18px' }}>+</span>
              : player.photo
                ? <img src={player.photo} alt={player.firstName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', background: avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, color: '#fff' }}>{initials}</div>
          ) : (
            <span style={{ color: C.border, fontSize: '20px' }}>+</span>
          )}
        </div>

        {/* Rating Badge */}
        {hasRealData && ratingStr && (
          <div style={{
            position: 'absolute', top: '-4px', right: '-2px', zIndex: 12,
            minWidth: '28px', height: '18px', padding: '0 5px',
            background: '#071F16',
            borderRadius: '999px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(216,243,74,0.42)',
            boxShadow: '0 6px 14px rgba(0,0,0,0.28)',
          }}>
            <span style={{ color: C.gold, fontSize: '8.5px', fontWeight: 'bold', lineHeight: 1 }}>
              {ratingStr}
            </span>
          </div>
        )}
        {/* Badge: crown for organizer, checkmark for verified */}
        {hasRealData && (isOrganizer || player.isVerified) && (
          <div style={{
            position: 'absolute', bottom: 0, right: 0, zIndex: 10,
            width: '16px', height: '16px', borderRadius: '50%',
            background: isOrganizer ? 'linear-gradient(135deg, #b7860a, #D4AF37)' : 'linear-gradient(135deg, #f59e0b, #ca8a04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '8px', color: '#fff', fontWeight: 800,
            border: `1.5px solid ${C.bg}`,
          }}>
            {isOrganizer ? 'О' : '✓'}
          </div>
        )}
      </div>

      <div style={{
        color: isPendingInvitation ? C.text : hasRealData ? slotColor : C.muted,
        fontSize: '11px', fontWeight: player ? 600 : 400,
        textAlign: 'center', maxWidth: '56px', lineHeight: 1.2,
      }}>
        {label}
      </div>
      {isPendingInvitation && (
        <div style={{ color: C.loss, fontSize: '8px', fontWeight: 800, lineHeight: 1.15, textAlign: 'center', maxWidth: '64px' }}>
          Ожидает ответа
        </div>
      )}
      {hasRealData && deltaStr && (
        <div style={{
          color: ratingChange.delta >= 0 ? C.win : C.loss,
          fontSize: '10px',
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {deltaStr}
        </div>
      )}
    </div>
  );
}

// ─── Edit Panel (bottom sheet) ────────────────────────────────────────────────

function EditPanel({ initDate, initTime, initCourt, initDuration, initTitle, initDescription, onSave, onClose }) {
  const [editDate,  setEditDate]  = useState(initDate);
  const [editTime,  setEditTime]  = useState(initTime);
  const [editCourt, setEditCourt] = useState(initCourt);
  const [editDur,   setEditDur]   = useState(initDuration);
  const [editTitle, setEditTitle] = useState(initTitle || '');
  const [editDesc,  setEditDesc]  = useState(initDescription || '');
  const [timeError, setTimeError] = useState('');

  useEffect(() => {
    const isToday = editDate === new Date().toISOString().slice(0, 10);
    if (!isToday) {
      setTimeError('');
      return;
    }
    const now = new Date();
    const validationTime = new Date(now.getTime() + 15 * 60 * 1000);
    const selectedDateTime = new Date(`${editDate}T${editTime}:00`);
    if (selectedDateTime < validationTime) {
      setTimeError('Нельзя забронировать время в прошлом');
    } else {
      setTimeError('');
    }
  }, [editDate, editTime]);

  const maxD   = maxDur(editTime);
  const safeDur = Math.min(editDur, maxD);
  const isP    = isPrimeTime(editTime, editDate);
  const newPPl = calcPerPlayer(editTime, safeDur, editCourt, editDate);
  // Минимальная аренда — 1 час
  const DURATION_OPTS = BOOKING_DURATIONS.filter(d => d <= maxD);

  const isToday = editDate === new Date().toISOString().slice(0, 10);
  const now = new Date();
  const validationTime = isToday ? now.getTime() + 15 * 60 * 1000 : 0;

  return (
    <BottomSheet onClose={onClose} variant="edit">
      <div style={{ color: C.text, fontSize: '20px', fontWeight: 850, marginBottom: '18px' }}>Редактировать матч</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(245,241,232,0.14)', borderRadius: '20px', padding: '14px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '8px' }}>Название матча</div>
          <input
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            placeholder="Например: Турнир выходного дня"
            style={{ width: '100%', padding: '13px 14px', borderRadius: '14px', background: '#0B2117', color: C.text, border: '1px solid rgba(245,241,232,0.18)', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
          />
          <div style={{ fontSize: '10px', fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em', margin: '14px 0 8px' }}>Комментарий</div>
          <textarea
            value={editDesc}
            onChange={e => setEditDesc(e.target.value)}
            placeholder="Например: играем в спокойном темпе"
            rows={3}
            style={{ width: '100%', padding: '13px 14px', borderRadius: '14px', background: '#0B2117', color: C.text, border: '1px solid rgba(245,241,232,0.18)', fontSize: '15px', boxSizing: 'border-box', resize: 'vertical', minHeight: '92px', outline: 'none', lineHeight: 1.45 }}
          />
        </div>

        <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(245,241,232,0.14)', borderRadius: '20px', padding: '14px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>Дата и время</div>
          <input type="date" value={editDate} min={new Date().toISOString().slice(0, 10)} onChange={e => setEditDate(e.target.value)} style={{
            width: '100%', padding: '13px 14px', borderRadius: '14px', background: '#0B2117', color: C.text, border: '1px solid rgba(245,241,232,0.18)', fontSize: '15px', marginBottom: '12px', boxSizing: 'border-box', outline: 'none'
          }} />
          <div className="flex gap-[8px] overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}>
            {TIME_SLOTS.map(slot => {
              const active = slot === editTime;
              const slotP  = isPrimeTime(slot, editDate);
              const slotDateTime = new Date(`${editDate}T${slot}:00`);
              const isPast = isToday && slotDateTime.getTime() < validationTime;
              return (
                <button key={slot} onClick={() => !isPast && setEditTime(slot)} disabled={isPast} style={{
                  flexShrink: 0, padding: '9px 12px', borderRadius: '14px',
                  background: active ? 'rgba(216,243,74,0.14)' : 'rgba(255,255,255,0.045)',
                  color: active ? C.gold : (slotP ? C.gold : C.muted),
                  border: active ? '1px solid rgba(216,243,74,0.34)' : `1px solid ${C.border}`,
                  fontSize: '13px', fontWeight: active ? 800 : 600,
                  ...(isPast ? { opacity: 0.25, cursor: 'not-allowed', pointerEvents: 'none', filter: 'grayscale(1)' } : { cursor: 'pointer' }),
                }}>{slot}</button>
              );
            })}
          </div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(245,241,232,0.14)', borderRadius: '20px', padding: '14px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>Параметры корта</div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {DURATION_OPTS.map(d => {
              const active = safeDur === d;
              return (
                <button key={d} onClick={() => setEditDur(d)} style={{
                  flex: '1 1 84px', padding: '10px 12px', borderRadius: '14px',
                  background: active ? 'rgba(216,243,74,0.14)' : 'rgba(255,255,255,0.045)',
                  color: active ? C.gold : C.muted,
                  border: active ? '1px solid rgba(216,243,74,0.34)' : `1px solid ${C.border}`,
                  fontSize: '13px', fontWeight: active ? 800 : 600, cursor: 'pointer',
                }}>{d === 0.5 ? '30 мин' : `${d} ч`}</button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[['panoramic', 'Ультрапанорама']].map(([val, label]) => {
              const active = editCourt === val;
              return (
                <button key={val} onClick={() => setEditCourt(val)} style={{
                  flex: 1, padding: '12px 10px', borderRadius: '14px',
                  background: active ? 'rgba(216,243,74,0.12)' : 'rgba(255,255,255,0.045)',
                  color: active ? C.gold : C.muted,
                  border: active ? '1px solid rgba(216,243,74,0.32)' : `1px solid ${C.border}`,
                  fontSize: '13px', fontWeight: active ? 800 : 600, cursor: 'pointer',
                }}>{label}</button>
              );
            })}
          </div>
        </div>

        <div style={{
          background: 'rgba(216,243,74,0.06)',
          borderRadius: '18px', padding: '14px 16px',
          border: '1px solid rgba(216,243,74,0.18)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
        }}>
          <div>
            <div style={{ color: C.gold, fontSize: '22px', fontWeight: 850, lineHeight: 1 }}>{fmtPrice(newPPl)}</div>
            <div style={{ color: C.muted, fontSize: '11px', marginTop: '3px' }}>новая цена / участник</div>
          </div>
          {isP && <div style={{ color: C.gold, fontSize: '12px', fontWeight: 700 }}>Тариф выше базового</div>}
        </div>

        {timeError && (
          <div style={{ color: C.loss, fontSize: '12px', textAlign: 'center' }}>
            {timeError}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
        <button onClick={() => onSave({ date: editDate, time: editTime, courtType: editCourt, duration: safeDur, title: editTitle, description: editDesc })} disabled={!!timeError} style={{ flex: 1, padding: '15px', background: 'rgba(216,243,74,0.12)', color: C.gold, border: '1px solid rgba(216,243,74,0.32)', borderRadius: '16px', fontSize: '15px', fontWeight: 800, cursor: 'pointer', opacity: timeError ? 0.5 : 1 }}>
          Сохранить
        </button>
        <button onClick={onClose} style={{ padding: '15px 20px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '16px', fontSize: '15px', cursor: 'pointer' }}>
          Отмена
        </button>
      </div>
    </BottomSheet>
  );
}

// ─── Cancel Sheet ─────────────────────────────────────────────────────────────

function CancelSheet({ onConfirm, onClose }) {
  return (
    <BottomSheet onClose={onClose}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <div style={{ color: C.text, fontSize: '18px', fontWeight: 700 }}>Отменить игру?</div>
      </div>

      <div style={{ background: 'rgba(212,175,55,0.06)', borderRadius: '12px', padding: '14px', border: '1px solid rgba(212,175,55,0.2)', marginBottom: '20px' }}>
        <div style={{ color: C.gold, fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>Правила отмены</div>
        <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.7 }}>
          Бесплатная отмена за <strong style={{ color: '#fff' }}>24 часа</strong> до начала матча.<br />
          При отмене менее чем за 24 часа — штраф <strong style={{ color: '#fff' }}>50% от стоимости корта</strong>.
        </div>
      </div>

      <button onClick={onConfirm} style={{ width: '100%', padding: '14px', marginBottom: '10px', background: 'linear-gradient(135deg, #dc2626, #ef4444)', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
        Да, отменить игру
      </button>
      <button onClick={onClose} style={{ width: '100%', padding: '14px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '12px', fontSize: '15px', cursor: 'pointer' }}>
        Оставить игру
      </button>
    </BottomSheet>
  );
}

// ─── Invite Sheet ─────────────────────────────────────────────────────────────

function InviteSheet({ matchId, onClose }) {
  const link = 'https://t.me/+qTqqdOIDHOU1ZTcy';
  const [copied,   setCopied]   = useState(false);
  const [username, setUsername] = useState('');

  const handleCopy = () => {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ color: C.text, fontSize: '17px', fontWeight: 700, marginBottom: '20px' }}>+ Пригласить игрока</div>

      <div style={{ fontSize: '11px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>Ссылка-приглашение</div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ flex: 1, background: C.surface, borderRadius: '10px', padding: '10px 12px', color: C.muted, fontSize: '12px', border: `1px solid ${C.border}`, wordBreak: 'break-all', lineHeight: 1.5 }}>
          {link}
        </div>
        <button onClick={handleCopy} style={{ width: '44px', height: '44px', flexShrink: 0, borderRadius: '10px', background: copied ? 'rgba(34,197,94,0.12)' : C.surface, border: `1px solid ${copied ? 'rgba(34,197,94,0.35)' : C.border}`, color: copied ? C.win : C.muted, fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {copied ? '✓' : 'Copy'}
        </button>
      </div>

      <div style={{ fontSize: '11px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>Поиск по username</div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="@username"
          style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '11px 14px', color: C.text, fontSize: '14px', outline: 'none' }}
        />
        <button style={{ padding: '0 16px', background: C.accent, color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Найти
        </button>
      </div>

      <button onClick={onClose} style={{ width: '100%', padding: '14px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '12px', fontSize: '15px', cursor: 'pointer' }}>
        Закрыть
      </button>
    </BottomSheet>
  );
}

// ─── Kick Confirm ─────────────────────────────────────────────────────────────

function KickConfirm({ player, onConfirm, onCancel }) {
  return (
    <div data-testid="match-leave-confirm" className="app-modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
      <div className="app-modal-panel" style={{ background: '#07160F', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '320px', border: '1px solid rgba(245,241,232,0.16)', textAlign: 'center' }}>
        <div style={{ color: C.gold, fontSize: '13px', fontWeight: 900, letterSpacing: '0.12em', marginBottom: '12px' }}>PLAYER</div>
        <div style={{ color: C.text, fontWeight: 700, fontSize: '16px', marginBottom: '8px' }}>Удалить игрока?</div>
        <div style={{ color: C.muted, fontSize: '13px', marginBottom: '24px', lineHeight: 1.5 }}>
          <strong style={{ color: '#fff' }}>{player.firstName}</strong> будет удалён из матча. Слот освободится для нового участника.
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '12px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}>Отмена</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #dc2626, #ef4444)', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>Удалить</button>
        </div>
      </div>
    </div>
  );
}

function LeaveConfirm({ onConfirm, onCancel }) {
  return (
    <div className="app-modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
      <div className="app-modal-panel" style={{ background: '#07160F', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '320px', border: '1px solid rgba(245,241,232,0.16)', textAlign: 'center' }}>
        <div style={{ color: C.gold, fontSize: '13px', fontWeight: 900, letterSpacing: '0.12em', marginBottom: '12px' }}>PLAYER</div>
        <div style={{ color: C.text, fontWeight: 700, fontSize: '16px', marginBottom: '8px' }}>Выйти из матча?</div>
        <div style={{ color: C.muted, fontSize: '13px', marginBottom: '24px', lineHeight: 1.5 }}>
          Ваше место станет свободным
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '12px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}>Отмена</button>
          <button data-testid="match-leave-confirm-button" onClick={onConfirm} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #dc2626, #ef4444)', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>Выйти</button>
        </div>
      </div>
    </div>
  );
}

// ─── Slot Action Sheet ────────────────────────────────────────────────────────
function LevelOverrideConfirm({ message, onConfirm, onCancel }) {
  return (
    <div data-testid="level-override-modal" className="app-modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
      <div className="app-modal-panel" style={{ background: '#07160F', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '320px', border: '1px solid rgba(245,241,232,0.16)', textAlign: 'center' }}>
        <div style={{ color: C.gold, fontSize: '13px', fontWeight: 900, letterSpacing: '0.12em', marginBottom: '12px' }}>LEVEL</div>
        <div style={{ color: C.text, fontWeight: 700, fontSize: '16px', marginBottom: '8px' }}>Пригласить игрока вне диапазона?</div>
        <div style={{ color: C.muted, fontSize: '13px', marginBottom: '24px', lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '12px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}>Отмена</button>
          <button data-testid="level-override-confirm" onClick={onConfirm} style={{ flex: 1, padding: '12px', background: C.accent, color: '#07160F', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>Пригласить</button>
        </div>
      </div>
    </div>
  );
}

function SlotActionSheet({ slotIndex, isOwner, currentUser, matchId, onAddGuest, onAddBot, availableBotsCount = 0, onTakeSlot, onClose, showToast, slots }) {
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [invitingPlayerId, setInvitingPlayerId] = useState(null);
  const invitationInFlightRef = useRef(false);

  // Проверяем, играет ли уже юзер в матче
  const isParticipant = slots?.some(player => player?.id === currentUser?.id);
  const link = 'https://t.me/+qTqqdOIDHOU1ZTcy';

  const handleCopy = () => {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    showToast('Ссылка скопирована!', 'info');
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const canSearch = isOwner;
    if (!canSearch || searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const data = await getPublicPlayerProfiles({
          search: searchTerm,
          excludeId: currentUser?.id,
          select: 'id, first_name, last_name, username, rating, is_verified, side_preference',
          limit: 5,
        });
        setSearchResults(data || []);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, isOwner, currentUser?.id]);

  const handleSelectPlayer = async (player) => {
    if (invitationInFlightRef.current) return;
    invitationInFlightRef.current = true;
    setInvitingPlayerId(player.id);
    try {
      const result = await onAddGuest(slotIndex, {
        id: player.id,
        firstName: player.first_name,
        lastName: player.last_name,
        username: player.username,
        numericRating: player.rating,
        isVerified: player.is_verified,
        sidePreference: player.side_preference || 'LR',
        isOrganizer: false,
      });
      if (result !== false) onClose();
    } finally {
      invitationInFlightRef.current = false;
      setInvitingPlayerId(null);
    }
  };

  // 1. ИНТЕРФЕЙС ОРГАНИЗАТОРА ИЛИ УЧАСТНИКА (Поиск)
  if (isOwner) {
    return (
      <BottomSheet onClose={onClose}>
        <div data-testid="slot-action-sheet">
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: C.text, fontSize: '17px', fontWeight: 700 }}>Слот {slotIndex + 1} · Свободно</div>
          <div style={{ color: C.muted, fontSize: '12px', marginTop: '3px' }}>Поиск среди игроков клуба</div>
        </div>
        <input
          data-testid="player-search-input"
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Имя, фамилия или @username"
          style={{ width: '100%', padding: '12px', borderRadius: '12px', background: C.surface, color: C.text, border: `1px solid ${C.border}`, boxSizing: 'border-box', marginBottom: '16px', outline: 'none' }}
        />
        {isSearching && <div style={{ color: C.gold, fontSize: '12px', textAlign: 'center', marginBottom: '16px' }}>Ищем...</div>}
        {!isSearching && searchResults.length > 0 && (
          <div style={{ background: C.surface, borderRadius: '12px', border: `1px solid ${C.border}`, maxHeight: '160px', overflowY: 'auto', marginBottom: '16px' }}>
            {searchResults.map((player) => (
              <button
                key={player.id}
                data-testid={`player-search-result-${player.id}`}
                onClick={() => handleSelectPlayer(player)}
                disabled={invitingPlayerId !== null}
                style={{ width: '100%', padding: '12px', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.border}`, color: C.text, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span>{player.first_name} {player.last_name}{player.username ? ` · @${player.username}` : ''}</span>
                <span style={{ color: C.gold, fontSize: '11px', fontWeight: 700 }}>
                  {invitingPlayerId === player.id ? 'Отправляем…' : 'Пригласить'}
                </span>
              </button>
            ))}
          </div>
        )}
        {availableBotsCount > 0 && (
          <button onClick={() => { onAddBot?.(slotIndex); onClose(); }} style={{ width: '100%', padding: '14px', marginBottom: '10px', background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}>
            🤖 Добавить бота ({availableBotsCount})
          </button>
        )}
        <button onClick={handleCopy} style={{ width: '100%', padding: '14px', marginBottom: '12px', background: copied ? 'rgba(34,197,94,0.08)' : C.surface, color: copied ? C.win : C.text, border: `1px solid ${copied ? 'rgba(34,197,94,0.35)' : C.border}`, borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}>
          {copied ? 'Ссылка скопирована' : 'Скопировать ссылку на Telegram-группу'}
        </button>
        <button onClick={onClose} style={{ width: '100%', padding: '14px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '12px', cursor: 'pointer' }}>Закрыть</button>
        </div>
      </BottomSheet>
    );
  }

  // 2. ИНТЕРФЕЙС ДЛЯ СТОРОННЕГО ИГРОКА (Занять место)
  const initials = [currentUser?.firstName?.[0], currentUser?.lastName?.[0]].filter(Boolean).join('') || '?';
  
  return (
    <BottomSheet onClose={onClose}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(145deg, #12382A, #071F16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 700, color: C.text, margin: '0 auto 12px' }}>
          {initials}
        </div>
        <div style={{ color: C.text, fontSize: '18px', fontWeight: 700 }}>{currentUser?.firstName} {currentUser?.lastName}</div>
      </div>
      <button onClick={async () => { const didTake = await onTakeSlot?.(slotIndex); if (didTake !== false) onClose(); }} style={{ width: '100%', padding: '16px', background: 'rgba(216,243,74,0.12)', color: C.gold, border: '1px solid rgba(216,243,74,0.32)', borderRadius: '16px', fontSize: '16px', fontWeight: 800, marginBottom: '10px', cursor: 'pointer' }}>
        Занять место
      </button>
      <button onClick={onClose} style={{ width: '100%', padding: '14px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '12px', cursor: 'pointer' }}>Отмена</button>
    </BottomSheet>
  );
}


// ─── Pinned Message Block ─────────────────────────────────────────────────────

function PinnedBlock({ msg, isOwner, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(msg || '');

  if (!isOwner && !msg) return null;

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '8px' }}>
        Сообщение организатора
      </div>
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Например: Собираемся у 7-го корта, форма чёрная 🖤"
            maxLength={200}
            rows={3}
            style={{ width: '100%', background: C.surface, border: `1px solid ${C.accent}`, borderRadius: '10px', padding: '10px 12px', color: C.text, fontSize: '13px', resize: 'none', boxSizing: 'border-box', outline: 'none', lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={() => { onSave(draft); setEditing(false); }} style={{ flex: 1, padding: '10px', background: C.accent, color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              Закрепить
            </button>
            <button onClick={() => { setDraft(msg || ''); setEditing(false); }} style={{ padding: '10px 14px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '10px', fontSize: '13px', cursor: 'pointer' }}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div style={{ background: C.surface, borderRadius: '10px', padding: '12px 14px', border: `1px solid ${C.border}`, position: 'relative', minHeight: '44px', display: 'flex', alignItems: 'center' }}>
          <div style={{ color: msg ? C.text : C.muted, fontSize: '13px', lineHeight: 1.5, flex: 1, fontStyle: msg ? 'normal' : 'italic', paddingRight: isOwner ? '28px' : 0 }}>
            {msg || 'Нажмите кнопку редактирования, чтобы добавить сообщение для участников'}
          </div>
          {isOwner && (
            <button onClick={() => setEditing(true)} style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: C.muted, fontSize: '15px', cursor: 'pointer', padding: '2px' }}>
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Scenario Info Block ──────────────────────────────────────────────────────

function ScenarioInfoBlock({ match }) {
  const bookingStatus = getMatchBookingStatus(match);

  if (bookingStatus.isBooked) {
    return (
      <div style={{ background: 'rgba(34,197,94,0.06)', borderRadius: '12px', padding: '12px 14px', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', fontWeight: 900, flexShrink: 0 }}>OK</span>
        <div>
          <div style={{ color: '#22C55E', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>Корт забронирован</div>
          <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.6 }}>
            Место игры подтверждено организатором. Ваше место гарантировано.
          </div>
        </div>
      </div>
    );
  }

  // Not confirmed
  return (
    <div style={{ background: 'rgba(212,175,55,0.06)', borderRadius: '12px', padding: '12px 14px', border: '1px solid rgba(212,175,55,0.25)', display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '16px' }}>
      <span style={{ fontSize: '14px', fontWeight: 900, flexShrink: 0 }}>!</span>
      <div>
        <div style={{ color: '#D4AF37', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>Корт НЕ забронирован</div>
        <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.6 }}>
          Организатор еще не забронировал корт. Договоритесь о месте и времени самостоятельно.
        </div>
      </div>
    </div>
  );
}

function RatingTypeBadge({ match }) {
  const isRated = isRatingMatch(match);

  return (
    <div style={{ marginBottom: '16px' }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '999px',
        padding: '5px 10px',
        border: isRated ? '1px solid rgba(216,243,74,0.28)' : `1px solid ${C.border}`,
        background: isRated ? 'rgba(216,243,74,0.08)' : C.card,
        color: isRated ? C.gold : C.muted,
        fontSize: '11px',
        fontWeight: 800,
      }}>
        {isRated ? 'Рейтинговая игра' : 'Обычная игра'}
      </span>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MatchDetailsScreen({ match, currentUser, onBack, onJoinSuccess, onDelete, onComplete, onConfirmScore, onDisputeScore, onUpdate, onSlotsChange, onJoinMatch, onLeaveMatch, pendingInvitations = [], invitationActions = new Set(), onCreateInvitation, onCancelInvitation, onRemoveParticipant, allMessages, messagesLoading, messagesLoadError, onRetryMessages, onSendMessage, onRevertToPrivate, showToast }) {
  const isOwner = canManageMatch(currentUser, match);

  const allBots = useMemo(() => getTestBots(), []);
  const botsById = useMemo(() => {
    return allBots.reduce((acc, bot) => {
      acc[bot.id] = bot;
      return acc;
    }, {});
  }, [allBots]);

  const [viewPlayer,  setViewPlayer]  = useState(null);
  const [joined,      setJoined]      = useState(false);
  const [joining,     setJoining]     = useState(false);
  const [cancelled,   setCancelled]   = useState(false);
  const [editSheet,   setEditSheet]   = useState(false);
  const [cancelSheet, setCancelSheet] = useState(false);
  const [kickTarget,  setKickTarget]  = useState(null);
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [pinnedMsg,   setPinnedMsg]   = useState('');
  const [targetSlot,  setTargetSlot]  = useState(null); // index of tapped empty slot
  const [finished,    setFinished]    = useState(match.status === 'completed');
  const [finishToast, setFinishToast] = useState(null);
  const [finishModal, setFinishModal] = useState(false);
  const [chatOpen,    setChatOpen]    = useState(false);
  const [levelOverride, setLevelOverride] = useState(null);
  const joinInFlightRef = useRef(false);
  const joinSuccessTimerRef = useRef(null);

  useEffect(() => () => {
    if (joinSuccessTimerRef.current) clearTimeout(joinSuccessTimerRef.current);
  }, []);

  // Owner-editable fields (null = use original from match prop)
  const [localDate, setLocalDate] = useState(null);
  const [localTime,  setLocalTime]  = useState(null);
  const [localCourt, setLocalCourt] = useState(null);
  const [localDur,   setLocalDur]   = useState(null);
  const [localSlots, setLocalSlots] = useState(null);
  const [localTitle, setLocalTitle] = useState(null);
  const [localDesc,  setLocalDesc]  = useState(null);

  const {
    host, date, ratingMin, ratingMax,
    dateISO:     origDateISO,
    filledSlots: origFilledSlots,
    players      = 0,
    title:       origTitle,
    description: origDescription,
    status,
    scenario,
    courtName:   origCourtName,
    courtType:   origCourt    = 'panoramic',
    time:        origTime,
    duration:    origDuration,
  } = match;
  const requiresVerifiedRating = getRequiresVerifiedRating(match);
  const levelRequirement = getMatchLevelRequirement(match);
  const isRatedMatch = isRatingMatch(match);
  const scoreStatus = match.scoreStatus ?? match.score_status ?? 'none';
  const isScorePending = scoreStatus === 'pending_confirmation' || status === 'pending_confirmation';
  const isScoreDisputed = scoreStatus === 'disputed' || status === 'disputed';
  const isScoreConfirmed = scoreStatus === 'confirmed';
  const ratingChanges = match.ratingChanges ?? match.rating_changes ?? {};

  // Effective values — local overrides original when owner edits
  const dateISO   = localDate  ?? origDateISO;
  const time      = localTime  ?? origTime;
  const courtType = localCourt ?? origCourt;
  const courtName = origCourtName;
  const duration  = localDur   ?? origDuration;
  const title     = localTitle ?? origTitle;
  const description = localDesc ?? origDescription;

  const isActuallyPrime = isPrimeTime(time, dateISO);
  const isPanoramic     = courtType === 'panoramic';
  const maxSlots        = getCourtCapacity(courtType);
  const pricePerPl      = match.pricePerPerson ?? match.price_per_person ?? calcPerPlayer(time, duration, courtType, dateISO);

  // Owner's real profile for the first slot
  const ownerSlot = {
    id:          currentUser.id,
    firstName:   currentUser.firstName || (host?.name || '').split(' ')[0] || 'Вы',
    lastName:    currentUser.lastName  || '',
    ratingIdx:   currentUser.ratingIdx,
    numericRating: currentUser.numericRating,
    isVerified:  currentUser.isVerified,
    isOrganizer: true,
  };

  // Slot resolution: prefer explicit filledSlots array, fall back to numeric count
  const resolvedSlots = localSlots ?? (origFilledSlots ?? []);
  let baseSlots;
  if (resolvedSlots.length > 0) {
    // Keep legacy "me" slots and current user's slot aligned with the loaded profile.
    baseSlots = resolvedSlots.map(p => {
      if (p?.id === 'me' || p?.id === currentUser.id) {
        return {
          ...p,
          id: currentUser.id,
          firstName: currentUser.firstName || p.firstName,
          lastName: currentUser.lastName || p.lastName,
          ratingIdx: currentUser.ratingIdx,
          numericRating: currentUser.numericRating,
          isVerified: currentUser.isVerified,
        };
      }
      return p;
    });
  } else if (players > 0) {
    baseSlots = isOwner
      ? [ownerSlot, ...Array(Math.max(0, players - 1)).fill({ firstName: '—', isVerified: false })]
      : Array(players).fill({ firstName: '—', isVerified: false });
  } else {
    baseSlots = [];
  }
  const confirmedPlayers = baseSlots.slice(0, maxSlots);
  const slots = Array(maxSlots).fill(null);

  confirmedPlayers.forEach((player) => {
    const explicitIndex = Number(player?.slotIndex);
    const slotIndex = Number.isInteger(explicitIndex)
      && explicitIndex >= 0
      && explicitIndex < maxSlots
      && !slots[explicitIndex]
      ? explicitIndex
      : slots.findIndex((slot) => !slot);
    if (slotIndex >= 0) slots[slotIndex] = player;
  });

  pendingInvitations.forEach((invitation) => {
    const slotIndex = Number(invitation.slot_index);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= maxSlots || slots[slotIndex]) return;
    const player = invitation.player ?? {};
    slots[slotIndex] = {
      id: invitation.invited_user_id,
      firstName: player.firstName ?? player.first_name ?? 'Игрок',
      lastName: player.lastName ?? player.last_name ?? '',
      numericRating: player.numericRating ?? player.rating,
      isVerified: player.isVerified ?? player.is_verified,
      isOrganizer: false,
      isPendingInvitation: true,
      invitationId: invitation.id,
      slotIndex,
    };
  });

  const allFilled = slots.filter((player) => player && !player.isPendingInvitation);
  const visiblePendingInvitations = slots.filter((player) => player?.isPendingInvitation);
  const isFull = allFilled.length >= maxSlots;
  const isCapacityReserved = slots.every(Boolean);
  const savedScore = match.finalScore ?? match.score;
  const hasFinalScore = Array.isArray(savedScore) && savedScore.some(s => (s?.t1 ?? 0) + (s?.t2 ?? 0) > 0);
  const isCompletedMatch = finished || status === 'completed' || status === 'finished' || (hasFinalScore && !isScorePending && !isScoreDisputed && !isRatedMatch);
  const canEditMatch = isOwner && !isCompletedMatch && !isScorePending && !isScoreDisputed;
  const completedScoreText = fmtSetList(savedScore);
  const scoreSubmittedBy = match.scoreSubmittedBy ?? match.score_submitted_by;
  const matchStartMs = new Date(`${dateISO}T${time || '00:00'}:00`).getTime();
  const matchHasNotStarted = !Number.isFinite(matchStartMs) || matchStartMs > Date.now();
  const isPaidParticipation = (player) => {
    const paymentStatus = String(player?.paymentStatus ?? player?.payment_status ?? '').toLowerCase();
    return player?.paid === true || player?.isPaid === true || paymentStatus === 'paid' || paymentStatus === 'full';
  };

  const playerTeam = (playerId) => {
    if (!playerId) return null;
    if ((match.team1 ?? []).some(player => player?.id === playerId)) return 1;
    if ((match.team2 ?? []).some(player => player?.id === playerId)) return 2;
    return null;
  };
  const submittedTeam = playerTeam(scoreSubmittedBy) ?? playerTeam(match.ownerId ?? match.owner_id);
  const currentUserTeam = playerTeam(currentUser.id);
  const confirmingTeamNumber = submittedTeam === 1 ? 2 : submittedTeam === 2 ? 1 : null;
  const confirmingPlayers = confirmingTeamNumber === 1
    ? (match.team1 ?? [])
    : confirmingTeamNumber === 2
      ? (match.team2 ?? [])
      : [];
  const confirmingPlayersLabel = confirmingPlayers
    .map(player => [player?.firstName, player?.lastName].filter(Boolean).join(' ').trim() || player?.firstName)
    .filter(Boolean)
    .join(' или ');
  const canConfirmPendingScore =
    isRatedMatch &&
    isScorePending &&
    currentUser.id !== scoreSubmittedBy &&
    currentUserTeam != null &&
    submittedTeam != null &&
    currentUserTeam !== submittedTeam;

  // Join guard
  const isParticipant = isOwner || (match.participants ?? []).includes(currentUser.id)
    || allFilled.some(player => player?.id === currentUser.id);
  const levelOk    = currentUser.ratingIdx >= ratingMin && currentUser.ratingIdx <= ratingMax;
  const privateJoinBlocked = match.isPrivate === true;
  const verifiedOk = !requiresVerifiedRating || currentUser.isVerified === true;
  const getJoinBlockReason = () => {
    if (isCompletedMatch) return 'completed';
    if (isOwner) return 'owner';
    if (isParticipant) return 'participant';
    if (isCapacityReserved) return 'full';
    if (privateJoinBlocked) return 'private';
    if (!verifiedOk) return 'unverified';
    if (!levelOk) return 'level';
    return null;
  };
  const joinBlockReason = getJoinBlockReason();
  const canJoin = joinBlockReason === null;
  const guardReason = joinBlockReason === 'unverified' || joinBlockReason === 'level' ? joinBlockReason : null;
  const showRatingGuard = !isOwner && !isParticipant && !isCapacityReserved && guardReason;
  const getJoinBlockedText = (reason = joinBlockReason) => {
    if (reason === 'completed') return 'Матч уже завершён.';
    if (reason === 'participant') return 'Вы уже участвуете в этом матче.';
    if (reason === 'full') return 'В матче больше нет свободных мест.';
    if (reason === 'private') return 'Это приватный матч. Присоединиться можно только по приглашению организатора.';
    if (reason === 'unverified') return 'Для участия нужен подтверждённый рейтинг. Обратитесь к администратору клуба.';
    if (reason === 'level') return `Ваш уровень не входит в диапазон ${levelRequirement.summaryLabel} этого матча.`;
    return 'Участие в матче сейчас недоступно.';
  };

  const handleJoin = async () => {
    if (joinInFlightRef.current) return;
    if (!canJoin) {
      showToast?.(getJoinBlockedText(), guardReason ? 'error' : 'info');
      return;
    }

    const firstFreeSlotIndex = slots.findIndex(slot => !slot);
    if (firstFreeSlotIndex === -1) {
      showToast?.('В матче больше нет свободных мест', 'info');
      return;
    }

    await handleTakeSlot(firstFreeSlotIndex);
  };
  
  const handleEditSave = async ({ date: dt, time: t, courtType: ct, duration: d, title: newTitle, description: newDesc }) => {
    try {
      const updatedMatch = await onUpdate?.(match.id, {
        dateISO: dt,
        time: t,
        courtType: ct,
        duration: d,
        title: newTitle,
        description: newDesc,
      });
      setLocalDate(updatedMatch?.dateISO ?? dt);
      setLocalTime(updatedMatch?.time ?? t);
      setLocalCourt(updatedMatch?.courtType ?? ct);
      setLocalDur(updatedMatch?.duration ?? d);
      setLocalTitle(updatedMatch?.title ?? newTitle);
      setLocalDesc(updatedMatch?.description ?? newDesc);
      setEditSheet(false);
    } catch {
      showToast?.('Изменения не сохранены. Попробуйте еще раз.', 'error');
    }
  };

  // Persist slot mutations both locally (instant UI) and up to allMatches (status/participants).
  const commitSlots = async (nextFilled) => {
    const updatedMatch = await onSlotsChange?.(match.id, nextFilled);
    setLocalSlots(updatedMatch?.filledSlots ?? nextFilled);
    return updatedMatch;
  };

  const handleKickConfirm = async () => {
    try {
      if (!kickTarget?.id || !onRemoveParticipant) {
        throw new Error('remove_match_participant RPC handler is not available');
      }
      const updatedMatch = await onRemoveParticipant(match.id, kickTarget.id);
      setLocalSlots(updatedMatch?.filledSlots ?? allFilled);
      setKickTarget(null);
    } catch {
      // Parent shows the concrete RPC error.
    }
  };

  const handleRemoveViewedPlayer = () => {
    if (!canEditMatch || !viewPlayer || viewPlayer.isOrganizer) return;
    setKickTarget(viewPlayer);
    setViewPlayer(null);
  };

  const canLeaveViewedPlayer = !!viewPlayer
    && viewPlayer.id === currentUser.id
    && isParticipant
    && !isOwner
    && !viewPlayer.isOrganizer
    && matchHasNotStarted
    && !isCompletedMatch
    && !isScorePending
    && !isScoreDisputed
    && !isPaidParticipation(viewPlayer);

  const handleLeaveViewedPlayer = () => {
    if (!canLeaveViewedPlayer) return;
    setLeaveTarget(viewPlayer);
    setViewPlayer(null);
  };

  const handleLeaveConfirm = async () => {
    try {
      if (!onLeaveMatch) {
        throw new Error('leave_match RPC handler is not available');
      }

      const updatedMatch = await onLeaveMatch(match.id);
      if (joinSuccessTimerRef.current) {
        clearTimeout(joinSuccessTimerRef.current);
        joinSuccessTimerRef.current = null;
      }
      setLocalSlots(updatedMatch?.filledSlots ?? allFilled);
      setJoined(false);
      setLeaveTarget(null);
    } catch {
      // The parent handler shows the concrete RPC error without duplicating the message.
    }
  };

  // The organizer reserves a slot by invitation; the player is added only after accepting it.
  const handleAddGuest = async (slotIndex, playerData, options = {}) => {
    if (slots[slotIndex]) {
      showToast?.('Этот слот уже занят.', 'info');
      return false;
    }

    if (playerData?.id && slots.some((player, index) => index !== slotIndex && player?.id === playerData.id)) {
      showToast?.('Этот игрок уже участвует в матче или ожидает ответа.', 'info');
      return false;
    }

    const playerRatingIdx = getRatingIndexForPlayer(playerData);
    if (
      !options.skipLevelWarning &&
      typeof playerData !== 'string' &&
      playerRatingIdx != null &&
      (playerRatingIdx < levelRequirement.minIdx || playerRatingIdx > levelRequirement.maxIdx)
    ) {
      const direction = playerRatingIdx < levelRequirement.minIdx ? 'ниже' : 'выше';
      setLevelOverride({
        slotIndex,
        playerData,
        message: `Уровень игрока ${formatPlayerRating(playerData)} ${direction} диапазона матча ${levelRequirement.numericRangeLabel}. Всё равно пригласить?`,
      });
      return true;
    }

    if (!playerData?.id || !onCreateInvitation) return false;
    try {
      await onCreateInvitation(match.id, playerData, slotIndex);
      setTargetSlot(null);
      return true;
    } catch {
      return false;
    }
  };

  const handleConfirmLevelOverride = async () => {
    if (!levelOverride) return;
    const pending = levelOverride;
    setLevelOverride(null);
    await handleAddGuest(pending.slotIndex, pending.playerData, { skipLevelWarning: true });
  };

  // Owner drops a random available test-bot into an empty slot
  const usedBotIds = allFilled.filter(p => p?.isBot).map(p => p.id);
  const availableBots = getAvailableBots(usedBotIds);
  const availableBotsCount = availableBots.length;

  const handleAddBot = async (slotIndex) => {
    if (availableBots.length === 0) return;
    const bot  = availableBots[Math.floor(Math.random() * availableBots.length)];
    if (requiresVerifiedRating && bot?.isVerified !== true) {
      showToast?.('Для рейтинговой игры нужен подтверждённый рейтинг участника.', 'error');
      return;
    }
    const next = [...slots];
    next[slotIndex] = bot;
    try {
      await commitSlots(next.filter((player) => player && !player.isPendingInvitation));
      setTargetSlot(null);
    } catch {
      showToast?.('Слот не обновлен. Попробуйте еще раз.', 'error');
    }
  };

  const handleFinishMatch = () => {
    if (!isFull || isCompletedMatch || isScorePending || isScoreDisputed) return;
    setFinishModal(true);
  };

  const handleFinalize = async ({ team1, team2, score, isTeam1Win }) => {
    let updatedMatch;
    try {
      updatedMatch = await onComplete?.(match.id, { score, isTeam1Win, team1, team2 });
      setFinished(updatedMatch?.status === 'completed' || updatedMatch?.status === 'finished');
      setFinishModal(false);
    } catch (error) {
      const isRatingApprovalError = error?.message === 'Rated match completion requires server-side rating approval';
      showToast?.(
        isRatingApprovalError
          ? 'Рейтинговый матч не завершён: требуется серверное подтверждение рейтинга.'
          : 'Результат не сохранился. Попробуйте ещё раз.',
        'error'
      );
      return;
    }
    const userDelta = updatedMatch?.ratingChanges?.[currentUser.id]?.delta;
    if (typeof userDelta === 'number') {
      const sign = userDelta >= 0 ? '+' : '';
      setFinishToast(`Рейтинг обновлён: ${sign}${userDelta.toFixed(3)}`);
    } else if (updatedMatch?.scoreStatus === 'pending_confirmation' || updatedMatch?.score_status === 'pending_confirmation') {
      setFinishToast('Счёт отправлен на подтверждение');
    } else {
      setFinishToast('Матч завершён');
    }
    setTimeout(() => setFinishToast(null), 4000);
  };

  const handleConfirmScore = async () => {
    if (!canConfirmPendingScore) return;
    try {
      const updatedMatch = await onConfirmScore?.(match.id);
      if (updatedMatch?.status === 'completed' || updatedMatch?.status === 'finished') {
        setFinished(true);
      }
    } catch {
      // Parent already shows the concrete Supabase/RPC error.
    }
  };

  const handleDisputeScore = async () => {
    if (!canConfirmPendingScore) return;
    try {
      await onDisputeScore?.(match.id);
    } catch {
      // Parent already shows the concrete Supabase error.
    }
  };

  // Non-owner takes an empty slot with their own profile
  const handleTakeSlot = async (slotIndex) => {
    if (joinInFlightRef.current) return false;

    if (!currentUser?.id) {
      showToast?.('Не удалось определить игрока. Попробуйте войти заново.', 'error');
      return false;
    }

    if (!canJoin) {
      showToast?.(getJoinBlockedText(), guardReason ? 'error' : 'info');
      return false;
    }

    if (slots[slotIndex]) {
      showToast?.('Этот слот уже занят.', 'info');
      return false;
    }

    joinInFlightRef.current = true;
    setJoining(true);

    try {
      const updatedMatch = await onJoinMatch?.(match.id);
      setLocalSlots(updatedMatch?.filledSlots ?? slots);
      setTargetSlot(null);
      setJoined(true);
      joinSuccessTimerRef.current = setTimeout(() => onJoinSuccess?.(updatedMatch ?? match), 1500);
      return true;
    } catch {
      return false;
    } finally {
      joinInFlightRef.current = false;
      setJoining(false);
    }
  };

  const handleEmptySlotClick = (slotIndex) => {
    if (isOwner) {
      setTargetSlot(slotIndex);
      return;
    }

    if (!canJoin) {
      showToast?.(getJoinBlockedText(), guardReason ? 'error' : 'info');
      return;
    }

    handleTakeSlot(slotIndex);
  };

  const handleCancelConfirm = async () => {
    try {
      await onDelete?.(match.id);   // remove from allMatches in parent
      setCancelSheet(false);
      setCancelled(true);
      setTimeout(() => onBack?.(), 1800);
    } catch {
      setCancelSheet(false);
      showToast?.('Матч не отменен. Попробуйте еще раз.', 'error');
    }
  };

  // ── Cancelled state ───────────────────────────────────────────────────────
  if (cancelled) {
    return (
      <div style={{ background: C.bg, minHeight: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: '20px', marginBottom: '8px' }}>Игра отменена</div>
        <div style={{ color: C.muted, fontSize: '14px' }}>Матч больше не отображается в ваших активных играх</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100dvh', maxHeight: '100dvh', overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', paddingBottom: 'calc(132px + env(safe-area-inset-bottom, 0px))' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(180deg, #071F16 0%, #050F0B 100%)', padding: '20px 16px 0', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.muted, fontSize: '22px', cursor: 'pointer', lineHeight: 1, padding: '4px' }}>←</button>
          <h1 style={{ color: C.text, fontSize: '18px', fontWeight: 700, margin: 0, flex: 1 }}>Детали матча</h1>
          {isActuallyPrime && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(212,175,55,0.15)', borderRadius: '8px', padding: '4px 8px', border: '1px solid rgba(212,175,55,0.35)' }}>
              <span style={{ color: C.gold, fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em' }}>PRIME</span>
            </div>
          )}
        </div>

        {/* Court info card */}
        <div style={{ background: isActuallyPrime ? 'rgba(212,175,55,0.06)' : C.surface, borderRadius: '14px', padding: '14px 16px', marginBottom: '16px', border: isActuallyPrime ? '1px solid rgba(212,175,55,0.25)' : `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ color: isActuallyPrime ? C.gold : C.text, fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>
                {courtName || (isPanoramic ? 'Ультрапанорамный корт' : 'Корт')}
              </div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {[['Дата', date], ['Время', time], ['Длительность', `${duration}ч`]].map(([icon, val]) => (
                  <span key={String(icon) + val} style={{ color: C.muted, fontSize: '13px' }}>{icon}: {val}</span>
                ))}
              </div>
            </div>
            {isOwner && (
              <div style={{ background: 'rgba(212,175,55,0.12)', borderRadius: '8px', padding: '4px 8px', border: '1px solid rgba(212,175,55,0.25)', color: C.gold, fontSize: '10px', fontWeight: 700, flexShrink: 0, marginLeft: '8px' }}>
                Организатор
              </div>
            )}
          </div>
          {description && <div style={{ color: C.muted, fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }}>{description}</div>}
          {title && (
            <div style={{
              marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${isActuallyPrime ? 'rgba(212,175,55,0.25)' : C.border}`
            }}>
              <div style={{ color: C.text, fontWeight: 700, fontSize: '18px' }}>{title}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Owner action bar ───────────────────────────────────────────────── */}
      {canEditMatch && (
        <div style={{ padding: '12px 16px', display: 'flex', gap: '8px', borderBottom: `1px solid ${C.border}`, background: 'rgba(216,243,74,0.04)' }}>
          {match.type === 'match' ? (
            <PadelButton variant="dark" size="md" onClick={() => setEditSheet(true)}>
              Редактировать
            </PadelButton>
          ) : (
            <PadelButton variant="dark" size="md" onClick={() => setEditSheet(true)} fullWidth>
              Редактировать бронь
            </PadelButton>
          )}
          <PadelButton variant="danger" size="md" fullWidth={match.type !== 'match'} onClick={() => setCancelSheet(true)}>
            Отменить игру
          </PadelButton>
        </div>
      )}

      <div style={{ padding: '16px' }}>

        {/* ── Scenario status block ─────────────────────────────────────── */}
        <ScenarioInfoBlock match={match} />
        <RatingTypeBadge match={match} />
        {(isScorePending || isScoreDisputed || isScoreConfirmed) && (
          <div style={{
            background: isScoreDisputed ? 'rgba(239,68,68,0.07)' : isScorePending ? 'rgba(212,175,55,0.07)' : 'rgba(34,197,94,0.07)',
            borderRadius: '12px',
            padding: '12px 14px',
            border: isScoreDisputed ? '1px solid rgba(239,68,68,0.25)' : isScorePending ? '1px solid rgba(212,175,55,0.25)' : '1px solid rgba(34,197,94,0.25)',
            marginBottom: '16px',
          }}>
            <div style={{ color: isScoreDisputed ? C.loss : isScorePending ? C.gold : C.win, fontWeight: 800, fontSize: '13px', marginBottom: completedScoreText ? '4px' : 0 }}>
              {isScoreDisputed ? 'Счёт оспорен' : isScorePending ? 'Ожидает подтверждения счёта' : 'Счёт подтверждён'}
            </div>
            {completedScoreText && (
              <div style={{ color: C.text, fontSize: '14px', fontWeight: 800, marginBottom: '4px' }}>
                {completedScoreText}
              </div>
            )}
            <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.5 }}>
              {isScoreDisputed
                ? 'Счёт оспорен. Обратитесь к администратору клуба.'
                : isScorePending
                  ? confirmingPlayersLabel
                    ? `Ожидаем подтверждение от команды ${confirmingTeamNumber}: ${confirmingPlayersLabel}.`
                    : 'Ожидаем подтверждение от противоположной команды.'
                  : 'Результат подтверждён и сохранён.'}
            </div>
          </div>
        )}

        {/* ── Rating requirement ─────────────────────────────────────────── */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>Требования к уровню</div>
          <div style={{ background: C.card, borderRadius: '12px', padding: '12px 14px', border: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {getMatchLevelBadges(match).map(r => (
                <div key={r} style={{ padding: '5px 10px', borderRadius: '8px', background: 'rgba(216,243,74,0.10)', border: '1px solid rgba(216,243,74,0.24)', color: C.gold, fontSize: '13px', fontWeight: 700 }}>{r}</div>
              ))}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: C.text, fontWeight: 700, fontSize: '14px' }}>
                {levelRequirement.numericRangeLabel}
              </div>
              <div style={{ color: C.muted, fontSize: '10px', marginTop: '2px' }}>Клубный рейтинг</div>
            </div>
          </div>
          <div style={{ color: C.muted, fontSize: '11px', lineHeight: 1.45, marginTop: '8px', paddingLeft: '2px' }}>
            Диапазон уровня применяется к игрокам, которые присоединяются. Организатор может быть вне выбранного диапазона.
          </div>
          {requiresVerifiedRating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', paddingLeft: '2px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', background: 'linear-gradient(135deg, #f59e0b, #ca8a04)', borderRadius: '4px', padding: '2px 6px' }}>
                <span style={{ color: '#fff', fontSize: '9px', fontWeight: 800 }}>✓ Подтверждён</span>
              </div>
              <span style={{ color: C.muted, fontSize: '11px' }}>подтверждённый рейтинг обязателен для участия</span>
            </div>
          )}
        </div>

        {/* ── Players ──────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Игроки {allFilled.length}/{maxSlots}
            </div>
            {canEditMatch && !isCapacityReserved && (
              <button onClick={() => setTargetSlot(slots.findIndex((slot) => !slot))} style={{ padding: '5px 12px', background: 'rgba(216,243,74,0.10)', border: '1px solid rgba(216,243,74,0.24)', borderRadius: '8px', color: C.gold, fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                + Пригласить
              </button>
            )}
          </div>
          <PadelCard padding="md" className="!rounded-2xl flex justify-around">
            {slots.map((player, i) => {
              let enrichedPlayer = player;
              // If it's a bot and doesn't have numericRating, enrich it from the source of truth.
              if (player?.isBot && player.numericRating == null) {
                const botData = botsById[player.id];
                if (botData) enrichedPlayer = { ...player, numericRating: botData.numericRating };
              }
              return (
                <PlayerSlot
                  key={i}
                  player={enrichedPlayer}
                  slotIndex={i}
                  onTap={setViewPlayer}
                  ratingChange={enrichedPlayer?.id ? ratingChanges[enrichedPlayer.id] : null}
                  onSlotClick={!isCompletedMatch ? () => handleEmptySlotClick(i) : undefined}
                />
              );
            })}
          </PadelCard>
          {visiblePendingInvitations.length > 0 && (
            <div className="mt-3 space-y-2" data-testid="pending-invitations-list">
              {visiblePendingInvitations.map((player) => {
                const cancelling = invitationActions.has(`cancel:${player.invitationId}`);
                return (
                  <div
                    key={player.invitationId}
                    data-testid={`pending-invitation-${player.invitationId}`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', borderRadius: '12px', background: 'rgba(255,111,97,0.06)', border: '1px solid rgba(255,111,97,0.18)' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: C.text, fontSize: '12px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {player.firstName} {player.lastName}
                      </div>
                      <div style={{ color: C.loss, fontSize: '10px', fontWeight: 700, marginTop: '2px' }}>Ожидает ответа</div>
                    </div>
                    <button
                      type="button"
                      data-testid={`cancel-invitation-${player.invitationId}`}
                      disabled={cancelling}
                      onClick={() => onCancelInvitation?.(player.invitationId).catch(() => {})}
                      style={{ flexShrink: 0, padding: '7px 9px', borderRadius: '9px', border: '1px solid rgba(255,111,97,0.28)', background: 'transparent', color: C.loss, fontSize: '10px', fontWeight: 800, opacity: cancelling ? 0.55 : 1, cursor: cancelling ? 'not-allowed' : 'pointer' }}
                    >
                      {cancelling ? 'Отменяем…' : 'Отменить приглашение'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {isParticipant && (
          <div className="mb-4">
            <PadelButton variant="info" fullWidth onClick={() => setChatOpen(true)}>
              💬 Открыть чат игры
            </PadelButton>
          </div>
        )}


        {/* ── Pinned message ────────────────────────────────────────────────── */}
        <PinnedBlock msg={pinnedMsg} isOwner={isOwner} onSave={setPinnedMsg} />

        {/* ── Price ────────────────────────────────────────────────────────── */}
        <div style={{ background: 'rgba(216,243,74,0.06)', borderRadius: '12px', padding: '12px 16px', marginBottom: '20px', border: '1px solid rgba(216,243,74,0.18)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: C.gold, fontSize: '22px', fontWeight: 800, lineHeight: 1 }}>{fmtPrice(pricePerPl)}</div>
            <div style={{ color: C.muted, fontSize: '11px', marginTop: '3px' }}>с человека · тариф по времени ÷ {maxSlots}</div>
          </div>
          {isActuallyPrime && <div style={{ color: C.gold, fontSize: '12px', fontWeight: 600 }}>✦ Вечерний тариф</div>}
        </div>

        {/* ── CTA / owner badge ─────────────────────────────────────────────── */}
        {isScoreDisputed ? (
          <div style={{ textAlign: 'center', padding: '18px', background: 'rgba(239,68,68,0.07)', borderRadius: '14px', border: '1px solid rgba(239,68,68,0.25)' }}>
            <div style={{ color: C.loss, fontWeight: 800, fontSize: '16px' }}>Счёт оспорен</div>
            <div style={{ color: C.muted, fontSize: '12px', marginTop: '6px' }}>Обратитесь к администратору клуба.</div>
          </div>
        ) : isScorePending ? (
          canConfirmPendingScore ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <PadelButton variant="success" size="lg" fullWidth onClick={handleConfirmScore}>
                Подтвердить счёт
              </PadelButton>
              <PadelButton variant="dark" size="md" fullWidth onClick={handleDisputeScore}>
                Оспорить
              </PadelButton>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '18px', background: 'rgba(212,175,55,0.07)', borderRadius: '14px', border: '1px solid rgba(212,175,55,0.24)' }}>
              <div style={{ color: C.gold, fontWeight: 800, fontSize: '16px' }}>Ожидает подтверждения счёта</div>
              <div style={{ color: C.muted, fontSize: '12px', marginTop: '6px', lineHeight: 1.45 }}>
                {confirmingPlayersLabel
                  ? `Подтвердить может команда ${confirmingTeamNumber}: ${confirmingPlayersLabel}.`
                  : 'Подтвердить может участник противоположной команды.'}
              </div>
            </div>
          )
        ) : isCompletedMatch ? (
          <div style={{ textAlign: 'center', padding: '18px', background: 'rgba(34,197,94,0.08)', borderRadius: '14px', border: '1px solid rgba(34,197,94,0.25)' }}>
            <div style={{ color: C.win, fontWeight: 800, fontSize: '17px' }}>✓ Матч завершён</div>
            {completedScoreText && (
              <div style={{ color: C.text, fontWeight: 800, fontSize: '18px', marginTop: '8px' }}>
                {completedScoreText}
              </div>
            )}
          </div>
        ) : isOwner ? (
          <>
            <div style={{ background: 'rgba(212,175,55,0.06)', borderRadius: '14px', padding: '16px', border: '1px solid rgba(212,175,55,0.2)', textAlign: 'center', color: C.gold, fontSize: '13px', fontWeight: 600 }}>
              Вы управляете этой игрой
            </div>
            <PadelButton
              variant={isFull && !isCompletedMatch ? 'success' : 'dark'}
              size="lg"
              fullWidth
              disabled={!isFull || isCompletedMatch}
              onClick={handleFinishMatch}
              className="mt-2.5"
            >
              {isCompletedMatch
                ? '✓ Матч завершён'
                : isFull
                  ? '🏁 Завершить матч'
                  : `Заполните все слоты (${allFilled.length}/${maxSlots})`}
            </PadelButton>
          </>
        ) : (joined || isParticipant) ? (
          <div data-testid="match-joined-state" style={{ textAlign: 'center', padding: '20px', background: 'rgba(34,197,94,0.08)', borderRadius: '14px', border: '1px solid rgba(34,197,94,0.25)' }}>
            <div style={{ color: C.win, fontWeight: 700, fontSize: '17px' }}>Вы присоединились к матчу!</div>
            <div style={{ color: C.muted, fontSize: '12px', marginTop: '4px' }}>Место сохранено в матче</div>
          </div>
        ) : (
          <>
            {!canJoin && showRatingGuard && (
              <RatingGuardBanner match={match} reason={guardReason} />
            )}
            <PadelButton
              data-testid="match-self-join-button"
              variant={canJoin ? (isActuallyPrime ? 'yellow' : 'info') : 'dark'}
              size="lg"
              fullWidth
              disabled={!canJoin || joining}
              onClick={handleJoin}
            >
              {isFull ? 'Матч заполнен' : isCapacityReserved ? 'Свободных мест нет' : canJoin ? 'Присоединиться к игре' : 'Участие недоступно'}
            </PadelButton>
          </>
        )}
      </div>

      {/* ── Sheets / Dialogs ──────────────────────────────────────────────── */}
      {viewPlayer  && (
        <PlayerMiniProfile
          player={viewPlayer}
          onClose={() => setViewPlayer(null)}
          onRemove={
            canEditMatch && !viewPlayer.isOrganizer
              ? handleRemoveViewedPlayer
              : canLeaveViewedPlayer
                ? handleLeaveViewedPlayer
                : null
          }
          removeLabel={canLeaveViewedPlayer ? 'Выйти из матча' : 'Убрать из матча'}
        />
      )}
      {editSheet   && canEditMatch && <EditPanel initDate={dateISO} initTime={time} initCourt={courtType} initDuration={duration} initTitle={title} initDescription={description} onSave={handleEditSave} onClose={() => setEditSheet(false)} />}
      {cancelSheet && canEditMatch && <CancelSheet onConfirm={handleCancelConfirm} onClose={() => setCancelSheet(false)} />}
      {kickTarget  && canEditMatch && <KickConfirm player={kickTarget} onConfirm={handleKickConfirm} onCancel={() => setKickTarget(null)} />}
      {leaveTarget && <LeaveConfirm onConfirm={handleLeaveConfirm} onCancel={() => setLeaveTarget(null)} />}
      {levelOverride && canEditMatch && (
        <LevelOverrideConfirm
          message={levelOverride.message}
          onConfirm={handleConfirmLevelOverride}
          onCancel={() => setLevelOverride(null)}
        />
      )}
      {chatOpen && (
        <MatchChat
          match={match}
          currentUser={currentUser}
          messages={allMessages.filter(m => (m.matchId ?? m.match_id) === match.id)}
          loading={messagesLoading}
          loadError={messagesLoadError}
          onRetry={onRetryMessages}
          onSendMessage={(text) => onSendMessage(match.id, currentUser, text)}
          onClose={() => setChatOpen(false)}
        />
      )}
      {targetSlot !== null && !isCompletedMatch && (
        <SlotActionSheet
          slotIndex={targetSlot}
          isOwner={isOwner}
          currentUser={currentUser}
          matchId={match.id}
          slots={slots} // <-- ВОТ ОНА, САМАЯ ГЛАВНАЯ СТРОКА! Передаем массив слотов родителя
          onAddGuest={handleAddGuest}
          onAddBot={handleAddBot}
          availableBotsCount={currentUser?.role === 'admin' ? availableBotsCount : 0}
          onTakeSlot={handleTakeSlot}
          showToast={showToast}
          onClose={() => setTargetSlot(null)}
        />
      )}

      {finishModal && (
        <FinishMatchModal
          players={allFilled}
          onSave={handleFinalize}
          onClose={() => setFinishModal(false)}
        />
      )}

      {finishToast && (
        <div style={{
          position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9000, maxWidth: '340px', width: 'calc(100% - 32px)',
          background: '#1e293b', borderRadius: '12px',
          padding: '12px 16px', border: '1px solid rgba(34,197,94,0.4)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          display: 'flex', gap: '10px', alignItems: 'center',
        }}>
          <span style={{ color: C.win, fontSize: '13px', fontWeight: 900 }}>UP</span>
          <div style={{ color: C.win, fontWeight: 700, fontSize: '13px' }}>
            {finishToast}
          </div>
        </div>
      )}
    </div>
  );
}
