import React, { useState } from 'react';

const C = {
  bg:      '#020617',
  card:    '#0f172a',
  surface: '#141B3D',
  border:  '#1E2755',
  accent:  '#2563eb',
  text:    '#FFFFFF',
  muted:   '#8B9CC8',
  win:     '#22C55E',
};

const TEAM1_COLOR = '#3b82f6';
const TEAM2_COLOR = '#f59e0b';
const PLAYER_COLORS = ['#FFD700', '#4285F4', '#34A853', '#EA4335'];

const initialScore = () => [
  { t1: 0, t2: 0 },
  { t1: 0, t2: 0 },
  { t1: 0, t2: 0 },
];

const winnerOfSet = (s) => (s.t1 > s.t2 ? 1 : s.t2 > s.t1 ? 2 : 0);

const countSetsWon = (score) => {
  let t1 = 0, t2 = 0;
  for (const s of score) {
    const w = winnerOfSet(s);
    if (w === 1) t1++;
    else if (w === 2) t2++;
  }
  return { t1, t2 };
};

// ─── Stepper (Apple-style +/-) ───────────────────────────────────────────────

function Stepper({ value, onChange, color }) {
  const minus = () => onChange(Math.max(0, value - 1));
  const plus  = () => onChange(Math.min(7, value + 1));
  const btn = (disabled) => ({
    width: 32, height: 32, borderRadius: '50%',
    background: disabled ? 'rgba(100,116,139,0.08)' : C.surface,
    border: `1px solid ${C.border}`,
    color: disabled ? '#334155' : C.muted,
    fontSize: 18, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    lineHeight: 1, padding: 0, flexShrink: 0,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={minus} disabled={value === 0} style={btn(value === 0)}>−</button>
      <div style={{
        minWidth: 36, textAlign: 'center',
        color: color || C.text, fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1,
      }}>{value}</div>
      <button onClick={plus} disabled={value === 7} style={btn(value === 7)}>+</button>
    </div>
  );
}

// ─── Player chip ─────────────────────────────────────────────────────────────

function PlayerChip({ player, slotIndex, selected, onTap }) {
  const initials = [player?.firstName?.[0], player?.lastName?.[0]].filter(Boolean).join('') || '?';
  const color    = PLAYER_COLORS[slotIndex % 4];
  return (
    <button
      onClick={onTap}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: selected ? `${color}33` : C.surface,
        border: selected ? `2px solid ${color}` : `1px solid ${C.border}`,
        borderRadius: 10, padding: selected ? '7px 11px' : '8px 12px',
        color: C.text, cursor: 'pointer', width: '100%',
        textAlign: 'left', transition: 'all 0.15s',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(145deg, ${color}ee, ${color}99)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: '#fff',
      }}>{initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {player?.firstName} {player?.lastName}
        </div>
        {(player?.isBot || player?.numericRating != null) && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {player?.numericRating != null ? player.numericRating.toFixed(1) : ''}{player?.isBot ? ' · бот' : ''}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Team card ───────────────────────────────────────────────────────────────

function TeamCard({ title, players, slotIndices, selectedKey, onTapPlayer, color }) {
  return (
    <div style={{
      background: C.card, borderRadius: 14, padding: 14,
      border: `1px solid ${color}55`, flex: 1, minWidth: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
        color, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        ● {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {players.map((p, i) => {
          const key = slotIndices[i];
          return (
            <PlayerChip
              key={key}
              player={p}
              slotIndex={key}
              selected={selectedKey === key}
              onTap={() => onTapPlayer(key)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Main modal ──────────────────────────────────────────────────────────────

export default function FinishMatchModal({ players, onSave, onClose }) {
  // We track which "original index" sits in each team slot, so swaps are reversible.
  const [team1Idx, setTeam1Idx] = useState([0, 1]);
  const [team2Idx, setTeam2Idx] = useState([2, 3]);
  const [selected, setSelected] = useState(null);
  const [score,    setScore]    = useState(initialScore);

  const team1Players = team1Idx.map(i => players[i]);
  const team2Players = team2Idx.map(i => players[i]);

  // Tap-swap: tap player → highlight; tap an opposite-team player → swap; tap same team → switch selection
  const handleTapPlayer = (origIdx) => {
    if (selected === null) { setSelected(origIdx); return; }
    if (selected === origIdx) { setSelected(null); return; }
    const inT1 = (i) => team1Idx.includes(i);
    if (inT1(selected) === inT1(origIdx)) {
      setSelected(origIdx);
      return;
    }
    const swap = (arr, oldVal, newVal) => arr.map(v => (v === oldVal ? newVal : v));
    if (inT1(selected)) {
      setTeam1Idx(prev => swap(prev, selected, origIdx));
      setTeam2Idx(prev => swap(prev, origIdx, selected));
    } else {
      setTeam2Idx(prev => swap(prev, selected, origIdx));
      setTeam1Idx(prev => swap(prev, origIdx, selected));
    }
    setSelected(null);
  };

  const setSetScore = (setIdx, side, val) =>
    setScore(prev => prev.map((s, i) => (i === setIdx ? { ...s, [side]: val } : s)));

  const setsWon    = countSetsWon(score);
  const isTeam1Win = setsWon.t1 > setsWon.t2;
  const canSave    = setsWon.t1 >= 2 || setsWon.t2 >= 2;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ team1: team1Players, team2: team2Players, score, isTeam1Win });
  };

  return (
    <div
      className="app-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 12,
      }}
    >
      <div
        className="app-modal-panel"
        onClick={e => e.stopPropagation()}
        style={{
          background: '#07160F', borderRadius: 18,
          width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto',
          border: '1px solid rgba(245,241,232,0.16)', padding: 20,
          boxSizing: 'border-box',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ color: C.text, fontSize: 17, fontWeight: 800, margin: 0 }}>
            🏁 Завершить матч
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: C.muted,
            fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* ── Teams ─────────────────────────────────────────────────────── */}
        <div style={{
          fontSize: 10, fontWeight: 700, color: C.muted,
          textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8,
        }}>
          Состав команд
          {selected !== null && (
            <span style={{ color: C.accent, fontWeight: 600, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>
              · выберите соперника для обмена
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <TeamCard
            title="Команда 1"
            players={team1Players}
            slotIndices={team1Idx}
            selectedKey={selected}
            onTapPlayer={handleTapPlayer}
            color={TEAM1_COLOR}
          />
          <TeamCard
            title="Команда 2"
            players={team2Players}
            slotIndices={team2Idx}
            selectedKey={selected}
            onTapPlayer={handleTapPlayer}
            color={TEAM2_COLOR}
          />
        </div>

        {/* ── Score ─────────────────────────────────────────────────────── */}
        <div style={{
          fontSize: 10, fontWeight: 700, color: C.muted,
          textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8,
        }}>
          Счёт по сетам
        </div>
        <div style={{
          background: C.card, borderRadius: 14, padding: '10px 12px',
          border: `1px solid ${C.border}`, marginBottom: 14,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', padding: '6px 4px',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ width: 40, color: C.muted, fontSize: 11, fontWeight: 600 }}>Сет</div>
            <div style={{ flex: 1, color: TEAM1_COLOR, fontSize: 11, fontWeight: 700, textAlign: 'center' }}>Команда 1</div>
            <div style={{ width: 16, color: C.muted, fontSize: 11, textAlign: 'center' }}>:</div>
            <div style={{ flex: 1, color: TEAM2_COLOR, fontSize: 11, fontWeight: 700, textAlign: 'center' }}>Команда 2</div>
          </div>
          {score.map((set, i) => {
            const w = winnerOfSet(set);
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', padding: '10px 4px',
                borderBottom: i < score.length - 1 ? `1px solid ${C.border}55` : 'none',
              }}>
                <div style={{ width: 40, color: C.muted, fontSize: 13, fontWeight: 600 }}>#{i + 1}</div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <Stepper
                    value={set.t1}
                    onChange={v => setSetScore(i, 't1', v)}
                    color={w === 1 ? C.win : (w === 2 ? '#475569' : C.text)}
                  />
                </div>
                <div style={{ width: 16, color: C.muted, fontSize: 18, fontWeight: 600, textAlign: 'center' }}>:</div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <Stepper
                    value={set.t2}
                    onChange={v => setSetScore(i, 't2', v)}
                    color={w === 2 ? C.win : (w === 1 ? '#475569' : C.text)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Status hint ───────────────────────────────────────────────── */}
        <div style={{
          textAlign: 'center', color: canSave ? C.win : C.muted,
          fontSize: 12, marginBottom: 14, fontWeight: canSave ? 700 : 400,
        }}>
          {canSave
            ? `Победитель: Команда ${isTeam1Win ? '1' : '2'} · ${setsWon.t1}:${setsWon.t2}`
            : 'Чтобы сохранить, одна из команд должна выиграть 2 сета'}
        </div>

        {/* ── Buttons ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            padding: '14px 20px', background: 'transparent',
            color: C.muted, border: `1px solid ${C.border}`,
            borderRadius: 12, fontSize: 14, cursor: 'pointer',
          }}>
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              flex: 1, padding: 14,
              background: canSave ? 'linear-gradient(135deg, #16a34a, #22C55E)' : 'rgba(100,116,139,0.12)',
              color: canSave ? '#fff' : '#475569',
              border: canSave ? 'none' : `1px solid ${C.border}`,
              borderRadius: 12, fontSize: 15, fontWeight: 700,
              cursor: canSave ? 'pointer' : 'not-allowed',
              boxShadow: canSave ? '0 4px 18px rgba(34,197,94,0.35)' : 'none',
            }}
          >
            Сохранить результат
          </button>
        </div>
      </div>
    </div>
  );
}
