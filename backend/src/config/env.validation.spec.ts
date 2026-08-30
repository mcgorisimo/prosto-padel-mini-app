import { envValidationSchema } from './env.validation';
import {
  TELEGRAM_AUTH_OPERATION_TTL_SECONDS,
  TELEGRAM_LOGIN_CONFIG_KEYS,
  TELEGRAM_LOOKUP_DIGEST_VERSION,
  TELEGRAM_LOOKUP_PEPPER_VERSION,
  TELEGRAM_SESSION_TTL_SECONDS,
} from './telegram-login.config';
import { TELEGRAM_NOTIFICATION_CONFIG_KEYS } from './telegram-notification.config';
import { MATCH_WAITLIST_OFFER_CONFIG_KEYS } from './match-waitlist-offer.config';
import { YCLIENTS_WEBHOOK_CONFIG_KEYS } from './yclients-webhook.config';
import {
  YCLIENTS_API_CONFIG_KEYS,
  YCLIENTS_API_DEFAULT_BASE_URL,
} from './yclients-api.config';
import { RESERVATION_SNAPSHOT_CONFIG_KEYS } from './reservation-snapshot.config';
import { PLAYER_ONBOARDING_POLICY_CONFIG_KEYS } from './player-onboarding-policy.config';

const SAFE_TEST_TELEGRAM_CRYPTO_CONFIG = Object.freeze({
  [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]: Buffer.alloc(
    32,
    0x11,
  ).toString('base64'),
  [TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64]: Buffer.alloc(
    32,
    0x22,
  ).toString('base64'),
  [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]:
    '12345678-1234-5678-9234-567812345678',
});
const SAFE_TEST_DATABASE_CONFIG = Object.freeze({
  DATABASE_ENABLED: 'true',
  DATABASE_URL: 'postgresql://test-only.invalid/prosto_padel',
});
const SAFE_TEST_BOT_TOKEN = '123456789:AA_TEST_ONLY_FAKE_TELEGRAM_BOT_TOKEN';
const SAFE_TEST_YCLIENTS_CONFIG = Object.freeze({
  [YCLIENTS_API_CONFIG_KEYS.companyId]: '2079564',
  [YCLIENTS_API_CONFIG_KEYS.partnerToken]: 'synthetic-partner-token',
  [YCLIENTS_API_CONFIG_KEYS.userToken]: 'synthetic-user-token',
  [RESERVATION_SNAPSHOT_CONFIG_KEYS.masterKeyBase64]: Buffer.alloc(
    32,
    0x5a,
  ).toString('base64'),
});

function validate(environment: Record<string, unknown> = {}) {
  return envValidationSchema.validate(environment, {
    abortEarly: false,
    allowUnknown: true,
  });
}

describe('envValidationSchema', () => {
  it('keeps the onboarding legal policy disabled and empty by default', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled]: false,
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion]: '',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion]: '',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.cancellationVersion]: '',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.personalDataProcessingVersion]: '',
    });
  });

  it('requires exact canonical versions and PostgreSQL for an enabled onboarding policy', () => {
    const withoutDatabase = validate({
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled]: 'true',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion]:
        'terms-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion]:
        'privacy-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.cancellationVersion]:
        'cancellation-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.personalDataProcessingVersion]:
        'personal-data-consent-test-2026-08-23-v1',
    });
    expect(withoutDatabase.error?.message).toContain(
      'requires DATABASE_ENABLED',
    );

    const missingVersion = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled]: 'true',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion]:
        'terms-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion]:
        'privacy-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.personalDataProcessingVersion]:
        'personal-data-consent-test-2026-08-23-v1',
    });
    expect(missingVersion.error).toBeDefined();

    const invalidVersion = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled]: 'true',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion]: 'Terms test version',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion]:
        'privacy-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.cancellationVersion]:
        'cancellation-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.personalDataProcessingVersion]:
        'personal-data-consent-test-2026-08-23-v1',
    });
    expect(invalidVersion.error).toBeDefined();

    const enabled = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled]: 'true',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion]:
        'terms-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion]:
        'privacy-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.cancellationVersion]:
        'cancellation-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.personalDataProcessingVersion]:
        'personal-data-consent-test-2026-08-23-v1',
    });
    expect(enabled.error).toBeUndefined();
    expect(enabled.value).toMatchObject({
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled]: true,
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion]:
        'terms-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion]:
        'privacy-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.cancellationVersion]:
        'cancellation-test-2026-08-23-v1',
      [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.personalDataProcessingVersion]:
        'personal-data-consent-test-2026-08-23-v1',
    });
  });

  it('disables YCLIENTS API and booking writes by default', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value[YCLIENTS_API_CONFIG_KEYS.enabled]).toBe(false);
    expect(value[YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]).toBe(false);
    expect(value[YCLIENTS_API_CONFIG_KEYS.baseUrl]).toBe(
      YCLIENTS_API_DEFAULT_BASE_URL,
    );
  });

  it('allows booking writes only when the YCLIENTS API is enabled', () => {
    const apiDisabled = validate({
      [YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]: 'true',
    });
    const apiEnabled = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_YCLIENTS_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
      [YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]: 'true',
    });

    expect(apiDisabled.error).toBeDefined();
    expect(apiEnabled.error).toBeUndefined();
    expect(apiEnabled.value[YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]).toBe(
      true,
    );
  });

  it('requires an exact canonical 32-byte reservation snapshot key for writes', () => {
    const common = {
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_YCLIENTS_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
      [YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]: 'true',
    };
    expect(
      validate({
        ...common,
        [RESERVATION_SNAPSHOT_CONFIG_KEYS.masterKeyBase64]: Buffer.alloc(
          31,
          1,
        ).toString('base64'),
      }).error,
    ).toBeDefined();
    expect(
      validate({
        ...common,
        [RESERVATION_SNAPSHOT_CONFIG_KEYS.masterKeyBase64]: Buffer.alloc(
          33,
          1,
        ).toString('base64'),
      }).error,
    ).toBeDefined();
  });

  it('keeps read/decrypt configured when booking writes are disabled and rejects rotation without a keyring', () => {
    const enabledRead = {
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_YCLIENTS_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
      [YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]: 'false',
    };
    expect(validate(enabledRead).error).toBeUndefined();
    expect(
      validate({
        ...enabledRead,
        [RESERVATION_SNAPSHOT_CONFIG_KEYS.masterKeyBase64]: '',
      }).error,
    ).toBeDefined();
    expect(
      validate({
        ...enabledRead,
        [RESERVATION_SNAPSHOT_CONFIG_KEYS.keyVersion]: '2',
      }).error,
    ).toBeDefined();
  });

  it('requires the database, company and both tokens for the enabled YCLIENTS API', () => {
    const missingDatabase = validate({
      ...SAFE_TEST_YCLIENTS_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
    });
    const missingCompany = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
      [YCLIENTS_API_CONFIG_KEYS.partnerToken]: 'synthetic-partner-token',
      [YCLIENTS_API_CONFIG_KEYS.userToken]: 'synthetic-user-token',
    });
    const missingPartnerToken = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_YCLIENTS_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
      [YCLIENTS_API_CONFIG_KEYS.partnerToken]: '',
    });
    const missingUserToken = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_YCLIENTS_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
      [YCLIENTS_API_CONFIG_KEYS.userToken]: '',
    });
    const valid = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_YCLIENTS_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
    });

    expect(missingDatabase.error).toBeDefined();
    expect(missingCompany.error).toBeDefined();
    expect(missingPartnerToken.error).toBeDefined();
    expect(missingUserToken.error).toBeDefined();
    expect(valid.error).toBeUndefined();
    expect(valid.value[YCLIENTS_API_CONFIG_KEYS.companyId]).toBe(2079564);
  });

  it.each([
    'http://api.yclients.com',
    'https://user:password@api.yclients.com',
    'https://api.yclients.com?secret=value',
    'https://api.yclients.com/#fragment',
  ])('rejects unsafe YCLIENTS API base URL %s', (baseUrl) => {
    const { error } = validate({
      [YCLIENTS_API_CONFIG_KEYS.baseUrl]: baseUrl,
    });

    expect(error).toBeDefined();
  });

  it.each(['too-short', 'token with spaces', 'token\nwith-newline'])(
    'rejects unsafe YCLIENTS tokens when API is enabled',
    (token) => {
      const { error } = validate({
        ...SAFE_TEST_DATABASE_CONFIG,
        ...SAFE_TEST_YCLIENTS_CONFIG,
        [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
        [YCLIENTS_API_CONFIG_KEYS.partnerToken]: token,
      });

      expect(error).toBeDefined();
    },
  );

  it('disables the YCLIENTS webhook by default', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value[YCLIENTS_WEBHOOK_CONFIG_KEYS.enabled]).toBe(false);
  });

  it('requires a database and safe company ID for an enabled YCLIENTS webhook', () => {
    const missingDatabase = validate({
      [YCLIENTS_WEBHOOK_CONFIG_KEYS.enabled]: 'true',
      [YCLIENTS_WEBHOOK_CONFIG_KEYS.companyId]: '123',
    });
    const missingCompany = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      [YCLIENTS_WEBHOOK_CONFIG_KEYS.enabled]: 'true',
    });
    const valid = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      [YCLIENTS_WEBHOOK_CONFIG_KEYS.enabled]: 'true',
      [YCLIENTS_WEBHOOK_CONFIG_KEYS.companyId]: '123',
    });

    expect(missingDatabase.error).toBeDefined();
    expect(missingCompany.error).toBeDefined();
    expect(valid.error).toBeUndefined();
    expect(valid.value[YCLIENTS_WEBHOOK_CONFIG_KEYS.companyId]).toBe(123);
  });

  it.each(['0', '-1', '1.5', '9007199254740992', 'not-a-number'])(
    'rejects invalid YCLIENTS company ID %s when enabled',
    (companyId) => {
      const { error } = validate({
        ...SAFE_TEST_DATABASE_CONFIG,
        [YCLIENTS_WEBHOOK_CONFIG_KEYS.enabled]: 'true',
        [YCLIENTS_WEBHOOK_CONFIG_KEYS.companyId]: companyId,
      });

      expect(error).toBeDefined();
    },
  );

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
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
    });

    expect(error).toBeUndefined();
    expect(value.TELEGRAM_AUTH_ENABLED).toBe(false);
  });

  it('rejects a missing token when enabled', () => {
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeDefined();
  });

  it('rejects an empty token when enabled', () => {
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeDefined();
  });

  it('rejects a whitespace-only token when enabled', () => {
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '   ',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeDefined();
  });

  it('accepts a syntactically valid fake test token when enabled', () => {
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeUndefined();
  });

  it('rejects a missing max age when enabled', () => {
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
    });

    expect(error).toBeDefined();
  });

  it('accepts a positive integer max age', () => {
    const { error, value } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeUndefined();
    expect(value.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS).toBe(300);
  });

  it('accepts the maximum Telegram init data age', () => {
    const { error, value } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '86400',
    });

    expect(error).toBeUndefined();
    expect(value.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS).toBe(86400);
  });

  it('rejects a Telegram init data age above the maximum', () => {
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '86401',
    });

    expect(error).toBeDefined();
  });

  it.each(['0', '-1', '1.5', 'not-a-number'])(
    'rejects invalid max age %s',
    (maxAge) => {
      const { error } = validate({
        ...SAFE_TEST_DATABASE_CONFIG,
        TELEGRAM_AUTH_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
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
      APP_RELEASE_SHA_REQUIRED: false,
      APP_RELEASE: 'local',
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

  it('accepts only a local marker or an exact lowercase commit as APP_RELEASE', () => {
    const exactCommit = '0123456789abcdef0123456789abcdef01234567';

    expect(validate({ APP_RELEASE: exactCommit }).error).toBeUndefined();
    expect(validate({ APP_RELEASE: exactCommit }).value.APP_RELEASE).toBe(
      exactCommit,
    );
    expect(validate({ APP_RELEASE: '85e8768' }).error).toBeDefined();
    expect(
      validate({ APP_RELEASE: exactCommit.toUpperCase() }).error,
    ).toBeDefined();
    expect(
      validate({ APP_RELEASE: 'release-secret marker' }).error,
    ).toBeDefined();
  });

  it('requires an exact commit when the runtime release gate is enabled', () => {
    const exactCommit = '0123456789abcdef0123456789abcdef01234567';

    expect(
      validate({
        APP_RELEASE_SHA_REQUIRED: 'true',
        APP_RELEASE: exactCommit,
      }).error,
    ).toBeUndefined();
    expect(
      validate({
        APP_RELEASE_SHA_REQUIRED: 'true',
        APP_RELEASE: 'local',
      }).error,
    ).toBeDefined();
    expect(validate({ APP_RELEASE_SHA_REQUIRED: 'true' }).error).toBeDefined();
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
      ...SAFE_TEST_DATABASE_CONFIG,
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
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      NODE_ENV: 'test',
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeUndefined();
  });

  it('keeps crypto secrets optional and fixed public values available when disabled', () => {
    const { error, value } = validate({ TELEGRAM_AUTH_ENABLED: 'false' });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]: '',
      [TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64]: '',
      [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]: '',
      [TELEGRAM_LOGIN_CONFIG_KEYS.digestVersion]:
        TELEGRAM_LOOKUP_DIGEST_VERSION,
      [TELEGRAM_LOGIN_CONFIG_KEYS.pepperVersion]:
        TELEGRAM_LOOKUP_PEPPER_VERSION,
      [TELEGRAM_LOGIN_CONFIG_KEYS.operationTtlSeconds]:
        TELEGRAM_AUTH_OPERATION_TTL_SECONDS,
      [TELEGRAM_LOGIN_CONFIG_KEYS.sessionTtlSeconds]:
        TELEGRAM_SESSION_TTL_SECONDS,
    });
  });

  it('rejects Telegram authentication when PostgreSQL is disabled', () => {
    const { error } = validate({
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      DATABASE_ENABLED: 'false',
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error?.message).toBe(
      'TELEGRAM_AUTH_ENABLED requires DATABASE_ENABLED to be enabled',
    );
    expect(error?.message).not.toContain(
      SAFE_TEST_TELEGRAM_CRYPTO_CONFIG[
        TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64
      ],
    );
    expect(error?.message).not.toContain(
      SAFE_TEST_TELEGRAM_CRYPTO_CONFIG[
        TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64
      ],
    );
  });

  it('allows PostgreSQL with Telegram authentication disabled and no Telegram secrets', () => {
    const { error, value } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'false',
    });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      DATABASE_ENABLED: true,
      TELEGRAM_AUTH_ENABLED: false,
      [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]: '',
      [TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64]: '',
      [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]: '',
    });
  });

  it('accepts the complete enabled Telegram workflow configuration', () => {
    const { error, value } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      [TELEGRAM_LOGIN_CONFIG_KEYS.digestVersion]: 1,
      [TELEGRAM_LOGIN_CONFIG_KEYS.pepperVersion]: 1,
      [TELEGRAM_LOGIN_CONFIG_KEYS.operationTtlSeconds]: 300,
      [TELEGRAM_LOGIN_CONFIG_KEYS.sessionTtlSeconds]: 2_592_000,
    });
  });

  it('keeps outbound Telegram notifications disabled by default', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value[TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]).toBe(false);
    expect(value[TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]).toBe('');
    expect(
      value[
        TELEGRAM_NOTIFICATION_CONFIG_KEYS.yclientsReadReconciliationEnabled
      ],
    ).toBe(false);
    expect(value[MATCH_WAITLIST_OFFER_CONFIG_KEYS.enabled]).toBe(false);
  });

  it('keeps waitlist offers fail-closed until outbound Telegram is enabled', () => {
    const disabledOutbound = validate({
      [MATCH_WAITLIST_OFFER_CONFIG_KEYS.enabled]: 'true',
    });
    expect(disabledOutbound.error?.message).toContain(
      'MATCH_WAITLIST_OFFERS_ENABLED requires TELEGRAM_OUTBOUND_NOTIFICATIONS_ENABLED',
    );

    const { error, value } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: 'true',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
        'https://app.prostopdl.ru/',
      [MATCH_WAITLIST_OFFER_CONFIG_KEYS.enabled]: 'true',
    });
    expect(error).toBeUndefined();
    expect(value[MATCH_WAITLIST_OFFER_CONFIG_KEYS.enabled]).toBe(true);
  });

  it('requires Telegram auth and an HTTPS Mini App URL for outbound notifications', () => {
    const disabledAuth = validate({
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: 'true',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
        'https://app.prostopdl.ru/',
    });
    expect(disabledAuth.error?.message).toContain(
      'requires TELEGRAM_AUTH_ENABLED',
    );

    const insecureUrl = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: 'true',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
        'http://app.prostopdl.ru/',
    });
    expect(insecureUrl.error).toBeDefined();

    const querySecret = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: 'true',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
        'https://app.prostopdl.ru/?token=must-not-leave-runtime',
    });
    expect(querySecret.error).toBeDefined();
  });

  it('accepts explicitly enabled outbound Telegram notifications', () => {
    const { error, value } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: 'true',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
        'https://app.prostopdl.ru/',
    });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: true,
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
        'https://app.prostopdl.ru',
    });
  });

  it('requires YCLIENTS reads and outbound Telegram for notification reconciliation', () => {
    const missingYclients = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: 'true',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
        'https://app.prostopdl.ru/',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.yclientsReadReconciliationEnabled]:
        'true',
    });
    const missingTelegram = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_YCLIENTS_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.yclientsReadReconciliationEnabled]:
        'true',
    });

    expect(missingYclients.error?.message).toContain(
      'requires YCLIENTS_API_ENABLED',
    );
    expect(missingTelegram.error?.message).toContain(
      'requires TELEGRAM_OUTBOUND_NOTIFICATIONS_ENABLED',
    );
  });

  it('accepts explicitly enabled bounded YCLIENTS notification reconciliation', () => {
    const { error, value } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_YCLIENTS_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      [YCLIENTS_API_CONFIG_KEYS.enabled]: 'true',
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: 'true',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
        'https://app.prostopdl.ru/',
      [TELEGRAM_NOTIFICATION_CONFIG_KEYS.yclientsReadReconciliationEnabled]:
        'true',
    });

    expect(error).toBeUndefined();
    expect(
      value[
        TELEGRAM_NOTIFICATION_CONFIG_KEYS.yclientsReadReconciliationEnabled
      ],
    ).toBe(true);
  });

  it('requires both crypto secrets and UUID namespace when enabled', () => {
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    });

    expect(error?.details.map((detail) => detail.path[0])).toEqual(
      expect.arrayContaining([
        TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64,
        TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64,
        TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace,
      ]),
    );
  });

  it('rejects a short secret without including its value in the message', () => {
    const secretMarker = 'short-secret-marker';
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]:
        Buffer.from(secretMarker).toString('base64'),
    });

    expect(error).toBeDefined();
    expect(error?.message).not.toContain(secretMarker);
    expect(error?.message).not.toContain(
      Buffer.from(secretMarker).toString('base64'),
    );
  });

  it('rejects non-canonical UUID namespace and unsupported fixed values', () => {
    const { error } = validate({
      ...SAFE_TEST_DATABASE_CONFIG,
      ...SAFE_TEST_TELEGRAM_CRYPTO_CONFIG,
      TELEGRAM_AUTH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: SAFE_TEST_BOT_TOKEN,
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]:
        '12345678-1234-5678-9234-56781234567Z',
      [TELEGRAM_LOGIN_CONFIG_KEYS.digestVersion]: '2',
      [TELEGRAM_LOGIN_CONFIG_KEYS.operationTtlSeconds]: '301',
    });

    expect(error).toBeDefined();
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
