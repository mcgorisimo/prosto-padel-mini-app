const LEVEL_LABELS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
const NUMERIC_RANGE_LABELS = ['1.0–1.9', '1.5–2.4', '2.5–2.9', '3.0–3.4', '3.5–3.9', '4.0–4.4', '4.5+'];

const clampLevelIndex = (value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(LEVEL_LABELS.length - 1, Math.round(number)));
};

const getRangeStart = (label) => String(label || '').split('–')[0];
const getRangeEnd = (label) => {
  const value = String(label || '');
  return value.includes('–') ? value.split('–').pop() : value;
};

export function getLevelLabelForIndex(index) {
  return LEVEL_LABELS[clampLevelIndex(index, 0)] || LEVEL_LABELS[0];
}

export function getMatchLevelRequirement(match = {}) {
  const minIdx = clampLevelIndex(match.ratingMin ?? match.rating_min, 0);
  const maxIdx = clampLevelIndex(match.ratingMax ?? match.rating_max, LEVEL_LABELS.length - 1);
  const safeMin = Math.min(minIdx, maxIdx);
  const safeMax = Math.max(minIdx, maxIdx);
  const levelLabels = LEVEL_LABELS.slice(safeMin, safeMax + 1);
  const minNumeric = NUMERIC_RANGE_LABELS[safeMin];
  const maxNumeric = NUMERIC_RANGE_LABELS[safeMax];

  return {
    minIdx: safeMin,
    maxIdx: safeMax,
    levelLabels,
    summaryLabel: `${LEVEL_LABELS[safeMin]} — ${LEVEL_LABELS[safeMax]}`,
    numericRangeLabel: `${getRangeStart(minNumeric)}–${getRangeEnd(maxNumeric)}`,
  };
}

export function getMatchRatingRangeLabel(match = {}) {
  return getMatchLevelRequirement(match).numericRangeLabel;
}

export function getMatchLevelBadges(match = {}) {
  return getMatchLevelRequirement(match).levelLabels;
}
