import { ConfigService } from '@nestjs/config';
import {
  YCLIENTS_API_CONFIG_KEYS,
  YCLIENTS_API_DEFAULT_BASE_URL,
  normalizeYclientsHttpsBaseUrl,
  readYclientsApiConfiguration,
} from './yclients-api.config';

describe('YCLIENTS API configuration', () => {
  it.each([
    ['https://api.yclients.com', 'https://api.yclients.com'],
    ['https://api.example.test/base///', 'https://api.example.test/base'],
  ])('normalizes safe HTTPS base URL %s', (value, expected) => {
    expect(normalizeYclientsHttpsBaseUrl(value)).toBe(expected);
  });

  it.each([
    'http://api.yclients.com',
    'https://user:password@api.yclients.com',
    'https://api.yclients.com?token=secret',
    'https://api.yclients.com/#fragment',
  ])('rejects unsafe base URL %s', (value) => {
    expect(normalizeYclientsHttpsBaseUrl(value)).toBeUndefined();
  });

  it('keeps requests disabled and does not retain tokens in the runtime client configuration', () => {
    const runtime = readYclientsApiConfiguration(
      new ConfigService({
        [YCLIENTS_API_CONFIG_KEYS.enabled]: false,
        [YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]: false,
        [YCLIENTS_API_CONFIG_KEYS.companyId]: 2079564,
        [YCLIENTS_API_CONFIG_KEYS.partnerToken]: 'private-partner-token',
        [YCLIENTS_API_CONFIG_KEYS.userToken]: 'private-user-token',
      }),
    );

    expect(runtime).toEqual({
      enabled: false,
      bookingWriteEnabled: false,
      baseUrl: YCLIENTS_API_DEFAULT_BASE_URL,
      companyId: 2079564,
      partnerToken: '',
      userToken: '',
    });
  });

  it('reads the complete enabled configuration', () => {
    const runtime = readYclientsApiConfiguration(
      new ConfigService({
        [YCLIENTS_API_CONFIG_KEYS.enabled]: true,
        [YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]: true,
        [YCLIENTS_API_CONFIG_KEYS.baseUrl]: 'https://api.example.test/base',
        [YCLIENTS_API_CONFIG_KEYS.companyId]: 2079564,
        [YCLIENTS_API_CONFIG_KEYS.partnerToken]: 'partner-token-value',
        [YCLIENTS_API_CONFIG_KEYS.userToken]: 'user-token-value',
      }),
    );

    expect(runtime).toEqual({
      enabled: true,
      bookingWriteEnabled: true,
      baseUrl: 'https://api.example.test/base',
      companyId: 2079564,
      partnerToken: 'partner-token-value',
      userToken: 'user-token-value',
    });
  });

  it('fails closed when an enabled configuration is incomplete', () => {
    expect(() =>
      readYclientsApiConfiguration(
        new ConfigService({
          [YCLIENTS_API_CONFIG_KEYS.enabled]: true,
          [YCLIENTS_API_CONFIG_KEYS.baseUrl]: YCLIENTS_API_DEFAULT_BASE_URL,
          [YCLIENTS_API_CONFIG_KEYS.companyId]: 2079564,
          [YCLIENTS_API_CONFIG_KEYS.partnerToken]: 'partner-token-value',
        }),
      ),
    ).toThrow();
  });

  it('fails closed when booking writes are enabled without the API', () => {
    expect(() =>
      readYclientsApiConfiguration(
        new ConfigService({
          [YCLIENTS_API_CONFIG_KEYS.enabled]: false,
          [YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled]: true,
        }),
      ),
    ).toThrow('Invalid YCLIENTS API configuration');
  });
});
