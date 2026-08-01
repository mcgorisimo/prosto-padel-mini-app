import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  readResolveMatchResultRequest,
  readResultMatchId,
  readSubmitMatchResultRequest,
} from './match-result.http';

const MATCH_ID = deterministicUuid('result-http-match');
const REQUEST_KEY = deterministicUuid('result-http-request');

describe('match result HTTP parsing', () => {
  it('accepts exact two-set and three-set request shapes', () => {
    expect(readResultMatchId(MATCH_ID)).toBe(MATCH_ID);
    expect(readSubmitMatchResultRequest({
      requestKey: REQUEST_KEY,
      sets: [
        { team1Games: 6, team2Games: 4 },
        { team1Games: 7, team2Games: 5 },
      ],
    })).toEqual({
      requestKey: REQUEST_KEY,
      sets: [
        { team1Games: 6, team2Games: 4 },
        { team1Games: 7, team2Games: 5 },
      ],
    });
    expect(readResolveMatchResultRequest({ requestKey: REQUEST_KEY })).toEqual({
      requestKey: REQUEST_KEY,
    });
  });

  it.each([
    { requestKey: REQUEST_KEY, sets: [{ team1Games: 6, team2Games: 4 }] },
    { requestKey: REQUEST_KEY, sets: [{ team1Games: 6, team2Games: 4 }, { team1Games: 6.5, team2Games: 4 }] },
    { requestKey: REQUEST_KEY, sets: [{ team1Games: 8, team2Games: 4 }, { team1Games: 6, team2Games: 4 }] },
    { requestKey: REQUEST_KEY, sets: [{ team1Games: 6, team2Games: 4 }, { team1Games: 6, team2Games: 4 }], accountId: MATCH_ID },
  ])('rejects malformed or identity-bearing payload %#', (payload) => {
    expect(readSubmitMatchResultRequest(payload)).toBeUndefined();
  });

  it('rejects extra resolve fields and non-v4 request keys', () => {
    expect(readResolveMatchResultRequest({ requestKey: REQUEST_KEY, matchId: MATCH_ID })).toBeUndefined();
    expect(readResolveMatchResultRequest({ requestKey: MATCH_ID.replace(/-4/u, '-5') })).toBeUndefined();
  });
});
