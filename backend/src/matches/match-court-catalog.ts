import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchDurationMinutes,
  MatchId,
  MatchScenario,
} from './match.types';

export interface MatchCourtSnapshot {
  readonly courtId: string;
  readonly courtName: string;
  readonly courtType: 'panoramic' | 'unassigned';
  readonly pricePerPersonSnapshot?: number;
}

export interface ResolveMatchCourtInput {
  readonly matchId: MatchId;
  readonly scenario: MatchScenario;
  readonly courtId?: string;
  readonly startsAt: UnixEpochSeconds;
  readonly durationMinutes: MatchDurationMinutes;
}

export interface MatchCourtCatalog {
  resolve(input: ResolveMatchCourtInput): MatchCourtSnapshot | undefined;
}

const MOSCOW_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Moscow',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const COURTS: ReadonlyMap<
  string,
  Readonly<{
    courtId: string;
    courtName: string;
    courtType: 'panoramic';
  }>
> = new Map(
  Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    return [
      `p${number}`,
      Object.freeze({
        courtId: `p${number}`,
        courtName: `Корт ${number}`,
        courtType: 'panoramic' as const,
      }),
    ] as const;
  }),
);

function localStart(
  startsAt: UnixEpochSeconds,
): { readonly minute: number; readonly weekend: boolean } | undefined {
  const date = new Date(startsAt * 1_000);
  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }
  const parts = Object.fromEntries(
    MOSCOW_PARTS.formatToParts(date).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    second !== 0 ||
    typeof parts.weekday !== 'string'
  ) {
    return undefined;
  }
  return Object.freeze({
    minute: hour * 60 + minute,
    weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun',
  });
}

function pricePerPlayer(
  start: number,
  durationMinutes: MatchDurationMinutes,
  weekend: boolean,
): number | undefined {
  const workingStart = 7 * 60;
  const workingEnd = 24 * 60;
  const end = start + durationMinutes;
  if (
    start < workingStart ||
    start % 30 !== 0 ||
    end > workingEnd
  ) {
    return undefined;
  }
  const boundary = (weekend ? 10 : 17) * 60;
  const firstRate = 3_600;
  const secondRate = weekend ? 4_800 : 4_400;
  const firstMinutes = Math.max(
    0,
    Math.min(end, boundary) - Math.max(start, workingStart),
  );
  const secondMinutes = Math.max(
    0,
    Math.min(end, workingEnd) - Math.max(start, boundary),
  );
  return Math.round(
    (firstMinutes * firstRate + secondMinutes * secondRate) /
      60 /
      4,
  );
}

export class SystemMatchCourtCatalog implements MatchCourtCatalog {
  resolve(input: ResolveMatchCourtInput): MatchCourtSnapshot | undefined {
    if (input.courtId === undefined) {
      return input.scenario === 'community'
        ? Object.freeze({
            courtId: `unassigned:${input.matchId}`,
            courtName: 'Корт не выбран',
            courtType: 'unassigned',
          })
        : undefined;
    }
    const court = COURTS.get(input.courtId);
    const providerCourt = /^yclients:([1-9]\d*)$/u.exec(input.courtId);
    const local = localStart(input.startsAt);
    if ((court === undefined && providerCourt === null) || local === undefined) {
      return undefined;
    }
    const price = pricePerPlayer(
      local.minute,
      input.durationMinutes,
      local.weekend,
    );
    return price === undefined
      ? undefined
      : Object.freeze({
          ...(court ?? {
            courtId: input.courtId,
            courtName: `Корт ${providerCourt?.[1]}`,
            courtType: 'panoramic' as const,
          }),
          pricePerPersonSnapshot: price,
        });
  }
}

export const MATCH_COURT_CATALOG = Symbol('MATCH_COURT_CATALOG');
