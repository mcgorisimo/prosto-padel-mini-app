import { envValidationSchema } from './env.validation';

function validate(environment: Record<string, unknown> = {}) {
  return envValidationSchema.validate(environment, {
    abortEarly: false,
    allowUnknown: true,
  });
}

describe('envValidationSchema', () => {
  it('disables Telegram authentication by default', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value.TELEGRAM_AUTH_ENABLED).toBe(false);
  });

  it('allows the token and max age to be absent when disabled', () => {
    const { error } = validate({ TELEGRAM_AUTH_ENABLED: 'false' });

    expect(error).toBeUndefined();
  });

  it('allows empty token and max age values when disabled', () => {
    const { error } = validate({
      TELEGRAM_AUTH_ENABLED: 'false',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '',
    });

    expect(error).toBeUndefined();
  });

  it('does not enable authentication when only a token is present', () => {
    const { error, value } = validate({
      TELEGRAM_BOT_TOKEN: 'obviously-fake-test-token',
    });

    expect(error).toBeUndefined();
    expect(value.TELEGRAM_AUTH_ENABLED).toBe(false);
  });

  it('rejects a missing token when enabled', () => {
    const { error } = validate({
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeDefined();
  });

  it('rejects an empty token when enabled', () => {
    const { error } = validate({
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeDefined();
  });

  it('rejects a whitespace-only token when enabled', () => {
    const { error } = validate({
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '   ',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeDefined();
  });

  it('accepts an obviously fake test token when enabled', () => {
    const { error } = validate({
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'obviously-fake-test-token',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeUndefined();
  });

  it('rejects a missing max age when enabled', () => {
    const { error } = validate({
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'obviously-fake-test-token',
    });

    expect(error).toBeDefined();
  });

  it('accepts a positive integer max age', () => {
    const { error, value } = validate({
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'obviously-fake-test-token',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeUndefined();
    expect(value.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS).toBe(300);
  });

  it('accepts the maximum Telegram init data age', () => {
    const { error, value } = validate({
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'obviously-fake-test-token',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '86400',
    });

    expect(error).toBeUndefined();
    expect(value.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS).toBe(86400);
  });

  it('rejects a Telegram init data age above the maximum', () => {
    const { error } = validate({
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'obviously-fake-test-token',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '86401',
    });

    expect(error).toBeDefined();
  });

  it.each(['0', '-1', '1.5', 'not-a-number'])(
    'rejects invalid max age %s',
    (maxAge) => {
      const { error } = validate({
        TELEGRAM_AUTH_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: 'obviously-fake-test-token',
        TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: maxAge,
      });

      expect(error).toBeDefined();
    },
  );

  it('rejects an invalid feature flag', () => {
    const { error } = validate({ TELEGRAM_AUTH_ENABLED: 'enabled' });

    expect(error).toBeDefined();
  });

  it('preserves the existing defaults', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      CRM_PROVIDER: 'disabled',
      DATABASE_ENABLED: false,
      DATABASE_URL: '',
    });
  });

  it('rejects an invalid NODE_ENV', () => {
    const { error } = validate({ NODE_ENV: 'staging' });

    expect(error).toBeDefined();
  });

  it('still requires a PostgreSQL URL when the database is enabled', () => {
    const { error } = validate({
      DATABASE_ENABLED: 'true',
      DATABASE_URL: 'https://example.test/database',
    });

    expect(error).toBeDefined();
  });

  it('rejects production Telegram auth without required values', () => {
    const { error } = validate({
      NODE_ENV: 'production',
      TELEGRAM_AUTH_ENABLED: 'true',
    });

    expect(error).toBeDefined();
    expect(error?.details.map((detail) => detail.path[0])).toEqual(
      expect.arrayContaining([
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_INIT_DATA_MAX_AGE_SECONDS',
      ]),
    );
  });

  it('accepts explicitly enabled test authentication with safe values', () => {
    const { error } = validate({
      NODE_ENV: 'test',
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'obviously-fake-test-token',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeUndefined();
  });

  it.each(['test', 'production'])(
    'keeps Telegram authentication disabled by default in %s',
    (nodeEnvironment) => {
      const { error, value } = validate({ NODE_ENV: nodeEnvironment });

      expect(error).toBeUndefined();
      expect(value.TELEGRAM_AUTH_ENABLED).toBe(false);
    },
  );
});
