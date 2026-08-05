import { Injectable } from '@nestjs/common';
import {
  YclientsApiClient,
  YclientsBookableResource,
} from './yclients-api.client';

const DAY_MILLISECONDS = 86_400_000;
const MAX_AVAILABILITY_DATE_RANGE_DAYS = 31;

export type YclientsCourt = Readonly<{
  id: number;
  name: string;
}>;

export type YclientsBookingService = Readonly<{
  id: number;
  title: string;
  categoryId: number;
}>;

export type YclientsBookingServicesResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{
      outcome: 'loaded';
      services: ReadonlyArray<YclientsBookingService>;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export type YclientsAvailableDatesQuery = Readonly<{
  serviceId: number;
  courtId: number;
  dateFrom: string;
  dateTo: string;
}>;

export type YclientsAvailableDatesResult =
  | Readonly<{ outcome: 'invalid_request' }>
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{
      outcome: 'loaded';
      dates: ReadonlyArray<string>;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export type YclientsCourtsForServiceResult =
  | Readonly<{ outcome: 'invalid_request' }>
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{
      outcome: 'loaded';
      courts: ReadonlyArray<YclientsCourt>;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

function isCourtLabel(value: string | undefined): boolean {
  return (
    typeof value === 'string' &&
    /^корт(?:\s|№|\d|$)/iu.test(value.trim())
  );
}

function isBookableCourt(resource: YclientsBookableResource): boolean {
  return (
    resource.bookable &&
    (isCourtLabel(resource.name) ||
      isCourtLabel(resource.specialization) ||
      isCourtLabel(resource.positionTitle))
  );
}

function readIsoDateMilliseconds(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== value
  ) {
    return undefined;
  }

  return milliseconds;
}

@Injectable()
export class YclientsAvailabilityService {
  constructor(private readonly yclients: YclientsApiClient) {}

  async listActiveServices(): Promise<YclientsBookingServicesResult> {
    try {
      const result = await this.yclients.listBookableServices();
      if (result.outcome !== 'loaded') {
        return Object.freeze({ outcome: result.outcome });
      }

      const seenServiceIds = new Set<number>();
      const services = result.services
        .filter((service) => service.active)
        .filter((service) => {
          if (seenServiceIds.has(service.id)) {
            return false;
          }
          seenServiceIds.add(service.id);
          return true;
        })
        .map((service) =>
          Object.freeze({
            id: service.id,
            title: service.title,
            categoryId: service.categoryId,
          }),
        );

      return Object.freeze({
        outcome: 'loaded' as const,
        services: Object.freeze(services),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }

  async listAvailableDates(
    query: YclientsAvailableDatesQuery,
  ): Promise<YclientsAvailableDatesResult> {
    const dateFromMilliseconds = readIsoDateMilliseconds(query?.dateFrom);
    const dateToMilliseconds = readIsoDateMilliseconds(query?.dateTo);
    const rangeDays =
      dateFromMilliseconds === undefined || dateToMilliseconds === undefined
        ? Number.NaN
        : (dateToMilliseconds - dateFromMilliseconds) / DAY_MILLISECONDS + 1;
    if (
      !Number.isSafeInteger(query?.serviceId) ||
      Number(query.serviceId) <= 0 ||
      !Number.isSafeInteger(query?.courtId) ||
      Number(query.courtId) <= 0 ||
      dateFromMilliseconds === undefined ||
      dateToMilliseconds === undefined ||
      !Number.isInteger(rangeDays) ||
      rangeDays <= 0 ||
      rangeDays > MAX_AVAILABILITY_DATE_RANGE_DAYS
    ) {
      return Object.freeze({ outcome: 'invalid_request' as const });
    }

    try {
      const result = await this.yclients.listBookableDates({
        serviceIds: [query.serviceId],
        resourceId: query.courtId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      });
      if (result.outcome !== 'loaded') {
        return Object.freeze({ outcome: result.outcome });
      }

      const dates = [...new Set(result.bookingDates)].sort();
      if (
        dates.some((date) => {
          const milliseconds = readIsoDateMilliseconds(date);
          return (
            milliseconds === undefined ||
            milliseconds < dateFromMilliseconds ||
            milliseconds > dateToMilliseconds
          );
        })
      ) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      return Object.freeze({
        outcome: 'loaded' as const,
        dates: Object.freeze(dates),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }

  async listCourtsForService(
    serviceId: number,
  ): Promise<YclientsCourtsForServiceResult> {
    if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
      return Object.freeze({ outcome: 'invalid_request' as const });
    }

    try {
      const result = await this.yclients.listBookableResources([serviceId]);
      if (result.outcome !== 'loaded') {
        return Object.freeze({ outcome: result.outcome });
      }

      const seenCourtIds = new Set<number>();
      const courts = result.resources
        .filter(isBookableCourt)
        .filter((resource) => {
          if (seenCourtIds.has(resource.id)) {
            return false;
          }
          seenCourtIds.add(resource.id);
          return true;
        })
        .map((resource) =>
          Object.freeze({
            id: resource.id,
            name: resource.name,
          }),
        );

      return Object.freeze({
        outcome: 'loaded' as const,
        courts: Object.freeze(courts),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }
}
