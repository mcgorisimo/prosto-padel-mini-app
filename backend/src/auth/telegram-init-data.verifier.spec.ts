import * as crypto from 'node:crypto';
import {
  TelegramInitDataVerificationError,
  TelegramInitDataVerifier,
  TelegramInitDataVerifierSettings,
  telegramCanonicalSubjectFromUserId,
} from './telegram-init-data.verifier';

const FAKE_BOT_TOKEN =
  '123456789:AA_TEST_ONLY_FAKE_TELEGRAM_BOT_TOKEN_DO_NOT_USE';
const FIXED_NOW = new Date('2026-07-21T12:00:00.000Z');
const FIXED_NOW_SECONDS = 1_784_635_200;
const MAX_AGE_SECONDS = 300;
const SAFE_ERROR_MESSAGE = 'Telegram authentication data is invalid';
const FIXED_MINIMAL_VECTOR =
  'auth_date=1784635200&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Fixture%22%7D&hash=3075d2eff161122e1b1ff0f5b53fe9b99761547f5658140eaf522e6e1f65a38b';

type Parameter = readonly [name: string, value: string];

function compareParameters(left: Parameter, right: Parameter): number {
  if (left[0] < right[0]) return -1;
  if (left[0] > right[0]) return 1;
  return 0;
}

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function serializeParameters(parameters: readonly Parameter[]): string {
  return parameters
    .map(
      ([name, value]) =>
        `${encodeFormComponent(name)}=${encodeFormComponent(value)}`,
    )
    .join('&');
}

function signParameters(
  parameters: readonly Parameter[],
  botToken = FAKE_BOT_TOKEN,
): string {
  const dataCheckString = [...parameters]
    .sort(compareParameters)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken, 'utf8')
    .digest();
  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString, 'utf8')
    .digest('hex');

  return serializeParameters([...parameters, ['hash', hash]]);
}

function userParameters(
  user: unknown,
  authDate = FIXED_NOW_SECONDS,
): Parameter[] {
  return [
    ['auth_date', String(authDate)],
    ['user', JSON.stringify(user)],
  ];
}

function makeVerifier(
  settings: TelegramInitDataVerifierSettings = {
    enabled: true,
    botToken: FAKE_BOT_TOKEN,
    maxAgeSeconds: MAX_AGE_SECONDS,
  },
  clock: () => Date = () => FIXED_NOW,
): TelegramInitDataVerifier {
  return new TelegramInitDataVerifier(settings, clock);
}

function captureVerificationError(action: () => unknown): Error {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected Telegram verification to fail');
}

function expectInvalid(
  rawInitData: string,
  verifier = makeVerifier(),
): TelegramInitDataVerificationError {
  const error = captureVerificationError(() => verifier.verify(rawInitData));

  expect(error).toBeInstanceOf(TelegramInitDataVerificationError);
  expect(error.message).toBe(SAFE_ERROR_MESSAGE);
  return error as TelegramInitDataVerificationError;
}

describe('TelegramInitDataVerifier', () => {
  describe('valid initData', () => {
    it('verifies a fixed minimal vector independent from the signing helper', () => {
      const identity = makeVerifier().verify(FIXED_MINIMAL_VECTOR);

      expect(identity).toEqual({
        provider: 'telegram',
        subject: '123456789',
        authDate: FIXED_NOW,
        verifiedAt: FIXED_NOW,
        firstName: 'Fixture',
      });
    });

    it('maps all supported optional user fields to camelCase', () => {
      const rawInitData = signParameters(
        userParameters({
          id: 4_503_599_627_370_495,
          first_name: 'First',
          last_name: 'Last',
          username: 'fixture_user',
          language_code: 'ru-RU',
          photo_url: 'https://example.test/avatar.svg',
          is_premium: true,
          unknown_future_field: { ignored: true },
        }),
      );

      expect(makeVerifier().verify(rawInitData)).toEqual({
        provider: 'telegram',
        subject: '4503599627370495',
        authDate: FIXED_NOW,
        verifiedAt: FIXED_NOW,
        firstName: 'First',
        lastName: 'Last',
        username: 'fixture_user',
        languageCode: 'ru-RU',
        photoUrl: 'https://example.test/avatar.svg',
      });
    });

    it('accepts parameters in a different input order', () => {
      const rawInitData = signParameters([
        ['user', JSON.stringify({ id: 42, first_name: 'Order' })],
        ['query_id', 'test-query'],
        ['auth_date', String(FIXED_NOW_SECONDS)],
      ]);

      expect(makeVerifier().verify(rawInitData).subject).toBe('42');
    });

    it('decodes plus, Unicode, and URL-encoded special characters', () => {
      const firstName = 'Тест & = + 😀';
      const rawInitData = signParameters(
        userParameters({ id: 43, first_name: firstName }),
      );

      expect(makeVerifier().verify(rawInitData).firstName).toBe(firstName);
      expect(rawInitData).toContain('+');
      expect(rawInitData).toContain('%26');
      expect(rawInitData).toContain('%2B');
    });

    it('includes unknown parameters in the HMAC data-check-string', () => {
      const parameters: Parameter[] = [
        ...userParameters({ id: 44, first_name: 'Unknown' }),
        ['future_parameter', 'signed-value'],
      ];
      const rawInitData = signParameters(parameters);

      expect(makeVerifier().verify(rawInitData).subject).toBe('44');
      expectInvalid(rawInitData.replace('signed-value', 'changed-value'));
    });

    it('includes signature in the bot-token HMAC when present', () => {
      const rawInitData = signParameters([
        ...userParameters({ id: 45, first_name: 'Signature' }),
        ['signature', 'test-only-ed25519-placeholder'],
      ]);

      expect(makeVerifier().verify(rawInitData).subject).toBe('45');
      expectInvalid(rawInitData.replace('placeholder', 'changed'));
    });

  });

  describe('verified proof envelope', () => {
    it('uses finite integer epoch seconds in the proof contract', () => {
      const outcome = makeVerifier().verifyProof(FIXED_MINIMAL_VECTOR);

      expect(outcome.status).toBe('verified');
      if (outcome.status === 'verified') {
        expect(outcome.proof.authDate).toBe(FIXED_NOW_SECONDS);
        expect(outcome.proof.verifiedAt).toBe(FIXED_NOW_SECONDS);
        expect(outcome.proof.expiresAt).toBe(
          FIXED_NOW_SECONDS + MAX_AGE_SECONDS,
        );
        expect(outcome.proof).not.toHaveProperty('identity');
      }
    });

    it('normalizes a subsecond verifier clock to epoch seconds', () => {
      const clock = () => new Date(FIXED_NOW.getTime() + 999);
      const outcome = makeVerifier(undefined, clock).verifyProof(
        FIXED_MINIMAL_VECTOR,
      );

      expect(outcome.status).toBe('verified');
      if (outcome.status === 'verified') {
        expect(outcome.proof.verifiedAt).toBe(FIXED_NOW_SECONDS);
      }
    });

    it('returns the same fingerprint for the same valid proof', () => {
      const first = makeVerifier().verifyProof(FIXED_MINIMAL_VECTOR);
      const second = makeVerifier().verifyProof(FIXED_MINIMAL_VECTOR);

      expect(first.status).toBe('verified');
      expect(second.status).toBe('verified');
      if (first.status === 'verified' && second.status === 'verified') {
        expect(first.proof.proofFingerprint).toBe(
          second.proof.proofFingerprint,
        );
      }
    });

    it('changes the fingerprint when the signed payload changes', () => {
      const first = makeVerifier().verifyProof(
        signParameters(
          userParameters({ id: 46, first_name: 'First payload' }),
        ),
      );
      const second = makeVerifier().verifyProof(
        signParameters(
          userParameters({ id: 46, first_name: 'Second payload' }),
        ),
      );

      expect(first.status).toBe('verified');
      expect(second.status).toBe('verified');
      if (first.status === 'verified' && second.status === 'verified') {
        expect(first.proof.proofFingerprint).not.toBe(
          second.proof.proofFingerprint,
        );
      }
    });

    it('does not expose the raw Telegram hash as the fingerprint', () => {
      const outcome = makeVerifier().verifyProof(FIXED_MINIMAL_VECTOR);
      const rawHash = new URLSearchParams(FIXED_MINIMAL_VECTOR).get('hash');

      expect(outcome.status).toBe('verified');
      if (outcome.status === 'verified') {
        expect(outcome.proof.proofFingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(outcome.proof.proofFingerprint).not.toBe(rawHash);
      }
    });

    it('uses only the numeric bot ID in the Telegram issuer namespace', () => {
      const outcome = makeVerifier().verifyProof(FIXED_MINIMAL_VECTOR);
      const tokenSecret = FAKE_BOT_TOKEN.split(':')[1];

      expect(outcome.status).toBe('verified');
      if (outcome.status === 'verified') {
        expect(outcome.proof.namespace).toBe('telegram:bot:123456789');
        expect(outcome.proof.namespace).not.toContain(tokenSecret);
        expect(outcome.proof.identityKey).toEqual({
          provider: 'telegram',
          namespace: 'telegram:bot:123456789',
          lookup: {
            kind: 'canonical_subject',
            subject: '123456789',
          },
        });
      }
    });

    it('binds the same payload to different bot namespaces', () => {
      const secondBotToken =
        '987654321:AA_TEST_ONLY_FAKE_TELEGRAM_BOT_TOKEN_DO_NOT_USE';
      const parameters = userParameters({ id: 49, first_name: 'Namespace' });
      const first = makeVerifier().verifyProof(
        signParameters(parameters, FAKE_BOT_TOKEN),
      );
      const second = makeVerifier({
        enabled: true,
        botToken: secondBotToken,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }).verifyProof(signParameters(parameters, secondBotToken));

      expect(first.status).toBe('verified');
      expect(second.status).toBe('verified');
      if (first.status === 'verified' && second.status === 'verified') {
        expect(first.proof.namespace).not.toBe(second.proof.namespace);
        expect(first.proof.proofFingerprint).not.toBe(
          second.proof.proofFingerprint,
        );
      }
    });

    it('does not expose proof material or the bot token in the envelope', () => {
      const outcome = makeVerifier().verifyProof(FIXED_MINIMAL_VECTOR);

      expect(outcome.status).toBe('verified');
      if (outcome.status === 'verified') {
        expect(outcome.proof).not.toHaveProperty('rawInitData');
        expect(outcome.proof).not.toHaveProperty('hash');
        expect(outcome.proof).not.toHaveProperty('canonicalPayload');
        expect(outcome.proof).not.toHaveProperty('botToken');
        expect(JSON.stringify(outcome.proof)).not.toContain(FAKE_BOT_TOKEN);
      }
    });

    it('does not return a fingerprint for an invalid signature', () => {
      const outcome = makeVerifier().verifyProof(
        FIXED_MINIMAL_VECTOR.replace(/hash=[0-9a-f]+$/, `hash=${'0'.repeat(64)}`),
      );

      expect(outcome).toEqual({
        status: 'invalid',
        reason: 'invalid_proof',
      });
      expect(outcome).not.toHaveProperty('proofFingerprint');
    });

    it('classifies a valid signed but expired proof internally', () => {
      const authDate = FIXED_NOW_SECONDS - MAX_AGE_SECONDS - 1;
      const rawInitData = signParameters(
        userParameters({ id: 47, first_name: 'Expired' }, authDate),
      );
      const outcome = makeVerifier().verifyProof(rawInitData);

      expect(outcome).toMatchObject({
        status: 'expired',
        reason: 'expired_proof',
        expiresAt: authDate + MAX_AGE_SECONDS,
      });
      if (outcome.status === 'expired') {
        expect(outcome.proofFingerprint).toMatch(/^[0-9a-f]{64}$/);
      }
      expectInvalid(rawInitData);
    });

    it.each([
      ['zero bot ID', '0:test-secret'],
      ['leading-zero bot ID', '000123:test-secret'],
      ['empty bot ID', ':test-secret'],
      ['negative bot ID', '-1:test-secret'],
      ['fractional bot ID', '1.5:test-secret'],
      ['non-numeric bot ID', 'bot:test-secret'],
      ['overlong bot ID', `${'1'.repeat(21)}:test-secret`],
      ['missing separator', '123test-secret'],
      ['missing secret', '123:'],
    ])('rejects a token with %s', (_description, malformedToken) => {
      const rawInitData = signParameters(
        userParameters({ id: 48, first_name: 'Malformed token' }),
        malformedToken,
      );
      const verifier = makeVerifier({
        enabled: true,
        botToken: malformedToken,
        maxAgeSeconds: MAX_AGE_SECONDS,
      });

      expect(verifier.verifyProof(rawInitData)).toEqual({
        status: 'invalid',
        reason: 'invalid_proof',
      });
      expectInvalid(rawInitData, verifier);
    });
  });

  describe('hash and parameter validation', () => {
    const parameters = userParameters({ id: 51, first_name: 'Hash' });

    it('rejects an incorrect hash', () => {
      expectInvalid(
        serializeParameters([...parameters, ['hash', '0'.repeat(64)]]),
      );
    });

    it('rejects a missing hash', () => {
      expectInvalid(serializeParameters(parameters));
    });

    it('rejects an empty hash', () => {
      expectInvalid(serializeParameters([...parameters, ['hash', '']]));
    });

    it.each(['a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)])(
      'rejects malformed hash %s',
      (hash) => {
        expectInvalid(serializeParameters([...parameters, ['hash', hash]]));
      },
    );

    it.each(['hash', 'auth_date', 'user', 'future_parameter'])(
      'rejects a repeated %s parameter',
      (name) => {
        const rawInitData = signParameters([
          ...parameters,
          ['future_parameter', 'one'],
        ]);
        expectInvalid(`${rawInitData}&${name}=duplicate`);
      },
    );
  });

  describe('freshness', () => {
    const user: Parameter = [
      'user',
      JSON.stringify({ id: 61, first_name: 'Freshness' }),
    ];

    it('rejects a missing auth_date', () => {
      expectInvalid(signParameters([user]));
    });

    it.each(['', '0', '-1', '1.5', '1e9', ' 1784635200', 'NaN'])(
      'rejects malformed auth_date %s',
      (authDate) => {
        expectInvalid(signParameters([['auth_date', authDate], user]));
      },
    );

    it('accepts data one second before expiry', () => {
      const rawInitData = signParameters([
        ['auth_date', String(FIXED_NOW_SECONDS - MAX_AGE_SECONDS + 1)],
        user,
      ]);

      expect(makeVerifier().verify(rawInitData).subject).toBe('61');
    });

    it('expires data exactly at expiresAt', () => {
      const rawInitData = signParameters([
        ['auth_date', String(FIXED_NOW_SECONDS - MAX_AGE_SECONDS)],
        user,
      ]);

      expect(makeVerifier().verifyProof(rawInitData)).toMatchObject({
        status: 'expired',
        reason: 'expired_proof',
        expiresAt: FIXED_NOW_SECONDS,
      });
      expectInvalid(rawInitData);
    });

    it('rejects data older than max age', () => {
      expectInvalid(
        signParameters([
          ['auth_date', String(FIXED_NOW_SECONDS - MAX_AGE_SECONDS - 1)],
          user,
        ]),
      );
    });

    it('accepts future auth_date exactly at the 30 second skew', () => {
      const rawInitData = signParameters([
        ['auth_date', String(FIXED_NOW_SECONDS + 30)],
        user,
      ]);

      expect(makeVerifier().verify(rawInitData).subject).toBe('61');
    });

    it('rejects auth_date beyond the future clock skew', () => {
      expectInvalid(
        signParameters([
          ['auth_date', String(FIXED_NOW_SECONDS + 31)],
          user,
        ]),
      );
    });

    it('rejects an unsafe auth_date integer', () => {
      expectInvalid(
        signParameters([
          ['auth_date', String(Number.MAX_SAFE_INTEGER + 1)],
          user,
        ]),
      );
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1_000])(
      'rejects an invalid verifier clock value %s',
      (milliseconds) => {
        const verifier = makeVerifier(undefined, () => new Date(milliseconds));

        expect(verifier.verifyProof(FIXED_MINIMAL_VECTOR)).toEqual({
          status: 'invalid',
          reason: 'invalid_proof',
        });
        expectInvalid(FIXED_MINIMAL_VECTOR, verifier);
      },
    );
  });

  describe('Telegram canonical subject', () => {
    it('accepts a canonical positive Telegram user ID', () => {
      expect(telegramCanonicalSubjectFromUserId('123456789')).toBe(
        '123456789',
      );
    });

    it.each([
      '0',
      '00',
      '000123',
      '-1',
      '1.5',
      'user',
      '9'.repeat(17),
    ])(
      'rejects a non-canonical Telegram user ID %s',
      (telegramUserId) => {
        expect(() =>
          telegramCanonicalSubjectFromUserId(telegramUserId),
        ).toThrow(TelegramInitDataVerificationError);
      },
    );
  });

  describe('Telegram user validation', () => {
    it('rejects a missing user', () => {
      expectInvalid(
        signParameters([['auth_date', String(FIXED_NOW_SECONDS)]]),
      );
    });

    it('rejects malformed user JSON', () => {
      expectInvalid(
        signParameters([
          ['auth_date', String(FIXED_NOW_SECONDS)],
          ['user', '{invalid'],
        ]),
      );
    });

    it.each(['null', '[]', 'true', '1', '"primitive"'])(
      'rejects non-object user JSON %s',
      (rawUser) => {
        expectInvalid(
          signParameters([
            ['auth_date', String(FIXED_NOW_SECONDS)],
            ['user', rawUser],
          ]),
        );
      },
    );

    it('rejects a missing Telegram ID', () => {
      expectInvalid(
        signParameters(userParameters({ first_name: 'Missing ID' })),
      );
    });

    it.each(['123', 0, -1, 1.5, 2 ** 52, Number.MAX_SAFE_INTEGER, null])(
      'rejects invalid Telegram ID %s',
      (id) => {
        expectInvalid(
          signParameters(userParameters({ id, first_name: 'Invalid ID' })),
        );
      },
    );

    it('rejects a missing first_name', () => {
      expectInvalid(signParameters(userParameters({ id: 71 })));
    });

    it.each([42, '', '😀'.repeat(257)])(
      'rejects invalid first_name',
      (firstName) => {
        expectInvalid(
          signParameters(
            userParameters({ id: 72, first_name: firstName }),
          ),
        );
      },
    );

    it.each(['last_name', 'username', 'language_code', 'photo_url'])(
      'rejects a non-string %s',
      (field) => {
        expectInvalid(
          signParameters(
            userParameters({ id: 73, first_name: 'Optional', [field]: 1 }),
          ),
        );
      },
    );

    it.each([
      ['last_name', 'x'.repeat(257)],
      ['username', 'x'.repeat(65)],
      ['language_code', 'x'.repeat(65)],
      ['photo_url', `https://example.test/${'x'.repeat(2050)}`],
    ])('rejects an overlong %s', (field, value) => {
      expectInvalid(
        signParameters(
          userParameters({ id: 74, first_name: 'Length', [field]: value }),
        ),
      );
    });

    it.each(['', 'not-a-url', 'http://example.test/avatar.jpg'])(
      'rejects invalid photo_url %s',
      (photoUrl) => {
        expectInvalid(
          signParameters(
            userParameters({
              id: 75,
              first_name: 'Photo',
              photo_url: photoUrl,
            }),
          ),
        );
      },
    );
  });

  describe('input limits and strict form decoding', () => {
    it('rejects non-string and empty input', () => {
      expectInvalid(undefined as unknown as string);
      expectInvalid('');
    });

    it('rejects raw initData larger than 16 KiB', () => {
      expectInvalid(`field=${'x'.repeat(16 * 1024)}`);
    });

    it('rejects more than 64 parameters', () => {
      expectInvalid(
        Array.from({ length: 65 }, (_, index) => `p${index}=x`).join('&'),
      );
    });

    it('rejects a decoded parameter name longer than 64 characters', () => {
      expectInvalid(`${'a'.repeat(65)}=x`);
    });

    it('rejects a decoded parameter value larger than 8 KiB', () => {
      expectInvalid(`value=${'x'.repeat(8 * 1024 + 1)}`);
    });

    it.each(['&', 'a=1&&b=2', 'a=1&', 'a', '=value', 'bad-name=value'])(
      'rejects malformed segment structure %s',
      (rawInitData) => {
        expectInvalid(rawInitData);
      },
    );

    it.each(['value=%', 'value=%GG', 'value=%C3%28'])(
      'rejects malformed percent encoding or UTF-8 %s',
      (rawInitData) => {
        expectInvalid(rawInitData);
      },
    );
  });

  describe('safe isolation', () => {
    it('fails immediately when Telegram Auth is disabled without reading a token or clock', () => {
      let tokenWasRead = false;
      const settings = new Proxy(
        { enabled: false } as TelegramInitDataVerifierSettings,
        {
          get(target, property, receiver) {
            if (property === 'botToken') tokenWasRead = true;
            return Reflect.get(target, property, receiver) as unknown;
          },
        },
      );
      const clock = jest.fn(() => FIXED_NOW);

      expectInvalid(FIXED_MINIMAL_VECTOR, makeVerifier(settings, clock));
      expect(tokenWasRead).toBe(false);
      expect(clock).not.toHaveBeenCalled();
    });

    it('uses one safe error type and never exposes input or secrets', () => {
      const sensitiveMarker = 'TEST_PERSONAL_DATA_MARKER';
      const rawInitData = serializeParameters([
        ...userParameters({ id: 81, first_name: sensitiveMarker }),
        ['hash', '0'.repeat(64)],
      ]);
      const error = expectInvalid(rawInitData);

      expect(error.name).toBe('TelegramInitDataVerificationError');
      expect(error.message).not.toContain(FAKE_BOT_TOKEN);
      expect(error.message).not.toContain(sensitiveMarker);
      expect(error.message).not.toContain('0'.repeat(64));
      expect(error.message).not.toContain(rawInitData);
    });

    it('returns identity only and needs no persistence or session dependencies', () => {
      const identity = makeVerifier().verify(FIXED_MINIMAL_VECTOR);

      expect(Object.keys(identity).sort()).toEqual(
        [
          'authDate',
          'firstName',
          'provider',
          'subject',
          'verifiedAt',
        ].sort(),
      );
      expect(identity).not.toHaveProperty('accountId');
      expect(identity).not.toHaveProperty('profile');
      expect(identity).not.toHaveProperty('session');
      expect(identity).not.toHaveProperty('rawInitData');
      expect(identity).not.toHaveProperty('hash');
      expect(identity).not.toHaveProperty('botToken');
    });
  });
});
