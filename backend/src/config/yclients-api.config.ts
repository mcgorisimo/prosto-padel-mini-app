import { ConfigService } from '@nestjs/config';

export const YCLIENTS_API_DEFAULT_BASE_URL = 'https://api.yclients.com';
export const YCLIENTS_API_REQUEST_TIMEOUT_MILLISECONDS = 10_000;

export const YCLIENTS_API_CONFIG_KEYS = Object.freeze({
  enabled: 'YCLIENTS_API_ENABLED',
  bookingWriteEnabled: 'YCLIENTS_BOOKING_WRITE_ENABLED',
  baseUrl: 'YCLIENTS_API_BASE_URL',
  companyId: 'YCLIENTS_COMPANY_ID',
  partnerToken: 'YCLIENTS_PARTNER_TOKEN',
  userToken: 'YCLIENTS_USER_TOKEN',
} as const);

export type YclientsApiConfiguration = Readonly<{
  enabled: boolean;
  bookingWriteEnabled: boolean;
  baseUrl: string;
  companyId: number | undefined;
  partnerToken: string;
  userToken: string;
}>;

export function normalizeYclientsHttpsBaseUrl(
  value: string,
): string | undefined {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return undefined;
    }
    const pathname = parsed.pathname.replace(/\/+$/u, '');
    return `${parsed.origin}${pathname}`;
  } catch {
    return undefined;
  }
}

export function readYclientsApiConfiguration(
  config: ConfigService,
): YclientsApiConfiguration {
  const enabled =
    config.get<boolean>(YCLIENTS_API_CONFIG_KEYS.enabled) === true;
  const bookingWriteEnabled =
    config.get<boolean>(YCLIENTS_API_CONFIG_KEYS.bookingWriteEnabled) === true;
  const baseUrl =
    normalizeYclientsHttpsBaseUrl(
      config.get<string>(YCLIENTS_API_CONFIG_KEYS.baseUrl) ??
        YCLIENTS_API_DEFAULT_BASE_URL,
    ) ?? '';
  const companyId = config.get<number>(YCLIENTS_API_CONFIG_KEYS.companyId);

  if (!enabled) {
    if (bookingWriteEnabled) {
      throw new Error('Invalid YCLIENTS API configuration');
    }
    return Object.freeze({
      enabled: false,
      bookingWriteEnabled: false,
      baseUrl,
      companyId:
        Number.isSafeInteger(companyId) && (companyId ?? 0) > 0
          ? companyId
          : undefined,
      partnerToken: '',
      userToken: '',
    });
  }

  if (baseUrl.length === 0) {
    throw new Error('Invalid YCLIENTS API configuration');
  }

  return Object.freeze({
    enabled: true,
    bookingWriteEnabled,
    baseUrl,
    companyId: config.getOrThrow<number>(YCLIENTS_API_CONFIG_KEYS.companyId),
    partnerToken: config.getOrThrow<string>(
      YCLIENTS_API_CONFIG_KEYS.partnerToken,
    ),
    userToken: config.getOrThrow<string>(YCLIENTS_API_CONFIG_KEYS.userToken),
  });
}
