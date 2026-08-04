import { ConfigService } from '@nestjs/config';

export const PLAYER_PROFILE_PHOTO_CONFIG_KEYS = Object.freeze({
  enabled: 'PROFILE_PHOTO_STORAGE_ENABLED',
  endpoint: 'PROFILE_PHOTO_STORAGE_ENDPOINT',
  region: 'PROFILE_PHOTO_STORAGE_REGION',
  bucket: 'PROFILE_PHOTO_STORAGE_BUCKET',
  publicBaseUrl: 'PROFILE_PHOTO_PUBLIC_BASE_URL',
  accessKeyId: 'PROFILE_PHOTO_STORAGE_ACCESS_KEY_ID',
  secretAccessKey: 'PROFILE_PHOTO_STORAGE_SECRET_ACCESS_KEY',
} as const);

export const PLAYER_PROFILE_PHOTO_MAX_UPLOAD_BYTES = 8 * 1_024 * 1_024;
export const PLAYER_PROFILE_PHOTO_MAX_INPUT_PIXELS = 40_000_000;
export const PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION = 256;
export const PLAYER_PROFILE_PHOTO_MAX_FULL_DIMENSION = 1_600;

export type PlayerProfilePhotoStorageConfiguration = Readonly<{
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  publicBaseUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

export function normalizePlayerProfilePhotoHttpsBaseUrl(
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

export function readPlayerProfilePhotoStorageConfiguration(
  config: ConfigService,
): PlayerProfilePhotoStorageConfiguration {
  const enabled =
    config.get<boolean>(PLAYER_PROFILE_PHOTO_CONFIG_KEYS.enabled) === true;
  const publicBaseUrl =
    normalizePlayerProfilePhotoHttpsBaseUrl(
      config.get<string>(PLAYER_PROFILE_PHOTO_CONFIG_KEYS.publicBaseUrl) ?? '',
    ) ?? '';
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      endpoint: '',
      region: '',
      bucket: '',
      publicBaseUrl,
      accessKeyId: '',
      secretAccessKey: '',
    });
  }

  return Object.freeze({
    enabled: true,
    endpoint: config.getOrThrow<string>(
      PLAYER_PROFILE_PHOTO_CONFIG_KEYS.endpoint,
    ),
    region: config.getOrThrow<string>(
      PLAYER_PROFILE_PHOTO_CONFIG_KEYS.region,
    ),
    bucket: config.getOrThrow<string>(
      PLAYER_PROFILE_PHOTO_CONFIG_KEYS.bucket,
    ),
    publicBaseUrl,
    accessKeyId: config.getOrThrow<string>(
      PLAYER_PROFILE_PHOTO_CONFIG_KEYS.accessKeyId,
    ),
    secretAccessKey: config.getOrThrow<string>(
      PLAYER_PROFILE_PHOTO_CONFIG_KEYS.secretAccessKey,
    ),
  });
}

export class PlayerProfilePhotoUrlResolver {
  private readonly publicBaseUrl: string;

  constructor(publicBaseUrl: string) {
    this.publicBaseUrl =
      publicBaseUrl.length === 0
        ? ''
        : (normalizePlayerProfilePhotoHttpsBaseUrl(publicBaseUrl) ?? '');
  }

  avatar(storagePrefix: string): string | undefined {
    return this.resolve(storagePrefix, 'avatar.webp');
  }

  full(storagePrefix: string): string | undefined {
    return this.resolve(storagePrefix, 'full.webp');
  }

  private resolve(
    storagePrefix: string,
    objectName: 'avatar.webp' | 'full.webp',
  ): string | undefined {
    if (this.publicBaseUrl.length === 0) {
      return undefined;
    }
    return `${this.publicBaseUrl}/${storagePrefix}/${objectName}`;
  }
}
