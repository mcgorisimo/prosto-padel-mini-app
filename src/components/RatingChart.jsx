import React, { useMemo } from 'react';
import { getLevelForRating } from '../lib/ratingEngine';
import { isRatingMatch } from '../lib/matchRating';

const C = {
  card:   '#0f172a',
  border: '#1E2755',
  text:   '#FFFFFF',
  muted:  '#8B9CC8',
  win:    '#22C55E',
  loss:   '#EF4444',
};

const VIEW_W = 400;
const VIEW_H = 120;
const PAD_X = 10;
const PAD_Y = 14;

const fmt2 = (value) => (typeof value === 'number' ? value.toFixed(2) : '—');
const fmtDelta = (value) => (typeof value === 'number' ? `${value >= 0 ? '+' : ''}${value.toFixed(3)}` : '—');

function getCompletedTime(match) {
  const timestamp = match?.completedAt ?? match?.completed_at ?? match?.dateISO ?? match?.date_iso;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPath(points, minVal, maxVal) {
  if (points.length === 0) return '';
  const range = maxVal - minVal || 1;
  const innerW = VIEW_W - PAD_X * 2;
  const innerH = VIEW_H - PAD_Y * 2;

  return points.map((point, index) => {
    const x = points.length === 1 ? VIEW_W / 2 : PAD_X + (index / (points.length - 1)) * innerW;
    const y = PAD_Y + (1 - (point.rating - minVal) / range) * innerH;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

export default function RatingChart({ currentRating, completedMatches = [], userId }) {
  const points = useMemo(() => {
    if (!userId) return [];

    return [...completedMatches]
      .sort((a, b) => getCompletedTime(a) - getCompletedTime(b))
      .map(match => {
        if (!isRatingMatch(match)) return null;
        const change = match?.ratingChanges?.[userId] ?? match?.rating_changes?.[userId];
        if (typeof change?.after !== 'number') return null;
        return {
          matchId: match.id,
          date: getCompletedTime(match),
          rating: change.after,
          delta: typeof change.delta === 'number' ? change.delta : null,
        };
      })
      .filter(Boolean);
  }, [completedMatches, userId]);

  const lastPoint = points[points.length - 1];
  const hasTrustedHistory =
    points.length > 0 &&
    typeof currentRating === 'number' &&
    Math.abs(lastPoint.rating - currentRating) < 0.001;

  const level = getLevelForRating(currentRating || 0);
  const values = hasTrustedHistory ? points.map(point => point.rating) : [currentRating || 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const path = hasTrustedHistory ? buildPath(points, min, max) : '';
  const totalDelta = hasTrustedHistory && points.length > 1 ? points[points.length - 1].rating - points[0].rating : 0;

  return (
    <div style={{
      background:   C.card,
      borderRadius: '16px',
      border:       `1px solid ${C.border}`,
      padding:      '16px',
      marginBottom: '16px',
    }}>
      <div style={{
        color:           C.muted,
        fontSize:        '10px',
        fontWeight:      700,
        textTransform:   'uppercase',
        letterSpacing:   '0.1em',
        marginBottom:    '10px',
      }}>
        Динамика рейтинга
      </div>

      {!hasTrustedHistory ? (
        <>
          <div style={{ color: C.text, fontSize: '15px', fontWeight: 700, marginBottom: '6px' }}>
            Текущий клубный рейтинг: {fmt2(currentRating)} · {level.label}
          </div>
          <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.55 }}>
            Динамика рейтинга появится после рейтинговых матчей клуба.
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', marginBottom: '12px' }}>
            <div>
              <div style={{ color: C.text, fontSize: '26px', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {fmt2(currentRating)}
              </div>
              <div style={{ color: level.color, fontSize: '13px', fontWeight: 700, marginTop: '4px' }}>
                {level.label}
              </div>
            </div>
            <div style={{ color: totalDelta >= 0 ? C.win : C.loss, fontSize: '13px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {fmtDelta(totalDelta)}
            </div>
          </div>

          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            style={{ width: '100%', height: '116px', display: 'block' }}
          >
            {points.length > 1 && (
              <path
                d={path}
                fill="none"
                stroke={level.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {points.map((point, index) => {
              const range = max - min || 1;
              const innerW = VIEW_W - PAD_X * 2;
              const innerH = VIEW_H - PAD_Y * 2;
              const x = points.length === 1 ? VIEW_W / 2 : PAD_X + (index / (points.length - 1)) * innerW;
              const y = PAD_Y + (1 - (point.rating - min) / range) * innerH;
              return <circle key={point.matchId || index} cx={x} cy={y} r="3" fill={level.color} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>

          <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.5, marginTop: '8px' }}>
            График построен по рейтинговым матчам клуба.
          </div>
        </>
      )}
    </div>
  );
}
