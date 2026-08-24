import { describe, expect, it } from 'vitest';
import {
  normalizeInitialLevelLabel,
  resolvePlayerLevelPresentation,
} from './playerLevelPresentation';

describe('player level presentation', () => {
  it('shows the server-computed initial level instead of the unverified club default', () => {
    const presentation = resolvePlayerLevelPresentation({
      numericRating: 3.0,
      isVerified: false,
      initialLevelLabel: 'D+',
    });

    expect(presentation).toMatchObject({
      isInitialLevel: true,
      homeLabel: 'Начальный уровень',
      homeValue: 'D+',
      avatarValue: 'D+',
      profileSummary: 'Начальный уровень · D+',
    });
    expect(presentation.displayLevel.label).toBe('D+');
    expect(JSON.stringify(presentation)).not.toContain('3.00');
  });

  it('keeps verified club rating presentation authoritative', () => {
    const presentation = resolvePlayerLevelPresentation({
      numericRating: 4.2,
      isVerified: true,
      initialLevelLabel: 'D+',
    });

    expect(presentation).toMatchObject({
      isInitialLevel: false,
      homeLabel: 'Уровень игрока',
      homeValue: '4.20',
      avatarValue: '4.2',
      profileSummary: 'Клубный рейтинг · B · 4.20',
    });
    expect(presentation.displayLevel.label).toBe('B');
  });

  it('preserves the legacy completed fallback when no v2 label exists', () => {
    const presentation = resolvePlayerLevelPresentation({
      numericRating: 3.0,
      isVerified: false,
      initialLevelLabel: null,
    });

    expect(presentation).toMatchObject({
      isInitialLevel: false,
      homeLabel: 'Уровень игрока',
      homeValue: '3.00',
      avatarValue: '3.0',
      profileSummary: 'Рейтинг пока не подтверждён · примерный уровень C',
    });
    expect(presentation.displayLevel.label).toBe('C');
  });

  it.each(['', 'C++', 3, {}, undefined])(
    'rejects malformed initial-level label %p',
    (value) => {
      expect(normalizeInitialLevelLabel(value)).toBeNull();
    },
  );
});
