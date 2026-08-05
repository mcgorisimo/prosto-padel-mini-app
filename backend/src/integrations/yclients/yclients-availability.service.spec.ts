import { YclientsApiClient } from './yclients-api.client';
import { YclientsAvailabilityService } from './yclients-availability.service';

function createSubject() {
  const listBookableResources = jest.fn();
  const yclients = {
    listBookableResources,
  } as unknown as YclientsApiClient;

  return {
    service: new YclientsAvailabilityService(yclients),
    listBookableResources,
  };
}

describe('YclientsAvailabilityService', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid service id %s without calling YCLIENTS',
    async (serviceId) => {
      const { service, listBookableResources } = createSubject();

      await expect(service.listCourtsForService(serviceId)).resolves.toEqual({
        outcome: 'invalid_request',
      });
      expect(listBookableResources).not.toHaveBeenCalled();
    },
  );

  it('returns only unique bookable courts using safe fields', async () => {
    const { service, listBookableResources } = createSubject();
    listBookableResources.mockResolvedValue({
      outcome: 'loaded',
      resources: [
        {
          id: 5_762_322,
          name: 'Тренер',
          specialization: 'Тренер',
          bookable: true,
        },
        {
          id: 5_730_531,
          name: 'Корт №1',
          specialization: 'Корт №1',
          positionTitle: 'Корт',
          bookable: true,
        },
        {
          id: 5_762_241,
          name: 'Корт №2',
          specialization: 'Корт №2',
          bookable: false,
        },
        {
          id: 5_762_274,
          name: 'Ресурс №3',
          specialization: 'Корт №3',
          bookable: true,
        },
        {
          id: 5_762_280,
          name: 'Ресурс №4',
          specialization: '',
          positionTitle: 'КОРТ',
          bookable: true,
        },
        {
          id: 5_730_531,
          name: 'Корт №1 duplicate',
          specialization: 'Корт №1',
          bookable: true,
        },
        {
          id: 99,
          name: 'Кортеж',
          specialization: '',
          bookable: true,
        },
      ],
    });

    await expect(service.listCourtsForService(30_539_679)).resolves.toEqual({
      outcome: 'loaded',
      courts: [
        { id: 5_730_531, name: 'Корт №1' },
        { id: 5_762_274, name: 'Ресурс №3' },
        { id: 5_762_280, name: 'Ресурс №4' },
      ],
    });
    expect(listBookableResources).toHaveBeenCalledTimes(1);
    expect(listBookableResources).toHaveBeenCalledWith([30_539_679]);
  });

  it('returns an empty loaded result when no courts match', async () => {
    const { service, listBookableResources } = createSubject();
    listBookableResources.mockResolvedValue({
      outcome: 'loaded',
      resources: [],
    });

    await expect(service.listCourtsForService(30_539_679)).resolves.toEqual({
      outcome: 'loaded',
      courts: [],
    });
  });

  it.each([
    'disabled',
    'unauthorized',
    'invalid_response',
    'unavailable',
  ] as const)('preserves the client outcome %s', async (outcome) => {
    const { service, listBookableResources } = createSubject();
    listBookableResources.mockResolvedValue({ outcome });

    await expect(service.listCourtsForService(30_539_679)).resolves.toEqual({
      outcome,
    });
  });

  it('maps unexpected client failures to unavailable', async () => {
    const { service, listBookableResources } = createSubject();
    listBookableResources.mockRejectedValue(
      new Error('private upstream marker'),
    );

    await expect(service.listCourtsForService(30_539_679)).resolves.toEqual({
      outcome: 'unavailable',
    });
  });
});
