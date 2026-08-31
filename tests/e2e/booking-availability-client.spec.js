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
    },
  }]);
  expect(summary.calls[0].body).not.toHaveProperty('paymentStatus');
  expect(summary.calls[0].body).not.toHaveProperty('ownerPaid');
  expect(summary.calls[0].body).not.toHaveProperty('holdAmount');
  expect(summary.calls[0].body).not.toHaveProperty('prepay');
  expect(summary.calls[0].body).not.toHaveProperty('email');
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
    const created = await client.createBooking(credential, { requestKey, serviceId:30539679,courtId:5730531,datetime:reservation.startsAt });
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
      }),
      injectedEmail: await client.createBooking(credential, {
        requestKey: '11111111-1111-4111-8111-111111111111',
        serviceId: 30539679,
        courtId: 5730531,
        datetime: '2026-08-06T07:00:00+03:00',
        email: 'attacker@example.test',
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
    summary.injectedEmail,
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

test('builds one bounded private range and keeps payment honest', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const clockTime = new Date('2026-08-05T06:00:00.000Z');
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(new Date(clockTime.getTime() + 1_000));
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
    const notifications = [];
    let writes = 0;
    let lists = 0;
    let settledDateRequests = 0;
    let activeAvailabilityReads = 0;
    let maxConcurrentAvailabilityReads = 0;
    let releaseDates;
    const datesGate = new Promise((resolve) => {
      releaseDates = resolve;
    });
    const trackAvailabilityRead = async (read) => {
      activeAvailabilityReads += 1;
      maxConcurrentAvailabilityReads = Math.max(
        maxConcurrentAvailabilityReads,
        activeAvailabilityReads,
      );
      try {
        await Promise.resolve();
        return await read();
      } finally {
        activeAvailabilityReads -= 1;
      }
    };
    const login = {
      sessionReady: true,
      async listBookingServices() {
        calls.push({ operation: 'services' });
        return {
          outcome: 'services_loaded',
          services: [
            {
              id: 30539679,
              title: 'Аренда корта 1ч.',
              categoryId: 27980310,
            },
            {
              id: 30539694,
              title: 'Аренда корта 1.5ч.',
              categoryId: 27980310,
            },
            {
              id: 30539748,
              title: 'Аренда корта 2ч.',
              categoryId: 27980310,
            },
            {
              id: 30539801,
              title: 'Аренда корта 2.5ч.',
              categoryId: 27980310,
            },
          ],
        };
      },
      async listBookingCourts(serviceId) {
        return trackAvailabilityRead(async () => {
          calls.push({ operation: 'courts', serviceId });
          return {
            outcome: 'courts_loaded',
            courts: serviceId === 30539679
              ? [
                  { id: 5730531, name: 'Корт №1' },
                  { id: 5762241, name: 'Корт №2' },
                ]
              : [{ id: 5730531, name: 'Корт №1' }],
          };
        });
      },
      async listBookingDates(query) {
        return trackAvailabilityRead(async () => {
          calls.push({ operation: 'dates', ...query });
          await datesGate;
          settledDateRequests += 1;
          return { outcome: 'dates_loaded', dates: [query.dateFrom] };
        });
      },
      async listBookingTimes(query) {
        return trackAvailabilityRead(async () => {
          calls.push({ operation: 'times', ...query });
          const durationSecondsByService = {
            30539679: 3_600,
            30539694: 5_400,
            30539748: 7_200,
            30539801: 9_000,
          };
          const timesByService = {
            30539679: ['17:00', '18:30', '19:30', '22:00', '22:30', '23:00'],
            30539694: ['17:00', '22:00', '22:30'],
            30539748: ['17:00', '22:00'],
            30539801: ['17:00'],
          };
          return {
            outcome: 'times_loaded',
            times: timesByService[query.serviceId].map((time) => ({
              time,
              durationSeconds: durationSecondsByService[query.serviceId],
              datetime: `${query.date}T${time}:00+03:00`,
            })),
          };
        });
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
        lists += 1;
        return {
          outcome: 'bookings_loaded',
          reservations: [{
            reservationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            status: 'rejected', serviceId: 30539679, courtId: 5730531,
            startsAt: '2026-08-05T12:00:00+03:00',
            endsAt: '2026-08-05T13:00:00+03:00', stale: false,
          }, {
            reservationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            status: 'confirmed', serviceId: 30539679, courtId: 5730531,
            startsAt: '2026-08-06T12:00:00+03:00',
            endsAt: '2026-08-06T13:00:00+03:00', stale: false,
          }],
        };
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
      matchIdToLink: '33333333-3333-4333-8333-333333333333',
      async onLinkMatchReservation(matchId, reservationId) {
        calls.push({ operation: 'link', matchId, reservationId });
        return {
          outcome: 'match_reservation_linked',
          courtBookingStatus: 'confirmed',
          courtBookingStale: false,
          courtReservationId: reservationId,
        };
      },
      bookingClient: {
        fullName: 'Test Player',
        phone: '+7 900 000-00-00',
      },
      onBookSlot() {
        writes += 100;
      },
      showToast(message, variant) {
        notifications.push({ message, variant });
      },
    }));
    window.__bookingReadOnlySummary = {
      calls,
      notifications,
      get writes() { return writes; },
      get lists() { return lists; },
      get settledDateRequests() { return settledDateRequests; },
      get maxConcurrentAvailabilityReads() { return maxConcurrentAvailabilityReads; },
      releaseDates,
    };

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
  await expect.poll(() => page.evaluate(() => ({
    dates: window.__bookingReadOnlySummary.calls.filter(
      (call) => call.operation === 'dates',
    ).length,
    times: window.__bookingReadOnlySummary.calls.filter(
      (call) => call.operation === 'times',
    ).length,
    settledDateRequests: window.__bookingReadOnlySummary.settledDateRequests,
  }))).toEqual({ dates: 1, times: 3, settledDateRequests: 0 });
  await expect(root.locator('.booking-date-card')).toHaveCount(14);
  expect(await root.locator('.booking-date-card:enabled').count()).toBe(14);
  await expect(root.getByRole('button', {
    name: '17:00–17:30 Загрузка',
  })).toBeDisabled();
  await page.evaluate(() => window.__bookingReadOnlySummary.releaseDates());
  await expect(root.getByRole('button', {
    name: '17:00–17:30 Свободно',
  })).toBeEnabled();
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Свободные слоты обновлены.',
  );
  await expect.poll(() => page.evaluate(() => ({
    dates: window.__bookingReadOnlySummary.calls.filter(
      (call) => call.operation === 'dates',
    ).length,
    settledDateRequests: window.__bookingReadOnlySummary.settledDateRequests,
  }))).toEqual({ dates: 3, settledDateRequests: 3 });
  await page.setViewportSize({ width: 375, height: 667 });
  const statusLayout = await root.evaluate((container) => {
    const title = container.querySelector('.booking-title').getBoundingClientRect();
    const banner = container.querySelector('.booking-availability-banner')
      .getBoundingClientRect();
    const datesSection = container.querySelector('.booking-section-dates')
      .getBoundingClientRect();
    return {
      titleBottom: Math.round(title.bottom),
      bannerTop: Math.round(banner.top),
      bannerBottom: Math.round(banner.bottom),
      dateTop: Math.round(datesSection.top),
    };
  });
  expect(statusLayout.titleBottom).toBeLessThanOrEqual(statusLayout.bannerTop);
  expect(statusLayout.bannerBottom).toBeLessThanOrEqual(statusLayout.dateTop);
  await page.clock.fastForward(5_999);
  await expect(root.getByTestId('booking-availability-status')).toBeVisible();
  await page.clock.fastForward(1);
  await expect(root.getByTestId('booking-availability-status')).toHaveCount(0);
  expect(await root.locator('.booking-section-dates').evaluate(
    (element) => Math.round(element.getBoundingClientRect().top),
  )).toBe(statusLayout.dateTop);
  await expect(root.getByRole('button', { name: 'Корт №1' })).toBeVisible();
  await expect(root.getByText('Длительность', { exact: true })).toHaveCount(0);

  const alignment = await root.evaluate((container) => {
    const screen = container.querySelector('.booking-screen').getBoundingClientRect();
    const dateStrip = container.querySelector('.booking-date-strip').getBoundingClientRect();
    const courtPanel = container.querySelector('.booking-control-panel')
      .getBoundingClientRect();
    const courtStrip = container.querySelector('.booking-court-strip').getBoundingClientRect();
    return {
      dateLeft: Math.round(dateStrip.left - screen.left),
      dateRight: Math.round(screen.right - dateStrip.right),
      courtLeft: Math.round(courtStrip.left - courtPanel.left),
      courtRight: Math.round(courtPanel.right - courtStrip.right),
      noHorizontalOverflow: container.scrollWidth <= container.clientWidth,
      slotTouchHeight: Math.round(
        container.querySelector('.booking-time-slot').getBoundingClientRect().height,
      ),
    };
  });
  expect(alignment).toEqual({
    dateLeft: 16,
    dateRight: 16,
    courtLeft: 15,
    courtRight: 15,
    noHorizontalOverflow: true,
    slotTouchHeight: 70,
  });

  const slot = (time, status = 'Свободно') => root.getByRole('button', {
    name: new RegExp(`^${time}–\\d{2}:\\d{2} ${status}$`, 'u'),
  });
  const anyCourt = root.getByRole('button', { name: 'Любой свободный' });
  await slot('17:00').click();
  const selection = root.getByTestId('booking-selection-summary');
  await expect(selection).toContainText('17:00–17:30');
  await expect(selection).toContainText('0,5 ч · добавьте соседний слот');
  await expect(selection.getByRole('button', { name: 'Продолжить' })).toBeDisabled();

  await slot('18:00').click();
  await expect(root.getByTestId('booking-selection-hint')).toContainText(
    'только соседние слоты без разрывов',
  );
  await expect(selection).toContainText('17:00–17:30');

  await slot('17:30').click();
  await expect(selection).toContainText('17:00–18:00');
  await expect(selection).toContainText('1 ч · 4 400 ₽');
  await expect(selection.getByRole('button', { name: 'Продолжить' })).toBeEnabled();
  const selectionPresentation = await root.evaluate((container) => {
    const times = container.querySelector('.booking-times');
    const summary = container.querySelector('.booking-selection-summary');
    const selectedSlot = container.querySelector('.booking-time-slot.is-selected');
    const summaryStyle = getComputedStyle(summary);
    const selectedStyle = getComputedStyle(selectedSlot);
    const summaryRect = summary.getBoundingClientRect();
    return {
      summaryFollowsSlots: Boolean(
        times.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
      summaryPrecedesSelection: Boolean(
        summary.compareDocumentPosition(selectedSlot) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
      summaryPosition: summaryStyle.position,
      summaryInViewport:
        summaryRect.top >= 0 && summaryRect.bottom <= window.innerHeight,
      selectedBackgroundColor: selectedStyle.backgroundColor,
      selectedShadow: selectedStyle.boxShadow,
      summaryBackground: summaryStyle.backgroundImage,
      summaryShadow: summaryStyle.boxShadow,
    };
  });
  expect(selectionPresentation.summaryFollowsSlots).toBe(true);
  expect(selectionPresentation.summaryPrecedesSelection).toBe(true);
  expect(selectionPresentation.summaryPosition).toBe('relative');
  expect(selectionPresentation.summaryInViewport).toBe(true);
  expect(selectionPresentation.selectedBackgroundColor).toBe('rgb(216, 243, 74)');
  expect(selectionPresentation.selectedShadow).not.toBe('none');
  expect(selectionPresentation.summaryBackground).toContain('radial-gradient');
  expect(selectionPresentation.summaryBackground).toContain('linear-gradient');
  expect(selectionPresentation.summaryBackground).toContain('rgba(216, 243, 74, 0.18)');
  expect(selectionPresentation.summaryShadow).toContain('inset');

  await slot('18:00').click();
  await expect(selection).toContainText('17:00–18:30');
  await expect(selection).toContainText('1,5 ч · 6 600 ₽');
  await slot('17:00', 'Выбрано').click();
  await expect(root.getByTestId('booking-selection-hint')).toHaveText(
    'Выбранный диапазон оставлен без изменений: после этого действия нельзя оформить непрерывную бронь.',
  );
  await expect(selection).toContainText('17:00–18:30');
  await slot('18:00', 'Выбрано').click();
  await expect(selection).toContainText('1 ч · 4 400 ₽');

  await slot('18:00').click();
  await slot('18:30').click();
  await expect(selection).toContainText('17:00–19:00');
  await expect(selection).toContainText('2 ч · 8 800 ₽');
  await slot('19:00').click();
  await expect(root.getByTestId('booking-selection-hint')).toContainText(
    'не больше 2 часов',
  );
  await expect(selection).toContainText('17:00–19:00');
  await expect(slot('20:30', 'Недоступно')).toBeDisabled();

  await anyCourt.click();
  await slot('18:30').click();
  await slot('19:00').click();
  const incompatibleSlot = slot('19:30', 'Не добавить');
  await expect(incompatibleSlot).toBeEnabled();
  await incompatibleSlot.click();
  await expect(root.getByTestId('booking-selection-hint')).toHaveText(
    '19:30 свободен отдельно, но весь диапазон 18:30–20:00 недоступен на одном корте.',
  );
  await expect(selection).toContainText('18:30–19:30');

  await anyCourt.click();
  await slot('23:30').click();
  await expect(root.getByTestId('booking-selection-hint')).toContainText(
    'Начните не позднее 23:00',
  );
  await expect(root.getByTestId('booking-selection-summary')).toHaveCount(0);

  await slot('23:00').click();
  await slot('23:30').click();
  await expect(selection).toContainText('23:00–00:00');

  await anyCourt.click();
  await slot('22:30').click();
  await slot('23:00').click();
  await slot('23:30').click();
  await expect(selection).toContainText('22:30–00:00');

  await anyCourt.click();
  await slot('22:00').click();
  await slot('22:30').click();
  await slot('23:00').click();
  await slot('23:30').click();
  await expect(selection).toContainText('22:00–00:00');
  await expect(selection).toContainText('2 ч · 8 800 ₽');

  await selection.getByRole('button', { name: 'Продолжить' }).click();
  const dialog = page.getByRole('dialog', { name: 'Подтверждение брони' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('22:00–00:00 · 2 ч');
  await expect(dialog).toContainText('Частная бронь');
  await expect(dialog.getByTestId('booking-total-price')).toHaveText('8 800 ₽');
  await expect(dialog.getByTestId('booking-per-player-price')).toHaveText('2 200 ₽');
  await expect(dialog.getByTestId('booking-contact-email')).toHaveCount(0);
  await expect(dialog).not.toContainText('Заполните контакты');
  await expect(dialog).toContainText('Контакты будут взяты из вашего профиля.');
  const payButton = dialog.getByRole('button', { name: 'Оплатить 8 800 ₽' });
  await expect(payButton).toBeDisabled();

  const fixedSheetState = await page.evaluate(() => {
    const overlay = document.querySelector('.booking-sheet-overlay');
    const sheet = document.querySelector('.booking-sheet');
    const footer = document.querySelector('.booking-sheet-footer');
    const sheetRect = sheet.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      portalParentIsBody: overlay.parentElement === document.body,
      htmlLocked: document.documentElement.classList.contains('booking-sheet-open'),
      bodyLocked: document.body.classList.contains('booking-sheet-open'),
      bodyPosition: getComputedStyle(document.body).position,
      bodyOverflow: getComputedStyle(document.body).overflowY,
      overlayPosition: getComputedStyle(overlay).position,
      sheetBottomGap: Math.round(window.innerHeight - sheetRect.bottom),
      footerBottomGap: Math.round(sheetRect.bottom - footerRect.bottom),
    };
  });
  expect(fixedSheetState).toEqual({
    portalParentIsBody: true,
    htmlLocked: true,
    bodyLocked: true,
    bodyPosition: 'fixed',
    bodyOverflow: 'hidden',
    overlayPosition: 'fixed',
    sheetBottomGap: 0,
    footerBottomGap: 0,
  });
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(payButton).toBeInViewport();
  expect(await dialog.evaluate((element) => (
    element.scrollWidth <= element.clientWidth
  ))).toBe(true);

  const summary = await page.evaluate(() => ({
    calls: window.__bookingReadOnlySummary.calls,
    notifications: window.__bookingReadOnlySummary.notifications,
    writes: window.__bookingReadOnlySummary.writes,
    lists: window.__bookingReadOnlySummary.lists,
    maxConcurrentAvailabilityReads:
      window.__bookingReadOnlySummary.maxConcurrentAvailabilityReads,
  }));
  expect(summary.writes).toBe(0);
  expect(summary.lists).toBe(0);
  expect(summary.maxConcurrentAvailabilityReads).toBe(1);
  expect(summary.calls.filter((call) => ['create', 'read', 'link'].includes(call.operation))).toEqual([]);
  expect(summary.calls.filter((call) => call.operation === 'courts')).toHaveLength(3);
  expect(summary.calls.filter((call) => call.operation === 'dates')).toHaveLength(7);
  expect(summary.calls.filter((call) => call.operation === 'times')).toHaveLength(7);
  expect(summary.calls.some((call) => call.serviceId === 30539801)).toBe(false);
  expect(summary.calls.filter((call) =>
    ['dates', 'times'].includes(call.operation) && call.courtId === 5762241,
  )).toEqual([
    expect.objectContaining({ operation: 'times', serviceId: 30539679 }),
    expect.objectContaining({ operation: 'dates', serviceId: 30539679 }),
  ]);
  await expect(root.getByTestId('booking-reservation-card')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Закрыть подтверждение' }).click();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const target = document.querySelector('[data-testid="pull-to-refresh-booking"]');
    const dispatch = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      target.dispatchEvent(event);
    };
    dispatch('touchstart', [{ clientX: 120, clientY: 12 }]);
    dispatch('touchmove', [{ clientX: 120, clientY: 152 }]);
    dispatch('touchend', []);
  });
  await expect(root.getByRole('button', { name: 'Любой свободный' })).toHaveClass(
    /is-active/u,
  );
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Свободные слоты обновлены.',
  );
});

test('fails closed instead of treating an incomplete duration batch as occupied', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-05T06:00:00.000Z') });
  await isolateComponentHarness(page);

  await page.evaluate(async () => {
    const reactModule = await import('/@id/react');
    const React = reactModule.default ?? reactModule;
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { createRoot } = reactDomClientModule.default ?? reactDomClientModule;
    const { default: BookingScreen } = await import('/src/components/BookingScreen.jsx');
    let shouldFailTimes = true;
    const timeServiceCalls = [];
    const availabilityActions = Object.freeze({
      async listServices() {
        return {
          outcome: 'services_loaded',
          services: [
            { id: 101, title: 'Аренда корта 1ч.', categoryId: 1 },
            { id: 102, title: 'Аренда корта 1.5ч.', categoryId: 1 },
            { id: 103, title: 'Аренда корта 2ч.', categoryId: 1 },
          ],
        };
      },
      async listCourts() {
        return {
          outcome: 'courts_loaded',
          courts: [{ id: 201, name: 'Корт №1' }],
        };
      },
      async listDates(query) {
        return { outcome: 'dates_loaded', dates: [query.dateFrom] };
      },
      async listTimes(query) {
        timeServiceCalls.push(query.serviceId);
        if (query.serviceId === 102 && shouldFailTimes) {
          return { outcome: 'rejected', reason: 'request_timeout' };
        }
        return {
          outcome: 'times_loaded',
          times: ['19:00', '19:30', '20:00'].map((time) => ({
            time,
            durationSeconds: query.serviceId === 103
              ? 7_200
              : query.serviceId === 102
                ? 5_400
                : 3_600,
            datetime: `${query.date}T${time}:00+03:00`,
          })),
        };
      },
    });
    const container = document.createElement('div');
    container.dataset.testid = 'partial-duration-root';
    document.body.append(container);
    createRoot(container).render(React.createElement(BookingScreen, {
      availabilityActions,
    }));
    window.__partialDurationScenario = {
      recover() { shouldFailTimes = false; },
      get timeServiceCalls() { return timeServiceCalls; },
    };
  });

  const root = page.getByTestId('partial-duration-root');
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Не удалось загрузить доступность. Обновите экран — ошибка останется до успешной загрузки.',
  );
  await expect(root.getByRole('button', {
    name: '19:00–19:30 Нет данных',
  })).toBeDisabled();
  await expect(root.getByRole('button', { name: /Не добавить/u })).toHaveCount(0);
  await expect(root.getByTestId('booking-selection-summary')).toHaveCount(0);
  expect(await page.evaluate(() => (
    window.__partialDurationScenario.timeServiceCalls
  ))).toEqual([101, 102]);
  await page.clock.fastForward(6_001);
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Не удалось загрузить доступность. Обновите экран — ошибка останется до успешной загрузки.',
  );

  await page.evaluate(() => {
    window.__partialDurationScenario.recover();
    window.scrollTo(0, 0);
    const target = document.querySelector('[data-testid="pull-to-refresh-booking"]');
    const dispatch = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      target.dispatchEvent(event);
    };
    dispatch('touchstart', [{ clientX: 120, clientY: 12 }]);
    dispatch('touchmove', [{ clientX: 120, clientY: 152 }]);
    dispatch('touchend', []);
  });
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Свободные слоты обновлены.',
  );
  await expect(root.getByRole('button', {
    name: '19:00–19:30 Свободно',
  })).toBeEnabled();
  expect(await page.evaluate(() => (
    window.__partialDurationScenario.timeServiceCalls
  ))).toEqual([101, 102, 101, 102, 103]);
});

test('keeps all 14 days interactive while the background date catalog is loading', async ({ page }) => {
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

    const mountScenario = (id, resolvedDates) => {
      let releaseDates;
      const datesGate = new Promise((resolve) => {
        releaseDates = resolve;
      });
      const timeDates = [];
      let datesStarted = 0;
      const availabilityActions = Object.freeze({
        async listServices() {
          return {
            outcome: 'services_loaded',
            services: [{ id: 101, title: 'Аренда корта 1ч.', categoryId: 1 }],
          };
        },
        async listCourts() {
          return {
            outcome: 'courts_loaded',
            courts: [{ id: 201, name: 'Корт №1' }],
          };
        },
        async listDates() {
          datesStarted += 1;
          await datesGate;
          return { outcome: 'dates_loaded', dates: resolvedDates };
        },
        async listTimes(query) {
          timeDates.push(query.date);
          return {
            outcome: 'times_loaded',
            times: [{
              time: '17:00',
              durationSeconds: 3_600,
              datetime: `${query.date}T17:00:00+03:00`,
            }],
          };
        },
      });
      const container = document.createElement('div');
      container.dataset.testid = `${id}-date-catalog-root`;
      document.body.append(container);
      createRoot(container).render(React.createElement(BookingScreen, {
        availabilityActions,
      }));
      window.__bookingDateCatalogScenarios[id] = {
        releaseDates,
        timeDates,
        get datesStarted() { return datesStarted; },
      };
    };

    window.__bookingDateCatalogScenarios = {};
    mountScenario('empty', []);
    mountScenario('shifted', ['2026-08-06']);
  });

  const emptyRoot = page.getByTestId('empty-date-catalog-root');
  const shiftedRoot = page.getByTestId('shifted-date-catalog-root');
  await expect.poll(() => page.evaluate(() => ({
    emptyDates: window.__bookingDateCatalogScenarios.empty.datesStarted,
    emptyTimes: window.__bookingDateCatalogScenarios.empty.timeDates,
    shiftedDates: window.__bookingDateCatalogScenarios.shifted.datesStarted,
    shiftedTimes: window.__bookingDateCatalogScenarios.shifted.timeDates,
  }))).toEqual({
    emptyDates: 1,
    emptyTimes: ['2026-08-05'],
    shiftedDates: 1,
    shiftedTimes: ['2026-08-05'],
  });
  await expect(emptyRoot.getByRole('button', {
    name: '17:00–17:30 Загрузка',
  })).toBeDisabled();
  await expect(shiftedRoot.getByRole('button', {
    name: '17:00–17:30 Загрузка',
  })).toBeDisabled();
  await expect(emptyRoot.locator('.booking-date-card')).toHaveCount(14);
  await expect(shiftedRoot.locator('.booking-date-card')).toHaveCount(14);
  expect(await emptyRoot.locator('.booking-date-card:enabled').count()).toBe(14);
  expect(await shiftedRoot.locator('.booking-date-card:enabled').count()).toBe(14);
  await expect(emptyRoot.getByTestId('booking-selection-summary')).toHaveCount(0);

  await shiftedRoot.locator('.booking-date-card').nth(1).click();
  await expect(shiftedRoot.locator('.booking-date-card.is-active')).toContainText('6 авг');
  await expect(shiftedRoot.getByRole('button', {
    name: '17:00–17:30 Загрузка',
  })).toBeDisabled();
  expect(await page.evaluate(() => (
    window.__bookingDateCatalogScenarios.shifted.timeDates
  ))).toEqual(['2026-08-05']);

  await page.evaluate(() => {
    window.__bookingDateCatalogScenarios.empty.releaseDates();
    window.__bookingDateCatalogScenarios.shifted.releaseDates();
  });

  await expect(emptyRoot.getByTestId('booking-availability-status')).toHaveText(
    'Для выбранного корта нет доступных дат.',
  );
  await expect(emptyRoot.getByRole('button', {
    name: '17:00–17:30 Недоступно',
  })).toBeDisabled();
  await expect(emptyRoot.getByTestId('booking-selection-summary')).toHaveCount(0);

  await expect(shiftedRoot.getByRole('button', {
    name: '17:00–17:30 Свободно',
  })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => ({
    empty: window.__bookingDateCatalogScenarios.empty.timeDates,
    shifted: window.__bookingDateCatalogScenarios.shifted.timeDates,
  }))).toEqual({
    empty: ['2026-08-05'],
    shifted: ['2026-08-05', '2026-08-06'],
  });
});

test('clears a proven range before deferred day availability in private and match flows', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-05T06:00:00.000Z') });
  await isolateComponentHarness(page);

  await page.evaluate(async () => {
    const reactModule = await import('/@id/react');
    const React = reactModule.default ?? reactModule;
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { createRoot } = reactDomClientModule.default ?? reactDomClientModule;
    const { default: BookingScreen } = await import(
      '/src/components/BookingScreen.jsx'
    );

    const mountScenario = (id, reservationPurpose) => {
      let releaseNextDay;
      let writes = 0;
      const nextDayGate = new Promise((resolve) => {
        releaseNextDay = resolve;
      });
      const availabilityActions = Object.freeze({
        async listServices() {
          return {
            outcome: 'services_loaded',
            services: [{ id: 101, title: 'Аренда корта 1ч.', categoryId: 1 }],
          };
        },
        async listCourts() {
          return {
            outcome: 'courts_loaded',
            courts: [{ id: 201, name: 'Корт №1' }],
          };
        },
        async listDates() {
          return {
            outcome: 'dates_loaded',
            dates: ['2026-08-05', '2026-08-06'],
          };
        },
        async listTimes(query) {
          if (query.date === '2026-08-06') await nextDayGate;
          return {
            outcome: 'times_loaded',
            times: [{
              time: '17:00',
              durationSeconds: 3_600,
              datetime: `${query.date}T17:00:00+03:00`,
            }],
          };
        },
        async createBooking() {
          writes += 1;
          return { outcome: 'temporary_unavailable' };
        },
      });
      const container = document.createElement('div');
      container.dataset.testid = `${id}-deferred-clear-root`;
      document.body.append(container);
      createRoot(container).render(React.createElement(BookingScreen, {
        availabilityActions,
        bookingClient: {
          fullName: 'Test Player',
          phone: '+7 900 000-00-00',
        },
        reservationPurpose,
      }));
      window.__bookingDeferredClearScenarios[id] = {
        releaseNextDay,
        get writes() { return writes; },
      };
    };

    window.__bookingDeferredClearScenarios = {};
    mountScenario('private', 'private');
    mountScenario('match', 'match');
  });

  for (const id of ['private', 'match']) {
    const root = page.getByTestId(`${id}-deferred-clear-root`);
    await root.getByRole('button', { name: '17:00–17:30 Свободно' }).click();
    await root.getByRole('button', { name: '17:30–18:00 Свободно' }).click();
    const selection = root.getByTestId('booking-selection-summary');
    await expect(selection).toContainText('17:00–18:00');
    const continueButton = selection.getByRole('button', { name: 'Продолжить' });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    const dialog = page.getByRole('dialog', { name: 'Подтверждение брони' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', {
      name: id === 'match'
        ? /Оплатить и создать матч/u
        : /^Оплатить/u,
    })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Закрыть подтверждение' }).click();

    await root.locator('.booking-date-card').nth(1).click();
    await expect(root.getByTestId('booking-selection-summary')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Подтверждение брони' }))
      .toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Продолжить' })).toHaveCount(0);
    await expect(root.getByRole('button', {
      name: '17:00–17:30 Загрузка',
    })).toBeDisabled();
    expect(await page.evaluate((scenarioId) => (
      window.__bookingDeferredClearScenarios[scenarioId].writes
    ), id)).toBe(0);
  }

  await page.evaluate(() => {
    window.__bookingDeferredClearScenarios.private.releaseNextDay();
    window.__bookingDeferredClearScenarios.match.releaseNextDay();
  });
});

test('prioritizes the latest day and court without starting an obsolete read backlog', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-05T06:00:00.000Z') });
  await isolateComponentHarness(page);

  await page.evaluate(async () => {
    const reactModule = await import('/@id/react');
    const React = reactModule.default ?? reactModule;
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { createRoot } = reactDomClientModule.default ?? reactDomClientModule;
    const { default: BookingScreen } = await import('/src/components/BookingScreen.jsx');
    const started = [];
    const pending = [];
    let active = 0;
    let maxActive = 0;

    const defer = (kind, query) => new Promise((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const call = { kind, ...query };
      started.push(call);
      pending.push({ call, resolve, settled: false });
    });

    const availabilityActions = Object.freeze({
      async listServices() {
        return {
          outcome: 'services_loaded',
          services: [{ id: 101, title: 'Аренда корта 1ч.', categoryId: 1 }],
        };
      },
      async listCourts() {
        return {
          outcome: 'courts_loaded',
          courts: [
            { id: 201, name: 'Корт №1' },
            { id: 202, name: 'Корт №2' },
          ],
        };
      },
      listDates(query) {
        return defer('dates', query);
      },
      listTimes(query) {
        return defer('times', query);
      },
    });

    const container = document.createElement('div');
    container.dataset.testid = 'latest-availability-root';
    document.body.append(container);
    createRoot(container).render(React.createElement(BookingScreen, {
      availabilityActions,
    }));

    window.__latestAvailabilityScenario = {
      started,
      get active() { return active; },
      get maxActive() { return maxActive; },
      releaseNext({ time = '19:00', dates = ['2026-08-05', '2026-08-06', '2026-08-07'] } = {}) {
        const record = pending.find((item) => !item.settled);
        if (!record) throw new Error('No pending availability read');
        record.settled = true;
        active -= 1;
        record.resolve(record.call.kind === 'dates'
          ? { outcome: 'dates_loaded', dates }
          : {
              outcome: 'times_loaded',
              times: [{
                time,
                durationSeconds: 3_600,
                datetime: `${record.call.date}T${time}:00+03:00`,
              }],
            });
      },
    };
  });

  const root = page.getByTestId('latest-availability-root');
  const summary = () => page.evaluate(() => ({
    active: window.__latestAvailabilityScenario.active,
    maxActive: window.__latestAvailabilityScenario.maxActive,
    started: window.__latestAvailabilityScenario.started,
  }));
  const releaseNext = (response) => page.evaluate((value) => {
    window.__latestAvailabilityScenario.releaseNext(value);
  }, response);

  await expect.poll(summary).toMatchObject({
    active: 1,
    maxActive: 1,
    started: [expect.objectContaining({
      kind: 'times',
      courtId: 201,
      date: '2026-08-05',
    })],
  });
  await expect(root.locator('.booking-date-card')).toHaveCount(14);
  expect(await root.locator('.booking-date-card:enabled').count()).toBe(14);

  await root.locator('.booking-date-card').nth(1).click();
  await expect(root.locator('.booking-date-card.is-active')).toContainText('6 авг');
  await root.locator('.booking-date-card').nth(2).click();
  await expect(root.locator('.booking-date-card.is-active')).toContainText('7 авг');
  expect((await summary()).started).toHaveLength(1);

  await releaseNext({ time: '18:00' });
  await expect.poll(summary).toMatchObject({
    active: 1,
    maxActive: 1,
    started: [
      expect.objectContaining({ date: '2026-08-05', courtId: 201 }),
      expect.objectContaining({ kind: 'times', date: '2026-08-07', courtId: 201 }),
    ],
  });
  expect((await summary()).started.some((call) => call.date === '2026-08-06')).toBe(false);

  await releaseNext({ time: '20:00' });
  await expect.poll(summary).toMatchObject({
    active: 1,
    maxActive: 1,
    started: [
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kind: 'dates', courtId: 201 }),
    ],
  });
  await releaseNext({ dates: ['2026-08-05', '2026-08-06', '2026-08-07'] });
  await expect(root.getByRole('button', { name: '20:00–20:30 Свободно' })).toBeEnabled();
  await expect(root.getByRole('button', { name: '18:00–18:30 Недоступно' })).toBeDisabled();

  const beforeAnyToCourt = (await summary()).started.length;
  await root.getByRole('button', { name: 'Любой свободный' }).click();
  await expect.poll(() => summary().then((value) => value.started.length))
    .toBe(beforeAnyToCourt + 1);
  expect((await summary()).started.at(-1)).toMatchObject({
    kind: 'times',
    courtId: 201,
    date: '2026-08-07',
  });
  await root.getByRole('button', { name: 'Корт №2' }).click();
  await expect(root.getByRole('button', { name: 'Корт №2' })).toHaveClass(/is-active/u);
  await releaseNext({ time: '19:00' });
  await expect.poll(summary).toMatchObject({
    active: 1,
    started: expect.arrayContaining([
      expect.objectContaining({ kind: 'times', courtId: 202, date: '2026-08-07' }),
    ]),
  });
  expect((await summary()).started.filter((call) => (
    call.kind === 'times' && call.courtId === 202 && call.date === '2026-08-07'
  ))).toHaveLength(1);
  expect((await summary()).started.slice(beforeAnyToCourt).filter(
    (call) => call.kind === 'times',
  ).map((call) => call.courtId)).toEqual([201, 202]);
  await releaseNext({ time: '21:00' });
  await expect.poll(summary).toMatchObject({
    active: 1,
    started: expect.arrayContaining([
      expect.objectContaining({ kind: 'dates', courtId: 202 }),
    ]),
  });
  await releaseNext({ dates: ['2026-08-07'] });
  await expect(root.getByRole('button', { name: '21:00–21:30 Свободно' })).toBeEnabled();
  await expect(root.getByRole('button', { name: '19:00–19:30 Недоступно' })).toBeDisabled();

  const beforeFinalAny = (await summary()).started.length;
  await root.getByRole('button', { name: 'Любой свободный' }).click();
  await expect(root.getByRole('button', { name: 'Любой свободный' })).toHaveClass(/is-active/u);
  await expect.poll(summary).toMatchObject({ active: 1, maxActive: 1 });
  await releaseNext({ time: '22:00' });
  await expect.poll(() => summary().then((value) => value.started.length)).toBe(beforeFinalAny + 2);
  await releaseNext({ time: '23:00' });
  await expect.poll(() => summary().then((value) => value.started.length)).toBe(beforeFinalAny + 3);
  await releaseNext({ dates: ['2026-08-07'] });
  await expect.poll(() => summary().then((value) => value.started.length)).toBe(beforeFinalAny + 4);
  await releaseNext({ dates: ['2026-08-07'] });
  await expect(root.getByRole('button', { name: '22:00–22:30 Свободно' })).toBeEnabled();
  await expect(root.getByRole('button', { name: '23:00–23:30 Свободно' })).toBeEnabled();
  expect((await summary()).maxActive).toBe(1);
  const stableCallCount = (await summary()).started.length;
  await page.evaluate(() => Promise.resolve());
  expect((await summary()).started).toHaveLength(stableCallCount);
});

test('restarts a cancelled date catalog after a fast court A to B to A switch', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-05T06:00:00.000Z') });
  await isolateComponentHarness(page);

  await page.evaluate(async () => {
    const reactModule = await import('/@id/react');
    const React = reactModule.default ?? reactModule;
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { createRoot } = reactDomClientModule.default ?? reactDomClientModule;
    const { default: BookingScreen } = await import('/src/components/BookingScreen.jsx');
    const firstCourtDateReleases = [];
    let firstCourtTimesCalls = 0;
    const calls = [];
    const availabilityActions = Object.freeze({
      async listServices() {
        return {
          outcome: 'services_loaded',
          services: [{ id: 101, title: 'Аренда корта 1ч.', categoryId: 1 }],
        };
      },
      async listCourts() {
        return {
          outcome: 'courts_loaded',
          courts: [
            { id: 201, name: 'Корт №1' },
            { id: 202, name: 'Корт №2' },
          ],
        };
      },
      async listDates(query) {
        calls.push({ operation: 'dates', courtId: query.courtId });
        if (query.courtId !== 201) {
          return { outcome: 'dates_loaded', dates: [query.dateFrom] };
        }
        await new Promise((resolve) => firstCourtDateReleases.push(resolve));
        return { outcome: 'dates_loaded', dates: [query.dateFrom] };
      },
      async listTimes(query) {
        calls.push({ operation: 'times', courtId: query.courtId });
        if (query.courtId === 201) firstCourtTimesCalls += 1;
        const time = query.courtId === 202
          ? '21:00'
          : firstCourtTimesCalls === 1
            ? '19:00'
            : '20:00';
        return {
          outcome: 'times_loaded',
          times: [{
            time,
            durationSeconds: 3_600,
            datetime: `${query.date}T${time}:00+03:00`,
          }],
        };
      },
    });
    const container = document.createElement('div');
    container.dataset.testid = 'court-switch-date-root';
    document.body.append(container);
    createRoot(container).render(React.createElement(BookingScreen, {
      availabilityActions,
    }));
    window.__courtSwitchDateScenario = {
      calls,
      firstCourtDateReleases,
    };
  });

  const root = page.getByTestId('court-switch-date-root');
  await expect.poll(() => page.evaluate(() => (
    window.__courtSwitchDateScenario.firstCourtDateReleases.length
  ))).toBe(1);
  await root.getByRole('button', { name: 'Корт №2' }).click();
  await root.getByRole('button', { name: 'Корт №1' }).click();
  expect(await page.evaluate(() => (
    window.__courtSwitchDateScenario.calls.filter(
      (call) => call.operation === 'times' && call.courtId === 202,
    ).length
  ))).toBe(0);

  await page.evaluate(() => window.__courtSwitchDateScenario.firstCourtDateReleases[0]());

  await expect.poll(() => page.evaluate(() => (
    window.__courtSwitchDateScenario.firstCourtDateReleases.length
  ))).toBe(2);
  await page.evaluate(() => window.__courtSwitchDateScenario.firstCourtDateReleases[1]());
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Свободные слоты обновлены.',
  );
  await expect(root.locator('.booking-date-card.is-active')).toBeEnabled();
  await expect(root.getByRole('button', { name: '20:00–20:30 Свободно' })).toBeEnabled();
  await expect(root.getByRole('button', { name: '19:00–19:30 Недоступно' })).toBeDisabled();
  expect(await page.evaluate(() => (
    window.__courtSwitchDateScenario.calls.filter(
      (call) => call.operation === 'times' && call.courtId === 202,
    ).length
  ))).toBe(0);
});

test('refreshes exact times and the background catalog in a fresh same-key epoch', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-05T06:00:00.000Z') });
  await isolateComponentHarness(page);

  await page.evaluate(async () => {
    const reactModule = await import('/@id/react');
    const React = reactModule.default ?? reactModule;
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { createRoot } = reactDomClientModule.default ?? reactDomClientModule;
    const { default: BookingScreen } = await import('/src/components/BookingScreen.jsx');
    let timesCalls = 0;
    let datesCalls = 0;
    let courtsCalls = 0;
    let releaseRefreshedCourts;
    let releaseRefreshedTimes;
    const refreshedCourtsGate = new Promise((resolve) => {
      releaseRefreshedCourts = resolve;
    });
    const refreshedTimesGate = new Promise((resolve) => {
      releaseRefreshedTimes = resolve;
    });
    const availabilityActions = Object.freeze({
      async listServices() {
        return {
          outcome: 'services_loaded',
          services: [{ id: 101, title: 'Аренда корта 1ч.', categoryId: 1 }],
        };
      },
      async listCourts() {
        courtsCalls += 1;
        if (courtsCalls > 1) await refreshedCourtsGate;
        return {
          outcome: 'courts_loaded',
          courts: [{ id: 201, name: 'Корт №1' }],
        };
      },
      async listDates(query) {
        datesCalls += 1;
        return { outcome: 'dates_loaded', dates: [query.dateFrom] };
      },
      async listTimes(query) {
        timesCalls += 1;
        if (timesCalls > 1) {
          await refreshedTimesGate;
          return { outcome: 'rejected', reason: 'request_timeout' };
        }
        return {
          outcome: 'times_loaded',
          times: [{
            time: '19:00',
            durationSeconds: 3_600,
            datetime: `${query.date}T19:00:00+03:00`,
          }],
        };
      },
    });
    const container = document.createElement('div');
    container.dataset.testid = 'same-key-refresh-root';
    document.body.append(container);
    createRoot(container).render(React.createElement(BookingScreen, {
      availabilityActions,
    }));
    window.__sameKeyRefreshScenario = {
      get courtsCalls() { return courtsCalls; },
      get datesCalls() { return datesCalls; },
      get timesCalls() { return timesCalls; },
      releaseRefreshedCourts,
      releaseRefreshedTimes,
    };
  });

  const root = page.getByTestId('same-key-refresh-root');
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Свободные слоты обновлены.',
  );
  expect(await page.evaluate(() => window.__sameKeyRefreshScenario.datesCalls)).toBe(1);
  await root.getByRole('button', { name: '19:00–19:30 Свободно' }).click();
  await root.getByRole('button', { name: '19:30–20:00 Свободно' }).click();
  await expect(root.getByTestId('booking-selection-summary')).toBeVisible();

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const target = document.querySelector('[data-testid="pull-to-refresh-booking"]');
    const dispatch = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      target.dispatchEvent(event);
    };
    dispatch('touchstart', [{ clientX: 120, clientY: 12 }]);
    dispatch('touchmove', [{ clientX: 120, clientY: 152 }]);
    dispatch('touchend', []);
  });
  await expect(root.getByTestId('booking-selection-summary')).toHaveCount(0);

  await expect.poll(() => page.evaluate(
    () => window.__sameKeyRefreshScenario.courtsCalls,
  )).toBe(2);
  expect(await page.evaluate(() => window.__sameKeyRefreshScenario.timesCalls)).toBe(1);
  expect(await page.evaluate(() => window.__sameKeyRefreshScenario.datesCalls)).toBe(1);
  await page.evaluate(() => window.__sameKeyRefreshScenario.releaseRefreshedCourts());
  await expect.poll(() => page.evaluate(
    () => window.__sameKeyRefreshScenario.timesCalls,
  )).toBe(2);
  expect(await page.evaluate(() => window.__sameKeyRefreshScenario.datesCalls)).toBe(1);
  await page.evaluate(() => window.__sameKeyRefreshScenario.releaseRefreshedTimes());
  await expect(root.getByTestId('booking-availability-status')).toHaveText(
    'Не удалось загрузить доступность. Обновите экран — ошибка останется до успешной загрузки.',
  );
  expect(await page.evaluate(() => window.__sameKeyRefreshScenario.datesCalls)).toBe(2);
});

test('uses only backend profile contacts and routes an incomplete profile out of the sheet', async ({ page }) => {
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

    let profileOpens = 0;
    let lists = 0;
    const availabilityActions = Object.freeze({
      async listServices() {
        return {
          outcome: 'services_loaded',
          services: [{ id: 101, title: 'Аренда корта 1ч.', categoryId: 1 }],
        };
      },
      async listCourts() {
        return {
          outcome: 'courts_loaded',
          courts: [{ id: 201, name: 'Корт №1' }],
        };
      },
      async listDates(query) {
        return { outcome: 'dates_loaded', dates: [query.dateFrom] };
      },
      async listTimes(query) {
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
        throw new Error('payment provider boundary must block create');
      },
      async listBookings() {
        lists += 1;
        return { outcome: 'bookings_loaded', reservations: [] };
      },
    });

    const container = document.createElement('div');
    container.dataset.testid = 'booking-profile-boundary-root';
    document.body.append(container);
    createRoot(container).render(React.createElement(BookingScreen, {
      availabilityActions,
      bookingClient: null,
      onOpenProfile() {
        profileOpens += 1;
      },
    }));
    window.__bookingProfileBoundary = {
      get profileOpens() { return profileOpens; },
      get lists() { return lists; },
    };
  });

  const root = page.getByTestId('booking-profile-boundary-root');
  await root.getByRole('button', { name: '17:00–17:30 Свободно' }).click();
  await root.getByRole('button', { name: '17:30–18:00 Свободно' }).click();
  await root.getByRole('button', { name: 'Продолжить' }).click();

  const dialog = page.getByRole('dialog', { name: 'Подтверждение брони' });
  await expect(dialog.getByTestId('booking-contact-email')).toHaveCount(0);
  await expect(dialog).toContainText('Заполните имя и телефон в профиле');
  await expect(dialog.getByRole('button', { name: 'Оплатить 4 400 ₽' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Перейти в профиль' }).click();
  expect(await page.evaluate(() => window.__bookingProfileBoundary)).toEqual({
    profileOpens: 1,
    lists: 0,
  });
});
