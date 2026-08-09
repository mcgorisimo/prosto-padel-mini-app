const { test, expect } = require('@playwright/test');

const TELEGRAM_SDK_ROUTE = 'https://telegram.org/js/telegram-web-app.js';
const CREDENTIAL = Buffer.alloc(32, 0x71).toString('base64url');

async function isolateComponentHarness(page) {
  await page.evaluate(() => {
    const applicationRoot = document.getElementById('root');
    if (applicationRoot) {
      applicationRoot.style.display = 'none';
      applicationRoot.setAttribute('aria-hidden', 'true');
    }
  });
}

test.beforeEach(async ({ page }) => {
  await page.route(TELEGRAM_SDK_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    });
  });
  await page.goto('/');
});

test('maps persisted owner bookings to truthful Home events', async ({ page }) => {
  const summary = await page.evaluate(async () => {
    const {
      getBackendBookingStatusPresentation,
      selectBackendReservationsForHome,
      selectMissingBookingCourtServiceIds,
    } = await import('/src/lib/backendBookingHomeAdapter.js');
    const reservation = {
      reservationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      status: 'pending_confirmation',
      serviceId: 30539748,
      courtId: 5730531,
      startsAt: '2035-08-12T20:30:00+03:00',
      endsAt: '2035-08-12T22:00:00+03:00',
      stale: true,
    };
    const visible = selectBackendReservationsForHome(
      [
        reservation,
        { ...reservation, reservationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'rejected' },
        { ...reservation, reservationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'cancelled' },
        {
          ...reservation,
          reservationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          startsAt: '2020-08-12T20:30:00+03:00',
          endsAt: '2020-08-12T22:00:00+03:00',
        },
      ],
      Date.parse('2035-08-12T19:00:00+03:00'),
      { 5730531: 'Корт №1' },
    );
    const withoutCatalog = selectBackendReservationsForHome(
      [reservation],
      Date.parse('2035-08-12T19:00:00+03:00'),
    );
    const catalogServiceIds = selectMissingBookingCourtServiceIds(
      Array.from({ length: 10 }, (_, index) => ({
        serviceId: 100 + index,
        courtId: 200 + index,
      })),
      {},
      new Set(),
    );
    return {
      visible,
      fallbackCourtName: withoutCatalog[0]?.courtName,
      catalogServiceIds,
      pending: getBackendBookingStatusPresentation('pending_confirmation'),
      unknown: getBackendBookingStatusPresentation('unknown'),
      confirmed: getBackendBookingStatusPresentation('confirmed'),
      cancelled: getBackendBookingStatusPresentation('cancelled'),
    };
  });

  expect(summary.visible).toHaveLength(1);
  expect(summary.visible[0]).toMatchObject({
    id: 'reservation:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    reservationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    type: 'private',
    isBackendReservation: true,
    reservationStatus: 'pending_confirmation',
    stale: true,
    dateISO: '2035-08-12',
    time: '20:30',
    duration: 1.5,
    courtId: 5730531,
    courtName: 'Корт №1',
  });
  expect(summary.fallbackCourtName).toBe('Корт');
  expect(summary.catalogServiceIds).toEqual([100, 101, 102, 103, 104, 105, 106, 107]);
  expect(summary.pending).toEqual({ label: 'Ожидает', tone: 'pending' });
  expect(summary.unknown).toEqual({ label: 'Уточняется', tone: 'pending' });
  expect(summary.confirmed).toEqual({ label: 'Подтверждено', tone: 'confirmed' });
  expect(summary.cancelled).toEqual({ label: 'Отменено', tone: 'cancelled' });
});

test('removes an admin-deleted reservation from active Home after refreshed state is loaded', async ({
  page,
}) => {
  const summary = await page.evaluate(async () => {
    const { selectBackendReservationsForHome } = await import(
      '/src/lib/backendBookingHomeAdapter.js'
    );
    const confirmed = {
      reservationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      status: 'confirmed',
      serviceId: 30539748,
      courtId: 5730531,
      startsAt: '2035-08-12T20:30:00+03:00',
      endsAt: '2035-08-12T22:00:00+03:00',
      stale: false,
    };
    const now = Date.parse('2035-08-12T19:00:00+03:00');
    return {
      beforeRefresh: selectBackendReservationsForHome([confirmed], now),
      afterRefresh: selectBackendReservationsForHome([
        { ...confirmed, status: 'cancelled' },
      ], now),
    };
  });

  expect(summary.beforeRefresh).toHaveLength(1);
  expect(summary.afterRefresh).toEqual([]);
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

test('creates exactly one authenticated booking without payment fields', async ({
  page,
}) => {
  const summary = await page.evaluate(async (credential) => {
    const { createBookingAvailabilityClient } = await import(
      '/src/lib/bookingAvailabilityClient.js'
    );
    const calls = [];
    const client = createBookingAvailabilityClient({
      fetchImpl: async (path, options) => {
        calls.push({
          path,
          method: options.method,
          cache: options.cache,
          credentials: options.credentials,
          redirect: options.redirect,
          acceptsJson: options.headers.Accept === 'application/json',
          sendsJson: options.headers['Content-Type'] === 'application/json',
          authorizationMatches:
            options.headers.Authorization === `Bearer ${credential}`,
          body: JSON.parse(options.body),
        });
        return new Response(JSON.stringify({
          reservationId: '22222222-2222-4222-8222-222222222222',
          status: 'confirmed', serviceId: 30539679, courtId: 5730531,
          startsAt: '2026-08-06T07:00:00+03:00',
          endsAt: '2026-08-06T08:00:00+03:00', stale: false,
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const result = await client.createBooking(credential, {
      requestKey: '11111111-1111-4111-8111-111111111111',
      serviceId: 30539679,
      courtId: 5730531,
      datetime: '2026-08-06T07:00:00+03:00',
      email: 'test@example.test',
    });
    return { calls, result };
  }, CREDENTIAL);

  expect(summary.result).toEqual({
    outcome: 'booking_created',
    reservation: {
      reservationId: '22222222-2222-4222-8222-222222222222',
      status: 'confirmed', serviceId: 30539679, courtId: 5730531,
      startsAt: '2026-08-06T07:00:00+03:00',
      endsAt: '2026-08-06T08:00:00+03:00', stale: false,
    },
  });
  expect(summary.calls).toEqual([{
    path: '/api/v1/bookings',
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    acceptsJson: true,
    sendsJson: true,
    authorizationMatches: true,
    body: {
      requestKey: '11111111-1111-4111-8111-111111111111',
      serviceId: 30539679,
      courtId: 5730531,
      datetime: '2026-08-06T07:00:00+03:00',
      email: 'test@example.test',
    },
  }]);
  expect(summary.calls[0].body).not.toHaveProperty('paymentStatus');
  expect(summary.calls[0].body).not.toHaveProperty('ownerPaid');
  expect(summary.calls[0].body).not.toHaveProperty('holdAmount');
  expect(summary.calls[0].body).not.toHaveProperty('prepay');
});

test('does not retry a booking when its network outcome is unknown', async ({
  page,
}) => {
  const summary = await page.evaluate(async (credential) => {
    const { createBookingAvailabilityClient } = await import(
      '/src/lib/bookingAvailabilityClient.js'
    );
    let calls = 0;
    const client = createBookingAvailabilityClient({
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError('synthetic network failure');
      },
    });
    const result = await client.createBooking(credential, {
      requestKey: '22222222-2222-4222-8222-222222222222',
      serviceId: 30539679,
      courtId: 5730531,
      datetime: '2026-08-06T07:00:00+03:00',
      email: 'test@example.test',
    });
    return { calls, result };
  }, CREDENTIAL);

  expect(summary).toEqual({
    calls: 1,
    result: { outcome: 'rejected', reason: 'unknown_outcome' },
  });
});

test('refreshes one persisted reservation through an authenticated GET only', async ({ page }) => {
  const summary = await page.evaluate(async (credential) => {
    const { createBookingAvailabilityClient } = await import('/src/lib/bookingAvailabilityClient.js');
    const calls = [];
    const reservationId = '22222222-2222-4222-8222-222222222222';
    const client = createBookingAvailabilityClient({
      fetchImpl: async (path, options) => {
        calls.push({ path, method: options.method, hasBody: options.body !== undefined });
        return new Response(JSON.stringify({
          reservationId, status: 'cancelled', serviceId: 30539679,
          courtId: 5730531, startsAt: '2026-08-06T07:00:00+03:00',
          endsAt: '2026-08-06T08:00:00+03:00', stale: false,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    return { calls, result: await client.readBooking(credential, reservationId) };
  }, CREDENTIAL);
  expect(summary.calls).toEqual([{
    path: '/api/v1/bookings/22222222-2222-4222-8222-222222222222',
    method: 'GET', hasBody: false,
  }]);
  expect(summary.result).toMatchObject({
    outcome: 'booking_loaded', reservation: { status: 'cancelled', stale: false },
  });
});

test('keeps an unknown create handle and supports owner list/request-key recovery', async ({ page }) => {
  const summary = await page.evaluate(async (credential) => {
    const { createBookingAvailabilityClient } = await import('/src/lib/bookingAvailabilityClient.js');
    const reservation = {
      reservationId: '22222222-2222-4222-8222-222222222222',
      status: 'unknown', serviceId: 30539679, courtId: 5730531,
      startsAt: '2026-08-06T07:00:00+03:00',
      endsAt: '2026-08-06T08:00:00+03:00', stale: true,
    };
    const calls = [];
    const client = createBookingAvailabilityClient({
      fetchImpl: async (path, options) => {
        calls.push({ path, method: options.method });
        const body = path === '/api/v1/bookings' && options.method === 'GET'
          ? { reservations: [reservation] }
          : reservation;
        const status = path === '/api/v1/bookings' && options.method === 'POST' ? 202 : 200;
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const requestKey = '11111111-1111-4111-8111-111111111111';
    const created = await client.createBooking(credential, { requestKey, serviceId:30539679,courtId:5730531,datetime:reservation.startsAt,email:'test@example.test' });
    const listed = await client.listBookings(credential);
    const recovered = await client.readBookingByRequestKey(credential, requestKey);
    return { calls, created, listed, recovered };
  }, CREDENTIAL);
  expect(summary.created).toMatchObject({ outcome:'booking_unknown', reservation:{status:'unknown'} });
  expect(summary.listed).toMatchObject({ outcome:'bookings_loaded', reservations:[{status:'unknown'}] });
  expect(summary.recovered).toMatchObject({ outcome:'booking_loaded', reservation:{status:'unknown'} });
  expect(summary.calls).toEqual([
    {path:'/api/v1/bookings',method:'POST'},
    {path:'/api/v1/bookings',method:'GET'},
    {path:'/api/v1/bookings/requests/11111111-1111-4111-8111-111111111111',method:'GET'},
  ]);
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
      invalidCreate: await client.createBooking(credential, {
        requestKey: 'invalid',
        serviceId: 30539679,
        courtId: 5730531,
        datetime: '2026-08-06T07:00:00+03:00',
        email: 'test@example.test',
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
    summary.invalidCreate,
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
        async createBooking(credential, command) {
          checkCredential(credential, 'create');
          return {
            outcome: 'booking_created',
            reservation: {
              reservationId: '44444444-4444-4444-8444-444444444444',
              status: 'confirmed', serviceId: command.serviceId,
              courtId: command.courtId, startsAt: command.datetime,
              endsAt: '2026-08-06T08:00:00+03:00', stale: false,
            },
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
    const booking = await lifecycle.createBooking({
      requestKey: '33333333-3333-4333-8333-333333333333',
      serviceId: 30539679,
      courtId: 5730531,
      datetime: '2026-08-06T07:00:00+03:00',
      email: 'test@example.test',
    });
    detach();

    return {
      credentialMatched,
      calls,
      services,
      courts,
      dates,
      times,
      booking,
      publicResultsHideCredential:
        !JSON.stringify({ services, courts, dates, times, booking })
          .includes(parameters.credential),
    };
  }, {
    credential: CREDENTIAL,
    accountId: '11111111-1111-4111-8111-111111111111',
  });

  expect(summary).toEqual({
    credentialMatched: true,
    calls: ['authenticate', 'services', 'courts', 'dates', 'times', 'create'],
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
    booking: { outcome: 'booking_created', reservation: {
      reservationId: '44444444-4444-4444-8444-444444444444',
      status: 'confirmed', serviceId: 30539679, courtId: 5730531,
      startsAt: '2026-08-06T07:00:00+03:00',
      endsAt: '2026-08-06T08:00:00+03:00', stale: false,
    } },
    publicResultsHideCredential: true,
  });
});

test('creates a backend booking from the availability confirmation', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-05T06:00:00.000Z') });
  await isolateComponentHarness(page);

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
      async createBooking(command) {
        writes += 1;
        calls.push({ operation: 'create', command });
        return { outcome: 'booking_created', reservation: {
          reservationId: '55555555-5555-4555-8555-555555555555',
          status: 'confirmed', serviceId: command.serviceId,
          courtId: command.courtId, startsAt: command.datetime,
          endsAt: '2026-08-05T18:30:00+03:00', stale: false,
        } };
      },
      async listBookings() {
        return { outcome: 'bookings_loaded', reservations: [] };
      },
      async readBooking(reservationId) {
        calls.push({ operation: 'read', reservationId });
        return { outcome: 'booking_loaded', reservation: {
          reservationId,
          status: 'cancelled', serviceId: 30539748,
          courtId: 5762241, startsAt: '2026-08-05T18:00:00+03:00',
          endsAt: '2026-08-05T19:30:00+03:00', stale: false,
        } };
      },
    };
    const availabilityActions =
      createBackendBookingAvailabilityActions(login);
    const container = document.createElement('div');
    container.dataset.testid = 'booking-readonly-root';
    document.body.append(container);
    createRoot(container).render(React.createElement(BookingScreen, {
      availabilityActions,
      bookingClient: {
        fullName: 'Test Player',
        phone: '+7 900 000-00-00',
        email: 'test@example.test',
      },
      onBookSlot() {
        writes += 100;
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
  await dialog.getByTestId('booking-contact-email').fill('test@example.test');
  const createButton = dialog.getByRole('button', { name: 'Создать бронь' });
  await expect(createButton).toBeEnabled();
  await expect(dialog).toContainText(
    'Бронь появится в YCLIENTS без онлайн-оплаты.',
  );
  await createButton.click();
  await expect(root).toContainText(
    'Бронь создана в YCLIENTS без онлайн-оплаты.',
  );
  const reservationCard = root.getByTestId('booking-reservation-card');
  await expect(reservationCard).toContainText('Статус: confirmed');
  await expect(reservationCard.getByRole('button', { name: /отмен|перенос/iu })).toHaveCount(0);
  await expect(reservationCard.getByRole('button', { name: /Обновить/u })).toHaveCount(0);
  const callsBeforeRefresh = await page.evaluate(
    () => [...window.__bookingReadOnlySummary.calls],
  );
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const target = document.querySelector(
      '[data-testid="pull-to-refresh-booking"]',
    );
    const dispatch = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      target.dispatchEvent(event);
    };
    dispatch('touchstart', [{ clientX: 120, clientY: 12 }]);
    dispatch('touchmove', [{ clientX: 120, clientY: 152 }]);
    dispatch('touchend', []);
  });
  await expect(reservationCard).toContainText('Статус: cancelled');
  await expect(reservationCard).toContainText('Корт №2');
  await expect(reservationCard).toContainText(
    'Для отмены или переноса свяжитесь с администратором клуба.',
  );

  const summary = await page.evaluate(() => ({
    calls: window.__bookingReadOnlySummary.calls,
    writes: window.__bookingReadOnlySummary.writes,
  }));
  expect(summary.writes).toBe(1);
  expect(callsBeforeRefresh.slice(0, -1)).toEqual([
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
  expect(callsBeforeRefresh.at(-1)).toMatchObject({
    operation: 'create',
    command: {
      serviceId: 30539748,
      courtId: 5730531,
      datetime: '2026-08-05T17:00:00+03:00',
      email: 'test@example.test',
    },
  });
  expect(callsBeforeRefresh.at(-1).command.requestKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(callsBeforeRefresh.at(-1).command).not.toHaveProperty('paymentStatus');
  expect(summary.calls.filter((call) => call.operation === 'read')).toEqual([{
    operation: 'read',
    reservationId: '55555555-5555-4555-8555-555555555555',
  }]);
});

test('preserves a future date across duration changes and only falls forward', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-08-05T06:00:00.000Z') });
  await isolateComponentHarness(page);

  await page.evaluate(async () => {
    const reactModule = await import('/@id/react');
    const React = reactModule.default ?? reactModule;
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { createRoot } =
      reactDomClientModule.default ?? reactDomClientModule;
    const { default: BookingScreen } = await import(
      '/src/components/BookingScreen.jsx'
    );

    const services = [
      { id: 101, title: 'Аренда корта 1ч.', categoryId: 1 },
      { id: 102, title: 'Аренда корта 1.5ч.', categoryId: 1 },
      { id: 103, title: 'Аренда корта 2ч.', categoryId: 1 },
    ];
    const datesByService = new Map([
      [101, ['2026-08-05', '2026-08-09', '2026-08-10']],
      [102, ['2026-08-05', '2026-08-09']],
      [103, ['2026-08-05', '2026-08-10']],
    ]);
    const calls = [];
    const availabilityActions = Object.freeze({
      async listServices() {
        return { outcome: 'services_loaded', services };
      },
      async listCourts() {
        return {
          outcome: 'courts_loaded',
          courts: [{ id: 201, name: 'Корт №1' }],
        };
      },
      async listDates(query) {
        calls.push({ operation: 'dates', ...query });
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          outcome: 'dates_loaded',
          dates: datesByService.get(query.serviceId) ?? [],
        };
      },
      async listTimes(query) {
        calls.push({ operation: 'times', ...query });
        return {
          outcome: 'times_loaded',
          times: [{
            time: '17:00',
            durationSeconds: 3600,
            datetime: `${query.date}T17:00:00+03:00`,
          }],
        };
      },
      async createBooking() {
        return { outcome: 'rejected', reason: 'unavailable' };
      },
    });

    const container = document.createElement('div');
    container.dataset.testid = 'booking-date-state-root';
    document.body.append(container);
    createRoot(container).render(React.createElement(BookingScreen, {
      availabilityActions,
    }));
    window.__bookingDateStateCalls = calls;
  });

  const root = page.getByTestId('booking-date-state-root');
  const august5 = root.getByRole('button', { name: /(?:^| )5 авг$/u });
  const august9 = root.getByRole('button', { name: /(?:^| )9 авг$/u });
  const august10 = root.getByRole('button', { name: /(?:^| )10 авг$/u });

  await expect(august9).toBeEnabled();
  await august9.click();
  await expect(august9).toHaveClass(/is-active/u);

  await root.getByRole('button', { name: '1 ч' }).click();
  await expect(august9).toBeEnabled();
  await expect(august9).toHaveClass(/is-active/u);
  await expect(august5).not.toHaveClass(/is-active/u);

  await root.getByRole('button', { name: '2 ч' }).click();
  await expect(august10).toBeEnabled();
  await expect(august10).toHaveClass(/is-active/u);
  await expect(august5).not.toHaveClass(/is-active/u);

  await root.getByRole('button', { name: '1,5 ч' }).click();
  await expect(august10).toBeDisabled();
  await expect(august10).toHaveClass(/is-active/u);
  await expect(august5).not.toHaveClass(/is-active/u);

  const timeDates = await page.evaluate(() =>
    window.__bookingDateStateCalls
      .filter((call) => call.operation === 'times')
      .map((call) => call.date));
  expect(timeDates.at(-1)).toBe('2026-08-10');
});
