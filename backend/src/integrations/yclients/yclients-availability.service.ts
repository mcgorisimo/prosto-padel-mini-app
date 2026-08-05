import { Injectable } from '@nestjs/common';
import {
  YclientsApiClient,
  YclientsBookableResource,
} from './yclients-api.client';

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
