import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { AccountId } from '../accounts/account.types';
import { ReservationOperationId } from './reservation.types';

const ALGORITHM = 'aes_256_gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const AAD_VERSION = 1;

export type EncryptedReservationValue = Readonly<{
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  algorithm: typeof ALGORITHM;
  keyVersion: number;
  digest: Buffer;
  digestKeyVersion: number;
}>;

export type EncryptedReservationClientSnapshot = Readonly<{
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  algorithm: typeof ALGORITHM;
  wrappedDataKeyCiphertext: Buffer;
  wrappedDataKeyNonce: Buffer;
  wrappedDataKeyAuthTag: Buffer;
  wrappingAlgorithm: typeof ALGORITHM;
  wrappingKeyVersion: number;
  digest: Buffer;
  digestKeyVersion: number;
  aadVersion: typeof AAD_VERSION;
}>;

function derive(masterKey: Buffer, info: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      masterKey,
      Buffer.from('prosto-padel.reservation.crypto.v1', 'utf8'),
      Buffer.from(info, 'utf8'),
      32,
    ),
  );
}

function aad(operationId: ReservationOperationId, ownerAccountId: AccountId) {
  return Buffer.from(
    `reservation-client-snapshot:v${AAD_VERSION}:${operationId}:${ownerAccountId}`,
    'utf8',
  );
}

function encryptAes(value: Buffer, key: Buffer, associatedData: Buffer) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Object.freeze({ ciphertext, nonce, authTag: cipher.getAuthTag() });
}

function decryptAes(
  ciphertext: Buffer,
  nonce: Buffer,
  authTag: Buffer,
  key: Buffer,
  associatedData: Buffer,
): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(associatedData);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export class ReservationSnapshotCrypto {
  private readonly wrappingKey: Buffer;
  private readonly digestKey: Buffer;
  private readonly recordKey: Buffer;
  private readonly recordDigestKey: Buffer;

  constructor(
    masterKey: Buffer,
    readonly keyVersion: number,
    private readonly enabled = true,
  ) {
    if (masterKey.length !== 32 || !Number.isSafeInteger(keyVersion) || keyVersion < 1) {
      throw new TypeError('Invalid reservation crypto configuration');
    }
    this.wrappingKey = derive(masterKey, 'client-snapshot-wrapping');
    this.digestKey = derive(masterKey, 'client-snapshot-digest');
    this.recordKey = derive(masterKey, 'provider-record-hash');
    this.recordDigestKey = derive(masterKey, 'provider-record-hash-digest');
  }

  static disabled(): ReservationSnapshotCrypto {
    return new ReservationSnapshotCrypto(Buffer.alloc(32), 1, false);
  }

  private requireEnabled(): void {
    if (!this.enabled) throw new Error('Reservation snapshot crypto is disabled');
  }

  encryptClientSnapshot(
    operationId: ReservationOperationId,
    ownerAccountId: AccountId,
    canonicalJson: string,
  ): EncryptedReservationClientSnapshot {
    this.requireEnabled();
    const associatedData = aad(operationId, ownerAccountId);
    const dataKey = randomBytes(32);
    try {
      const encrypted = encryptAes(Buffer.from(canonicalJson, 'utf8'), dataKey, associatedData);
      const wrapped = encryptAes(dataKey, this.wrappingKey, associatedData);
      return Object.freeze({
        ...encrypted,
        algorithm: ALGORITHM,
        wrappedDataKeyCiphertext: wrapped.ciphertext,
        wrappedDataKeyNonce: wrapped.nonce,
        wrappedDataKeyAuthTag: wrapped.authTag,
        wrappingAlgorithm: ALGORITHM,
        wrappingKeyVersion: this.keyVersion,
        digest: createHmac('sha256', this.digestKey).update(canonicalJson).digest(),
        digestKeyVersion: this.keyVersion,
        aadVersion: AAD_VERSION,
      });
    } finally {
      dataKey.fill(0);
    }
  }

  decryptClientSnapshot(
    operationId: ReservationOperationId,
    ownerAccountId: AccountId,
    value: EncryptedReservationClientSnapshot,
  ): string {
    this.requireEnabled();
    if (
      value.algorithm !== ALGORITHM ||
      value.wrappingAlgorithm !== ALGORITHM ||
      value.wrappingKeyVersion !== this.keyVersion ||
      value.digestKeyVersion !== this.keyVersion ||
      value.aadVersion !== AAD_VERSION
    ) {
      throw new TypeError('Invalid reservation snapshot metadata');
    }
    const associatedData = aad(operationId, ownerAccountId);
    const dataKey = decryptAes(
      value.wrappedDataKeyCiphertext,
      value.wrappedDataKeyNonce,
      value.wrappedDataKeyAuthTag,
      this.wrappingKey,
      associatedData,
    );
    try {
      const plaintext = decryptAes(
        value.ciphertext,
        value.nonce,
        value.authTag,
        dataKey,
        associatedData,
      );
      const expected = createHmac('sha256', this.digestKey).update(plaintext).digest();
      if (expected.length !== value.digest.length || !timingSafeEqual(expected, value.digest)) {
        throw new TypeError('Invalid reservation snapshot digest');
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    } finally {
      dataKey.fill(0);
    }
  }

  encryptRecordHash(recordHash: string): EncryptedReservationValue {
    this.requireEnabled();
    const associatedData = Buffer.from('provider-record-hash:v1', 'utf8');
    const encrypted = encryptAes(Buffer.from(recordHash, 'utf8'), this.recordKey, associatedData);
    return Object.freeze({
      ...encrypted,
      algorithm: ALGORITHM,
      keyVersion: this.keyVersion,
      digest: createHmac('sha256', this.recordDigestKey).update(recordHash).digest(),
      digestKeyVersion: this.keyVersion,
    });
  }

  decryptRecordHash(value: EncryptedReservationValue): string {
    this.requireEnabled();
    if (
      value.algorithm !== ALGORITHM ||
      value.keyVersion !== this.keyVersion ||
      value.digestKeyVersion !== this.keyVersion
    ) {
      throw new TypeError('Invalid provider record metadata');
    }
    const plaintext = decryptAes(
      value.ciphertext,
      value.nonce,
      value.authTag,
      this.recordKey,
      Buffer.from('provider-record-hash:v1', 'utf8'),
    );
    const expected = createHmac('sha256', this.recordDigestKey).update(plaintext).digest();
    if (expected.length !== value.digest.length || !timingSafeEqual(expected, value.digest)) {
      throw new TypeError('Invalid provider record digest');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  }
}
