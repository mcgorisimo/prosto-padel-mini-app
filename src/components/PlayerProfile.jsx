import React, { useState, useRef, useEffect } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import RatingChart from './RatingChart';
import PadelButton from './ui/PadelButton';
import { RATING_CONFIG, getLevelForRating } from '../lib/ratingEngine';
import { PRICING } from '../lib/clubConfig';
import { formatParticipationPrice, getParticipationPrice } from '../lib/pricing';

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

const PROFILE_PHOTO_MAX_BYTES = 8 * 1_024 * 1_024;
const PROFILE_PHOTO_OUTPUT_DIMENSION = 1_200;

const getSideBadge = (sidePreference) => {
  const normalized = String(sidePreference || '').toLowerCase();
  if (normalized === 'left' || normalized === 'l' || normalized.includes('лев')) return 'L';
  if (normalized === 'right' || normalized === 'r' || normalized.includes('прав')) return 'R';
  return 'LR';
};

const loadPhoto = (source) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = source;
});

async function createCroppedProfilePhoto(source, cropX, cropY, zoom) {
  const image = await loadPhoto(source);
  const visibleSide = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  const sourceX = (image.naturalWidth - visibleSide) * (cropX / 100);
  const sourceY = (image.naturalHeight - visibleSide) * (cropY / 100);
  const outputDimension = Math.min(
    PROFILE_PHOTO_OUTPUT_DIMENSION,
    Math.max(256, Math.round(visibleSide)),
  );
  const canvas = document.createElement('canvas');
  canvas.width = outputDimension;
  canvas.height = outputDimension;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('profile_photo_canvas_unavailable');
  context.drawImage(
    image,
    sourceX,
    sourceY,
    visibleSide,
    visibleSide,
    0,
    0,
    outputDimension,
    outputDimension,
  );
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.9);
  });
  if (!blob) throw new Error('profile_photo_crop_failed');
  return new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' });
}

const fmtPrice = (n) => n.toLocaleString('ru-RU') + ' ₽';

const getAttestationPrice = (timeSlot) => {
  const coach = 4000;
  const court = timeSlot === 'night' ? PRICING.weekday[1].rate : PRICING.weekday[0].rate;
  return { coach, court, total: coach + court };
};

// Legacy placeholder shown only when upcomingMatches prop is empty
const MOCK_UPCOMING = [];

const fmtSetList = (sets) => (sets ?? [])
  .filter(s => (s.t1 ?? 0) + (s.t2 ?? 0) > 0)
  .map(s => `${s.t1}:${s.t2}`)
  .join(' · ');
const fmtCompletedDate = (ts) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', '');
  } catch { return ''; }
};
const getMatchOutcome = (match, userId) => {
  if (['cancelled', 'canceled'].includes(match?.status)) return 'neutral';
  if (typeof match?.isTeam1Win !== 'boolean' || !userId) return 'neutral';
  const inTeam1 = (match.team1 ?? []).some((player) => player?.id === userId);
  const inTeam2 = (match.team2 ?? []).some((player) => player?.id === userId);
  if (!inTeam1 && !inTeam2) return 'neutral';
  return (inTeam1 ? match.isTeam1Win : !match.isTeam1Win) ? 'win' : 'loss';
};

const OUTCOME_UI = {
  win: { label: 'Победа', color: C.win, border: 'rgba(216,243,74,0.34)', background: 'rgba(216,243,74,0.065)' },
  loss: { label: 'Поражение', color: C.loss, border: 'rgba(255,111,97,0.34)', background: 'rgba(255,111,97,0.065)' },
  neutral: { label: 'Завершён', color: C.muted, border: C.border, background: C.card },
};

function UpcomingMatchCard({ match, onClick }) {
  const title = match.type === 'match' ? 'Матч' : 'Бронь';
  const meta = [match.date, match.time, match.courtName || 'Корт'].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      data-testid={`profile-upcoming-match-${match.id}`}
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
          <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.4 }}>{meta}</div>
        </div>
        <div style={{ color: C.gold, fontSize: '12px', fontWeight: 800, flexShrink: 0 }}>Открыть</div>
      </div>
    </button>
  );
}

function UpcomingMatchesSection({ matches, onViewDetails }) {
  return (
    <section style={{ marginBottom: '16px' }}>
      <div style={{ color: C.muted, fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>
        Предстоящие матчи
      </div>
      {matches.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {matches.map(match => (
            <UpcomingMatchCard key={match.id} match={match} onClick={onViewDetails} />
          ))}
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '12px', color: C.muted, fontSize: '12px' }}>
          Пока нет предстоящих матчей
        </div>
      )}
    </section>
  );
}

function ResultPlayer({ player, userId, ratingChanges }) {
  const ratingChange = player?.id ? ratingChanges?.[player.id] : null;
  const rating = player?.numericRating ?? player?.rating ?? ratingChange?.before;
  const firstName = player?.id === userId ? 'Вы' : player?.firstName;
  const name = [firstName, player?.lastName].filter(Boolean).join(' ') || 'Нет данных';
  const initials = player
    ? [firstName?.[0], player?.lastName?.[0]].filter(Boolean).join('') || '?'
    : '—';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, minHeight: '44px' }}>
      <div style={{ width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: player ? C.surface : 'rgba(255,255,255,0.025)', border: `1px solid ${C.border}`, color: player ? C.text : C.muted, fontSize: '11px', fontWeight: 800, overflow: 'hidden' }}>
        {player?.photo_url || player?.photo ? (
          <img src={player.photo_url || player.photo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : initials}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div title={name} style={{ color: player ? C.text : C.muted, fontSize: '11px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ color: C.muted, fontSize: '9px', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
          {typeof rating === 'number' ? `Рейтинг ${rating.toFixed(2)}` : 'Рейтинг не сохранён'}
        </div>
      </div>
    </div>
  );
}

function ResultTeam({ label, players, userId, ratingChanges }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: C.muted, fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>{label}</div>
      {[0, 1].map((index) => (
        <ResultPlayer key={players?.[index]?.id ?? index} player={players?.[index] ?? null} userId={userId} ratingChanges={ratingChanges} />
      ))}
    </div>
  );
}

function ResultCard({ match, userId, onClick }) {
  const outcome = getMatchOutcome(match, userId);
  const ui = OUTCOME_UI[outcome];
  const ratingChanges = match.ratingChanges ?? match.rating_changes ?? {};
  const userDelta = ratingChanges?.[userId]?.delta;
  const score = fmtSetList(match.finalScore ?? match.score);
  const date = fmtCompletedDate(match.completedAt ?? match.completed_at ?? match.dateISO) || match.date || 'Дата не сохранена';
  const resultLabel = ['cancelled', 'canceled'].includes(match.status) ? 'Отменён' : ui.label;

  return (
    <button
      type="button"
      data-testid={`result-card-${outcome}`}
      onClick={() => onClick?.(match)}
      style={{ flex: '0 0 calc(100% - 28px)', maxWidth: '360px', minWidth: 0, scrollSnapAlign: 'start', scrollSnapStop: 'always', textAlign: 'left', padding: '15px', borderRadius: '20px', border: `1px solid ${ui.border}`, background: ui.background, color: C.text, cursor: 'pointer', minHeight: '268px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.muted, fontSize: '10px', fontWeight: 700 }}>{date}</div>
          <div style={{ fontSize: '15px', fontWeight: 850, marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Матч</div>
        </div>
        <span style={{ flexShrink: 0, color: ui.color, fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{resultLabel}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px minmax(0, 1fr)', gap: '7px', alignItems: 'center' }}>
        <ResultTeam label="Команда 1" players={match.team1} userId={userId} ratingChanges={ratingChanges} />
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: '9px', fontWeight: 900, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>VS</div>
        <ResultTeam label="Команда 2" players={match.team2} userId={userId} ratingChanges={ratingChanges} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '12px', paddingTop: '11px', borderTop: `1px solid ${C.border}` }}>
        <div>
          <div style={{ color: C.muted, fontSize: '9px', textTransform: 'uppercase', fontWeight: 800 }}>Счёт по сетам</div>
          <div style={{ color: score ? C.text : C.muted, fontSize: '14px', fontWeight: 900, marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>{score || 'Не сохранён'}</div>
        </div>
        {typeof userDelta === 'number' && (
          <div style={{ color: userDelta >= 0 ? C.win : C.loss, fontSize: '13px', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
            {userDelta >= 0 ? '+' : ''}{userDelta.toFixed(3)}
          </div>
        )}
      </div>
    </button>
  );
}

function ResultsSection({ matches, userId, onViewDetails }) {
  return (
    <section style={{ marginBottom: '16px', minWidth: 0 }} data-testid="profile-results-section">
      <div style={{ color: C.muted, fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>Результаты игр</div>
      {matches.length > 0 ? (
        <div className="profile-horizontal-rail" data-testid="profile-results-rail">
          {matches.map((match) => <ResultCard key={match.id} match={match} userId={userId} onClick={onViewDetails} />)}
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '14px', color: C.muted, fontSize: '12px' }}>Результаты появятся после завершения первого матча</div>
      )}
    </section>
  );
}

function MatchStats({ stats }) {
  const form = stats?.recentForm ?? [];
  return (
    <section data-testid="profile-match-stats" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '18px', padding: '14px', marginBottom: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', textAlign: 'center' }}>
        {[
          [`${stats?.winRate ?? 0}%`, 'Побед'],
          [stats?.matchesCount ?? 0, 'Матчей'],
          [stats?.winsCount ?? 0, 'Выиграно'],
          [stats?.lossesCount ?? 0, 'Проиграно'],
        ].map(([value, label]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ color: label === 'Проиграно' ? C.loss : label === 'Выиграно' ? C.win : C.text, fontSize: '17px', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            <div style={{ color: C.muted, fontSize: '8px', fontWeight: 800, textTransform: 'uppercase', marginTop: '3px' }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '13px', paddingTop: '12px', borderTop: `1px solid ${C.border}` }}>
        <span style={{ color: C.muted, fontSize: '10px', fontWeight: 800, textTransform: 'uppercase' }}>Последние 5</span>
        <div style={{ display: 'flex', gap: '7px' }}>
          {form.length > 0 ? form.map((outcome, index) => (
            <span key={`${outcome}-${index}`} title={outcome === 'win' ? 'Победа' : outcome === 'loss' ? 'Поражение' : 'Результат не определён'} style={{ width: '24px', height: '24px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: outcome === 'win' ? 'rgba(216,243,74,0.14)' : outcome === 'loss' ? 'rgba(255,111,97,0.14)' : 'rgba(255,255,255,0.05)', color: outcome === 'win' ? C.win : outcome === 'loss' ? C.loss : C.muted, fontSize: '9px', fontWeight: 900 }}>
              {outcome === 'win' ? 'В' : outcome === 'loss' ? 'П' : '—'}
            </span>
          )) : <span style={{ color: C.muted, fontSize: '11px' }}>Нет данных</span>}
        </div>
      </div>
    </section>
  );
}

function InvitationNotificationCard({ notification, invitation, processing, onAccept, onDecline }) {
  const organizer = [invitation.organizer_first_name, invitation.organizer_last_name].filter(Boolean).join(' ') || 'Организатор';
  const details = [invitation.date_iso ? fmtCompletedDate(invitation.date_iso) : null, invitation.start_time, invitation.court_name].filter(Boolean).join(' · ');
  const levels = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
  const minLevel = levels[invitation.rating_min] ?? invitation.rating_min;
  const maxLevel = levels[invitation.rating_max] ?? invitation.rating_max;
  const pricePerPerson = getParticipationPrice(invitation, { allowFallback: false });
  const priceLabel = formatParticipationPrice(pricePerPerson, {
    isFree: invitation.is_free === true || invitation.isFree === true,
  });

  return (
    <article data-testid={`invitation-card-${invitation.invitation_id}`} className="profile-notification-card" style={{ borderColor: notification?.read_at ? C.border : 'rgba(255,111,97,0.34)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.loss, fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Приглашение</div>
          <div style={{ color: C.text, fontSize: '15px', fontWeight: 850, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{organizer}</div>
        </div>
        {!notification?.read_at && <span aria-label="Непрочитанное" style={{ width: '8px', height: '8px', flexShrink: 0, borderRadius: '50%', background: '#ef4444', marginTop: '4px' }} />}
      </div>
      <div style={{ color: C.muted, fontSize: '11px', lineHeight: 1.45, marginTop: '8px', minHeight: '32px' }}>{details || 'Детали матча доступны после принятия приглашения'}</div>
      <div style={{ display: 'flex', gap: '12px', color: C.muted, fontSize: '10px', marginTop: '7px' }}>
        {minLevel != null && maxLevel != null && <span>Уровень <strong style={{ color: C.text }}>{minLevel}–{maxLevel}</strong></span>}
        <span><strong data-testid={`invitation-price-${invitation.invitation_id}`} style={{ color: C.win }}>{priceLabel}</strong></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' }}>
        <button type="button" data-testid={`invitation-decline-${invitation.invitation_id}`} disabled={processing} onClick={() => onDecline(invitation).catch(() => {})} style={{ minHeight: '44px', borderRadius: '13px', border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: '12px', fontWeight: 800, opacity: processing ? 0.55 : 1 }}>Отказаться</button>
        <button type="button" data-testid={`invitation-accept-${invitation.invitation_id}`} disabled={processing} onClick={() => onAccept(invitation).catch(() => {})} style={{ minHeight: '44px', borderRadius: '13px', border: '1px solid rgba(216,243,74,0.32)', background: 'rgba(216,243,74,0.12)', color: C.win, fontSize: '12px', fontWeight: 900, opacity: processing ? 0.55 : 1 }}>{processing ? 'Подождите…' : 'Принять'}</button>
      </div>
    </article>
  );
}

function StandardNotificationCard({ notification, onView }) {
  const isWaitlistPromotion = notification.notification_type === 'waitlist_promoted';
  return (
    <button type="button" data-testid={`notification-card-${notification.notification_id}`} className="profile-notification-card" onClick={() => onView(notification)} style={{ textAlign: 'left', cursor: 'pointer', borderColor: notification.read_at ? C.border : 'rgba(216,243,74,0.30)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
        <div style={{ color: isWaitlistPromotion ? C.win : C.gold, fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{isWaitlistPromotion ? 'Место в матче' : 'Уведомление'}</div>
        {!notification.read_at && <span aria-label="Непрочитанное" style={{ width: '8px', height: '8px', flexShrink: 0, borderRadius: '50%', background: '#ef4444' }} />}
      </div>
      <div style={{ color: C.text, fontSize: '15px', fontWeight: 850, marginTop: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notification.title || 'Новое уведомление'}</div>
      <div style={{ color: C.muted, fontSize: '11px', lineHeight: 1.45, marginTop: '7px', minHeight: '48px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{notification.body || 'Откройте связанный матч, чтобы посмотреть детали.'}</div>
      <div style={{ color: notification.match_id ? C.win : C.muted, fontSize: '11px', fontWeight: 850, marginTop: '10px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>{notification.match_id ? 'Открыть матч →' : 'Прочитано'}</div>
    </button>
  );
}

function NotificationsSection({ notifications, invitations, loading, loadError, actions, onRetry, onView, onAccept, onDecline }) {
  const invitationsById = new Map(invitations.map((item) => [item.invitation_id, item]));
  const cards = notifications
    .filter((notification) => notification.notification_type !== 'match_invitation'
      || invitationsById.has(notification.invitation_id))
    .map((notification) => ({ notification, invitation: invitationsById.get(notification.invitation_id) ?? null }));
  const existingInvitationIds = new Set(notifications.map((item) => item.invitation_id).filter(Boolean));
  invitations.forEach((invitation) => {
    if (!existingInvitationIds.has(invitation.invitation_id)) cards.push({ notification: null, invitation });
  });

  return (
    <section data-testid="profile-notifications" style={{ marginBottom: '18px', minWidth: 0 }} aria-live="polite">
      <div style={{ color: C.muted, fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>Уведомления</div>
      {loading ? (
        <div data-testid="notifications-loading" style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: '18px', padding: '22px', color: C.muted, fontSize: '12px', textAlign: 'center' }}>Загружаем уведомления…</div>
      ) : loadError ? (
        <div data-testid="notifications-error" style={{ background: C.card, border: '1px solid rgba(255,111,97,0.25)', borderRadius: '18px', padding: '16px', color: C.loss, fontSize: '12px', textAlign: 'center' }}>
          <div>{loadError}</div>
          <button type="button" onClick={onRetry} style={{ minHeight: '44px', marginTop: '10px', padding: '0 18px', borderRadius: '12px', border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontWeight: 800 }}>Повторить</button>
        </div>
      ) : cards.length === 0 ? (
        <div data-testid="notifications-empty" style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: '18px', padding: '18px', color: C.muted, fontSize: '12px', textAlign: 'center' }}>Новых уведомлений пока нет.</div>
      ) : (
        <div className="profile-horizontal-rail" data-testid="profile-notifications-rail">
          {cards.map(({ notification, invitation }, index) => invitation ? (
            <InvitationNotificationCard key={invitation.invitation_id} notification={notification} invitation={invitation} processing={actions.has(`accept:${invitation.invitation_id}`) || actions.has(`decline:${invitation.invitation_id}`)} onAccept={onAccept} onDecline={onDecline} />
          ) : (
            <StandardNotificationCard key={notification?.notification_id ?? index} notification={notification} onView={onView} />
          ))}
        </div>
      )}
    </section>
  );
}

function Avatar({ user, level, rating, onManagePhoto }) {
  const fullName  = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const initials  = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('') || '?';
  const ringColor = level?.color || C.accent;
  const ratingStr = Number.isFinite(rating) ? rating.toFixed(1) : '—';
  const sideBadge = getSideBadge(user?.side_preference || user?.sidePreference);

  return (
    <div style={{ position: 'relative', width: '88px', height: '88px', flexShrink: 0 }}>
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: `conic-gradient(from 0deg, ${ringColor}, rgba(255,255,255,0.1) 60%, ${ringColor})`,
        animation: 'ring-spin 4s linear infinite',
      }} />
      <button
        type="button"
        aria-label={`Настроить фото профиля ${fullName || 'игрока'}`}
        disabled={typeof onManagePhoto !== 'function'}
        onClick={onManagePhoto}
        style={{
          position: 'absolute', inset: '3px', borderRadius: '50%',
          background: C.bg, padding: '2px', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          border: 'none', cursor: typeof onManagePhoto === 'function' ? 'pointer' : 'default',
        }}
      >
        {user?.photo_url ? (
          <img src={user.photo_url} alt={fullName}
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <span style={{
            width: '100%', height: '100%', borderRadius: '50%',
            background: 'linear-gradient(145deg, #12382A, #071F16)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '26px', fontWeight: 700, color: '#fff',
          }}>
            {initials}
          </span>
        )}
      </button>
      {/* Rating Badge */}
      <div
        data-testid="profile-avatar-rating"
        style={{
          position: 'absolute', top: '-4px', right: '-5px', zIndex: 2,
          minWidth: '30px', height: '20px', padding: '0 5px', borderRadius: '999px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#071F16', border: '1px solid rgba(216,243,74,0.52)',
          boxShadow: '0 5px 12px rgba(0,0,0,0.3)', boxSizing: 'border-box',
        }}
      >
        <span style={{ color: C.gold, fontSize: '9px', fontWeight: 900, lineHeight: 1 }}>
          {ratingStr}
        </span>
      </div>

      <div
        data-testid="profile-avatar-side"
        aria-label={`Предпочитаемая сторона: ${sideBadge}`}
        style={{
          position: 'absolute', bottom: '2px', right: '-3px', zIndex: 2,
          minWidth: sideBadge === 'LR' ? '24px' : '20px', height: '20px', padding: '0 4px',
          borderRadius: '999px', background: C.gold, border: `2px solid ${C.bg}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.bg, fontSize: '8px', fontWeight: 900, boxSizing: 'border-box',
        }}
      >
        {sideBadge}
      </div>
    </div>
  );
}

function ProfilePhotoActions({
  user,
  name,
  busy,
  canUpload,
  canDelete,
  onSelect,
  onDelete,
  onOpenFull,
  onClose,
}) {
  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('') || '?';

  return (
    <div
      className="app-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Управление фото профиля"
      data-testid="profile-photo-actions"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10_000,
        background: 'rgba(0,0,0,0.76)', display: 'flex', alignItems: 'flex-end',
        justifyContent: 'center', padding: '16px',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(100%, 420px)', background: C.surface,
          border: `1px solid ${C.border}`, borderRadius: '22px', padding: '20px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ color: C.text, fontSize: '18px', fontWeight: 850, marginBottom: '16px' }}>
          Фото профиля
        </div>

        {user?.photo_url ? (
          <button
            type="button"
            data-testid="profile-photo-preview"
            aria-label={`Открыть фото ${name || 'игрока'} полностью`}
            onClick={onOpenFull}
            style={{
              width: '112px', height: '112px', margin: '0 auto 10px', padding: 0,
              display: 'block', overflow: 'hidden', borderRadius: '50%',
              border: `3px solid ${C.gold}`, background: C.bg, cursor: 'pointer',
            }}
          >
            <img
              src={user.photo_url}
              alt={name || 'Фото игрока'}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </button>
        ) : (
          <div style={{
            width: '112px', height: '112px', margin: '0 auto 10px', borderRadius: '50%',
            display: 'grid', placeItems: 'center', background: 'linear-gradient(145deg, #12382A, #071F16)',
            border: `2px solid ${C.border}`, color: C.text, fontSize: '32px', fontWeight: 800,
          }}>
            {initials}
          </div>
        )}

        {user?.photo_url && (
          <div style={{ color: C.muted, fontSize: '11px', textAlign: 'center', marginBottom: '16px' }}>
            Нажмите на фото, чтобы открыть его полностью
          </div>
        )}

        <div style={{ display: 'grid', gap: '10px' }}>
          {canUpload && (
            <button
              type="button"
              data-testid="profile-photo-select"
              disabled={busy}
              onClick={onSelect}
              style={{
                minHeight: '48px', borderRadius: '12px', border: `1px solid ${C.border}`,
                background: C.card, color: C.text, fontWeight: 850,
                cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.65 : 1,
              }}
            >
              {busy ? 'Обновляем…' : user?.photo_url ? 'Заменить фото' : 'Загрузить фото'}
            </button>
          )}
          {user?.photo_url && canDelete && (
            <button
              type="button"
              data-testid="profile-photo-delete"
              disabled={busy}
              onClick={onDelete}
              style={{
                minHeight: '48px', borderRadius: '12px',
                border: '1px solid rgba(255,111,97,0.28)', background: 'transparent',
                color: C.loss, fontWeight: 850, cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.65 : 1,
              }}
            >
              Удалить фото
            </button>
          )}
          <button
            type="button"
            aria-label="Закрыть управление фото"
            disabled={busy}
            onClick={onClose}
            style={{
              minHeight: '46px', borderRadius: '12px', border: `1px solid ${C.border}`,
              background: 'transparent', color: C.muted, fontWeight: 800,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function FullProfilePhoto({ src, name, onClose }) {
  if (!src) return null;
  return (
    <div
      className="app-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Фото ${name || 'игрока'}`}
      data-testid="profile-photo-lightbox"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10_000,
        background: 'rgba(0,0,0,0.92)', display: 'grid', placeItems: 'center',
        padding: '24px',
      }}
    >
      <button
        type="button"
        aria-label="Закрыть фото"
        onClick={onClose}
        style={{
          position: 'absolute', top: 'calc(16px + env(safe-area-inset-top, 0px))', right: '16px',
          width: '44px', height: '44px', borderRadius: '50%', border: `1px solid ${C.border}`,
          background: 'rgba(7,22,15,0.88)', color: C.text, fontSize: '24px', cursor: 'pointer',
        }}
      >
        ×
      </button>
      <img
        src={src}
        alt={name || 'Фото игрока'}
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'block', maxWidth: '100%', maxHeight: 'calc(100dvh - 96px)',
          width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: '18px',
        }}
      />
    </div>
  );
}

function ProfilePhotoCropper({
  source,
  imageSize,
  cropX,
  cropY,
  zoom,
  busy,
  onCropXChange,
  onCropYChange,
  onZoomChange,
  onConfirm,
  onCancel,
}) {
  if (!source || !imageSize?.width || !imageSize?.height) return null;
  const ratio = imageSize.width / imageSize.height;
  const widthPercent = (ratio >= 1 ? ratio : 1) * 100 * zoom;
  const heightPercent = (ratio >= 1 ? 1 : 1 / ratio) * 100 * zoom;
  const leftPercent = -(widthPercent - 100) * (cropX / 100);
  const topPercent = -(heightPercent - 100) * (cropY / 100);

  return (
    <div
      className="app-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Выбор кадра фото профиля"
      data-testid="profile-photo-cropper"
      style={{
        position: 'fixed', inset: 0, zIndex: 10_001,
        background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'flex-end',
        justifyContent: 'center', padding: '16px',
      }}
    >
      <div style={{
        width: 'min(100%, 420px)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: '22px',
        padding: '20px', boxSizing: 'border-box',
      }}>
        <div style={{ color: C.text, fontSize: '18px', fontWeight: 800, marginBottom: '6px' }}>
          Выберите область фото
        </div>
        <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.45, marginBottom: '16px' }}>
          Переместите кадр по горизонтали и вертикали, при необходимости увеличьте фото.
        </div>
        <div
          data-testid="profile-photo-crop-preview"
          style={{
            position: 'relative', width: 'min(72vw, 280px)', aspectRatio: '1',
            margin: '0 auto 18px', overflow: 'hidden', borderRadius: '50%',
            border: `3px solid ${C.gold}`, background: C.bg,
          }}
        >
          <img
            src={source}
            alt="Предпросмотр фото"
            draggable="false"
            style={{
              position: 'absolute', width: `${widthPercent}%`, height: `${heightPercent}%`,
              left: `${leftPercent}%`, top: `${topPercent}%`, maxWidth: 'none',
              userSelect: 'none', pointerEvents: 'none',
            }}
          />
        </div>
        {[
          ['По горизонтали', cropX, onCropXChange, 'profile-photo-crop-x', 0, 100, 1],
          ['По вертикали', cropY, onCropYChange, 'profile-photo-crop-y', 0, 100, 1],
          ['Масштаб', zoom, onZoomChange, 'profile-photo-crop-zoom', 1, 3, 0.05],
        ].map(([label, value, onChange, testId, min, max, step]) => (
          <label key={testId} style={{ display: 'block', color: C.text, fontSize: '12px', fontWeight: 700, marginTop: '12px' }}>
            {label}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              disabled={busy}
              onChange={(event) => onChange(Number(event.target.value))}
              data-testid={testId}
              style={{ width: '100%', marginTop: '8px', accentColor: C.gold }}
            />
          </label>
        ))}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            type="button"
            data-testid="profile-photo-crop-cancel"
            disabled={busy}
            onClick={onCancel}
            style={{
              flex: 1, minHeight: '46px', borderRadius: '12px', border: `1px solid ${C.border}`,
              background: 'transparent', color: C.muted, fontWeight: 800, cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Отмена
          </button>
          <button
            type="button"
            data-testid="profile-photo-crop-confirm"
            disabled={busy}
            onClick={onConfirm}
            style={{
              flex: 1.35, minHeight: '46px', borderRadius: '12px',
              border: '1px solid rgba(216,243,74,0.45)', background: 'rgba(216,243,74,0.16)',
              color: C.gold, fontWeight: 900, cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? 'Загружаем…' : 'Сохранить кадр'}
          </button>
        </div>
      </div>
    </div>
  );
}

function profilePhotoErrorMessage(reason) {
  const messages = {
    invalid_request: 'Выберите JPEG, PNG или WebP размером до 8 МБ.',
    invalid_image: 'Файл не удалось распознать как изображение.',
    conflict: 'Фото уже изменилось. Повторите попытку.',
    feature_unavailable: 'Загрузка фото временно недоступна.',
    temporary_unavailable: 'Нет связи с хранилищем. Попробуйте ещё раз.',
    session_invalid: 'Сессия завершена. Откройте приложение заново.',
  };
  return messages[reason] ?? 'Не удалось обновить фото. Попробуйте ещё раз.';
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

export default function PlayerProfile({ user, stats, upcomingMatches = [], completedMatches = [], resultMatches = completedMatches, onViewDetails, notifications = [], notificationsLoading = false, notificationsLoadError = '', invitations = [], invitationActions = new Set(), onRetryNotifications, onViewNotification, onAcceptInvitation, onDeclineInvitation, onCreateMatch, onBookCourt, onOpenSettings, onOpenAdmin, onPhotoUpload, onPhotoDelete, photoManagerRequest = 0, onPhotoManagerRequestHandled, showToast, onLogout, isVerified: initVerified = false, hasFamilyMembership = false }) {
  // Numbers come from the App-level computed stats (single source of truth: allMatches + dp_rating_history).
  const currentRating = stats?.numericRating ?? 0;
  const currentLevel  = getLevelForRating(currentRating);

  // Animated displays — kick in when underlying stats change.
  const animRating  = useAnimatedNumber(currentRating);
  const isVerified = user?.isVerified ?? initVerified;
  const [verifPath, setVerifPath]       = useState(null);
  const [showTraining, setShowTraining] = useState(false);

  const fileInputRef                  = useRef(null);
  const [ratingFile, setRatingFile]   = useState(null);
  const photoInputRef = useRef(null);
  const activePhotoAccountIdRef = useRef(user?.accountId ?? null);
  activePhotoAccountIdRef.current = user?.accountId ?? null;
  const [photoBusy, setPhotoBusy] = useState(false);
  const [showPhotoActions, setShowPhotoActions] = useState(false);
  const [showFullPhoto, setShowFullPhoto] = useState(false);
  const [photoCrop, setPhotoCrop] = useState(null);
  const [photoCropSize, setPhotoCropSize] = useState(null);
  const [photoCropX, setPhotoCropX] = useState(50);
  const [photoCropY, setPhotoCropY] = useState(50);
  const [photoCropZoom, setPhotoCropZoom] = useState(1);

  useEffect(() => {
    const objectUrl = photoCrop?.objectUrl;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoCrop?.objectUrl]);

  useEffect(() => {
    setShowPhotoActions(false);
    setShowFullPhoto(false);
    setPhotoCrop(null);
    setPhotoCropSize(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
  }, [user?.accountId]);

  useEffect(() => {
    if (photoManagerRequest > 0) {
      setShowPhotoActions(true);
      onPhotoManagerRequestHandled?.();
    }
  }, [photoManagerRequest]);

  const handleRatingFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRatingFile(file.name);
    setVerifPath('screenshot');
    showToast('Уведомление отправлено администратору', 'info');
    e.target.value = ''; // reset input
  };

  const uploadProfilePhoto = async (photo) => {
    setPhotoBusy(true);
    try {
      const result = await onPhotoUpload(photo);
      if (result?.outcome === 'profile_photo_updated') {
        showToast?.('Фото профиля обновлено', 'success');
        return true;
      } else if (result?.outcome !== 'cancelled') {
        showToast?.(profilePhotoErrorMessage(result?.reason), 'error');
      }
    } catch {
      showToast?.('Не удалось обновить фото. Попробуйте ещё раз.', 'error');
    } finally {
      setPhotoBusy(false);
    }
    return false;
  };

  const handlePhotoFile = async (event) => {
    const photo = event.target.files?.[0];
    const selectedForAccountId = activePhotoAccountIdRef.current;
    event.target.value = '';
    if (!photo || photoBusy || typeof onPhotoUpload !== 'function') return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ||
      photo.size < 1 ||
      photo.size > PROFILE_PHOTO_MAX_BYTES
    ) {
      showToast?.('Выберите JPEG, PNG или WebP размером до 8 МБ.', 'error');
      return;
    }
    const objectUrl = URL.createObjectURL(photo);
    try {
      const image = await loadPhoto(objectUrl);
      if (activePhotoAccountIdRef.current !== selectedForAccountId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setPhotoCrop({ objectUrl, accountId: selectedForAccountId });
      setPhotoCropSize({ width: image.naturalWidth, height: image.naturalHeight });
      setPhotoCropX(50);
      setPhotoCropY(50);
      setPhotoCropZoom(1);
    } catch {
      URL.revokeObjectURL(objectUrl);
      showToast?.('Файл не удалось распознать как изображение.', 'error');
    }
  };

  const handlePhotoCropConfirm = async () => {
    const expectedAccountId = photoCrop?.accountId ?? null;
    if (
      !photoCrop ||
      photoBusy ||
      expectedAccountId !== activePhotoAccountIdRef.current
    ) return;
    try {
      const croppedPhoto = await createCroppedProfilePhoto(
        photoCrop.objectUrl,
        photoCropX,
        photoCropY,
        photoCropZoom,
      );
      if (expectedAccountId !== activePhotoAccountIdRef.current) return;
      const uploaded = await uploadProfilePhoto(croppedPhoto);
      if (uploaded) {
        setPhotoCrop(null);
        setPhotoCropSize(null);
      }
    } catch {
      showToast?.('Не удалось подготовить выбранный кадр.', 'error');
    }
  };

  const handlePhotoDelete = async () => {
    if (photoBusy || typeof onPhotoDelete !== 'function') return;
    if (globalThis.window?.confirm?.('Удалить фото профиля?') === false) return;
    setPhotoBusy(true);
    try {
      const result = await onPhotoDelete();
      if (result?.outcome === 'profile_photo_deleted') {
        setShowPhotoActions(false);
        setShowFullPhoto(false);
        showToast?.('Фото профиля удалено', 'success');
      } else if (result?.outcome !== 'cancelled') {
        showToast?.(profilePhotoErrorMessage(result?.reason), 'error');
      }
    } catch {
      showToast?.('Не удалось удалить фото. Попробуйте ещё раз.', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Игрок';

  return (
    <div style={{ background: C.bg, minHeight: '100dvh', paddingBottom: 'calc(112px + env(safe-area-inset-bottom, 0px))', overflowX: 'hidden' }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleRatingFile}
        style={{ display: 'none' }}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handlePhotoFile}
        data-testid="profile-photo-input"
        style={{ display: 'none' }}
      />

      {showFullPhoto && (
        <FullProfilePhoto
          src={user?.full_photo_url || user?.photo_url}
          name={displayName}
          onClose={() => setShowFullPhoto(false)}
        />
      )}

      {showPhotoActions && (
        <ProfilePhotoActions
          user={user}
          name={displayName}
          busy={photoBusy}
          canUpload={typeof onPhotoUpload === 'function'}
          canDelete={typeof onPhotoDelete === 'function'}
          onSelect={() => {
            setShowPhotoActions(false);
            photoInputRef.current?.click();
          }}
          onDelete={handlePhotoDelete}
          onOpenFull={() => {
            setShowPhotoActions(false);
            setShowFullPhoto(true);
          }}
          onClose={() => {
            if (!photoBusy) setShowPhotoActions(false);
          }}
        />
      )}

      {photoCrop && (
        <ProfilePhotoCropper
          source={photoCrop.objectUrl}
          imageSize={photoCropSize}
          cropX={photoCropX}
          cropY={photoCropY}
          zoom={photoCropZoom}
          busy={photoBusy}
          onCropXChange={setPhotoCropX}
          onCropYChange={setPhotoCropY}
          onZoomChange={setPhotoCropZoom}
          onConfirm={handlePhotoCropConfirm}
          onCancel={() => {
            if (photoBusy) return;
            setPhotoCrop(null);
            setPhotoCropSize(null);
          }}
        />
      )}

      {/* ── Header card ── */}
      <div style={{
            background: 'radial-gradient(circle at 50% -20%, rgba(216,243,74,0.09), transparent 18rem), linear-gradient(180deg, #071F16 0%, #050F0B 100%)',
        padding: 'calc(28px + env(safe-area-inset-top, 0px)) 20px 24px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        {/* Avatar row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <Avatar
            user={user}
            level={currentLevel}
            rating={animRating}
            onManagePhoto={
              typeof onPhotoUpload === 'function' || user?.photo_url
                ? () => setShowPhotoActions(true)
                : undefined
            }
          />

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
                  ? `Клубный рейтинг · ${currentLevel.label} · ${animRating.toFixed(2)}`
                  : `Рейтинг пока не подтверждён · примерный уровень ${currentLevel.label}`}
              </span>
            </div>
            {user?.username && (
              <div style={{ color: C.muted, fontSize: '12px' }}>@{user.username}</div>
            )}
          </div>

          <button onClick={onOpenSettings} aria-label="Настройки" style={{
            width: '44px', height: '44px', borderRadius: '12px',
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

          {!isVerified && (
            <div style={{ color: '#334155', fontSize: '11px', textAlign: 'center', marginTop: '8px', lineHeight: 1.5 }}>
              Уровень можно подтвердить у администратора клуба.
            </div>
          )}

          {/* Verification status block */}
          {!isVerified && (
            <div style={{ marginTop: '10px' }}>
              {verifPath === 'training' ? (
              /* ── Ожидает тренера ── */
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(212,175,55,0.07)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(212,175,55,0.2)' }}>
                <span style={{ color: C.gold, fontSize: '13px', fontWeight: 900 }}>...</span>
                <div>
                  <div style={{ color: C.gold, fontSize: '12px', fontWeight: 700 }}>Ожидает подтверждения тренера</div>
                  <div style={{ color: C.muted, fontSize: '11px' }}>Уровень обновится после аттестации</div>
                </div>
              </div>

            ) : verifPath === 'screenshot' ? (
              /* ── Скриншот на проверке ── */
              <div style={{ background: 'rgba(212,175,55,0.07)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(212,175,55,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: C.gold, fontSize: '13px', fontWeight: 900 }}>OK</span>
                  <div style={{ color: C.gold, fontSize: '12px', fontWeight: 700 }}>На проверке у администратора</div>
                </div>
                <div style={{ color: C.muted, fontSize: '11px', paddingLeft: '24px' }}>
                  {ratingFile || 'screenshot.png'} · Ожидайте подтверждения
                </div>
              </div>

            ) : (
              /* ── Не подтверждён ── */
              <div style={{ background: 'rgba(100,116,139,0.06)', borderRadius: '10px', padding: '12px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                  <span style={{ color: C.muted, fontSize: '13px', fontWeight: 900 }}>i</span>
                  <span style={{ color: C.muted, fontSize: '12px' }}>Рейтинг пока не подтверждён</span>
                </div>
                <div style={{ color: C.muted, fontSize: '11px', lineHeight: 1.5 }}>
                  Клуб подтвердит рейтинг после первых игр или тренировки.
                  До этого уровень отображается как ориентировочный.
                </div>
              </div>
              )}
            </div>
          )}
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
        <NotificationsSection
          notifications={notifications}
          invitations={invitations}
          loading={notificationsLoading}
          loadError={notificationsLoadError}
          actions={invitationActions}
          onRetry={onRetryNotifications}
          onView={onViewNotification}
          onAccept={onAcceptInvitation}
          onDecline={onDeclineInvitation}
        />

        <RatingChart
          currentRating={currentRating}
          completedMatches={completedMatches}
          userId={user?.id}
        />

        <UpcomingMatchesSection matches={upcomingMatches} onViewDetails={onViewDetails} />
        <ResultsSection matches={resultMatches} userId={user?.id} onViewDetails={onViewDetails} />
        <MatchStats stats={stats} />

        {/* ── Family bonus ── */}
        {hasFamilyMembership && <FamilyBonusBlock />}

        {/* ── CTAs ── */}
        <PadelButton
          variant={onBookCourt ? 'yellow' : 'dark'}
          size="lg"
          fullWidth
          onClick={() => {
            if (onBookCourt) {
              onBookCourt();
              showToast?.('Сначала выберите свободный корт и время');
              return;
            }
            showToast?.('Бронирование через приложение скоро будет обновлено', 'info');
          }}
          className="mb-6"
        >
          {onBookCourt ? 'Забронировать / Создать матч' : 'Бронирование скоро будет обновлено'}
        </PadelButton>

        {user?.isAdmin === true && (
          <PadelButton
            variant="info"
            size="md"
            fullWidth
            onClick={onOpenAdmin}
            className="mb-3"
          >
            Админ-панель
          </PadelButton>
        )}

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
