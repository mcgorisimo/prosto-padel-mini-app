import { unixEpochSeconds } from './auth.types';
import {
  createSessionRefreshHttpSuccessResponse,
  readSessionBearerCredential,
  readSessionLifecycleHttpRequest,
} from './session-lifecycle.http';

const REQUEST_KEY = '12345678-1234-4abc-9234-567812345678';
const CREDENTIAL = Buffer.alloc(32, 0x41).toString('base64url');
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);

describe('session lifecycle HTTP contracts', () => {
  it('accepts only the exact requestKey body', () => {
    expect(readSessionLifecycleHttpRequest({ requestKey: REQUEST_KEY })).toEqual({
      requestKey: REQUEST_KEY,
    });

    for (const body of [
      undefined,
      null,
      [],
      {},
      { requestKey: '' },
      { requestKey: 'not-a-uuid' },
      { requestKey: REQUEST_KEY.toUpperCase() },
      { requestKey: REQUEST_KEY, credential: CREDENTIAL },
      { requestKey: REQUEST_KEY, commandId: REQUEST_KEY },
      { requestKey: REQUEST_KEY, requestDigest: 'digest' },
      { requestKey: REQUEST_KEY, eventId: REQUEST_KEY },
      { requestKey: REQUEST_KEY, sessionId: REQUEST_KEY },
      { requestKey: REQUEST_KEY, generation: 1 },
    ]) {
      expect(readSessionLifecycleHttpRequest(body)).toBeUndefined();
    }
  });

  it('accepts only an exact canonical Bearer credential', () => {
    expect(readSessionBearerCredential(`Bearer ${CREDENTIAL}`)).toBe(
      CREDENTIAL,
    );

    for (const authorization of [
      undefined,
      null,
      CREDENTIAL,
      `bearer ${CREDENTIAL}`,
      `Bearer  ${CREDENTIAL}`,
      `Bearer ${CREDENTIAL} `,
      `Basic ${CREDENTIAL}`,
      'Bearer invalid',
      ['Bearer', CREDENTIAL],
    ]) {
      expect(readSessionBearerCredential(authorization)).toBeUndefined();
    }
  });

  it('creates only a canonical future refresh response', () => {
    expect(
      createSessionRefreshHttpSuccessResponse(
        CREDENTIAL,
        EXPIRES_AT,
        NOW,
      ),
    ).toEqual({
      credential: CREDENTIAL,
      expiresAt: EXPIRES_AT,
    });
    expect(
      createSessionRefreshHttpSuccessResponse('invalid', EXPIRES_AT, NOW),
    ).toBeUndefined();
    expect(
      createSessionRefreshHttpSuccessResponse(CREDENTIAL, NOW, NOW),
    ).toBeUndefined();
  });
});
