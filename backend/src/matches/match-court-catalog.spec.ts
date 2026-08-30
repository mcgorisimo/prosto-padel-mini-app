import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { MatchId } from './match.types';
import { SystemMatchCourtCatalog } from './match-court-catalog';

function epoch(iso: string) {
  return unixEpochSeconds(Date.parse(iso) / 1_000);
}

describe('SystemMatchCourtCatalog', () => {
  const catalog = new SystemMatchCourtCatalog();
  const matchId = deterministicUuid('match-court-catalog') as MatchId;

  it('resolves an allowlisted court and derives its weekday price', () => {
    const result = catalog.resolve({
      matchId,
      scenario: 'social',
      courtId: 'p1',
      startsAt: epoch('2026-07-27T13:30:00.000Z'),
      durationMinutes: 90,
    });

    expect(result).toEqual({
      courtId: 'p1',
      courtName: 'Корт 1',
      courtType: 'panoramic',
      pricePerPersonSnapshot: 1_550,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result ?? {}).sort()).toEqual([
      'courtId',
      'courtName',
      'courtType',
      'pricePerPersonSnapshot',
    ]);
  });

  it('uses the weekend tariff across a rate boundary', () => {
    expect(
      catalog.resolve({
        matchId,
        scenario: 'social',
        courtId: 'p8',
        startsAt: epoch('2026-08-01T06:30:00.000Z'),
        durationMinutes: 90,
      }),
    ).toEqual({
      courtId: 'p8',
      courtName: 'Корт 8',
      courtType: 'panoramic',
      pricePerPersonSnapshot: 1_650,
    });
  });

  it.each([
    ['unknown court', 'p9', '2026-07-27T13:30:00.000Z', 90],
    ['before opening', 'p1', '2026-07-27T03:30:00.000Z', 90],
    ['after closing', 'p1', '2026-07-27T20:30:00.000Z', 90],
    ['non-slot start', 'p1', '2026-07-27T13:15:00.000Z', 90],
    ['non-zero seconds', 'p1', '2026-07-27T13:30:30.000Z', 90],
  ] as const)(
    'rejects %s',
    (_case, courtId, startsAt, durationMinutes) => {
      expect(
        catalog.resolve({
          matchId,
          scenario: 'social',
          courtId,
          startsAt: epoch(startsAt),
          durationMinutes,
        }),
      ).toBeUndefined();
    },
  );

  it('derives an unassigned per-match snapshot for community without a court', () => {
    const result = catalog.resolve({
      matchId,
      scenario: 'community',
      startsAt: epoch('2026-07-27T13:30:00.000Z'),
      durationMinutes: 90,
    });

    expect(result).toEqual({
      courtId: `unassigned:${matchId}`,
      courtName: 'Корт не выбран',
      courtType: 'unassigned',
    });
    expect(result).not.toHaveProperty('pricePerPersonSnapshot');
  });

  it('attaches the same booking price to a selected community court', () => {
    expect(
      catalog.resolve({
        matchId,
        scenario: 'community',
        courtId: 'p1',
        startsAt: epoch('2026-07-27T13:30:00.000Z'),
        durationMinutes: 90,
      }),
    ).toEqual({
      courtId: 'p1',
      courtName: 'Корт 1',
      courtType: 'panoramic',
      pricePerPersonSnapshot: 1550,
    });
  });

  it('accepts a provider court and an exact midnight end', () => {
    expect(catalog.resolve({
      matchId,
      scenario: 'social',
      courtId: 'yclients:55',
      startsAt: epoch('2026-07-27T20:00:00.000Z'),
      durationMinutes: 60,
    })).toEqual({
      courtId: 'yclients:55',
      courtName: 'Корт 55',
      courtType: 'panoramic',
      pricePerPersonSnapshot: 1100,
    });
    expect(catalog.resolve({
      matchId,
      scenario: 'social',
      courtId: 'yclients:55',
      startsAt: epoch('2026-07-27T20:30:00.000Z'),
      durationMinutes: 60,
    })).toBeUndefined();
  });

  it.each(['social', 'private'] as const)(
    'rejects a missing court for %s',
    (scenario) => {
      expect(
        catalog.resolve({
          matchId,
          scenario,
          startsAt: epoch('2026-07-27T13:30:00.000Z'),
          durationMinutes: 90,
        }),
      ).toBeUndefined();
    },
  );
});
