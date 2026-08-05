import type { YclientsApiConfiguration } from '../../config/yclients-api.config';
import { YclientsApiClient } from './yclients-api.client';

const PARTNER_TOKEN = 'private-partner-token';
const USER_TOKEN = 'private-user-token';
const COMPANY_ID = 2079564;

function runtime(
  overrides: Partial<YclientsApiConfiguration> = {},
): YclientsApiConfiguration {
  return {
    enabled: true,
    baseUrl: 'https://api.example.test/vendor',
    companyId: COMPANY_ID,
    partnerToken: PARTNER_TOKEN,
    userToken: USER_TOKEN,
    ...overrides,
  };
}

function fetchMock(): jest.MockedFunction<typeof globalThis.fetch> {
  return jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(
  fetch: jest.MockedFunction<typeof globalThis.fetch>,
  configuration: YclientsApiConfiguration = runtime(),
): YclientsApiClient {
  return new YclientsApiClient({
    runtime: configuration,
    requestTimeoutMilliseconds: 5_000,
    fetch,
  });
}

describe('YclientsApiClient', () => {
  describe('bookable times', () => {
    const query = Object.freeze({
      serviceIds: [30_539_679],
      resourceId: 5_730_531,
      date: '2026-08-05',
    });

    it('does not perform a network request while disabled', async () => {
      const fetch = fetchMock();

      await expect(
        client(fetch, runtime({ enabled: false })).listBookableTimes(query),
      ).resolves.toEqual({ outcome: 'disabled' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('loads validated free times using the partner token', async () => {
      const fetch = fetchMock().mockResolvedValue(
        response(200, {
          success: true,
          data: [
            {
              time: '16:30',
              seance_length: 3_600,
              datetime: '2026-08-05T16:30:00+03:00',
              private: 'ignored-marker',
            },
          ],
        }),
      );

      await expect(client(fetch).listBookableTimes(query)).resolves.toEqual({
        outcome: 'loaded',
        times: [
          {
            time: '16:30',
            seanceLengthSeconds: 3_600,
            datetime: '2026-08-05T16:30:00+03:00',
          },
        ],
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      expect(String(input)).toBe(
        'https://api.example.test/vendor/api/v1/book_times/2079564/5730531/2026-08-05?service_ids%5B%5D=30539679',
      );
      expect(init).toEqual(
        expect.objectContaining({
          method: 'GET',
          headers: {
            accept: 'application/vnd.yclients.v2+json',
            authorization: `Bearer ${PARTNER_TOKEN}`,
          },
        }),
      );
    });

    it('normalizes a single-digit provider hour', async () => {
      const fetch = fetchMock().mockResolvedValue(
        response(200, {
          success: true,
          data: [
            {
              time: '7:00',
              seance_length: 3_600,
              datetime: '2026-08-05T07:00:00+03:00',
            },
          ],
        }),
      );

      await expect(client(fetch).listBookableTimes(query)).resolves.toEqual({
        outcome: 'loaded',
        times: [
          {
            time: '07:00',
            seanceLengthSeconds: 3_600,
            datetime: '2026-08-05T07:00:00+03:00',
          },
        ],
      });
    });

    it.each([401, 403])(
      'maps authorization status %s safely',
      async (status) => {
        const fetch = fetchMock().mockResolvedValue(
          response(status, { private: 'response marker' }),
        );

        await expect(client(fetch).listBookableTimes(query)).resolves.toEqual({
          outcome: 'unauthorized',
        });
      },
    );

    it.each([
      [{ ...query, serviceIds: [] }],
      [{ ...query, serviceIds: [0] }],
      [{ ...query, resourceId: 0 }],
      [{ ...query, date: '2026-02-30' }],
    ])('fails closed before fetch for invalid query %#', async (invalidQuery) => {
      const fetch = fetchMock();

      await expect(
        client(fetch).listBookableTimes(invalidQuery),
      ).resolves.toEqual({ outcome: 'invalid_response' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      [200, { success: true, data: {} }, 'invalid_response'],
      [
        200,
        {
          success: true,
          data: [
            {
              time: '16:30',
              seance_length: 3_600,
              datetime: '2026-08-06T16:30:00+03:00',
            },
          ],
        },
        'invalid_response',
      ],
      [
        200,
        {
          success: true,
          data: [
            {
              time: '24:00',
              seance_length: 3_600,
              datetime: '2026-08-05T24:00:00+03:00',
            },
          ],
        },
        'invalid_response',
      ],
      [429, { success: false }, 'unavailable'],
      [500, { success: false }, 'unavailable'],
    ] as const)(
      'maps status %s and time response shape to %s',
      async (status, body, outcome) => {
        const fetch = fetchMock().mockResolvedValue(response(status, body));

        await expect(client(fetch).listBookableTimes(query)).resolves.toEqual({
          outcome,
        });
      },
    );

    it('maps transport failures without exposing the exception', async () => {
      const fetch = fetchMock().mockRejectedValue(
        new Error('private network marker'),
      );

      await expect(client(fetch).listBookableTimes(query)).resolves.toEqual({
        outcome: 'unavailable',
      });
    });
  });

  describe('bookable dates', () => {
    const query = Object.freeze({
      serviceIds: [30_539_679],
      resourceId: 5_730_531,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    });

    it('does not perform a network request while disabled', async () => {
      const fetch = fetchMock();

      await expect(
        client(fetch, runtime({ enabled: false })).listBookableDates(query),
      ).resolves.toEqual({ outcome: 'disabled' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('loads validated working and booking dates using the partner token', async () => {
      const fetch = fetchMock().mockResolvedValue(
        response(200, {
          success: true,
          data: {
            working_dates: ['2026-08-05', '2026-08-06', '2026-08-06'],
            booking_dates: ['2026-08-05'],
            working_days: { private: 'ignored-marker' },
            booking_days: { private: 'ignored-marker' },
          },
        }),
      );

      await expect(client(fetch).listBookableDates(query)).resolves.toEqual({
        outcome: 'loaded',
        workingDates: ['2026-08-05', '2026-08-06'],
        bookingDates: ['2026-08-05'],
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      expect(String(input)).toBe(
        'https://api.example.test/vendor/api/v1/book_dates/2079564?service_ids%5B%5D=30539679&staff_id=5730531&date_from=2026-08-05&date_to=2026-08-18',
      );
      expect(init).toEqual(
        expect.objectContaining({
          method: 'GET',
          headers: {
            accept: 'application/vnd.yclients.v2+json',
            authorization: `Bearer ${PARTNER_TOKEN}`,
          },
        }),
      );
    });

    it.each([401, 403])(
      'maps authorization status %s safely',
      async (status) => {
        const fetch = fetchMock().mockResolvedValue(
          response(status, { private: 'response marker' }),
        );

        await expect(client(fetch).listBookableDates(query)).resolves.toEqual({
          outcome: 'unauthorized',
        });
      },
    );

    it.each([
      [{ ...query, serviceIds: [] }],
      [{ ...query, serviceIds: [0] }],
      [{ ...query, resourceId: 0 }],
      [{ ...query, dateFrom: '2026-02-30' }],
      [{ ...query, dateFrom: '2026-08-19' }],
      [{ ...query, dateTo: '2026-09-30' }],
    ])('fails closed before fetch for invalid query %#', async (invalidQuery) => {
      const fetch = fetchMock();

      await expect(
        client(fetch).listBookableDates(invalidQuery),
      ).resolves.toEqual({ outcome: 'invalid_response' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      [200, { success: true, data: [] }, 'invalid_response'],
      [
        200,
        {
          success: true,
          data: {
            working_dates: ['2026-08-05'],
            booking_dates: ['not-a-date'],
          },
        },
        'invalid_response',
      ],
      [429, { success: false }, 'unavailable'],
      [500, { success: false }, 'unavailable'],
    ] as const)(
      'maps status %s and date response shape to %s',
      async (status, body, outcome) => {
        const fetch = fetchMock().mockResolvedValue(response(status, body));

        await expect(client(fetch).listBookableDates(query)).resolves.toEqual({
          outcome,
        });
      },
    );

    it('maps transport failures without exposing the exception', async () => {
      const fetch = fetchMock().mockRejectedValue(
        new Error('private network marker'),
      );

      await expect(client(fetch).listBookableDates(query)).resolves.toEqual({
        outcome: 'unavailable',
      });
    });
  });

  describe('bookable resources', () => {
    it('does not perform a network request while disabled', async () => {
      const fetch = fetchMock();

      await expect(
        client(fetch, runtime({ enabled: false })).listBookableResources(),
      ).resolves.toEqual({ outcome: 'disabled' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('loads only safe resource fields using the partner token', async () => {
      const fetch = fetchMock().mockResolvedValue(
        response(200, {
          success: true,
          data: [
            {
              id: 5_730_531,
              name: '  Корт №1  ',
              specialization: '  Корт №1  ',
              position: { id: 1, title: '  Корт  ' },
              bookable: true,
              rating: 5,
              avatar: 'private-avatar-marker',
              information: 'private-information-marker',
            },
          ],
        }),
      );

      await expect(
        client(fetch).listBookableResources([30_539_679, 30_539_679]),
      ).resolves.toEqual({
        outcome: 'loaded',
        resources: [
          {
            id: 5_730_531,
            name: 'Корт №1',
            specialization: 'Корт №1',
            positionTitle: 'Корт',
            bookable: true,
          },
        ],
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      expect(String(input)).toBe(
        'https://api.example.test/vendor/api/v1/book_staff/2079564?service_ids%5B%5D=30539679',
      );
      expect(init).toEqual(
        expect.objectContaining({
          method: 'GET',
          headers: {
            accept: 'application/vnd.yclients.v2+json',
            authorization: `Bearer ${PARTNER_TOKEN}`,
          },
        }),
      );
    });

    it('loads all bookable resources when no service filter is provided', async () => {
      const fetch = fetchMock().mockResolvedValue(
        response(200, {
          success: true,
          data: [
            {
              id: 5_762_322,
              name: 'Тренер',
              specialization: '',
              position: null,
              bookable: true,
            },
          ],
        }),
      );

      await expect(client(fetch).listBookableResources()).resolves.toEqual({
        outcome: 'loaded',
        resources: [
          {
            id: 5_762_322,
            name: 'Тренер',
            specialization: '',
            bookable: true,
          },
        ],
      });

      expect(String(fetch.mock.calls[0][0])).toBe(
        'https://api.example.test/vendor/api/v1/book_staff/2079564',
      );
    });

    it.each([401, 403])(
      'maps authorization status %s safely',
      async (status) => {
        const fetch = fetchMock().mockResolvedValue(
          response(status, { private: 'response marker' }),
        );

        await expect(client(fetch).listBookableResources()).resolves.toEqual({
          outcome: 'unauthorized',
        });
      },
    );

    it.each([
      [200, { success: true, data: {} }, 'invalid_response'],
      [
        200,
        {
          success: true,
          data: [
            {
              id: 5_730_531,
              name: '',
              specialization: 'Корт №1',
              bookable: true,
            },
          ],
        },
        'invalid_response',
      ],
      [429, { success: false }, 'unavailable'],
      [500, { success: false }, 'unavailable'],
    ] as const)(
      'maps status %s and resource response shape to %s',
      async (status, body, outcome) => {
        const fetch = fetchMock().mockResolvedValue(response(status, body));

        await expect(client(fetch).listBookableResources()).resolves.toEqual({
          outcome,
        });
      },
    );

    it.each([[0], [-1], [Number.MAX_SAFE_INTEGER + 1]])(
      'fails closed before fetch for invalid service filters %#',
      async (serviceId) => {
        const fetch = fetchMock();

        await expect(
          client(fetch).listBookableResources([serviceId]),
        ).resolves.toEqual({ outcome: 'invalid_response' });
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it('maps transport failures without exposing the exception', async () => {
      const fetch = fetchMock().mockRejectedValue(
        new Error('private network marker'),
      );

      await expect(client(fetch).listBookableResources()).resolves.toEqual({
        outcome: 'unavailable',
      });
    });
  });

  describe('bookable services', () => {
    it('does not perform a network request while disabled', async () => {
      const fetch = fetchMock();

      await expect(
        client(fetch, runtime({ enabled: false })).listBookableServices(),
      ).resolves.toEqual({ outcome: 'disabled' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('loads only safe catalog fields using the partner token', async () => {
      const fetch = fetchMock().mockResolvedValue(
        response(200, {
          success: true,
          data: {
            services: [
              {
                id: 30_539_679,
                title: '  Аренда корта 1ч.  ',
                category_id: 27_980_310,
                active: 1,
                price_min: 4_000,
                price_max: 5_000,
                prepaid: 'private-payment-marker',
                comment: 'private-comment-marker',
              },
            ],
          },
        }),
      );

      await expect(client(fetch).listBookableServices()).resolves.toEqual({
        outcome: 'loaded',
        services: [
          {
            id: 30_539_679,
            title: 'Аренда корта 1ч.',
            categoryId: 27_980_310,
            active: true,
          },
        ],
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      expect(String(input)).toBe(
        'https://api.example.test/vendor/api/v1/book_services/2079564',
      );
      expect(init).toEqual(
        expect.objectContaining({
          method: 'GET',
          headers: {
            accept: 'application/vnd.yclients.v2+json',
            authorization: `Bearer ${PARTNER_TOKEN}`,
          },
        }),
      );
    });

    it.each([401, 403])(
      'maps authorization status %s safely',
      async (status) => {
        const fetch = fetchMock().mockResolvedValue(
          response(status, { private: 'response marker' }),
        );

        await expect(client(fetch).listBookableServices()).resolves.toEqual({
          outcome: 'unauthorized',
        });
      },
    );

    it.each([
      [200, { success: true, data: [] }, 'invalid_response'],
      [
        200,
        {
          success: true,
          data: {
            services: [
              {
                id: 30_539_679,
                title: '',
                category_id: 27_980_310,
                active: 1,
              },
            ],
          },
        },
        'invalid_response',
      ],
      [429, { success: false }, 'unavailable'],
      [500, { success: false }, 'unavailable'],
    ] as const)(
      'maps status %s and service response shape to %s',
      async (status, body, outcome) => {
        const fetch = fetchMock().mockResolvedValue(response(status, body));

        await expect(client(fetch).listBookableServices()).resolves.toEqual({
          outcome,
        });
      },
    );

    it('fails closed before fetch for an incomplete enabled configuration', async () => {
      const fetch = fetchMock();

      await expect(
        client(fetch, runtime({ partnerToken: '' })).listBookableServices(),
      ).resolves.toEqual({ outcome: 'invalid_response' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('maps transport failures without exposing the exception', async () => {
      const fetch = fetchMock().mockRejectedValue(
        new Error('private network marker'),
      );

      await expect(client(fetch).listBookableServices()).resolves.toEqual({
        outcome: 'unavailable',
      });
    });
  });

  it('does not perform a network request while disabled', async () => {
    const fetch = fetchMock();

    await expect(
      client(fetch, runtime({ enabled: false })).probeConfiguredCompany(),
    ).resolves.toEqual({ outcome: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists accessible companies using the partner and application user tokens', async () => {
    const fetch = fetchMock().mockResolvedValue(
      response(200, {
        success: true,
        data: [{ id: COMPANY_ID, title: 'Prosto Padel' }],
      }),
    );

    await expect(client(fetch).probeConfiguredCompany()).resolves.toEqual({
      outcome: 'verified',
      companyId: COMPANY_ID,
      title: 'Prosto Padel',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    expect(String(input)).toBe(
      'https://api.example.test/vendor/api/v1/companies?my=1',
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: 'GET',
        headers: {
          accept: 'application/vnd.yclients.v2+json',
          authorization: `Bearer ${PARTNER_TOKEN}, User ${USER_TOKEN}`,
        },
      }),
    );
  });

  it.each([401, 403])('maps authorization status %s safely', async (status) => {
    const fetch = fetchMock().mockResolvedValue(
      response(status, { private: 'response marker' }),
    );

    await expect(client(fetch).probeConfiguredCompany()).resolves.toEqual({
      outcome: 'unauthorized',
    });
  });

  it('rejects a response without the configured company', async () => {
    const fetch = fetchMock().mockResolvedValue(
      response(200, { success: true, data: [{ id: COMPANY_ID + 1 }] }),
    );

    await expect(client(fetch).probeConfiguredCompany()).resolves.toEqual({
      outcome: 'company_not_found',
    });
  });

  it.each([
    [200, { success: false, data: [] }, 'invalid_response'],
    [200, { success: true, data: 'not-an-array' }, 'invalid_response'],
    [429, { success: false }, 'unavailable'],
    [500, { success: false }, 'unavailable'],
  ] as const)(
    'maps status %s and response shape to %s',
    async (status, body, outcome) => {
      const fetch = fetchMock().mockResolvedValue(response(status, body));

      await expect(client(fetch).probeConfiguredCompany()).resolves.toEqual({
        outcome,
      });
    },
  );

  it.each([
    { companyId: undefined },
    { partnerToken: '' },
    { userToken: '' },
  ] satisfies ReadonlyArray<Partial<YclientsApiConfiguration>>)(
    'fails closed before fetch for incomplete enabled configuration %#',
    async (overrides) => {
      const fetch = fetchMock();

      await expect(
        client(fetch, runtime(overrides)).probeConfiguredCompany(),
      ).resolves.toEqual({ outcome: 'invalid_response' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('maps transport failures without exposing the exception', async () => {
    const fetch = fetchMock().mockRejectedValue(
      new Error('private network marker'),
    );

    await expect(client(fetch).probeConfiguredCompany()).resolves.toEqual({
      outcome: 'unavailable',
    });
  });
});
