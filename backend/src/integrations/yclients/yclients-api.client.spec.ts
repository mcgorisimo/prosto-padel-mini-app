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
