import { ConfigService } from '@nestjs/config';

export const RESERVATION_SNAPSHOT_CONFIG_KEYS = Object.freeze({
  masterKeyBase64: 'RESERVATION_SNAPSHOT_MASTER_KEY_BASE64',
  keyVersion: 'RESERVATION_SNAPSHOT_KEY_VERSION',
} as const);

export type ReservationSnapshotConfiguration = Readonly<{
  masterKey: Buffer;
  keyVersion: number;
}>;

export function readReservationSnapshotConfiguration(
  config: ConfigService,
): ReservationSnapshotConfiguration {
  const encoded = config.getOrThrow<string>(
    RESERVATION_SNAPSHOT_CONFIG_KEYS.masterKeyBase64,
  );
  const keyVersion = config.getOrThrow<number>(
    RESERVATION_SNAPSHOT_CONFIG_KEYS.keyVersion,
  );
  const masterKey = Buffer.from(encoded, 'base64');
  if (
    masterKey.length !== 32 ||
    masterKey.toString('base64') !== encoded ||
    !Number.isSafeInteger(keyVersion) ||
    keyVersion < 1
  ) {
    masterKey.fill(0);
    throw new Error('Invalid reservation snapshot configuration');
  }
  return Object.freeze({ masterKey, keyVersion });
}
