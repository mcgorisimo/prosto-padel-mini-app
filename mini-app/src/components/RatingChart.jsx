import React, { useMemo, useState } from 'react';
import {
  loadHistory,
  getLevelForRating,
  getNextLevelInfo,
  START_RATING,
} from '../lib/ratingEngine';

const C = {
  card:   '#0f172a',
  border: '#1E2755',
  bg:     '#020617',
  text:   '#FFFFFF',
  muted:  '#8B9CC8',
  win:    '#22C55E',
  loss:   '#EF4444',
};

const fmt2 = (val) => val.toFixed(2);
const fmt3 = (val) => val.toFixed(3);

const WINDOWS = [
  { value: 5,     label: '5'   },
  { value: 15,    label: '15'  },
  { value: 'all', label: 'Все' },
];

const VIEW_W = 400;
const VIEW_H = 140;
const PAD_X  = 8;
const PAD_Y  = 14;

function buildPath(points, minVal, maxVal) {
  if (points.length === 0) return '';
  const range  = maxVal - minVal || 1;
  const innerW = VIEW_W - PAD_X * 2;
  const innerH = VIEW_H - PAD_Y * 2;
  return points.map((p, i) => {
    const x = points.length === 1
      ? VIEW_W / 2
      : PAD_X + (i / (points.length - 1)) * innerW;
    const y = PAD_Y + (1 - (p.rating - minVal) / range) * innerH;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

export default function RatingChart() {
  const [history] = useState(loadHistory);
  const [win, setWin] = useState(15);

  const points = useMemo(
    () => (win === 'all' ? history : history.slice(-win)),
    [history, win]
  );

  const stats = useMemo(() => {
    if (points.length === 0) {
      return { current: START_RATING, change: 0, min: START_RATING, max: START_RATING };
    }
    const values = points.map(p => p.rating);
    return {
      current: values[values.length - 1],
      change:  values[values.length - 1] - values[0],
      min:     Math.min(...values),
      max:     Math.max(...values),
    };
  }, [points]);

  const path  = useMemo(() => buildPath(points, stats.min, stats.max), [points, stats.min, stats.max]);
  const level = getLevelForRating(stats.current);
  const next  = getNextLevelInfo(stats.current);

  const isUp        = stats.change >= 0;
  const changeColor = stats.change === 0 ? C.muted : isUp ? C.win : C.loss;
  const changeSign  = stats.change > 0 ? '+' : '';

  return (
    <div style={{
      background:   C.card,
      borderRadius: '16px',
      border:       `1px solid ${C.border}`,
      padding:      '16px',
      marginBottom: '16px',
    }}>
      {/* Header: rating + level + change | window toggle */}
      <div style={{
        display:        'flex',
        alignItems:     'flex-end',
        justifyContent: 'space-between',
        marginBottom:   '12px',
        gap:            '12px',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            color:           C.muted,
            fontSize:        '10px',
            fontWeight:      700,
            textTransform:   'uppercase',
            letterSpacing:   '0.1em',
            marginBottom:    '4px',
          }}>
            Рейтинг
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              color:              C.text,
              fontSize:           '26px',
              fontWeight:         800,
              letterSpacing:      '-0.03em',
              lineHeight:         1,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {fmt2(stats.current)}
            </span>
            <span style={{ color: level.color, fontSize: '14px', fontWeight: 700 }}>
              {level.label}
            </span>
            {points.length > 1 && (
              <span style={{
                color:              changeColor,
                fontSize:           '12px',
                fontWeight:         600,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {changeSign}{stats.change.toFixed(3)}
              </span>
            )}
          </div>
        </div>

        <div style={{
          display:      'flex',
          background:   C.bg,
          borderRadius: '8px',
          padding:      '2px',
          border:       `1px solid ${C.border}`,
          flexShrink:   0,
        }}>
          {WINDOWS.map(({ value, label }) => {
            const active = win === value;
            return (
              <button
                key={String(value)}
                onClick={() => setWin(value)}
                style={{
                  padding:      '5px 10px',
                  borderRadius: '6px',
                  border:       'none',
                  background:   active ? '#1E3AE8' : 'transparent',
                  color:        active ? '#fff' : C.muted,
                  fontSize:     '11px',
                  fontWeight:   active ? 700 : 500,
                  cursor:       'pointer',
                  transition:   'all 0.15s ease',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: '120px', display: 'block' }}
        >
          <defs>
            <linearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={level.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={level.color} stopOpacity="0"    />
            </linearGradient>
          </defs>

          {points.length > 1 && (
            <path
              d={`${path} L ${VIEW_W - PAD_X} ${VIEW_H - PAD_Y} L ${PAD_X} ${VIEW_H - PAD_Y} Z`}
              fill="url(#ratingFill)"
              stroke="none"
            />
          )}
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
          {points.length > 0 && (() => {
            const range  = stats.max - stats.min || 1;
            const innerW = VIEW_W - PAD_X * 2;
            const innerH = VIEW_H - PAD_Y * 2;
            const last   = points[points.length - 1];
            const x = points.length === 1 ? VIEW_W / 2 : PAD_X + innerW;
            const y = PAD_Y + (1 - (last.rating - stats.min) / range) * innerH;
            return (
              <>
                <circle cx={x} cy={y} r="6" fill={level.color} fillOpacity="0.18" vectorEffect="non-scaling-stroke" />
                <circle cx={x} cy={y} r="3" fill={level.color} vectorEffect="non-scaling-stroke" />
              </>
            );
          })()}
        </svg>

        <div style={{
          position:       'absolute',
          inset:          0,
          pointerEvents:  'none',
          display:        'flex',
          flexDirection:  'column',
          justifyContent: 'space-between',
          padding:        '4px 0',
        }}>
          <span style={{ color: '#475569', fontSize: '10px', fontVariantNumeric: 'tabular-nums' }}>{fmt2(stats.max)}</span>
          <span style={{ color: '#475569', fontSize: '10px', fontVariantNumeric: 'tabular-nums' }}>{fmt2(stats.min)}</span>
        </div>
      </div>

      {/* Footer: progress to next level */}
      <div style={{
        marginTop: '10px',
        textAlign: 'center',
        fontSize:  '12px',
        color:     C.muted,
      }}>
        {next ? (
          <>
            До уровня <span style={{ color: next.nextColor, fontWeight: 700 }}>{next.nextLabel}</span>
            {' '}осталось <span style={{ color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt3(next.pointsToGo)}</span>
          </>
        ) : (
          <>Вы на максимальном уровне <span style={{ color: level.color, fontWeight: 700 }}>{level.label}</span></>
        )}
      </div>
    </div>
  );
}
