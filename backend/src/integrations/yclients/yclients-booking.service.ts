import { Injectable } from '@nestjs/common';
import { YclientsApiClient } from './yclients-api.client';
import { YclientsAvailabilityService } from './yclients-availability.service';

export type YclientsBookingCreationCommand = Readonly<{
  apiId: number;
  serviceId: number;
  courtId: number;
  datetime: string;
  client: Readonly<{
    phone: string;
    fullName: string;
    email: string;
  }>;
}>;

export type YclientsBookingDispatchGuard = () => Promise<boolean>;

export type YclientsBookingCreationResult =
  | Readonly<{ outcome: 'invalid_request' }>
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{ outcome: 'write_disabled' }>
  | Readonly<{ outcome: 'not_dispatched' }>
  | Readonly<{ outcome: 'not_bookable' }>
  | Readonly<{
      outcome: 'created';
      appointmentId: number;
      recordId: number;
      recordHash: string;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'rejected' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>
  | Readonly<{ outcome: 'unknown_outcome' }>;

function readText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function readClient(
  value: unknown,
): YclientsBookingCreationCommand['client'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const phone = readText(candidate.phone, 32);
  const fullName = readText(candidate.fullName, 256);
  const email = readText(candidate.email, 320);
  if (
    phone === undefined ||
    !/^\d{10,15}$/u.test(phone) ||
    fullName === undefined ||
    email === undefined ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    return undefined;
  }
  return Object.freeze({ phone, fullName, email });
}

@Injectable()
export class YclientsBookingService {
  constructor(
    private readonly availability: YclientsAvailabilityService,
    private readonly yclients: YclientsApiClient,
  ) {}

  async createBooking(
    command: YclientsBookingCreationCommand,
    beforeWriteDispatch?: YclientsBookingDispatchGuard,
  ): Promise<YclientsBookingCreationResult> {
    const client = readClient(command?.client);
    if (
      !Number.isSafeInteger(command?.apiId) ||
      Number(command.apiId) <= 0 ||
      !Number.isSafeInteger(command?.serviceId) ||
      Number(command.serviceId) <= 0 ||
      !Number.isSafeInteger(command?.courtId) ||
      Number(command.courtId) <= 0 ||
      client === undefined
    ) {
      return Object.freeze({ outcome: 'invalid_request' as const });
    }

    let preflight: Awaited<
      ReturnType<YclientsAvailabilityService['preflightBooking']>
    >;
    try {
      preflight = await this.availability.preflightBooking({
        serviceId: command.serviceId,
        courtId: command.courtId,
        datetime: command.datetime,
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
    if (preflight.outcome !== 'bookable') {
      return Object.freeze({ outcome: preflight.outcome });
    }

    try {
      const result = await this.yclients.createBookingRecord({
        apiId: command.apiId,
        serviceId: command.serviceId,
        resourceId: command.courtId,
        datetime: command.datetime,
        client,
      }, beforeWriteDispatch);
      if (result.outcome !== 'created') {
        return Object.freeze({ outcome: result.outcome });
      }
      return Object.freeze({
        outcome: 'created' as const,
        appointmentId: result.appointmentId,
        recordId: result.recordId,
        recordHash: result.recordHash,
      });
    } catch {
      return Object.freeze({ outcome: 'unknown_outcome' as const });
    }
  }
}
