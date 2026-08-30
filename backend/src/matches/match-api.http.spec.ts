import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  readCreateMatchRequest,
  readMatchActionRequest,
  readMatchFeedRequest,
  readMatchId,
  readUpdateMatchDescriptionRequest,
} from './match-api.http';

const REQUEST_KEY = deterministicUuid('match-api-http-request');
const MATCH_ID = deterministicUuid('match-api-http-match');
const RESERVATION_ID = deterministicUuid('match-api-http-reservation');

function publicRequest(): Record<string, unknown> {
  return {
    requestKey: REQUEST_KEY,
    reservationId: RESERVATION_ID,
    scenario: 'social',
    description: '',
    ratingMin: 2,
    ratingMax: 4,
    isRatingMatch: true,
  };
}

describe('match API HTTP parsers', () => {
  it('accepts and freezes the exact public create allowlist', () => {
    const result = readCreateMatchRequest(publicRequest());

    expect(result).toEqual(publicRequest());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('accepts a 240-code-point comment and rejects a longer comment', () => {
    expect(
      readCreateMatchRequest({
        ...publicRequest(),
        description: 'я'.repeat(240),
      }),
    ).toBeDefined();
    expect(
      readCreateMatchRequest({
        ...publicRequest(),
        description: 'я'.repeat(241),
      }),
    ).toBeUndefined();
  });

  it('accepts the existing private metadata with the same reservation contract', () => {
    const request = publicRequest();
    request.scenario = 'private';
    request.isRatingMatch = false;
    delete request.ratingMin;
    delete request.ratingMax;

    expect(readCreateMatchRequest(request)).toEqual(request);
  });

  it('accepts community create with the same reservation contract', () => {
    const request = publicRequest();
    request.scenario = 'community';

    expect(readCreateMatchRequest(request)).toEqual(request);
  });

  it.each([
    ['unknown field', { ...publicRequest(), status: 'confirmed' }],
    ['retired title field', { ...publicRequest(), title: 'Evening padel' }],
    ['client match id', { ...publicRequest(), matchId: MATCH_ID }],
    ['client command id', { ...publicRequest(), commandId: MATCH_ID }],
    ['client actor id', { ...publicRequest(), actorAccountId: MATCH_ID }],
    ['client digest', { ...publicRequest(), requestDigest: 'aa'.repeat(32) }],
    ['bad request key', { ...publicRequest(), requestKey: 'not-a-uuid' }],
    ['bad reservation id', { ...publicRequest(), reservationId: 'not-a-uuid' }],
    ['missing reservation id', (() => {
      const value = publicRequest();
      delete value.reservationId;
      return value;
    })()],
    ['client startsAt', { ...publicRequest(), startsAt: 1_800_003_600 }],
    ['client duration', { ...publicRequest(), durationMinutes: 90 }],
    ['client court id', { ...publicRequest(), courtId: 'p1' }],
    ['control character', { ...publicRequest(), description: 'x\u0000y' }],
    ['client court name', { ...publicRequest(), courtName: 'Court 1' }],
    ['client court type', { ...publicRequest(), courtType: 'indoor' }],
    ['client price', { ...publicRequest(), pricePerPersonSnapshot: 1_500 }],
    ['missing public minimum', (() => {
      const value = publicRequest();
      delete value.ratingMin;
      return value;
    })()],
    ['invalid public range', { ...publicRequest(), ratingMin: 5, ratingMax: 4 }],
    ['private rating fields', {
      ...publicRequest(),
      scenario: 'private',
      isRatingMatch: false,
    }],
  ])('rejects %s', (_label, value) => {
    expect(readCreateMatchRequest(value)).toBeUndefined();
  });

  it('accepts only requestKey for join and leave actions', () => {
    expect(readMatchActionRequest({ requestKey: REQUEST_KEY })).toEqual({
      requestKey: REQUEST_KEY,
    });
    expect(
      readMatchActionRequest({
        requestKey: REQUEST_KEY,
        participantId: MATCH_ID,
      }),
    ).toBeUndefined();
  });

  it('accepts only a request key and bounded comment for description updates', () => {
    const value = {
      requestKey: REQUEST_KEY,
      description: 'Updated comment',
    };
    const parsed = readUpdateMatchDescriptionRequest(value);

    expect(parsed).toEqual(value);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(readUpdateMatchDescriptionRequest({
      ...value,
      title: 'Retired title',
    })).toBeUndefined();
    expect(readUpdateMatchDescriptionRequest({
      ...value,
      description: 'x'.repeat(241),
    })).toBeUndefined();
    expect(readUpdateMatchDescriptionRequest({
      ...value,
      description: 'x\u0000y',
    })).toBeUndefined();
  });

  it('parses an empty/default or canonical bounded feed query', () => {
    expect(readMatchFeedRequest({})).toEqual({ limit: 20 });
    expect(readMatchFeedRequest({ limit: '50' })).toEqual({ limit: 50 });
    expect(readMatchFeedRequest({ limit: 2 })).toEqual({ limit: 2 });
    for (const invalid of [
      { limit: '0' },
      { limit: '01' },
      { limit: '51' },
      { limit: 2.5 },
      { cursor: MATCH_ID },
    ]) {
      expect(readMatchFeedRequest(invalid)).toBeUndefined();
    }
  });

  it('accepts only canonical UUID match ids', () => {
    expect(readMatchId(MATCH_ID)).toBe(MATCH_ID);
    expect(readMatchId(MATCH_ID.toUpperCase())).toBeUndefined();
    expect(readMatchId('not-a-match')).toBeUndefined();
  });
});
