const { test, expect } = require('@playwright/test');

const CREDENTIAL = Buffer.alloc(32, 0x71).toString('base64url');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('reads services, courts, dates and times using only authenticated GET requests', async ({
  page,
}) => {
  const summary = await page.evaluate(async (credential) => {
    const { createBookingAvailabilityClient } = await import(
      '/src/lib/bookingAvailabilityClient.js'
    );
    const calls = [];
    const bodies = new Map([
      ['/api/v1/bookings/services', {
        services: [
          { id: 30539679, title: 'Аренда корта 1ч.', categoryId: 27980310 },
        ],
      }],
      ['/api/v1/bookings/services/30539679/courts', {
        courts: [{ id: 5730531, name: 'Корт №1' }],
      }],
      [
        '/api/v1/bookings/services/30539679/courts/5730531/dates' +
          '?dateFrom=2026-08-05&dateTo=2026-08-18',
        { dates: ['2026-08-05', '2026-08-06'] },
      ],
      [
        '/api/v1/bookings/services/30539679/courts/5730531/times' +
          '?date=2026-08-05',
        {
          times: [
            {
              time: '16:30',
              durationSeconds: 3600,
              datetime: '2026-08-05T16:30:00+03:00',
            },
          ],
        },
      ],
    ]);
    const client = createBookingAvailabilityClient({
      fetchImpl: async (path, options) => {
        calls.push({
          path,
          method: options.method,
          cache: options.cache,
          credentials: options.credentials,
          redirect: options.redirect,
          acceptsJson: options.headers.Accept === 'application/json',
          authorizationMatches:
            options.headers.Authorization === `Bearer ${credential}`,
        });
        return new Response(JSON.stringify(bodies.get(path)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const services = await client.listServices(credential);
    const courts = await client.listCourts(credential, 30539679);
    const dates = await client.listDates(credential, {
      serviceId: 30539679,
      courtId: 5730531,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    });
    const times = await client.listTimes(credential, {
      serviceId: 30539679,
      courtId: 5730531,
      date: '2026-08-05',
    });
    return { calls, services, courts, dates, times };
  }, CREDENTIAL);

  expect(summary.calls).toHaveLength(4);
  expect(summary.calls.every((call) =>
    call.method === 'GET' &&
    call.cache === 'no-store' &&
    call.credentials === 'omit' &&
    call.redirect === 'error' &&
    call.acceptsJson &&
    call.authorizationMatches)).toBe(true);
  expect(summary.services).toEqual({
    outcome: 'services_loaded',
    services: [
      { id: 30539679, title: 'Аренда корта 1ч.', categoryId: 27980310 },
    ],
  });
  expect(summary.courts).toEqual({
    outcome: 'courts_loaded',
    courts: [{ id: 5730531, name: 'Корт №1' }],
  });
  expect(summary.dates).toEqual({
    outcome: 'dates_loaded',
    dates: ['2026-08-05', '2026-08-06'],
  });
  expect(summary.times).toEqual({
    outcome: 'times_loaded',
    times: [
      {
        time: '16:30',
        durationSeconds: 3600,
        datetime: '2026-08-05T16:30:00+03:00',
      },
    ],
  });
});

test('rejects invalid input before fetch', async ({ page }) => {
  const summary = await page.evaluate(async (credential) => {
    const { createBookingAvailabilityClient } = await import(
      '/src/lib/bookingAvailabilityClient.js'
    );
    let calls = 0;
    const client = createBookingAvailabilityClient({
      fetchImpl: async () => {
        calls += 1;
        throw new Error('must not run');
      },
    });
    return {
      calls,
      invalidCredential: await client.listServices('invalid'),
      invalidCourt: await client.listCourts(credential, 0),
      invalidDates: await client.listDates(credential, {
        serviceId: 30539679,
        courtId: 5730531,
        dateFrom: '2026-08-18',
        dateTo: '2026-08-05',
      }),
      invalidTimeDate: await client.listTimes(credential, {
        serviceId: 30539679,
        courtId: 5730531,
        date: '2026-02-30',
      }),
    };
  }, CREDENTIAL);

  expect(summary.calls).toBe(0);
  expect(summary.invalidCredential).toEqual({
    outcome: 'rejected',
    reason: 'invalid',
  });
  for (const result of [
    summary.invalidCourt,
    summary.invalidDates,
    summary.invalidTimeDate,
  ]) {
    expect(result).toEqual({ outcome: 'rejected', reason: 'invalid_request' });
  }
});

test('maps provider failures and malformed bodies without leaking details', async ({
  page,
}) => {
  const summary = await page.evaluate(async (credential) => {
    const { createBookingAvailabilityClient } = await import(
      '/src/lib/bookingAvailabilityClient.js'
    );
    const makeClient = (response) => createBookingAvailabilityClient({
      fetchImpl: async () => response(),
    });
    const response = (status, body) => () => new Response(
      JSON.stringify(body),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
    return {
      unauthorized: await makeClient(response(401, { private: 'marker' }))
        .listServices(credential),
      unavailable: await makeClient(response(503, { private: 'marker' }))
        .listServices(credential),
      badGateway: await makeClient(response(502, { private: 'marker' }))
        .listServices(credential),
      malformed: await makeClient(response(200, {
        services: [{ id: 1, title: 'Service', categoryId: 1, private: 'marker' }],
      })).listServices(credential),
    };
  }, CREDENTIAL);

  expect(summary).toEqual({
    unauthorized: { outcome: 'rejected', reason: 'invalid' },
    unavailable: { outcome: 'rejected', reason: 'unavailable' },
    badGateway: { outcome: 'rejected', reason: 'invalid_response' },
    malformed: { outcome: 'rejected', reason: 'invalid_response' },
  });
  expect(JSON.stringify(summary)).not.toContain('marker');
});

test('keeps the credential private while lifecycle reads booking availability', async ({
  page,
}) => {
  const summary = await page.evaluate(async (parameters) => {
    const { createTelegramBackendLoginLifecycle } = await import(
      '/src/hooks/useTelegramBackendLogin.js'
    );
    let credentialMatched = true;
    const calls = [];
    const checkCredential = (credential, operation) => {
      credentialMatched =
        credentialMatched && credential === parameters.credential;
      calls.push(operation);
    };
    const lifecycle = createTelegramBackendLoginLifecycle({
      fingerprint: async () => 'booking-availability-fingerprint',
      client: {
        async login() {
          return {
            outcome: 'authenticated',
            credential: parameters.credential,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            accountKind: 'existing',
          };
        },
      },
      sessions: {
        async authenticate(credential) {
          checkCredential(credential, 'authenticate');
          return {
            outcome: 'authenticated',
            principal: {
              accountId: parameters.accountId,
              role: 'player',
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            },
          };
        },
      },
      bookings: {
        async listServices(credential) {
          checkCredential(credential, 'services');
          return { outcome: 'services_loaded', services: [] };
        },
        async listCourts(credential, serviceId) {
          checkCredential(credential, 'courts');
          return {
            outcome: 'courts_loaded',
            courts: [{ id: 5730531, name: `Корт для ${serviceId}` }],
          };
        },
        async listDates(credential, query) {
          checkCredential(credential, 'dates');
          return { outcome: 'dates_loaded', dates: [query.dateFrom] };
        },
        async listTimes(credential, query) {
          checkCredential(credential, 'times');
          return {
            outcome: 'times_loaded',
            times: [{
              time: '16:30',
              durationSeconds: 3600,
              datetime: `${query.date}T16:30:00+03:00`,
            }],
          };
        },
      },
      credentialStorage: {
        async read() {
          return { outcome: 'empty' };
        },
        async write() {
          return { outcome: 'stored' };
        },
        async remove() {
          return { outcome: 'removed' };
        },
      },
    });

    const detach = lifecycle.attach('synthetic-init-data', () => {});
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (lifecycle.hasPrincipal()) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const services = await lifecycle.listBookingServices();
    const courts = await lifecycle.listBookingCourts(30539679);
    const dates = await lifecycle.listBookingDates({
      serviceId: 30539679,
      courtId: 5730531,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    });
    const times = await lifecycle.listBookingTimes({
      serviceId: 30539679,
      courtId: 5730531,
      date: '2026-08-05',
    });
    detach();

    return {
      credentialMatched,
      calls,
      services,
      courts,
      dates,
      times,
      publicResultsHideCredential:
        !JSON.stringify({ services, courts, dates, times })
          .includes(parameters.credential),
    };
  }, {
    credential: CREDENTIAL,
    accountId: '11111111-1111-4111-8111-111111111111',
  });

  expect(summary).toEqual({
    credentialMatched: true,
    calls: ['authenticate', 'services', 'courts', 'dates', 'times'],
    services: { outcome: 'services_loaded', services: [] },
    courts: {
      outcome: 'courts_loaded',
      courts: [{ id: 5730531, name: 'Корт для 30539679' }],
    },
    dates: { outcome: 'dates_loaded', dates: ['2026-08-05'] },
    times: {
      outcome: 'times_loaded',
      times: [{
        time: '16:30',
        durationSeconds: 3600,
        datetime: '2026-08-05T16:30:00+03:00',
      }],
    },
    publicResultsHideCredential: true,
  });
});

test('renders backend availability in read-only booking mode', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-05T06:00:00.000Z') });

  const factorySummary = await page.evaluate(async () => {
    const reactModule = await import('/@id/react');
    const React = reactModule.default ?? reactModule;
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { createRoot } =
      reactDomClientModule.default ?? reactDomClientModule;
    const { default: BookingScreen } = await import(
      '/src/components/BookingScreen.jsx'
    );
    const { createBackendBookingAvailabilityActions } = await import(
      '/src/components/AuthGate.jsx'
    );

    const calls = [];
    let writes = 0;
    const login = {
      sessionReady: true,
      async listBookingServices() {
        calls.push({ operation: 'services' });
        return {
          outcome: 'services_loaded',
          services: [
            {
              id: 30539694,
              title: 'Аренда корта 1.5ч.',
              categoryId: 27980310,
            },
            {
              id: 30539748,
              title: 'Аренда корта 1.5ч. Прайм',
              categoryId: 27980310,
            },
            {
              id: 30539922,
              title: 'Индивид 1ч.',
              categoryId: 27980391,
            },
          ],
        };
      },
      async listBookingCourts(serviceId) {
        calls.push({ operation: 'courts', serviceId });
        return {
          outcome: 'courts_loaded',
          courts: [
            { id: 5730531, name: 'Корт №1' },
            { id: 5762241, name: 'Корт №2' },
          ],
        };
      },
      async listBookingDates(query) {
        calls.push({ operation: 'dates', ...query });
        return { outcome: 'dates_loaded', dates: [query.dateFrom] };
      },
      async listBookingTimes(query) {
        calls.push({ operation: 'times', ...query });
        if (query.serviceId === 30539694) {
          return { outcome: 'rejected', reason: 'invalid_response' };
        }
        const time = '17:00';
        return {
          outcome: 'times_loaded',
          times: [{
            time,
            durationSeconds: 5_400,
            datetime: `${query.date}T${time}:00+03:00`,
          }],
        };
      },
    };
    const availabilityActions =
      createBackendBookingAvailabilityActions(login);
    const container = document.createElement('div');
    container.dataset.testid = 'booking-readonly-root';
    document.body.append(container);
    createRoot(container).render(React.createElement(BookingScreen, {
      availabilityActions,
      onBookSlot() {
        writes += 1;
      },
    }));
    window.__bookingReadOnlySummary = { calls, get writes() { return writes; } };

    return {
      actionsFrozen: Object.isFrozen(availabilityActions),
      disabledWithoutSession:
        createBackendBookingAvailabilityActions({ sessionReady: false }) === null,
    };
  });

  expect(factorySummary).toEqual({
    actionsFrozen: true,
    disabledWithoutSession: true,
  });

  const root = page.getByTestId('booking-readonly-root');
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Показаны доступные слоты. Часть вариантов услуги временно недоступна.',
  );
  await expect(root.getByRole('button', { name: 'Корт №1' })).toBeVisible();
  await expect(root.getByRole('button', { name: '1,5 ч' })).toBeEnabled();
  await expect(root.getByRole('button', { name: '2,5 ч' })).toBeDisabled();

  const primeTime = root.getByRole('button', {
    name: '17:00 Свободно',
  });
  await expect(primeTime).toBeEnabled();
  await expect(primeTime).toContainText('Свободно');

  await primeTime.click();
  const dialog = root.getByRole('dialog', { name: 'Подтверждение брони' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Только просмотр' }))
    .toBeDisabled();
  await expect(dialog).toContainText(
    'Создание брони подключим отдельным этапом.',
  );

  const summary = await page.evaluate(() => ({
    calls: window.__bookingReadOnlySummary.calls,
    writes: window.__bookingReadOnlySummary.writes,
  }));
  expect(summary.writes).toBe(0);
  expect(summary.calls).toEqual([
    { operation: 'services' },
    { operation: 'courts', serviceId: 30539694 },
    { operation: 'courts', serviceId: 30539748 },
    {
      operation: 'dates',
      serviceId: 30539694,
      courtId: 5730531,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    },
    {
      operation: 'dates',
      serviceId: 30539748,
      courtId: 5730531,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    },
    {
      operation: 'times',
      serviceId: 30539694,
      courtId: 5730531,
      date: '2026-08-05',
    },
    {
      operation: 'times',
      serviceId: 30539748,
      courtId: 5730531,
      date: '2026-08-05',
    },
  ]);
});
