import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  readAdminPlayerId,
  readAdminPlayerListRequest,
  readSetAdminPlayerRatingStateRequest,
} from './admin-player-rating.http';

describe('admin player rating HTTP readers', () => {
  it('applies bounded list defaults and accepts canonical filters', () => {
    expect(readAdminPlayerListRequest({})).toEqual({ verification: 'all', limit: 20 });
    expect(readAdminPlayerListRequest({ search: 'Иван', verification: 'unverified', limit: '50' })).toEqual({
      search: 'Иван', verification: 'unverified', limit: 50,
    });
  });

  it.each([
    { extra: 'value' },
    { limit: '0' },
    { limit: '51' },
    { verification: 'unknown' },
    { search: ' Иван' },
    { cursor: 'not+a+cursor' },
  ])('rejects malformed list query %#', (query) => {
    expect(readAdminPlayerListRequest(query)).toBeUndefined();
  });

  it('accepts an exact canonical rating command', () => {
    const requestKey = deterministicUuid('admin-rating-http-command');
    expect(readSetAdminPlayerRatingStateRequest({ requestKey, rating: 3.25, isVerified: true })).toEqual({
      requestKey, rating: 3.25, isVerified: true,
    });
    expect(readAdminPlayerId(deterministicUuid('admin-rating-http-player'))).toBeDefined();
  });

  it.each([
    { requestKey: 'bad', rating: 3, isVerified: true },
    { requestKey: deterministicUuid('admin-rating-http-a'), rating: 3.251, isVerified: true },
    { requestKey: deterministicUuid('admin-rating-http-b'), rating: 11, isVerified: true },
    { requestKey: deterministicUuid('admin-rating-http-c'), rating: 3, isVerified: 'true' },
    { requestKey: deterministicUuid('admin-rating-http-d'), rating: 3, isVerified: true, extra: 1 },
  ])('rejects malformed rating command %#', (body) => {
    expect(readSetAdminPlayerRatingStateRequest(body)).toBeUndefined();
  });
});
