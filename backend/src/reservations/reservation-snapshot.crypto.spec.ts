import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { ReservationOperationId } from './reservation.types';
import { ReservationSnapshotCrypto } from './reservation-snapshot.crypto';

const OWNER = deterministicUuid('reservation-crypto-owner') as AccountId;
const OPERATION = deterministicUuid('reservation-crypto-operation') as ReservationOperationId;
const PRIVATE_MARKER = 'private-contact-marker@example.test';

describe('ReservationSnapshotCrypto', () => {
  it('round-trips an envelope-encrypted snapshot without plaintext persistence', () => {
    const crypto = new ReservationSnapshotCrypto(Buffer.alloc(32, 0x31), 7);
    const plaintext = JSON.stringify({
      phone: '+79000000000',
      fullName: 'Private Player',
      email: PRIVATE_MARKER,
    });

    const encrypted = crypto.encryptClientSnapshot(OPERATION, OWNER, plaintext);

    expect(encrypted.algorithm).toBe('aes_256_gcm');
    expect(encrypted.wrappingAlgorithm).toBe('aes_256_gcm');
    expect(encrypted.wrappingKeyVersion).toBe(7);
    expect(encrypted.digest).toHaveLength(32);
    expect(Buffer.concat([
      encrypted.ciphertext,
      encrypted.wrappedDataKeyCiphertext,
      encrypted.digest,
    ]).toString('utf8')).not.toContain(PRIVATE_MARKER);
    expect(crypto.decryptClientSnapshot(OPERATION, OWNER, encrypted)).toBe(plaintext);
  });

  it('binds ciphertext to owner and operation and fails closed after tampering', () => {
    const crypto = new ReservationSnapshotCrypto(Buffer.alloc(32, 0x32), 1);
    const encrypted = crypto.encryptClientSnapshot(OPERATION, OWNER, JSON.stringify({
      phone: '+79000000000', fullName: 'Private Player', email: PRIVATE_MARKER,
    }));

    expect(() => crypto.decryptClientSnapshot(
      deterministicUuid('other-operation') as ReservationOperationId,
      OWNER,
      encrypted,
    )).toThrow();
    const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
    tampered.ciphertext[0] ^= 1;
    expect(() => crypto.decryptClientSnapshot(OPERATION, OWNER, tampered)).toThrow();
  });

  it('encrypts and keyed-digests provider record hashes independently', () => {
    const crypto = new ReservationSnapshotCrypto(Buffer.alloc(32, 0x33), 2);
    const encrypted = crypto.encryptRecordHash('private-record-hash');
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('private-record-hash');
    expect(encrypted.digest).toHaveLength(32);
    expect(crypto.decryptRecordHash(encrypted)).toBe('private-record-hash');
  });

  it('refuses every operation when runtime crypto is disabled', () => {
    const crypto = ReservationSnapshotCrypto.disabled();
    expect(() => crypto.encryptRecordHash('private-record-hash')).toThrow(
      'Reservation snapshot crypto is disabled',
    );
  });
});
