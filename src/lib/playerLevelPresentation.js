import { RATING_CONFIG, getLevelForRating } from './ratingEngine';

const INITIAL_LEVELS_BY_LABEL = new Map(
  RATING_CONFIG.levels.map((level) => [level.label, level]),
);

export function normalizeInitialLevelLabel(value) {
  return typeof value === 'string' && INITIAL_LEVELS_BY_LABEL.has(value)
    ? value
    : null;
}

export function resolvePlayerLevelPresentation({
  numericRating,
  isVerified,
  initialLevelLabel,
}) {
  const safeNumericRating = Number.isFinite(numericRating)
    ? numericRating
    : 3.0;
  const clubLevel = getLevelForRating(safeNumericRating);
  const normalizedInitialLevelLabel = normalizeInitialLevelLabel(
    initialLevelLabel,
  );
  const initialLevel = isVerified === true
    ? null
    : INITIAL_LEVELS_BY_LABEL.get(normalizedInitialLevelLabel) ?? null;
  const displayLevel = initialLevel ?? clubLevel;

  return Object.freeze({
    displayLevel,
    isInitialLevel: initialLevel !== null,
    homeLabel: initialLevel ? 'Начальный уровень' : 'Уровень игрока',
    homeValue: initialLevel?.label ?? safeNumericRating.toFixed(2),
    avatarValue: initialLevel?.label ?? safeNumericRating.toFixed(1),
    profileSummary: isVerified === true
      ? `Клубный рейтинг · ${clubLevel.label} · ${safeNumericRating.toFixed(2)}`
      : initialLevel
        ? `Начальный уровень · ${initialLevel.label}`
        : `Рейтинг пока не подтверждён · примерный уровень ${clubLevel.label}`,
  });
}
