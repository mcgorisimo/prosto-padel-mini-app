import { isAccountId } from '../../accounts/account.types';
import {
  ReservationCancellationDeleteCommand,
  ReservationCancellationDeleteResult,
  ReservationCancellationExactReadResult,
  ReservationCancellationProviderPort,
} from '../../reservations/reservation-cancellation.port';
import {
  isCourtReservationId,
  isReservationOperationId,
  isReservationRequestDigest,
} from '../../reservations/reservation.types';
import type { YclientsAdminReadClient } from './yclients-admin-read.client';
import type { YclientsAdminWriteClient } from './yclients-controlled-admin.client';

type CancelClient = Pick<YclientsAdminWriteClient, 'cancel'>;
type ExactReadClient = Pick<YclientsAdminReadClient, 'getRecord'>;

export interface YclientsReservationCancellationAdapterDependencies {
  readonly cancelClient: CancelClient;
  readonly exactReadClient: ExactReadClient;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validCommand(
  value: unknown,
): value is ReservationCancellationDeleteCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const command = value as Record<string, unknown>;
  return (
    Object.keys(command).length === 6 &&
    isReservationOperationId(command.operationId) &&
    isCourtReservationId(command.reservationId) &&
    isAccountId(command.ownerAccountId) &&
    isReservationRequestDigest(command.requestDigest) &&
    positiveSafeInteger(command.recordId) &&
    positiveSafeInteger(command.apiId)
  );
}

function exactOutcome(value: unknown, outcome: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as Record<string, unknown>).outcome === outcome
  );
}

/**
 * Runtime-disabled mapping from the existing YCLIENTS clients to the narrow
 * cancel-only domain port. The adapter exposes no reschedule or generic write.
 */
export class YclientsReservationCancellationAdapter
  implements ReservationCancellationProviderPort
{
  constructor(
    private readonly dependencies: YclientsReservationCancellationAdapterDependencies,
  ) {}

  async deleteOnce(
    command: ReservationCancellationDeleteCommand,
  ): Promise<ReservationCancellationDeleteResult> {
    if (!validCommand(command)) {
      return Object.freeze({
        outcome: 'not_sent' as const,
        reason: 'invalid_request' as const,
      });
    }
    let result: unknown;
    try {
      result = await this.dependencies.cancelClient.cancel(command.recordId);
    } catch {
      return Object.freeze({ outcome: 'unknown' as const });
    }
    if (exactOutcome(result, 'deleted')) {
      return Object.freeze({ outcome: 'accepted' as const });
    }
    if (exactOutcome(result, 'disabled')) {
      return Object.freeze({
        outcome: 'not_sent' as const,
        reason: 'provider_disabled' as const,
      });
    }
    if (exactOutcome(result, 'invalid_request')) {
      return Object.freeze({
        outcome: 'not_sent' as const,
        reason: 'invalid_request' as const,
      });
    }
    // Every provider response, transport failure or ambiguous success without
    // a documented no-effect guarantee requires exact read-only reconciliation.
    return Object.freeze({ outcome: 'unknown' as const });
  }

  async readExact(
    command: ReservationCancellationDeleteCommand,
  ): Promise<ReservationCancellationExactReadResult> {
    if (!validCommand(command)) {
      return Object.freeze({ outcome: 'unknown' as const });
    }
    let result: unknown;
    try {
      result = await this.dependencies.exactReadClient.getRecord(
        command.recordId,
      );
    } catch {
      return Object.freeze({ outcome: 'unknown' as const });
    }
    if (exactOutcome(result, 'not_found')) {
      return Object.freeze({ outcome: 'not_found' as const });
    }
    if (
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result) ||
      Object.keys(result).length !== 2 ||
      (result as Record<string, unknown>).outcome !== 'found'
    ) {
      return Object.freeze({ outcome: 'unknown' as const });
    }
    const record = (result as Record<string, unknown>).record;
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      return Object.freeze({ outcome: 'unknown' as const });
    }
    const safeRecord = record as Record<string, unknown>;
    if (
      !positiveSafeInteger(safeRecord.recordId) ||
      safeRecord.recordId !== command.recordId ||
      !positiveSafeInteger(safeRecord.apiId) ||
      safeRecord.apiId !== command.apiId ||
      typeof safeRecord.deleted !== 'boolean'
    ) {
      return Object.freeze({ outcome: 'unknown' as const });
    }
    return Object.freeze({
      outcome: 'found' as const,
      record: Object.freeze({
        recordId: safeRecord.recordId,
        apiId: safeRecord.apiId,
        deleted: safeRecord.deleted,
      }),
    });
  }
}
