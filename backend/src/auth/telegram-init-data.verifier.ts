import { createHmac, timingSafeEqual } from 'node:crypto';
import { VerifiedTelegramIdentity } from './auth.types';

const MAX_RAW_INIT_DATA_BYTES = 16 * 1024;
const MAX_PARAMETER_COUNT = 64;
const MAX_PARAMETER_NAME_LENGTH = 64;
const MAX_PARAMETER_VALUE_BYTES = 8 * 1024;
const MAX_TELEGRAM_USER_ID = 2 ** 52 - 1;
const MAX_NAME_CODE_POINTS = 256;
const MAX_SHORT_TEXT_CODE_POINTS = 64;
const MAX_PHOTO_URL_CODE_POINTS = 2048;
const FUTURE_CLOCK_SKEW_SECONDS = 30;
const SAFE_ERROR_MESSAGE = 'Telegram authentication data is invalid';

const PARAMETER_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const HASH_PATTERN = /^[0-9a-fA-F]{64}$/;
const POSITIVE_DECIMAL_PATTERN = /^[0-9]+$/;

export type TelegramInitDataVerifierSettings =
  | {
      readonly enabled: false;
    }
  | {
      readonly enabled: true;
      readonly botToken: string;
      readonly maxAgeSeconds: number;
    };

export type TelegramInitDataClock = () => Date;

export class TelegramInitDataVerificationError extends Error {
  constructor() {
    super(SAFE_ERROR_MESSAGE);
    this.name = 'TelegramInitDataVerificationError';
  }
}

type TelegramUserData = Record<string, unknown>;

function failVerification(): never {
  throw new TelegramInitDataVerificationError();
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function decodeFormComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return failVerification();
  }
}

function parseInitData(rawInitData: string): Map<string, string> {
  if (
    typeof rawInitData !== 'string' ||
    rawInitData.length === 0 ||
    utf8ByteLength(rawInitData) > MAX_RAW_INIT_DATA_BYTES
  ) {
    return failVerification();
  }

  const segments = rawInitData.split('&');
  if (segments.length > MAX_PARAMETER_COUNT) {
    return failVerification();
  }

  const parameters = new Map<string, string>();

  for (const segment of segments) {
    if (segment.length === 0) {
      return failVerification();
    }

    const separatorIndex = segment.indexOf('=');
    if (separatorIndex <= 0) {
      return failVerification();
    }

    const name = decodeFormComponent(segment.slice(0, separatorIndex));
    const value = decodeFormComponent(segment.slice(separatorIndex + 1));

    if (
      name.length === 0 ||
      name.length > MAX_PARAMETER_NAME_LENGTH ||
      !PARAMETER_NAME_PATTERN.test(name) ||
      utf8ByteLength(value) > MAX_PARAMETER_VALUE_BYTES ||
      parameters.has(name)
    ) {
      return failVerification();
    }

    parameters.set(name, value);
  }

  return parameters;
}

function compareParameterNames(left: [string, string], right: [string, string]): number {
  if (left[0] < right[0]) {
    return -1;
  }
  if (left[0] > right[0]) {
    return 1;
  }
  return 0;
}

function verifyHash(
  parameters: ReadonlyMap<string, string>,
  botToken: string,
): void {
  const receivedHash = parameters.get('hash');
  if (receivedHash === undefined || !HASH_PATTERN.test(receivedHash)) {
    return failVerification();
  }

  const dataCheckString = [...parameters.entries()]
    .filter(([name]) => name !== 'hash')
    .sort(compareParameterNames)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken, 'utf8')
    .digest();
  const expectedHash = createHmac('sha256', secretKey)
    .update(dataCheckString, 'utf8')
    .digest();
  const receivedHashBytes = Buffer.from(receivedHash, 'hex');

  if (
    expectedHash.length !== 32 ||
    receivedHashBytes.length !== 32 ||
    !timingSafeEqual(expectedHash, receivedHashBytes)
  ) {
    return failVerification();
  }
}

function readAuthDate(
  parameters: ReadonlyMap<string, string>,
  now: Date,
  maxAgeSeconds: number,
): { authDate: Date; verifiedAt: Date } {
  const rawAuthDate = parameters.get('auth_date');
  if (rawAuthDate === undefined || !POSITIVE_DECIMAL_PATTERN.test(rawAuthDate)) {
    return failVerification();
  }

  const authDateSeconds = Number(rawAuthDate);
  const verifiedAtMilliseconds = now.getTime();
  if (
    !Number.isSafeInteger(authDateSeconds) ||
    authDateSeconds <= 0 ||
    !Number.isFinite(verifiedAtMilliseconds)
  ) {
    return failVerification();
  }

  const verifiedAtSeconds = Math.floor(verifiedAtMilliseconds / 1000);
  if (
    authDateSeconds > verifiedAtSeconds + FUTURE_CLOCK_SKEW_SECONDS ||
    verifiedAtSeconds - authDateSeconds > maxAgeSeconds
  ) {
    return failVerification();
  }

  return {
    authDate: new Date(authDateSeconds * 1000),
    verifiedAt: new Date(verifiedAtMilliseconds),
  };
}

function parseTelegramUser(rawUser: string | undefined): TelegramUserData {
  if (rawUser === undefined || rawUser.length === 0) {
    return failVerification();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser) as unknown;
  } catch {
    return failVerification();
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    return failVerification();
  }

  return parsed as TelegramUserData;
}

function hasOwn(user: TelegramUserData, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(user, field);
}

function readRequiredString(
  user: TelegramUserData,
  field: string,
  maxCodePoints: number,
): string {
  if (!hasOwn(user, field)) {
    return failVerification();
  }

  const value = user[field];
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    [...value].length > maxCodePoints
  ) {
    return failVerification();
  }

  return value;
}

function readOptionalString(
  user: TelegramUserData,
  field: string,
  maxCodePoints: number,
): string | undefined {
  if (!hasOwn(user, field)) {
    return undefined;
  }

  return readRequiredString(user, field, maxCodePoints);
}

function readTelegramId(user: TelegramUserData): number {
  if (!hasOwn(user, 'id')) {
    return failVerification();
  }

  const id = user.id;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    id > MAX_TELEGRAM_USER_ID
  ) {
    return failVerification();
  }

  return id;
}

function readPhotoUrl(user: TelegramUserData): string | undefined {
  const photoUrl = readOptionalString(
    user,
    'photo_url',
    MAX_PHOTO_URL_CODE_POINTS,
  );
  if (photoUrl === undefined) {
    return undefined;
  }

  try {
    const parsed = new URL(photoUrl);
    if (parsed.protocol !== 'https:') {
      return failVerification();
    }
  } catch {
    return failVerification();
  }

  return photoUrl;
}

export class TelegramInitDataVerifier {
  constructor(
    private readonly settings: TelegramInitDataVerifierSettings,
    private readonly clock: TelegramInitDataClock = () => new Date(),
  ) {}

  verify(rawInitData: string): VerifiedTelegramIdentity {
    try {
      if (!this.settings.enabled) {
        return failVerification();
      }

      const parameters = parseInitData(rawInitData);
      verifyHash(parameters, this.settings.botToken);

      const now = this.clock();
      const { authDate, verifiedAt } = readAuthDate(
        parameters,
        now,
        this.settings.maxAgeSeconds,
      );
      const user = parseTelegramUser(parameters.get('user'));
      const telegramId = readTelegramId(user);
      const firstName = readRequiredString(
        user,
        'first_name',
        MAX_NAME_CODE_POINTS,
      );
      const lastName = readOptionalString(
        user,
        'last_name',
        MAX_NAME_CODE_POINTS,
      );
      const username = readOptionalString(
        user,
        'username',
        MAX_SHORT_TEXT_CODE_POINTS,
      );
      const languageCode = readOptionalString(
        user,
        'language_code',
        MAX_SHORT_TEXT_CODE_POINTS,
      );
      const photoUrl = readPhotoUrl(user);

      return {
        provider: 'telegram',
        subject: String(telegramId),
        authDate,
        verifiedAt,
        firstName,
        ...(lastName === undefined ? {} : { lastName }),
        ...(username === undefined ? {} : { username }),
        ...(languageCode === undefined ? {} : { languageCode }),
        ...(photoUrl === undefined ? {} : { photoUrl }),
      };
    } catch (error: unknown) {
      if (error instanceof TelegramInitDataVerificationError) {
        throw error;
      }
      return failVerification();
    }
  }
}
