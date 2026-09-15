import { accountId } from '../accounts/account.types';
import { PostgresTransaction } from '../database/postgres-transaction';
import { PostgresPhoneProofReader } from './postgres-phone-proof.reader';

const ACCOUNT = accountId('11111111-1111-4111-8111-111111111111');
const PHONE = '+79991112233';
const evidence = () => ({ account_id: ACCOUNT, field: 'phone', method: 'phone_sms_otp', purpose: 'contact_ownership',
  state: 'verified', contact_version: 2, challenge_contact_version: 2, profile_revision: 3,
  subject_digest: 'ab'.repeat(32), challenge_subject_digest: 'ab'.repeat(32), digest_key_version: 1, challenge_digest_key_version: 1,
  challenge_id: '22222222-2222-4222-8222-222222222222', verified_command_id: '33333333-3333-4333-8333-333333333333',
  created_at: 1001, verified_at: 1005, expires_at: 1601, observed_at: 1010, profile_changed_at: 1000,
  algorithm: 'aes_256_gcm', key_version: 1, ciphertext: 'ab', nonce: 'cd'.repeat(12), auth_tag: 'ef'.repeat(16), profile_phone: PHONE });
function setup(p: unknown = evidence()) {
  const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ proof: p }] });
  const decryptContact = jest.fn().mockReturnValue(PHONE);
  return { query, decryptContact, tx: { query } as PostgresTransaction, reader: new PostgresPhoneProofReader({ decryptContact }) };
}
describe('server proof verification boundary', () => {
  it('uses authenticated account, encrypted canonical contact and versioned SMS evidence', async () => {
    const { reader, tx, query, decryptContact } = setup();
    expect(await reader.read(tx, ACCOUNT)).toMatchObject({ accountId: ACCOUNT, phone: PHONE, contactVersion: 2, profileRevision: 3 });
    expect(query.mock.calls[0][1]).toEqual([ACCOUNT]);
    expect(decryptContact).toHaveBeenCalledWith(expect.objectContaining({ accountId: ACCOUNT, field: 'phone', contactVersion: 2 }));
  });
  it.each([
    { state: 'pending' }, { method: 'telegram' }, { method: 'email_code' }, { purpose: 'login' },
    { challenge_contact_version: 1 }, { challenge_subject_digest: 'cd'.repeat(32) }, { challenge_digest_key_version: 2 },
    { verified_at: 1601 }, { observed_at: 1004 }, { verified_command_id: null }, { contact_version: 0 },
    { profile_revision: 0 }, { created_at: 1000 }, { profile_changed_at: 1002 },
    { account_id: '44444444-4444-4444-8444-444444444444' }, { nonce: 'bad' }, { key_version: 0 },
  ])('rejects stale, foreign, invalid or unsupported evidence %#', async changes => {
    const { reader, tx } = setup({ ...evidence(), ...changes });
    await expect(reader.read(tx, ACCOUNT)).rejects.toThrow('Phone proof unavailable');
  });
  it('a changed profile phone is not the encrypted verified phone', async () => {
    const { reader, tx } = setup({ ...evidence(), profile_phone: '+79992223344' });
    expect(await reader.read(tx, ACCOUNT)).toBeUndefined();
  });
  it('missing proof stays unverified', async () => {
    const { reader, tx, query, decryptContact } = setup();
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    expect(await reader.read(tx, ACCOUNT)).toBeUndefined();
    expect(decryptContact).not.toHaveBeenCalled();
  });
  it('never exposes SQL, decryption errors, contacts or ciphertext', async () => {
    const { reader, tx, decryptContact, query } = setup();
    decryptContact.mockImplementation(() => { throw new Error(PHONE); });
    await expect(reader.read(tx, ACCOUNT)).rejects.toEqual(new Error('Phone proof unavailable'));
    query.mockRejectedValue(new Error(`SQL ${PHONE}`));
    await expect(reader.read(tx, ACCOUNT)).rejects.toEqual(new Error('Phone proof unavailable'));
  });
});
