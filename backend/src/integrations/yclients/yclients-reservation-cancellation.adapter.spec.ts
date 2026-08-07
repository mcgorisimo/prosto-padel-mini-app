import { accountId } from '../../accounts/account.types';
import { deterministicUuid } from '../../../test/deterministic-uuid';
import {
  ReservationCancellationDeleteCommand,
  ReservationCancellationDeleteResult,
} from '../../reservations/reservation-cancellation.port';
import {
  courtReservationId,
  reservationOperationId,
  reservationRequestDigest,
} from '../../reservations/reservation.types';
import { YclientsReservationCancellationAdapter } from './yclients-reservation-cancellation.adapter';

const RECORD_ID = 1_891_713_981;
const API_ID = 7_710_001;
const COMMAND: ReservationCancellationDeleteCommand = Object.freeze({
  operationId: reservationOperationId(
    deterministicUuid('d2-adapter-cancel-operation'),
  ),
  reservationId: courtReservationId(
    deterministicUuid('d2-adapter-cancel-reservation'),
  ),
  ownerAccountId: accountId(deterministicUuid('d2-adapter-cancel-owner')),
  requestDigest: reservationRequestDigest('a'.repeat(64)),
  recordId: RECORD_ID,
  apiId: API_ID,
});

function harness() {
  const cancel = jest.fn();
  const getRecord = jest.fn();
  const adapter = new YclientsReservationCancellationAdapter({
    cancelClient: { cancel },
    exactReadClient: { getRecord },
  });
  return { adapter, cancel, getRecord };
}

describe('YclientsReservationCancellationAdapter', () => {
  it('maps one exact DELETE success to accepted without exposing reschedule', async () => {
    const test = harness();
    test.cancel.mockResolvedValueOnce(Object.freeze({ outcome: 'deleted' }));

    await expect(test.adapter.deleteOnce(COMMAND)).resolves.toEqual({
      outcome: 'accepted',
    });
    expect(test.cancel).toHaveBeenCalledTimes(1);
    expect(test.cancel).toHaveBeenCalledWith(RECORD_ID);
    expect(test.adapter).not.toHaveProperty('reschedule');
  });

  it.each([
    ['disabled', 'provider_disabled'],
    ['invalid_request', 'invalid_request'],
  ] as const)(
    'maps local %s to a precise no-request result',
    async (outcome, reason) => {
      const test = harness();
      test.cancel.mockResolvedValueOnce(Object.freeze({ outcome }));

      await expect(test.adapter.deleteOnce(COMMAND)).resolves.toEqual({
        outcome: 'not_sent',
        reason,
      });
      expect(test.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { outcome: 'unauthorized' },
    { outcome: 'rejected' },
    { outcome: 'unknown', reason: 'timeout_or_transport' },
    { outcome: 'unknown', reason: 'provider_unavailable' },
    { outcome: 'deleted', extra: true },
    { outcome: 'unexpected' },
  ])('maps uncertain provider result %p to unknown without retry', async (providerResult) => {
    const test = harness();
    test.cancel.mockResolvedValueOnce(providerResult);

    await expect(test.adapter.deleteOnce(COMMAND)).resolves.toEqual({
      outcome: 'unknown',
    });
    expect(test.cancel).toHaveBeenCalledTimes(1);
  });

  it('maps a thrown DELETE to unknown without retry', async () => {
    const test = harness();
    test.cancel.mockRejectedValueOnce(new Error('transport marker'));

    await expect(test.adapter.deleteOnce(COMMAND)).resolves.toEqual({
      outcome: 'unknown',
    });
    expect(test.cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed command before either client is called', async () => {
    const test = harness();
    const malformed = {
      ...COMMAND,
      unexpected: 'Diagnostic Client Marker',
    } as unknown as ReservationCancellationDeleteCommand;

    await expect(test.adapter.deleteOnce(malformed)).resolves.toEqual({
      outcome: 'not_sent',
      reason: 'invalid_request',
    });
    await expect(test.adapter.readExact(malformed)).resolves.toEqual({
      outcome: 'unknown',
    });
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.getRecord).not.toHaveBeenCalled();
  });

  it('projects exact read to record/api/deleted only', async () => {
    const test = harness();
    test.getRecord.mockResolvedValueOnce({
      outcome: 'found',
      record: {
        recordId: RECORD_ID,
        companyId: 2_079_564,
        resourceId: 5_730_531,
        serviceIds: [30_539_679],
        datetime: '2026-08-09T16:30:00+03:00',
        deleted: true,
        apiId: API_ID,
        client: {
          phone: 'PII_MARKER_PHONE',
          fullName: 'PII_MARKER_NAME',
          email: 'PII_MARKER_EMAIL',
        },
        recordHash: 'HASH_MARKER',
      },
    });

    const result = await test.adapter.readExact(COMMAND);

    expect(result).toEqual({
      outcome: 'found',
      record: { recordId: RECORD_ID, apiId: API_ID, deleted: true },
    });
    expect(test.getRecord).toHaveBeenCalledTimes(1);
    expect(test.getRecord).toHaveBeenCalledWith(RECORD_ID);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('PII_MARKER');
    expect(serialized).not.toContain('HASH_MARKER');
  });

  it('preserves exact not_found as non-proof', async () => {
    const test = harness();
    test.getRecord.mockResolvedValueOnce(Object.freeze({ outcome: 'not_found' }));

    await expect(test.adapter.readExact(COMMAND)).resolves.toEqual({
      outcome: 'not_found',
    });
    expect(test.getRecord).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['record id', { recordId: RECORD_ID + 1, apiId: API_ID, deleted: true }],
    ['api id', { recordId: RECORD_ID, apiId: API_ID + 1, deleted: true }],
    ['missing api id', { recordId: RECORD_ID, deleted: true }],
    ['deleted type', { recordId: RECORD_ID, apiId: API_ID, deleted: 'true' }],
  ])('fails closed for mismatched %s', async (_name, record) => {
    const test = harness();
    test.getRecord.mockResolvedValueOnce({ outcome: 'found', record });

    await expect(test.adapter.readExact(COMMAND)).resolves.toEqual({
      outcome: 'unknown',
    });
    expect(test.getRecord).toHaveBeenCalledTimes(1);
  });

  it.each([
    { outcome: 'found', record: { recordId: RECORD_ID, apiId: API_ID, deleted: true }, extra: true },
    { outcome: 'unknown' },
    { outcome: 'unauthorized' },
    null,
  ])('fails closed for malformed or unsafe exact result %p', async (providerResult) => {
    const test = harness();
    test.getRecord.mockResolvedValueOnce(providerResult);

    await expect(test.adapter.readExact(COMMAND)).resolves.toEqual({
      outcome: 'unknown',
    });
    expect(test.getRecord).toHaveBeenCalledTimes(1);
  });

  it('maps a thrown exact read to unknown without fallback', async () => {
    const test = harness();
    test.getRecord.mockRejectedValueOnce(new Error('read marker'));

    await expect(test.adapter.readExact(COMMAND)).resolves.toEqual({
      outcome: 'unknown',
    });
    expect(test.getRecord).toHaveBeenCalledTimes(1);
    expect(test.cancel).not.toHaveBeenCalled();
  });

  it('does not serialize client PII or record hash through a delete outcome', async () => {
    const test = harness();
    test.cancel.mockResolvedValueOnce({ outcome: 'unauthorized' });

    const result: ReservationCancellationDeleteResult =
      await test.adapter.deleteOnce(COMMAND);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('phone');
    expect(serialized).not.toContain('fullName');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('recordHash');
  });
});
