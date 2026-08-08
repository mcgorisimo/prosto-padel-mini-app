import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  CourtReservationId,
  ReservationOperationId,
} from '../reservations/reservation.types';
import { BookingReservationDiagnosticLogger } from './booking-reservation.diagnostics';

describe('BookingReservationDiagnosticLogger', () => {
  it('emits only allowlisted correlation IDs, stage and outcome', () => {
    const diagnostics = new BookingReservationDiagnosticLogger();
    const warn = jest.fn();
    (diagnostics as unknown as { logger: { warn: typeof warn } }).logger = {
      warn,
    };

    diagnostics.record(Object.freeze({
      reservationId: deterministicUuid('diagnostic-reservation') as CourtReservationId,
      operationId: deterministicUuid('diagnostic-operation') as ReservationOperationId,
      stage: 'confirm_binding',
      outcome: 'storage_failure',
    }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      event: 'booking_reservation_finalization',
      reservationId: deterministicUuid('diagnostic-reservation'),
      operationId: deterministicUuid('diagnostic-operation'),
      stage: 'confirm_binding',
      outcome: 'storage_failure',
    });
    const serialized = JSON.stringify(warn.mock.calls);
    expect(serialized).not.toContain('phone');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('recordHash');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('raw');
  });
});
