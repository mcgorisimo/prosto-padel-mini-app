import { YclientsApiClient } from './yclients-api.client';
import { YclientsAvailabilityService } from './yclients-availability.service';

function createSubject() {
  const checkBookableAppointment = jest.fn();
  const listBookableServices = jest.fn();
  const listBookableDates = jest.fn();
  const listBookableTimes = jest.fn();
  const listBookableResources = jest.fn();
  const yclients = {
    checkBookableAppointment,
    listBookableServices,
    listBookableDates,
    listBookableTimes,
    listBookableResources,
  } as unknown as YclientsApiClient;

  return {
    service: new YclientsAvailabilityService(yclients),
    checkBookableAppointment,
    listBookableServices,
    listBookableDates,
    listBookableTimes,
    listBookableResources,
  };
}

describe('YclientsAvailabilityService', () => {
  describe('booking preflight', () => {
    const query = Object.freeze({
      serviceId: 30_539_679,
      courtId: 5_730_531,
      datetime: '2026-08-05T16:30:00+03:00',
    });

    it('checks the selected service, court and datetime', async () => {
      const { service, checkBookableAppointment } = createSubject();
      checkBookableAppointment.mockResolvedValue({ outcome: 'bookable' });

      await expect(service.preflightBooking(query)).resolves.toEqual({
        outcome: 'bookable',
      });
      expect(checkBookableAppointment).toHaveBeenCalledTimes(1);
      expect(checkBookableAppointment).toHaveBeenCalledWith({
        serviceId: 30_539_679,
        resourceId: 5_730_531,
        datetime: '2026-08-05T16:30:00+03:00',
      });
    });

    it.each([
      { ...query, serviceId: 0 },
      { ...query, courtId: -1 },
      { ...query, datetime: '2026-08-05 16:30:00' },
      { ...query, datetime: '2026-02-30T16:30:00+03:00' },
    ])('rejects invalid preflight query %#', async (invalidQuery) => {
      const { service, checkBookableAppointment } = createSubject();

      await expect(service.preflightBooking(invalidQuery)).resolves.toEqual({
        outcome: 'invalid_request',
      });
      expect(checkBookableAppointment).not.toHaveBeenCalled();
    });

    it.each([
      'disabled',
      'not_bookable',
      'unauthorized',
      'invalid_response',
      'unavailable',
    ] as const)('preserves the preflight client outcome %s', async (outcome) => {
      const { service, checkBookableAppointment } = createSubject();
      checkBookableAppointment.mockResolvedValue({ outcome });

      await expect(service.preflightBooking(query)).resolves.toEqual({
        outcome,
      });
    });

    it('maps unexpected client failures to unavailable', async () => {
      const { service, checkBookableAppointment } = createSubject();
      checkBookableAppointment.mockRejectedValue(
        new Error('private upstream marker'),
      );

      await expect(service.preflightBooking(query)).resolves.toEqual({
        outcome: 'unavailable',
      });
    });
  });

  it('returns only unique active services using safe fields', async () => {
    const { service, listBookableServices } = createSubject();
    listBookableServices.mockResolvedValue({
      outcome: 'loaded',
      services: [
        {
          id: 30_539_679,
          title: 'Аренда корта 1ч.',
          categoryId: 27_980_310,
          active: true,
          privateMarker: 'not returned',
        },
        {
          id: 30_539_694,
          title: 'Аренда корта 1.5ч.',
          categoryId: 27_980_310,
          active: false,
        },
        {
          id: 30_539_886,
          title: 'Индивидуальная тренировка 1ч.',
          categoryId: 27_980_391,
          active: true,
        },
        {
          id: 30_539_679,
          title: 'Duplicate service',
          categoryId: 27_980_310,
          active: true,
        },
      ],
    });

    await expect(service.listActiveServices()).resolves.toEqual({
      outcome: 'loaded',
      services: [
        {
          id: 30_539_679,
          title: 'Аренда корта 1ч.',
          categoryId: 27_980_310,
        },
        {
          id: 30_539_886,
          title: 'Индивидуальная тренировка 1ч.',
          categoryId: 27_980_391,
        },
      ],
    });
    expect(listBookableServices).toHaveBeenCalledTimes(1);
    expect(listBookableServices).toHaveBeenCalledWith();
  });

  it('returns an empty loaded result when no services are active', async () => {
    const { service, listBookableServices } = createSubject();
    listBookableServices.mockResolvedValue({
      outcome: 'loaded',
      services: [
        {
          id: 30_539_694,
          title: 'Аренда корта 1.5ч.',
          categoryId: 27_980_310,
          active: false,
        },
      ],
    });

    await expect(service.listActiveServices()).resolves.toEqual({
      outcome: 'loaded',
      services: [],
    });
  });

  it.each([
    'disabled',
    'unauthorized',
    'invalid_response',
    'unavailable',
  ] as const)('preserves the services client outcome %s', async (outcome) => {
    const { service, listBookableServices } = createSubject();
    listBookableServices.mockResolvedValue({ outcome });

    await expect(service.listActiveServices()).resolves.toEqual({ outcome });
  });

  it('maps unexpected services client failures to unavailable', async () => {
    const { service, listBookableServices } = createSubject();
    listBookableServices.mockRejectedValue(
      new Error('private upstream marker'),
    );

    await expect(service.listActiveServices()).resolves.toEqual({
      outcome: 'unavailable',
    });
  });

  it.each([
    {
      serviceId: 0,
      courtId: 5_730_531,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    },
    {
      serviceId: 30_539_679,
      courtId: -1,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    },
    {
      serviceId: 30_539_679,
      courtId: 5_730_531,
      dateFrom: '05.08.2026',
      dateTo: '2026-08-18',
    },
    {
      serviceId: 30_539_679,
      courtId: 5_730_531,
      dateFrom: '2026-02-30',
      dateTo: '2026-03-01',
    },
    {
      serviceId: 30_539_679,
      courtId: 5_730_531,
      dateFrom: '2026-08-18',
      dateTo: '2026-08-05',
    },
    {
      serviceId: 30_539_679,
      courtId: 5_730_531,
      dateFrom: '2026-08-05',
      dateTo: '2026-09-05',
    },
  ])('rejects invalid dates query %# without calling YCLIENTS', async (query) => {
    const { service, listBookableDates } = createSubject();

    await expect(service.listAvailableDates(query)).resolves.toEqual({
      outcome: 'invalid_request',
    });
    expect(listBookableDates).not.toHaveBeenCalled();
  });

  it('returns unique sorted booking dates for the selected court', async () => {
    const { service, listBookableDates } = createSubject();
    listBookableDates.mockResolvedValue({
      outcome: 'loaded',
      workingDates: ['2026-08-05', '2026-08-06', '2026-08-07'],
      bookingDates: ['2026-08-07', '2026-08-05', '2026-08-05'],
    });

    await expect(
      service.listAvailableDates({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        dateFrom: '2026-08-05',
        dateTo: '2026-08-18',
      }),
    ).resolves.toEqual({
      outcome: 'loaded',
      dates: ['2026-08-05', '2026-08-07'],
    });
    expect(listBookableDates).toHaveBeenCalledTimes(1);
    expect(listBookableDates).toHaveBeenCalledWith({
      serviceIds: [30_539_679],
      resourceId: 5_730_531,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    });
  });

  it('returns an empty loaded result when no booking dates are available', async () => {
    const { service, listBookableDates } = createSubject();
    listBookableDates.mockResolvedValue({
      outcome: 'loaded',
      workingDates: ['2026-08-05'],
      bookingDates: [],
    });

    await expect(
      service.listAvailableDates({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        dateFrom: '2026-08-05',
        dateTo: '2026-08-05',
      }),
    ).resolves.toEqual({ outcome: 'loaded', dates: [] });
  });

  it('fails closed when YCLIENTS returns a date outside the requested range', async () => {
    const { service, listBookableDates } = createSubject();
    listBookableDates.mockResolvedValue({
      outcome: 'loaded',
      workingDates: ['2026-08-05'],
      bookingDates: ['2026-08-19'],
    });

    await expect(
      service.listAvailableDates({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        dateFrom: '2026-08-05',
        dateTo: '2026-08-18',
      }),
    ).resolves.toEqual({ outcome: 'invalid_response' });
  });

  it.each([
    'disabled',
    'unauthorized',
    'invalid_response',
    'unavailable',
  ] as const)('preserves the dates client outcome %s', async (outcome) => {
    const { service, listBookableDates } = createSubject();
    listBookableDates.mockResolvedValue({ outcome });

    await expect(
      service.listAvailableDates({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        dateFrom: '2026-08-05',
        dateTo: '2026-08-18',
      }),
    ).resolves.toEqual({ outcome });
  });

  it('maps unexpected dates client failures to unavailable', async () => {
    const { service, listBookableDates } = createSubject();
    listBookableDates.mockRejectedValue(
      new Error('private upstream marker'),
    );

    await expect(
      service.listAvailableDates({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        dateFrom: '2026-08-05',
        dateTo: '2026-08-18',
      }),
    ).resolves.toEqual({ outcome: 'unavailable' });
  });

  it.each([
    { serviceId: 0, courtId: 5_730_531, date: '2026-08-05' },
    { serviceId: 30_539_679, courtId: -1, date: '2026-08-05' },
    { serviceId: 30_539_679, courtId: 5_730_531, date: '05.08.2026' },
    { serviceId: 30_539_679, courtId: 5_730_531, date: '2026-02-30' },
  ])('rejects invalid times query %# without calling YCLIENTS', async (query) => {
    const { service, listBookableTimes } = createSubject();

    await expect(service.listAvailableTimes(query)).resolves.toEqual({
      outcome: 'invalid_request',
    });
    expect(listBookableTimes).not.toHaveBeenCalled();
  });

  it('returns unique sorted times using safe application fields', async () => {
    const { service, listBookableTimes } = createSubject();
    listBookableTimes.mockResolvedValue({
      outcome: 'loaded',
      times: [
        {
          time: '17:00',
          seanceLengthSeconds: 3_600,
          datetime: '2026-08-05T17:00:00+03:00',
          privateMarker: 'not returned',
        },
        {
          time: '16:30',
          seanceLengthSeconds: 3_600,
          datetime: '2026-08-05T16:30:00+03:00',
        },
        {
          time: '16:30',
          seanceLengthSeconds: 3_600,
          datetime: '2026-08-05T16:30:00+03:00',
        },
      ],
    });

    await expect(
      service.listAvailableTimes({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        date: '2026-08-05',
      }),
    ).resolves.toEqual({
      outcome: 'loaded',
      times: [
        {
          time: '16:30',
          durationSeconds: 3_600,
          datetime: '2026-08-05T16:30:00+03:00',
        },
        {
          time: '17:00',
          durationSeconds: 3_600,
          datetime: '2026-08-05T17:00:00+03:00',
        },
      ],
    });
    expect(listBookableTimes).toHaveBeenCalledTimes(1);
    expect(listBookableTimes).toHaveBeenCalledWith({
      serviceIds: [30_539_679],
      resourceId: 5_730_531,
      date: '2026-08-05',
    });
  });

  it('returns an empty loaded result when no times are available', async () => {
    const { service, listBookableTimes } = createSubject();
    listBookableTimes.mockResolvedValue({
      outcome: 'loaded',
      times: [],
    });

    await expect(
      service.listAvailableTimes({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        date: '2026-08-05',
      }),
    ).resolves.toEqual({ outcome: 'loaded', times: [] });
  });

  it('fails closed when duplicate local times conflict', async () => {
    const { service, listBookableTimes } = createSubject();
    listBookableTimes.mockResolvedValue({
      outcome: 'loaded',
      times: [
        {
          time: '16:30',
          seanceLengthSeconds: 3_600,
          datetime: '2026-08-05T16:30:00+03:00',
        },
        {
          time: '16:30',
          seanceLengthSeconds: 5_400,
          datetime: '2026-08-05T16:30:00+03:00',
        },
      ],
    });

    await expect(
      service.listAvailableTimes({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        date: '2026-08-05',
      }),
    ).resolves.toEqual({ outcome: 'invalid_response' });
  });

  it.each([
    'disabled',
    'unauthorized',
    'invalid_response',
    'unavailable',
  ] as const)('preserves the times client outcome %s', async (outcome) => {
    const { service, listBookableTimes } = createSubject();
    listBookableTimes.mockResolvedValue({ outcome });

    await expect(
      service.listAvailableTimes({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        date: '2026-08-05',
      }),
    ).resolves.toEqual({ outcome });
  });

  it('maps unexpected times client failures to unavailable', async () => {
    const { service, listBookableTimes } = createSubject();
    listBookableTimes.mockRejectedValue(
      new Error('private upstream marker'),
    );

    await expect(
      service.listAvailableTimes({
        serviceId: 30_539_679,
        courtId: 5_730_531,
        date: '2026-08-05',
      }),
    ).resolves.toEqual({ outcome: 'unavailable' });
  });

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
