import { AccountId, isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import { contactVerificationSubjectDigest } from '../contacts/contact-verification.contracts';
import { ContactVerificationEnvelopePort, contactVerificationEnvelopeKeyVersion } from '../contacts/contact-verification-envelope.port';
import { contactVerificationDigestKeyVersion } from '../contacts/contact-verification-digest.port';
import { PostgresTransaction } from '../database/postgres-transaction';
import { VerifiedPhoneProof } from './crm-binding.types';

export interface PhoneProofReader {
  read(transaction: PostgresTransaction, accountId: AccountId): Promise<VerifiedPhoneProof | undefined>;
}
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => integer(v) && v > 0;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function bytes(v: unknown, length?: number): Buffer {
  if (typeof v !== 'string' || !/^(?:[0-9a-f]{2})+$/u.test(v) || v.length > 8192 ||
      (length !== undefined && v.length !== length * 2)) throw new Error('Phone proof unavailable');
  return Buffer.from(v, 'hex');
}

/** Runtime-disconnected until the D5.2 verifier and its existing AEAD keyring are wired. */
export class PostgresPhoneProofReader implements PhoneProofReader {
  constructor(private readonly envelopes: Pick<ContactVerificationEnvelopePort, 'decryptContact'>) {}

  async read(transaction: PostgresTransaction, accountId: AccountId): Promise<VerifiedPhoneProof | undefined> {
    try {
      if (!isAccountId(accountId)) throw new Error();
      const result = await transaction.query('SELECT proof FROM backend_auth.read_crm_phone_proof($1::uuid)', [accountId]);
      if (result.rowCount !== result.rows.length || result.rows.length > 1) throw new Error();
      if (result.rows.length === 0) return undefined;
      const p: unknown = result.rows[0].proof;
      if (!record(p) || p.account_id !== accountId || p.field !== 'phone' || p.method !== 'phone_sms_otp' ||
          p.purpose !== 'contact_ownership' || p.state !== 'verified' ||
          !isInternalUuid(p.challenge_id) || !isInternalUuid(p.verified_command_id) ||
          !positive(p.contact_version) || p.challenge_contact_version !== p.contact_version ||
          !positive(p.profile_revision) || !positive(p.digest_key_version) ||
          p.challenge_digest_key_version !== p.digest_key_version ||
          p.subject_digest !== p.challenge_subject_digest ||
          !integer(p.created_at) || !integer(p.verified_at) || !integer(p.expires_at) || !integer(p.observed_at) ||
          !integer(p.profile_changed_at) || p.created_at <= p.profile_changed_at ||
          p.created_at > p.verified_at || p.verified_at >= p.expires_at || p.verified_at > p.observed_at ||
          p.algorithm !== 'aes_256_gcm' || !positive(p.key_version)) throw new Error();
      const subjectDigest = contactVerificationSubjectDigest(bytes(p.subject_digest, 32).toString('hex'));
      const phone = this.envelopes.decryptContact({
        accountId, field: 'phone', purpose: 'contact_ownership', contactVersion: p.contact_version,
        subjectDigest, subjectDigestKeyVersion: contactVerificationDigestKeyVersion(p.digest_key_version),
        envelope: { ciphertext: bytes(p.ciphertext), nonce: bytes(p.nonce, 12), authTag: bytes(p.auth_tag, 16),
          algorithm: 'aes_256_gcm', keyVersion: contactVerificationEnvelopeKeyVersion(p.key_version) },
      });
      if (!/^\+[1-9][0-9]{6,14}$/u.test(phone) || phone !== p.profile_phone) return undefined;
      return Object.freeze({ accountId, phone, contactVersion: p.contact_version,
        profileRevision: p.profile_revision, challengeId: p.challenge_id, subjectDigest,
        digestKeyVersion: p.digest_key_version, verifiedAt: p.verified_at, observedAt: p.observed_at });
    } catch { throw new Error('Phone proof unavailable'); }
  }
}
