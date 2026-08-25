import { isInternalUuid } from '../internal-uuid';
import { newRequestId } from './request-id';

describe('newRequestId', () => {
  it('generates independent canonical UUIDs', () => {
    const firstRequestId = newRequestId();
    const secondRequestId = newRequestId();

    expect(isInternalUuid(firstRequestId)).toBe(true);
    expect(isInternalUuid(secondRequestId)).toBe(true);
    expect(secondRequestId).not.toBe(firstRequestId);
  });
});
