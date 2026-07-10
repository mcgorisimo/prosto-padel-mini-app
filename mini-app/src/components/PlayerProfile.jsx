import React, { useState, useRef, useEffect } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import RatingChart from './RatingChart';
import PadelButton from './ui/PadelButton';
import { RATING_CONFIG, getLevelForRating } from '../lib/ratingEngine';
import { CLUB, PRICING } from '../lib/clubConfig';

// ─── Count-up animation ──────────────────────────────────────────────────────
// Eases from previous value to current target using requestAnimationFrame.
// Initial mount: returns target instantly (no animation on first paint).

function useAnimatedNumber(target, duration = 700) {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [val, setVal] = useState(safeTarget);
  const prevRef = useRef(safeTarget);

  useEffect(() => {
    const from = prevRef.current;
    const to   = safeTarget;
    if (from === to) return;
    prevRef.current = to;
    const start = performance.now();
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [safeTarget, duration]);

  return val;
}

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

const fmtPrice = (n) => n.toLocaleString('ru-RU') + ' ₽';

const getAttestationPrice = (timeSlot) => {
  const coach = 4000;
  const court = timeSlot === 'night' ? PRICING.weekday[1].rate : PRICING.weekday[0].rate;
  return { coach, court, total: coach + court };
};

// Legacy placeholder shown only when upcomingMatches prop is empty
const MOCK_UPCOMING = [];

const ME_ID = 'me';

const fmtRating  = (n) => (typeof n === 'number' ? n.toFixed(2) : '—');
const fmtDelta   = (n) => (typeof n === 'number' ? `${n >= 0 ? '+' : ''}${n.toFixed(3)}` : '—');
const fmtSetList = (sets) => (sets ?? [])
  .filter(s => (s.t1 ?? 0) + (s.t2 ?? 0) > 0)
  .map(s => `${s.t1}:${s.t2}`)
  .join(', ') || '—';
const fmtPair = (team) => (team ?? [])
  .map(p => p?.id === ME_ID ? 'Вы' : (p?.firstName || '?'))
  .join(' + ') || '—';
const fmtCompletedDate = (ts) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', '');
  } catch { return ''; }
};
const getCompletedResultLabel = (match, userId) => {
  if (typeof match?.isTeam1Win !== 'boolean' || !userId) return 'Завершён';

  const inTeam1 = (match.team1 ?? []).some(p => p?.id === userId);
  const inTeam2 = (match.team2 ?? []).some(p => p?.id === userId);
  if (!inTeam1 && !inTeam2) return 'Завершён';

  const isWin = inTeam1 ? match.isTeam1Win : !match.isTeam1Win;
  return isWin ? 'Победа' : 'Поражение';
};

// ─── Player Avatar with Rating Badge ──────────────────────────────────────────

function PlayerAvatarWithRating({ player, rating, size = 'sm' }) {
  const initials = [player?.firstName?.[0], player?.lastName?.[0]].filter(Boolean).join('') || '?';
  const ratingStr = typeof rating === 'number' ? rating.toFixed(1) : '—';

  const SIZES = {
    sm: {
      wrapper: 'w-10 h-10 aspect-square',
      text: 'text-sm',
      badge: 'w-5 h-5 -top-1 -right-1',
      badgeText: 'text-[10px]',
    },
  };

  const s = SIZES[size];

  return (
    <div className="relative shrink-0">
      <div className={`relative rounded-full ${s.wrapper}`}>
        {player?.photo_url ? (
          <img src={player.photo_url} alt={player.firstName} className="w-full h-full rounded-full object-cover" />
        ) : (
          <div className={`w-full h-full rounded-full bg-surface flex items-center justify-center font-bold text-white ${s.text}`}>
            {initials}
          </div>
        )}
        {/* Rating Badge */}
        <div className={`absolute ${s.badge} bg-green-600 rounded-full flex items-center justify-center border-2 border-slate-900`}>
          <span className={`text-white font-bold leading-none ${s.badgeText}`}>
            {ratingStr}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Team Avatars Group ───────────────────────────────────────────────────────

function TeamAvatars({ team, ratingChanges }) {
  if (!team || team.length === 0) return <span className="text-slate-500">—</span>;

  return (
    <div className="flex items-center gap-2">
      {team.map((p, index) => {
        const rating = ratingChanges?.[p?.id]?.after;
        const playerInfo = p?.id === ME_ID ? { firstName: 'Вы' } : p;
        return <PlayerAvatarWithRating key={p?.id || index} player={playerInfo} rating={rating} />;
      })}
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function ProfileMatchCard({ match, type = 'upcoming', onClick, userId }) {
  const isCompleted = type === 'completed';
  const score = fmtSetList(match.finalScore ?? match.score);
  const completedDate = fmtCompletedDate(match.completedAt ?? match.completed_at);
  const title = match.title || (match.type === 'match' ? 'Матч' : 'Бронь');
  const meta = [match.date, match.time, match.courtName || 'Корт'].filter(Boolean).join(' · ');
  const resultLabel = getCompletedResultLabel(match, userId);

  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '14px',
        padding: '12px',
        color: C.text,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.4 }}>
            {isCompleted ? (completedDate || meta) : meta}
          </div>
        </div>
        <div style={{ color: isCompleted ? C.win : C.gold, fontSize: '12px', fontWeight: 800, flexShrink: 0 }}>
          {isCompleted ? resultLabel : 'Открыть'}
        </div>
      </div>
      {isCompleted && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '10px', color: C.muted, fontSize: '11px' }}>
          <span>{fmtPair(match.team1)}</span>
          <span style={{ color: C.text, fontWeight: 700 }}>{score}</span>
          <span>{fmtPair(match.team2)}</span>
        </div>
      )}
    </button>
  );
}

function ProfileMatchSection({ title, emptyText, matches, type, onViewDetails, userId }) {
  return (
    <section style={{ marginBottom: '16px' }}>
      <div style={{ color: C.muted, fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>
        {title}
      </div>
      {matches.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {matches.map(match => (
            <ProfileMatchCard key={match.id} match={match} type={type} onClick={onViewDetails} userId={userId} />
          ))}
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '12px', color: C.muted, fontSize: '12px' }}>
          {emptyText}
        </div>
      )}
    </section>
  );
}

function Avatar({ user, level, rating, isVerified }) {
  const fullName  = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const initials  = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('') || '?';
  const ringColor = level?.color || C.accent;
  const ratingStr = isVerified && typeof rating === 'number' ? rating.toFixed(1) : '—';

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{
        width: '88px', height: '88px', borderRadius: '50%',
        background: `conic-gradient(from 0deg, ${ringColor}, rgba(255,255,255,0.1) 60%, ${ringColor})`,
        padding: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'ring-spin 4s linear infinite',
      }}>
        <div style={{
          width: '82px', height: '82px', borderRadius: '50%',
          background: C.bg, padding: '2px', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {user?.photo_url ? (
            <img src={user.photo_url} alt={fullName}
              style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%', borderRadius: '50%',
              background: 'linear-gradient(145deg, #12382A, #071F16)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '26px', fontWeight: 700, color: '#fff',
            }}>
              {initials}
            </div>
          )}
        </div>
      </div>
      {/* Rating Badge */}
      <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-600 rounded-full flex items-center justify-center border-2 border-slate-900">
        <span className="text-white text-xs font-bold leading-none">
          {ratingStr}
        </span>
      </div>

      {/* Status dot */}
      <div style={{
        position: 'absolute', bottom: '4px', right: '2px',
        width: '16px', height: '16px', borderRadius: '50%',
        background: C.win, border: `2px solid ${C.bg}`,
      }} />
    </div>
  );
}

// ─── Level Selector ───────────────────────────────────────────────────────────

function LevelSelector({ currentLevel }) {
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      {RATING_CONFIG.levels.map((lvl) => {
        const active = lvl.label === currentLevel?.label;
        return (
          <div
            key={lvl.label}
            style={{
              flex: 1, padding: '10px 0',
              borderRadius: '10px', textAlign: 'center',
              border: active ? 'none' : `1px solid ${C.border}`,
              background: active
                ? `linear-gradient(135deg, ${lvl.color}, ${lvl.color}cc)`
                : C.card,
              color: active ? '#fff' : '#334155',
              fontSize: '13px', fontWeight: active ? 800 : 500,
              boxShadow: active ? `0 4px 12px ${lvl.color}66` : 'none',
              userSelect: 'none',
            }}
          >
            {lvl.label}
          </div>
        );
      })}
    </div>
  );
}

// ─── Level change notification ────────────────────────────────────────────────

function LevelNotification({ onClose }) {
  return (
    <div style={{
      position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 9000, maxWidth: '340px', width: 'calc(100% - 32px)',
      background: '#1e293b', borderRadius: '12px',
      padding: '12px 16px', border: '1px solid rgba(212,175,55,0.4)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      display: 'flex', gap: '10px', alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '18px', flexShrink: 0 }}>!</span>
      <div style={{ flex: 1 }}>
        <div style={{ color: C.gold, fontWeight: 700, fontSize: '13px', marginBottom: '3px' }}>
          Подтверждение тренера
        </div>
        <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.5 }}>
          Повышение рейтинга доступно после подтверждения тренером клуба
        </div>
      </div>
      <button onClick={onClose}
        style={{ background: 'none', border: 'none', color: C.muted, fontSize: '16px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}>
        ✕
      </button>
    </div>
  );
}

// ─── Verified Badge ───────────────────────────────────────────────────────────

function VerifiedBadge() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      background: 'linear-gradient(135deg, #f59e0b, #ca8a04)',
      borderRadius: '6px', padding: '3px 9px',
      boxShadow: '0 2px 8px rgba(245,158,11,0.35)',
    }}>
      <span style={{ fontSize: '11px', color: '#fff' }}>✓</span>
      <span style={{ color: '#fff', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em' }}>
        Подтверждён
      </span>
    </div>
  );
}

// ─── Training Booking Sheet ───────────────────────────────────────────────────

function TrainingBookingSheet({ ratingLabel, onClose, onBooked }) {
  const [timeSlot, setTimeSlot]   = useState('day'); // 'day' | 'night'
  const [confirmed, setConfirmed] = useState(false);

  const { coach, court, total } = getAttestationPrice(timeSlot);

  const handleBook = () => {
    setConfirmed(true);
    setTimeout(() => { onBooked(); onClose(); }, 2000);
  };

  return (
    <div className="app-modal-overlay" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 9999,
    }}>
      <div className="app-modal-panel" style={{
        background: '#07160F', borderRadius: '24px 24px 0 0',
        width: '100%', maxWidth: '480px', padding: '0 20px 44px',
        border: '1px solid rgba(245,241,232,0.16)',
      }}>
        {/* Handle */}
        <div style={{ padding: '12px 0 16px', textAlign: 'center' }}>
          <div style={{ width: '40px', height: '4px', background: C.border, borderRadius: '2px', display: 'inline-block' }} />
        </div>

        <h3 style={{ color: C.text, fontSize: '18px', fontWeight: 700, margin: '0 0 4px' }}>
          Аттестация уровня {ratingLabel}
        </h3>
        <p style={{ color: C.muted, fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
          Индивидуальная тренировка с тренером клуба + оценка уровня
        </p>

        {/* Time toggle */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
            Время занятия
          </div>
          <div style={{ display: 'flex', background: C.bg, borderRadius: '10px', padding: '3px', border: `1px solid ${C.border}` }}>
            {[
              { label: 'Дневное 07:00–17:00', val: 'day'   },
              { label: 'Вечернее 17:00–00:00', val: 'night' },
            ].map(({ label, val }) => (
              <button key={val} onClick={() => setTimeSlot(val)} style={{
                flex: 1, padding: '9px 4px', borderRadius: '8px', border: 'none',
                background: timeSlot === val
                  ? val === 'night' ? 'rgba(212,175,55,0.2)' : C.accent
                  : 'transparent',
                color: timeSlot === val ? (val === 'night' ? C.gold : '#fff') : C.muted,
                fontSize: '11px', fontWeight: timeSlot === val ? 700 : 400,
                cursor: 'pointer', transition: 'all 0.2s',
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Price breakdown */}
        <div style={{ background: 'rgba(255,255,255,0.035)', borderRadius: '16px', padding: '16px', marginBottom: '20px', border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px' }}>
            Стоимость аттестации
          </div>
          {[
            ['Работа тренера (1ч)', fmtPrice(coach), C.text],
            ['Аренда корта' + (timeSlot === 'night' ? ' (вечерний тариф)' : ''), fmtPrice(court), timeSlot === 'night' ? C.gold : C.text],
          ].map(([label, val, color]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ color: C.muted, fontSize: '13px' }}>{label}</span>
              <span style={{ color, fontWeight: 600, fontSize: '13px' }}>{val}</span>
            </div>
          ))}
          <div style={{ height: '1px', background: 'rgba(212,175,55,0.2)', margin: '10px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ color: C.text, fontWeight: 700 }}>Итого</span>
            <span style={{ color: C.gold, fontWeight: 800, fontSize: '22px' }}>{fmtPrice(total)}</span>
          </div>
        </div>

        {confirmed ? (
          <div style={{ textAlign: 'center', padding: '18px', background: 'rgba(34,197,94,0.08)', borderRadius: '12px', border: '1px solid rgba(34,197,94,0.2)' }}>
            <div style={{ color: C.win, fontSize: '13px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '6px' }}>Запрос отправлен</div>
            <div style={{ color: '#22C55E', fontWeight: 700, fontSize: '15px' }}>Записано!</div>
            <div style={{ color: C.muted, fontSize: '12px', marginTop: '4px' }}>Ожидайте подтверждения тренера клуба</div>
          </div>
        ) : (
          <>
            <button onClick={handleBook} style={{
              width: '100%', padding: '16px', marginBottom: '10px',
              background: 'rgba(216,243,74,0.12)',
              color: C.gold, border: '1px solid rgba(216,243,74,0.30)', borderRadius: '16px',
              fontSize: '15px', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 14px 34px rgba(0,0,0,0.18)',
            }}>
              Записаться на тренировку
            </button>
            <button onClick={onClose} style={{
              width: '100%', padding: '14px', background: 'transparent',
              color: C.muted, border: `1px solid ${C.border}`,
              borderRadius: '12px', fontSize: '14px', cursor: 'pointer',
            }}>
              Отмена
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Family Bonus Block ───────────────────────────────────────────────────────

function FamilyBonusBlock() {
  return (
    <div style={{
      background: 'rgba(212,175,55,0.07)',
      borderRadius: '12px', padding: '12px 14px',
      border: '1px solid rgba(212,175,55,0.25)',
      display: 'flex', alignItems: 'center', gap: '10px',
      marginBottom: '16px',
    }}>
      <span style={{ color: C.gold, fontSize: '13px', fontWeight: 900, flexShrink: 0 }}>20%</span>
      <div>
        <div style={{ color: C.gold, fontWeight: 700, fontSize: '13px', marginBottom: '2px' }}>
          Семейный абонемент активен
        </div>
        <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.4 }}>
          Ваш бонус на корты:{' '}
          <strong style={{ color: C.text }}>–20%</strong>
          {' '}(доступно в дневное время 07:00–17:00)
        </div>
      </div>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PlayerProfile({ user, stats, upcomingMatches = [], completedMatches = [], onViewDetails, onCreateMatch, onBookCourt, onOpenSettings, showToast, onLogout, isVerified: initVerified = false, hasFamilyMembership = false }) {
  // Numbers come from the App-level computed stats (single source of truth: allMatches + dp_rating_history).
  const currentRating = stats?.numericRating ?? 0;
  const matchesCount  = stats?.matchesCount  ?? 0;
  const winRate       = stats?.winRate       ?? 0;
  const currentLevel  = getLevelForRating(currentRating);

  // Animated displays — kick in when underlying stats change.
  const animRating  = useAnimatedNumber(currentRating);
  const animMatches = useAnimatedNumber(matchesCount);
  const animWinRate = useAnimatedNumber(winRate);
  const [isVerified, setIsVerified]     = useState(initVerified);
  const [verifPath, setVerifPath]       = useState(null);
  const [showTraining, setShowTraining] = useState(false);

  // Lunda screenshot upload
  const fileInputRef                  = useRef(null);
  const [lundaFile, setLundaFile]     = useState(null);   // filename string

  const handleLundaFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLundaFile(file.name);
    setVerifPath('lunda');
    showToast('Уведомление отправлено администратору', 'info');
    e.target.value = ''; // reset input
  };

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Игрок';

  return (
    <div style={{ background: C.bg, minHeight: '100dvh', paddingBottom: 'calc(112px + env(safe-area-inset-bottom, 0px))', overflowX: 'hidden' }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleLundaFile}
        style={{ display: 'none' }}
      />

      {/* ── Header card ── */}
      <div style={{
            background: 'radial-gradient(circle at 50% -20%, rgba(216,243,74,0.09), transparent 18rem), linear-gradient(180deg, #071F16 0%, #050F0B 100%)',
        padding: '28px 20px 24px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        {/* Avatar row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <Avatar user={user} level={currentLevel} rating={animRating} isVerified={isVerified} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ color: C.text, fontSize: '20px', fontWeight: 700, margin: '0 0 6px', lineHeight: 1.2 }}>
              {displayName}
            </h1>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              background: `${currentLevel.color}26`, borderRadius: '6px',
              padding: '3px 8px', marginBottom: '6px',
            }}>
              <span style={{ color: currentLevel.color, fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', fontVariantNumeric: 'tabular-nums' }}>
                {isVerified
                  ? `Подтверждённый рейтинг · ${currentLevel.label} · ${animRating.toFixed(2)}`
                  : `Рейтинг пока не подтверждён · ${currentLevel.label}`}
              </span>
            </div>
            <div style={{ color: C.muted, fontSize: '12px' }}>
              {user?.username ? `@${user.username} · ` : ''}{CLUB.location}, {CLUB.address}
            </div>
          </div>

          <button onClick={onOpenSettings} aria-label="Настройки" style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: C.surface,
            border: `1px solid ${C.border}`,
            color: C.muted,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            transition: 'background 0.15s ease',
          }}>
            <SettingsIcon size={18} strokeWidth={1.8} />
          </button>
        </div>

        {/* Level selector — read-only */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Уровень игры
            </div>
            {isVerified && <VerifiedBadge />}
          </div>
          <LevelSelector currentLevel={currentLevel} />

          {/* Helper text — always visible */}
          <div style={{ color: '#334155', fontSize: '11px', textAlign: 'center', marginTop: '8px', lineHeight: 1.5 }}>
            Уровень можно подтвердить у администратора клуба.
          </div>

          {/* Verification status block */}
          <div style={{ marginTop: '10px' }}>
            {isVerified ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(34,197,94,0.07)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(34,197,94,0.20)' }}>
                <span style={{ color: C.win, fontSize: '13px', fontWeight: 900 }}>✓</span>
                <div>
                  <div style={{ color: C.win, fontSize: '12px', fontWeight: 700 }}>Рейтинг подтверждён</div>
                  <div style={{ color: C.muted, fontSize: '11px' }}>Это официальный клубный рейтинг для матчей с ограничением по уровню</div>
                </div>
              </div>
            )

            : verifPath === 'training' ? (
              /* ── Ожидает тренера ── */
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(212,175,55,0.07)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(212,175,55,0.2)' }}>
                <span style={{ color: C.gold, fontSize: '13px', fontWeight: 900 }}>...</span>
                <div>
                  <div style={{ color: C.gold, fontSize: '12px', fontWeight: 700 }}>Ожидает подтверждения тренера</div>
                  <div style={{ color: C.muted, fontSize: '11px' }}>Уровень обновится после аттестации</div>
                </div>
              </div>

            ) : verifPath === 'lunda' ? (
              /* ── Скриншот на проверке ── */
              <div style={{ background: 'rgba(212,175,55,0.07)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(212,175,55,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: C.gold, fontSize: '13px', fontWeight: 900 }}>OK</span>
                  <div style={{ color: C.gold, fontSize: '12px', fontWeight: 700 }}>На проверке у администратора</div>
                </div>
                <div style={{ color: C.muted, fontSize: '11px', paddingLeft: '24px' }}>
                  {lundaFile || 'screenshot.png'} · Ожидайте подтверждения
                </div>
              </div>

            ) : (
              /* ── Не подтверждён — честное MVP-состояние ── */
              <div style={{ background: 'rgba(100,116,139,0.06)', borderRadius: '10px', padding: '12px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                  <span style={{ color: C.muted, fontSize: '13px', fontWeight: 900 }}>i</span>
                  <span style={{ color: C.muted, fontSize: '12px' }}>Рейтинг пока не подтверждён</span>
                </div>
                <div style={{ color: C.muted, fontSize: '11px', lineHeight: 1.5 }}>
                  Для участия в матчах с ограничением по уровню нужен подтверждённый рейтинг.
                  Клуб подтвердит уровень после первых игр или тренировки.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showTraining && (
        <TrainingBookingSheet
          ratingLabel={currentLevel.label}
          onClose={() => setShowTraining(false)}
          onBooked={() => setVerifPath('training')}
        />
      )}

      <div style={{ padding: '20px 16px 0' }}>

        {/* ── Stats block ── */}
        <div style={{
          background: C.card, borderRadius: '16px', border: `1px solid ${C.border}`,
          padding: '18px', marginBottom: '16px',
        }}>
          {/* Numbers row */}
          <div style={{ display: 'flex', marginBottom: '16px' }}>
            {[
              { value: Math.round(animMatches),         label: 'Матчей',  color: C.text,             tabular: true  },
              { value: `${Math.round(animWinRate)}%`,   label: 'Побед',   color: C.win,              tabular: true  },
              { value: currentLevel.label,              label: 'Уровень', color: currentLevel.color, tabular: false },
            ].map(({ value, label, color, tabular }, i, arr) => (
              <React.Fragment key={label}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{
                    color, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1,
                    fontVariantNumeric: tabular ? 'tabular-nums' : 'normal',
                  }}>
                    {value}
                  </div>
                  <div style={{ color: C.muted, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '5px' }}>
                    {label}
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ width: '1px', background: C.border, margin: '0 4px', alignSelf: 'stretch' }} />
                )}
              </React.Fragment>
            ))}
          </div>

        </div>

        {/* ── Rating history chart ── */}
        <ProfileMatchSection
          title="Предстоящие матчи"
          emptyText="Пока нет предстоящих матчей"
          matches={upcomingMatches}
          type="upcoming"
          onViewDetails={onViewDetails}
          userId={user?.id}
        />

        <ProfileMatchSection
          title="История матчей"
          emptyText="История появится после завершения первого матча"
          matches={completedMatches}
          type="completed"
          onViewDetails={onViewDetails}
          userId={user?.id}
        />

        <RatingChart />

        {/* ── Family bonus ── */}
        {hasFamilyMembership && <FamilyBonusBlock />}

        {/* ── CTAs ── */}
        <PadelButton
          variant="yellow"
          size="lg"
          fullWidth
          onClick={() => {
            onBookCourt(); // This is `setActiveTab('booking')`
            showToast('Сначала выберите свободный корт и время');
          }}
          className="mb-6"
        >
          Забронировать / Создать матч
        </PadelButton>

        {/* Logout Button */}
        <PadelButton
          variant="danger"
          size="md"
          fullWidth
          onClick={onLogout}
          className="mt-4"
        >
          Выйти из аккаунта
        </PadelButton>
      </div>
    </div>
  );
}
