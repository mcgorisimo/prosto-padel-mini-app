import { inspect } from 'node:util';
import {
  BACKEND_RUNTIME_CONFIGURATION_ERROR,
  FILE_SECRET_KEYS,
  FILE_SECRET_MAX_UTF8_BYTES,
  FileSecretReader,
  resolveFileSecrets,
} from './file-secret.resolver';

function readerFrom(
  files: Readonly<Record<string, Buffer | string>>,
): jest.MockedFunction<FileSecretReader> {
  return jest.fn((path: string) => {
    if (!Object.prototype.hasOwnProperty.call(files, path)) {
      throw new Error(`Synthetic missing file: ${path}`);
    }
    return files[path];
  });
}

function expectFixedFailure(
  action: () => unknown,
  forbidden: readonly string[] = [],
): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  const error = caught instanceof Error ? caught : undefined;
  const message = error?.message ?? '';
  const stack = error?.stack ?? '';
  const cause =
    error === undefined
      ? undefined
      : (error as Error & { cause?: unknown }).cause;
  const ownPropertyInspection =
    error === undefined
      ? ''
      : Object.getOwnPropertyNames(error)
          .map(
            (name) =>
              `${name}:${inspect(
                Reflect.get(error, name) as unknown,
                { depth: 4 },
              )}`,
          )
          .join('\n');
  let serialized = '';
  let serializationSucceeded = true;
  try {
    serialized = JSON.stringify(caught);
  } catch {
    serializationSucceeded = false;
  }
  const inspected = inspect(caught, { depth: 4 });
  const diagnosticSurfaces = [
    message,
    stack,
    inspect(cause, { depth: 4 }),
    ownPropertyInspection,
    serialized,
    inspected,
  ];
  expect({
    isError: error !== undefined,
    fixedMessage: message === BACKEND_RUNTIME_CONFIGURATION_ERROR,
    hasCause: cause !== undefined,
    serializationSucceeded,
    containsForbiddenValue: forbidden.some((value) =>
      diagnosticSurfaces.some((surface) => surface.includes(value)),
    ),
  }).toEqual({
    isError: true,
    fixedMessage: true,
    hasCause: false,
    serializationSucceeded: true,
    containsForbiddenValue: false,
  });
}

describe('file secret resolver', () => {
  it('reads an allowlisted UTF-8 secret without retaining its file key', () => {
    const path = '/synthetic/telegram-token';
    const token = '123456789:synthetic_token';
    const reader = readerFrom({ [path]: Buffer.from(token, 'utf8') });

    const resolved = resolveFileSecrets(
      { [FILE_SECRET_KEYS.telegramBotToken]: path },
      reader,
    );

    expect({
      tokenMatches: resolved.environment.TELEGRAM_BOT_TOKEN === token,
      retainsFileKey: Object.prototype.hasOwnProperty.call(
        resolved.environment,
        FILE_SECRET_KEYS.telegramBotToken,
      ),
      readCount: reader.mock.calls.length,
    }).toEqual({
      tokenMatches: true,
      retainsFileKey: false,
      readCount: 1,
    });
  });

  it('returns the database password separately from the environment', () => {
    const path = '/synthetic/database-password';
    const password = 'synthetic database password';

    const resolved = resolveFileSecrets(
      { [FILE_SECRET_KEYS.databasePassword]: path },
      readerFrom({ [path]: password }),
    );

    expect({
      passwordMatches: resolved.databasePassword === password,
      passwordInEnvironment: Object.values(resolved.environment).includes(
        password,
      ),
      retainsFileKey: Object.prototype.hasOwnProperty.call(
        resolved.environment,
        FILE_SECRET_KEYS.databasePassword,
      ),
    }).toEqual({
      passwordMatches: true,
      passwordInEnvironment: false,
      retainsFileKey: false,
    });
  });

  it.each([
    ['missing file', new Error('ENOENT synthetic')],
    ['unreadable file', new Error('EACCES synthetic')],
  ])('fails closed for a %s', (_label, readError) => {
    const path = '/synthetic/private-secret';
    const reader = jest.fn(() => {
      throw readError;
    });

    expectFixedFailure(
      () =>
        resolveFileSecrets(
          { [FILE_SECRET_KEYS.telegramBotToken]: path },
          reader,
        ),
      [path, readError.message],
    );
  });

  it.each([
    ['empty value', ''],
    ['line-ending-only value', '\r\n'],
    ['whitespace-only value', ' \t '],
  ])('rejects a %s', (_label, value) => {
    const path = '/synthetic/empty-secret';

    expectFixedFailure(
      () =>
        resolveFileSecrets(
          { [FILE_SECRET_KEYS.telegramBotToken]: path },
          readerFrom({ [path]: value }),
        ),
      [path],
    );
  });

  it('removes trailing CRLF without trimming meaningful content', () => {
    const path = '/synthetic/crlf-secret';
    const value = 'secret with internal spaces  \r\n';

    const resolved = resolveFileSecrets(
      { [FILE_SECRET_KEYS.telegramBotToken]: path },
      readerFrom({ [path]: value }),
    );

    expect(
      resolved.environment.TELEGRAM_BOT_TOKEN ===
        'secret with internal spaces  ',
    ).toBe(true);
  });

  it('preserves internal spaces exactly', () => {
    const path = '/synthetic/spaced-secret';
    const value = 'alpha  beta gamma';

    const resolved = resolveFileSecrets(
      { [FILE_SECRET_KEYS.telegramBotToken]: path },
      readerFrom({ [path]: value }),
    );

    expect(resolved.environment.TELEGRAM_BOT_TOKEN === value).toBe(true);
  });

  it('rejects a file above the fixed byte limit', () => {
    const path = '/synthetic/oversized-secret';

    expectFixedFailure(
      () =>
        resolveFileSecrets(
          { [FILE_SECRET_KEYS.telegramBotToken]: path },
          readerFrom({
            [path]: Buffer.alloc(FILE_SECRET_MAX_UTF8_BYTES + 1, 0x61),
          }),
        ),
      [path],
    );
  });

  it('rejects non-UTF-8 file content', () => {
    const path = '/synthetic/non-utf8-secret';

    expectFixedFailure(
      () =>
        resolveFileSecrets(
          { [FILE_SECRET_KEYS.telegramBotToken]: path },
          readerFrom({ [path]: Buffer.from([0xc3, 0x28]) }),
        ),
      [path],
    );
  });

  it('rejects direct and file values before reading the file', () => {
    const path = '/synthetic/ambiguous-token';
    const secret = '123456789:direct_secret';
    const reader = readerFrom({ [path]: '123456789:file_secret' });

    expectFixedFailure(
      () =>
        resolveFileSecrets(
          {
            TELEGRAM_BOT_TOKEN: secret,
            [FILE_SECRET_KEYS.telegramBotToken]: path,
          },
          reader,
        ),
      [path, secret],
    );
    expect(reader).not.toHaveBeenCalled();
  });

  it('maps both allowlisted YCLIENTS token files without retaining their paths', () => {
    const partnerPath = '/synthetic/yclients-partner-token';
    const userPath = '/synthetic/yclients-user-token';
    const partnerToken = 'synthetic-partner-token';
    const userToken = 'synthetic-user-token';
    const resolved = resolveFileSecrets(
      {
        [FILE_SECRET_KEYS.yclientsPartnerToken]: partnerPath,
        [FILE_SECRET_KEYS.yclientsUserToken]: userPath,
      },
      readerFrom({
        [partnerPath]: partnerToken,
        [userPath]: userToken,
      }),
    );

    expect(resolved.environment).toEqual({
      YCLIENTS_PARTNER_TOKEN: partnerToken,
      YCLIENTS_USER_TOKEN: userToken,
    });
  });

  it('rejects an ambiguous direct and file YCLIENTS token before reading it', () => {
    const path = '/synthetic/ambiguous-yclients-token';
    const secret = 'synthetic-direct-partner-token';
    const reader = readerFrom({ [path]: 'synthetic-file-partner-token' });

    expectFixedFailure(
      () =>
        resolveFileSecrets(
          {
            YCLIENTS_PARTNER_TOKEN: secret,
            [FILE_SECRET_KEYS.yclientsPartnerToken]: path,
          },
          reader,
        ),
      [path, secret],
    );
    expect(reader).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file key before reading any file', () => {
    const path = '/synthetic/unsupported-secret';
    const reader = readerFrom({ [path]: 'secret' });

    expectFixedFailure(
      () =>
        resolveFileSecrets(
          { UNAPPROVED_RUNTIME_SECRET_FILE: path },
          reader,
        ),
      [path],
    );
    expect(reader).not.toHaveBeenCalled();
  });

  it('keeps the existing BACKEND_IGNORE_ENV_FILE control variable', () => {
    const resolved = resolveFileSecrets({
      BACKEND_IGNORE_ENV_FILE: 'true',
    });

    expect(resolved.environment.BACKEND_IGNORE_ENV_FILE).toBe('true');
  });
});
