import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
  SessionBearerGuard,
  readAuthenticatedSessionPrincipal,
} from '../auth/session-authentication.guard';
import { SessionLifecyclePublicError } from '../auth/session-lifecycle.http';
import { BackendDomainEventLogger } from '../common/logging/backend-domain-event.logger';
import {
  YclientsAvailabilityService,
  YclientsAvailableDatesResult,
  YclientsAvailableTimesResult,
  YclientsBookingServicesResult,
  YclientsCourtsForServiceResult,
} from '../integrations/yclients/yclients-availability.service';
import { BookingReservationService } from './booking-reservation.service';

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: ReadonlyArray<string>,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function readBookingCreationRequest(value: unknown):
  | Readonly<{
      requestKey: string;
      serviceId: number;
      courtId: number;
      datetime: string;
      email: string;
    }>
  | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'requestKey',
      'serviceId',
      'courtId',
      'datetime',
      'email',
    ]) ||
    typeof value.requestKey !== 'string' ||
    !UUID_PATTERN.test(value.requestKey) ||
    !Number.isSafeInteger(value.serviceId) ||
    Number(value.serviceId) <= 0 ||
    !Number.isSafeInteger(value.courtId) ||
    Number(value.courtId) <= 0 ||
    typeof value.datetime !== 'string' ||
    typeof value.email !== 'string'
  ) {
    return undefined;
  }
  return Object.freeze({
    requestKey: value.requestKey.toLowerCase(),
    serviceId: Number(value.serviceId),
    courtId: Number(value.courtId),
    datetime: value.datetime,
    email: value.email,
  });
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

function creationRejection(
  reason:
    | 'invalid_request'
    | 'contact_incomplete'
    | 'not_bookable'
    | 'conflict'
    | 'provider_rejected'
    | 'unavailable'
    | 'unknown',
): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'booking_creation_invalid_request',
        'Booking creation request is invalid',
      );
    case 'not_bookable':
      return publicError(
        HttpStatus.CONFLICT,
        'booking_slot_not_bookable',
        'Booking slot is no longer available',
      );
    case 'provider_rejected':
      return publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'booking_creation_rejected',
        'Booking creation was rejected',
      );
    case 'unknown':
      return publicError(
        HttpStatus.BAD_GATEWAY,
        'booking_creation_unknown_outcome',
        'Booking creation outcome is unknown',
      );
    case 'contact_incomplete':
      return publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'booking_contact_incomplete',
        'Booking contact data is incomplete',
      );
    case 'conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'booking_idempotency_conflict',
        'Booking request key conflicts with an earlier request',
      );
    case 'unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'booking_creation_unavailable',
        'Booking creation is unavailable',
      );
  }
}

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly availability: YclientsAvailabilityService,
    private readonly reservations: BookingReservationService,
    private readonly domainEvents: BackendDomainEventLogger,
  ) {}

  @Post()
  @UseGuards(SessionBearerGuard)
  async createBooking(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    const body = readBookingCreationRequest(rawBody);
    if (principal === undefined || body === undefined) {
      throw creationRejection('invalid_request');
    }
    const result = await this.reservations.create(principal.accountId, body);
    if (result.outcome === 'unknown') {
      this.domainEvents.record({
        domain: 'private_booking',
        action: 'create',
        outcome: 'unknown',
        reservationId: result.reservation.reservationId,
        reservationStatus: result.reservation.status,
      });
      reply.status(HttpStatus.ACCEPTED);
      return result.reservation;
    }
    if (result.outcome !== 'created' && result.outcome !== 'idempotent_retry') {
      this.domainEvents.record({
        domain: 'private_booking',
        action: 'create',
        outcome: 'rejected',
        reason: result.outcome,
      });
      throw creationRejection(result.outcome);
    }
    this.domainEvents.record({
      domain: 'private_booking',
      action: 'create',
      outcome: result.outcome,
      reservationId: result.reservation.reservationId,
      reservationStatus: result.reservation.status,
    });
    return result.reservation;
  }

  @Get()
  @UseGuards(SessionBearerGuard)
  async listBookings(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) throw creationRejection('invalid_request');
    const result = await this.reservations.list(principal.accountId);
    if (result.outcome === 'unavailable') {
      throw publicError(HttpStatus.SERVICE_UNAVAILABLE, 'booking_list_unavailable', 'Bookings are temporarily unavailable');
    }
    return Object.freeze({ reservations: result.reservations });
  }

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

  @Get('requests/:requestKey')
  @UseGuards(SessionBearerGuard)
  async readBookingByRequestKey(
    @Param('requestKey') requestKey: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) throw creationRejection('invalid_request');
    const result = await this.reservations.readByRequestKey(principal.accountId, requestKey);
    if (result.outcome === 'not_found') {
      throw publicError(HttpStatus.NOT_FOUND, 'booking_not_found', 'Booking was not found');
    }
    if (result.outcome === 'unavailable') {
      throw publicError(HttpStatus.SERVICE_UNAVAILABLE, 'booking_read_unavailable', 'Booking is temporarily unavailable');
    }
    return result.reservation;
  }

  @Get(':reservationId')
  @UseGuards(SessionBearerGuard)
  async readBooking(
    @Param('reservationId') reservationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) throw creationRejection('invalid_request');
    const result = await this.reservations.read(principal.accountId, reservationId);
    if (result.outcome === 'not_found') {
      throw publicError(HttpStatus.NOT_FOUND, 'booking_not_found', 'Booking was not found');
    }
    if (result.outcome === 'unavailable') {
      throw publicError(HttpStatus.SERVICE_UNAVAILABLE, 'booking_read_unavailable', 'Booking is temporarily unavailable');
    }
    return result.reservation;
  }
}
