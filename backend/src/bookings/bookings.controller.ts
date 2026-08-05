import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { SessionBearerGuard } from '../auth/session-authentication.guard';
import { SessionLifecyclePublicError } from '../auth/session-lifecycle.http';
import {
  YclientsAvailabilityService,
  YclientsAvailableDatesResult,
  YclientsAvailableTimesResult,
  YclientsBookingServicesResult,
  YclientsCourtsForServiceResult,
} from '../integrations/yclients/yclients-availability.service';

type AvailabilityResult =
  | YclientsBookingServicesResult
  | YclientsCourtsForServiceResult
  | YclientsAvailableDatesResult
  | YclientsAvailableTimesResult;

type AvailabilityRejection =
  | Exclude<AvailabilityResult['outcome'], 'loaded'>
  | 'internal_failure';

const AVAILABILITY_OUTCOMES = [
  'invalid_request',
  'disabled',
  'loaded',
  'unauthorized',
  'invalid_response',
  'unavailable',
] as const;

function publicError(
  statusCode: number,
  code: string,
  message: string,
): HttpException {
  const response: SessionLifecyclePublicError = Object.freeze({
    statusCode,
    code,
    message,
  });
  return new HttpException(response, statusCode);
}

function rejection(reason: AvailabilityRejection): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'booking_availability_invalid_request',
        'Booking availability request is invalid',
      );
    case 'disabled':
    case 'unauthorized':
    case 'unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'booking_availability_unavailable',
        'Booking availability is unavailable',
      );
    case 'invalid_response':
      return publicError(
        HttpStatus.BAD_GATEWAY,
        'booking_availability_invalid_response',
        'Booking availability response is invalid',
      );
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'booking_availability_internal_error',
        'Booking availability request failed',
      );
  }
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function readStringQuery(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(value, key) &&
        typeof value[key] === 'string',
    )
  ) {
    return undefined;
  }
  return value as Readonly<Record<string, string>>;
}

async function execute<T extends AvailabilityResult>(
  operation: () => Promise<T>,
): Promise<T> {
  let result: unknown;
  try {
    result = await operation();
  } catch {
    throw rejection('internal_failure');
  }
  if (
    !isRecord(result) ||
    typeof result.outcome !== 'string' ||
    !AVAILABILITY_OUTCOMES.includes(
      result.outcome as (typeof AVAILABILITY_OUTCOMES)[number],
    )
  ) {
    throw rejection('internal_failure');
  }
  return result as T;
}

@Controller('bookings')
export class BookingsController {
  constructor(private readonly availability: YclientsAvailabilityService) {}

  @Get('services')
  @UseGuards(SessionBearerGuard)
  async listServices(@Res({ passthrough: true }) reply: FastifyReply) {
    disableCaching(reply);
    const result = await execute(() => this.availability.listActiveServices());
    if (result.outcome !== 'loaded') {
      throw rejection(result.outcome);
    }
    return Object.freeze({ services: result.services });
  }

  @Get('services/:serviceId/courts')
  @UseGuards(SessionBearerGuard)
  async listCourts(
    @Param('serviceId') rawServiceId: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const serviceId = readPositiveInteger(rawServiceId);
    if (serviceId === undefined) {
      throw rejection('invalid_request');
    }
    const result = await execute(() =>
      this.availability.listCourtsForService(serviceId),
    );
    if (result.outcome !== 'loaded') {
      throw rejection(result.outcome);
    }
    return Object.freeze({ courts: result.courts });
  }

  @Get('services/:serviceId/courts/:courtId/dates')
  @UseGuards(SessionBearerGuard)
  async listDates(
    @Param('serviceId') rawServiceId: unknown,
    @Param('courtId') rawCourtId: unknown,
    @Query() rawQuery: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const serviceId = readPositiveInteger(rawServiceId);
    const courtId = readPositiveInteger(rawCourtId);
    const query = readStringQuery(rawQuery, ['dateFrom', 'dateTo']);
    if (serviceId === undefined || courtId === undefined || query === undefined) {
      throw rejection('invalid_request');
    }
    const result = await execute(() =>
      this.availability.listAvailableDates({
        serviceId,
        courtId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
    );
    if (result.outcome !== 'loaded') {
      throw rejection(result.outcome);
    }
    return Object.freeze({ dates: result.dates });
  }

  @Get('services/:serviceId/courts/:courtId/times')
  @UseGuards(SessionBearerGuard)
  async listTimes(
    @Param('serviceId') rawServiceId: unknown,
    @Param('courtId') rawCourtId: unknown,
    @Query() rawQuery: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const serviceId = readPositiveInteger(rawServiceId);
    const courtId = readPositiveInteger(rawCourtId);
    const query = readStringQuery(rawQuery, ['date']);
    if (serviceId === undefined || courtId === undefined || query === undefined) {
      throw rejection('invalid_request');
    }
    const result = await execute(() =>
      this.availability.listAvailableTimes({
        serviceId,
        courtId,
        date: query.date,
      }),
    );
    if (result.outcome !== 'loaded') {
      throw rejection(result.outcome);
    }
    return Object.freeze({ times: result.times });
  }
}
