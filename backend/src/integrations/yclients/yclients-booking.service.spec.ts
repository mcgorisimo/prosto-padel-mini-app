import { YclientsApiClient } from './yclients-api.client';
import { YclientsAvailabilityService } from './yclients-availability.service';
import { YclientsBookingService } from './yclients-booking.service';

function createSubject() {
  const preflightBooking = jest.fn();
  const createBookingRecord = jest.fn();
  const availability = {
    preflightBooking,
  } as unknown as YclientsAvailabilityService;
  const yclients = { createBookingRecord } as unknown as YclientsApiClient;
  return {
    service: new YclientsBookingService(availability, yclients),
    preflightBooking,
    createBookingRecord,
  };
}

describe('YclientsBookingService', () => {
  const command = Object.freeze({
    apiId: 7_770_001,
    serviceId: 30_539_679,
    courtId: 5_730_531,
    datetime: '2026-08-05T16:30:00+03:00',
    client: Object.freeze({
      phone: '79000000000',
      fullName: ' Тест Просто Падел ',
      email: 'test@example.test',
    }),
  });

  it('preflights before creating exactly one normalized booking', async () => {
    const { service, preflightBooking, createBookingRecord } = createSubject();
    preflightBooking.mockResolvedValue({ outcome: 'bookable' });
    createBookingRecord.mockResolvedValue({
      outcome: 'created',
      appointmentId: 1,
      recordId: 2_820_023,
      recordHash: '567df655304da9b98487769426d4e76e',
      privateMarker: 'not returned',
    });

    await expect(service.createBooking(command)).resolves.toEqual({
      outcome: 'created',
      appointmentId: 1,
      recordId: 2_820_023,
      recordHash: '567df655304da9b98487769426d4e76e',
    });
    expect(preflightBooking).toHaveBeenCalledTimes(1);
    expect(preflightBooking).toHaveBeenCalledWith({
      serviceId: 30_539_679,
      courtId: 5_730_531,
      datetime: '2026-08-05T16:30:00+03:00',
    });
    expect(createBookingRecord).toHaveBeenCalledTimes(1);
    expect(createBookingRecord).toHaveBeenCalledWith({
      apiId: 7_770_001,
      serviceId: 30_539_679,
      resourceId: 5_730_531,
      datetime: '2026-08-05T16:30:00+03:00',
      client: {
        phone: '79000000000',
        fullName: 'Тест Просто Падел',
        email: 'test@example.test',
      },
    });
    expect(preflightBooking.mock.invocationCallOrder[0]).toBeLessThan(
      createBookingRecord.mock.invocationCallOrder[0],
    );
  });

  it.each([
    [{ ...command, apiId: 0 }],
    [{ ...command, serviceId: 0 }],
    [{ ...command, courtId: -1 }],
    [{ ...command, client: { ...command.client, phone: '+79000000000' } }],
    [{ ...command, client: { ...command.client, fullName: ' ' } }],
    [{ ...command, client: { ...command.client, email: 'invalid-email' } }],
  ])('rejects invalid command %# before preflight', async (invalidCommand) => {
    const { service, preflightBooking, createBookingRecord } = createSubject();

    await expect(service.createBooking(invalidCommand)).resolves.toEqual({
      outcome: 'invalid_request',
    });
    expect(preflightBooking).not.toHaveBeenCalled();
    expect(createBookingRecord).not.toHaveBeenCalled();
  });

  it.each([
    'invalid_request',
    'disabled',
    'not_bookable',
    'unauthorized',
    'invalid_response',
    'unavailable',
  ] as const)('stops after preflight outcome %s', async (outcome) => {
    const { service, preflightBooking, createBookingRecord } = createSubject();
    preflightBooking.mockResolvedValue({ outcome });

    await expect(service.createBooking(command)).resolves.toEqual({ outcome });
    expect(createBookingRecord).not.toHaveBeenCalled();
  });

  it.each([
    'disabled',
    'write_disabled',
    'invalid_request',
    'unauthorized',
    'rejected',
    'unknown_outcome',
  ] as const)('preserves create outcome %s', async (outcome) => {
    const { service, preflightBooking, createBookingRecord } = createSubject();
    preflightBooking.mockResolvedValue({ outcome: 'bookable' });
    createBookingRecord.mockResolvedValue({ outcome });

    await expect(service.createBooking(command)).resolves.toEqual({ outcome });
    expect(createBookingRecord).toHaveBeenCalledTimes(1);
  });

  it('maps an unexpected preflight failure to unavailable', async () => {
    const { service, preflightBooking, createBookingRecord } = createSubject();
    preflightBooking.mockRejectedValue(new Error('private preflight marker'));

    await expect(service.createBooking(command)).resolves.toEqual({
      outcome: 'unavailable',
    });
    expect(createBookingRecord).not.toHaveBeenCalled();
  });

  it('maps an unexpected create failure to unknown outcome without retry', async () => {
    const { service, preflightBooking, createBookingRecord } = createSubject();
    preflightBooking.mockResolvedValue({ outcome: 'bookable' });
    createBookingRecord.mockRejectedValue(new Error('private create marker'));

    await expect(service.createBooking(command)).resolves.toEqual({
      outcome: 'unknown_outcome',
    });
    expect(createBookingRecord).toHaveBeenCalledTimes(1);
  });
});
