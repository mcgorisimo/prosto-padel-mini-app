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
      homeValue: '2.00 · D+',
      avatarValue: '2.0',
      profileSummary: 'Начальный уровень · 2.00 · D+',
    });
    expect(presentation.displayLevel.label).toBe('D+');
    expect(JSON.stringify(presentation)).not.toContain('3.00');
  });

  it.each([
    ['D', '1.00 · D', '1.0'],
    ['D+', '2.00 · D+', '2.0'],
    ['C', '3.00 · C', '3.0'],
    ['C+', '3.50 · C+', '3.5'],
    ['B', '4.00 · B', '4.0'],
    ['B+', '4.70 · B+', '4.7'],
    ['A', '5.50 · A', '5.5'],
  ])(
    'uses the canonical %s lower bound without mutating the club rating',
    (initialLevelLabel, homeValue, avatarValue) => {
      const presentation = resolvePlayerLevelPresentation({
        numericRating: 9.75,
        isVerified: false,
        initialLevelLabel,
      });

      expect(presentation).toMatchObject({
        homeValue,
        avatarValue,
        profileSummary: `Начальный уровень · ${homeValue}`,
      });
      expect(presentation.displayLevel.label).toBe(initialLevelLabel);
      expect(JSON.stringify(presentation)).not.toContain('9.75');
    },
  );

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
