const { test, expect } = require('@playwright/test');

const TELEGRAM_SDK_ROUTE = 'https://telegram.org/js/telegram-web-app.js';
const SYNTHETIC_CREDENTIAL = 'A'.repeat(43);
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_KEY = '44444444-4444-4444-8444-444444444444';
const INVITATION_ID = '55555555-5555-4555-8555-555555555555';
const PARTICIPANT_ID = '66666666-6666-4666-8666-666666666666';
const MESSAGE_ID = '77777777-7777-4777-8777-777777777777';
const OLDER_MESSAGE_ID = '88888888-8888-4888-8888-888888888888';
const WAITLIST_ENTRY_ID = '99999999-9999-4999-8999-999999999999';
const RESULT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTIFICATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
});

test.describe('backend match credential lifecycle', () => {
  test('legacy data boundary fails before any network request', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabaseClient.js');
      const operations = [
        () => supabase.from('matches'),
        () => supabase.rpc('join_match'),
        () => supabase.channel('public:matches'),
        () => supabase.removeChannel({}),
        () => supabase.auth.getSession(),
        () => supabase.auth.onAuthStateChange(() => {}),
        () => supabase.auth.signInWithPassword({}),
        () => supabase.auth.signOut(),
        () => supabase.auth.signUp({}),
      ];
      const errors = operations.map((operation) => {
        try {
          operation();
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      });

      return {
        errors,
        hasNetworkConfiguration:
          Object.prototype.hasOwnProperty.call(supabase, 'supabaseUrl') ||
          Object.prototype.hasOwnProperty.call(supabase, 'url') ||
          Object.prototype.hasOwnProperty.call(supabase, 'fetch'),
      };
    });

    expect(summary.hasNetworkConfiguration).toBe(false);
    expect(summary.errors).toHaveLength(9);
    expect(summary.errors.every((message) =>
      message ===
        'Legacy data runtime is unavailable; use the bearer-protected backend API',
    )).toBe(true);
  });

  test('uses exact no-store contracts for public/account feeds, detail, create, join and leave', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const {
        createBackendSessionClient,
        isBackendMatchDetailRecord,
        isBackendMatchFeedRecord,
      } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const contracts = [];
      const detail = {
        matchId: parameters.matchId,
        ownerAccountId: parameters.accountId,
        createdAt: 1_900_000_000,
        updatedAt: 1_900_000_000,
        startsAt: 1_900_086_400,
        durationMinutes: 90,
        courtId: 'court-1',
        courtName: 'Корт 1',
        courtType: 'panoramic',
        kind: 'match',
        visibility: 'public',
        scenario: 'social',
        status: 'confirmed',
        description: '',
        ratingMin: 1,
        ratingMax: 5,
        isRatingMatch: false,
        pricePerPersonSnapshot: 750,
        version: 1,
        owner: {
          playerId: parameters.accountId,
          firstName: 'Synthetic',
          lastName: 'Owner',
          username: 'synthetic_owner',
          rating: 3,
          isVerified: true,
        },
        participants: [{
          playerId: parameters.otherAccountId,
          slotNumber: 2,
          firstName: 'Other',
          lastName: 'Player',
          username: 'other_player',
          rating: 4,
          isVerified: false,
        }],
      };
      const feed = {
        matchId: detail.matchId,
        ownerAccountId: detail.ownerAccountId,
        startsAt: detail.startsAt,
        durationMinutes: detail.durationMinutes,
        courtId: detail.courtId,
        courtName: detail.courtName,
        courtType: detail.courtType,
        scenario: detail.scenario,
        status: detail.status,
        description: detail.description,
        ratingMin: detail.ratingMin,
        ratingMax: detail.ratingMax,
        isRatingMatch: detail.isRatingMatch,
        pricePerPersonSnapshot: detail.pricePerPersonSnapshot,
        occupiedSlots: 2,
        version: detail.version,
        owner: detail.owner,
        participants: detail.participants,
      };
      const client = createBackendSessionClient({
        cryptoImpl: {
          randomUUID: () => parameters.requestKey,
        },
        fetchImpl: async (url, options) => {
          const body = options.body === undefined
            ? null
            : JSON.parse(options.body);
          contracts.push({
            url,
            method: options.method,
            bearerMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            contentType:
              options.headers['Content-Type'] ?? null,
            body,
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });

          if (url.endsWith('/join')) {
            return new Response(JSON.stringify({
              participant: {
                matchId: parameters.matchId,
                playerId: parameters.accountId,
                slotNumber: 2,
                status: 'active',
                matchVersion: 2,
              },
            }), { status: 200 });
          }
          if (url.endsWith('/leave')) {
            return new Response(JSON.stringify({
              participant: {
                matchId: parameters.matchId,
                playerId: parameters.accountId,
                slotNumber: 2,
                status: 'left',
                matchVersion: 3,
              },
            }), { status: 200 });
          }
          if (url === '/api/v1/matches?limit=20') {
            return new Response(JSON.stringify({ matches: [feed] }), {
              status: 200,
            });
          }
          if (url === '/api/v1/matches/mine?limit=50') {
            return new Response(JSON.stringify({ matches: [feed] }), {
              status: 200,
            });
          }
          if (url === `/api/v1/matches/${parameters.matchId}`) {
            return new Response(JSON.stringify({ match: detail }), {
              status: 200,
            });
          }
          return new Response(JSON.stringify({ match: detail }), {
            status: 201,
          });
        },
      });
      const draft = {
        startsAt: detail.startsAt,
        durationMinutes: detail.durationMinutes,
        courtId: detail.courtId,
        scenario: detail.scenario,
        description: detail.description,
        ratingMin: detail.ratingMin,
        ratingMax: detail.ratingMax,
        isRatingMatch: detail.isRatingMatch,
      };

      const results = [
        await client.listMatches(parameters.credential, 20),
        await client.listAccountMatches(parameters.credential, 50),
        await client.readMatch(parameters.credential, parameters.matchId),
        await client.createMatch(parameters.credential, draft),
        await client.joinMatch(parameters.credential, parameters.matchId),
        await client.leaveMatch(parameters.credential, parameters.matchId),
      ];
      const terminalFeedResults = await Promise.all(
        ['completed', 'cancelled'].map(async (status) => {
          const terminalFeedClient = createBackendSessionClient({
            fetchImpl: async () => new Response(JSON.stringify({
              matches: [{ ...feed, status }],
            }), { status: 200 }),
          });
          return terminalFeedClient.listMatches(
            parameters.credential,
            20,
          );
        }),
      );
      const largeFeed = Array.from({ length: 20 }, (_, index) => ({
        ...feed,
        matchId:
          `33333333-3333-4333-8333-${index
            .toString(16)
            .padStart(12, '0')}`,
        owner: {
          ...feed.owner,
          firstName: '😀'.repeat(256),
          lastName: '😀'.repeat(256),
          username: 'u'.repeat(64),
        },
      }));
      const largeFeedResult = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          matches: largeFeed,
        }), { status: 200 }),
      }).listMatches(parameters.credential, 20);
      const serializedResults = JSON.stringify(results);
      const serializedErrors = results
        .map((result) => result.reason ?? '')
        .join('|');
      const {
        owner: _feedOwner,
        participants: _feedParticipants,
        ...legacyFeed
      } = feed;
      const {
        owner: _detailOwner,
        ...legacyDetailBase
      } = detail;
      const legacyDetail = {
        ...legacyDetailBase,
        participants: detail.participants.map(
          ({ playerId, slotNumber }) => ({ playerId, slotNumber }),
        ),
      };

      return {
        contracts: contracts.map((contract) => ({
          ...contract,
          exactActionBody:
            contract.body === null ||
            (
              Object.keys(contract.body).sort().join(',') ===
                'requestKey' &&
              contract.body.requestKey === parameters.requestKey
            ),
          exactCreateBody:
            contract.url !== '/api/v1/matches' ||
            (
              Object.keys(contract.body).sort().join(',') ===
                'courtId,description,durationMinutes,isRatingMatch,ratingMax,ratingMin,requestKey,scenario,startsAt' &&
              contract.body.requestKey === parameters.requestKey &&
              !Object.prototype.hasOwnProperty.call(
                contract.body,
                'accountId',
              )
            ),
          body: undefined,
        })),
        outcomes: results.map((result) => result.outcome),
        terminalFeedRejected: terminalFeedResults.every(
          (result) =>
            result.outcome === 'rejected' &&
            result.reason === 'internal_error',
        ),
        largeFeedAccepted:
          largeFeedResult.outcome === 'matches_loaded' &&
          largeFeedResult.matches.length === 20,
        publicProjectionFailClosed:
          !isBackendMatchFeedRecord({
            ...feed,
            owner: {
              ...feed.owner,
              phone: '+79990000000',
            },
          }) &&
          !isBackendMatchFeedRecord({
            ...feed,
            occupiedSlots: 1,
          }) &&
          !isBackendMatchDetailRecord({
            ...detail,
            participants: [{
              playerId: parameters.otherAccountId,
              slotNumber: 2,
              firstName: 'Other',
              rating: 3,
              isVerified: false,
              photoUrl: 'http://example.invalid/private',
            }],
          }),
        rollingUpgradeCompatible:
          isBackendMatchFeedRecord(legacyFeed) &&
          isBackendMatchDetailRecord(legacyDetail),
        credentialAbsentFromResults:
          !serializedResults.includes(parameters.credential),
        credentialAbsentFromErrors:
          !serializedErrors.includes(parameters.credential),
        publicProjectionFrozen:
          Object.isFrozen(results[0].matches[0]) &&
          Object.isFrozen(results[0].matches[0].owner) &&
          Object.isFrozen(results[0].matches[0].participants) &&
          Object.isFrozen(results[0].matches[0].participants[0]) &&
          Object.isFrozen(results[1].matches[0]) &&
          Object.isFrozen(results[2].match.owner) &&
          Object.isFrozen(results[2].match.participants[0]),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      requestKey: REQUEST_KEY,
    });

    expect(summary.outcomes).toEqual([
      'matches_loaded',
      'matches_loaded',
      'match_loaded',
      'match_created',
      'participant_joined',
      'participant_left',
    ]);
    expect(summary.credentialAbsentFromResults).toBe(true);
    expect(summary.credentialAbsentFromErrors).toBe(true);
    expect(summary.publicProjectionFrozen).toBe(true);
    expect(summary.terminalFeedRejected).toBe(true);
    expect(summary.largeFeedAccepted).toBe(true);
    expect(summary.publicProjectionFailClosed).toBe(true);
    expect(summary.rollingUpgradeCompatible).toBe(true);
    expect(summary.contracts).toEqual([
      {
        url: '/api/v1/matches?limit=20',
        method: 'GET',
        bearerMatches: true,
        contentType: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactActionBody: true,
        exactCreateBody: true,
      },
      {
        url: '/api/v1/matches/mine?limit=50',
        method: 'GET',
        bearerMatches: true,
        contentType: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactActionBody: true,
        exactCreateBody: true,
      },
      {
        url: `/api/v1/matches/${MATCH_ID}`,
        method: 'GET',
        bearerMatches: true,
        contentType: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactActionBody: true,
        exactCreateBody: true,
      },
      {
        url: '/api/v1/matches',
        method: 'POST',
        bearerMatches: true,
        contentType: 'application/json',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactActionBody: false,
        exactCreateBody: true,
      },
      {
        url: `/api/v1/matches/${MATCH_ID}/join`,
        method: 'POST',
        bearerMatches: true,
        contentType: 'application/json',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactActionBody: true,
        exactCreateBody: true,
      },
      {
        url: `/api/v1/matches/${MATCH_ID}/leave`,
        method: 'POST',
        bearerMatches: true,
        contentType: 'application/json',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactActionBody: true,
        exactCreateBody: true,
      },
    ]);
  });

  test('maps bearer join eligibility rejections without a legacy fallback', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const responses = [
        { status: 403, code: 'match_rating_verification_required' },
        { status: 409, code: 'match_rating_out_of_range' },
        { status: 409, code: 'match_not_joinable' },
      ];
      const requestKeys = [...parameters.requestKeys];
      const calls = [];
      const client = createBackendSessionClient({
        cryptoImpl: { randomUUID: () => requestKeys.shift() },
        fetchImpl: async (url, options) => {
          calls.push({
            url,
            method: options.method,
            authorization: options.headers.Authorization,
            body: JSON.parse(options.body),
          });
          const response = responses.shift();
          return new Response(JSON.stringify({ code: response.code }), {
            status: response.status,
          });
        },
      });

      const results = [];
      for (let index = 0; index < 3; index += 1) {
        results.push(await client.joinMatch(
          parameters.credential,
          parameters.matchId,
        ));
      }

      return {
        reasons: results.map((result) => result.reason),
        outcomes: results.map((result) => result.outcome),
        exactBackendBoundary: calls.every((call, index) =>
          call.url === `/api/v1/matches/${parameters.matchId}/join` &&
          call.method === 'POST' &&
          call.authorization === `Bearer ${parameters.credential}` &&
          Object.keys(call.body).length === 1 &&
          call.body.requestKey === parameters.requestKeys[index]),
        legacyRequestObserved: calls.some((call) =>
          /\/auth\/v1|\/rest\/v1|supabase/iu.test(call.url)),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      matchId: MATCH_ID,
      requestKeys: [
        REQUEST_KEY,
        '44444444-4444-4444-8444-444444444445',
        '44444444-4444-4444-8444-444444444446',
      ],
    });

    expect(summary).toEqual({
      reasons: [
        'rating_verification_required',
        'rating_out_of_range',
        'match_not_joinable',
      ],
      outcomes: ['rejected', 'rejected', 'rejected'],
      exactBackendBoundary: true,
      legacyRequestObserved: false,
    });
  });

  test('uses exact private contracts for comment update and legacy text moderation', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const calls = [];
      const client = createBackendSessionClient({
        cryptoImpl: { randomUUID: () => parameters.requestKey },
        fetchImpl: async (url, options) => {
          const body = JSON.parse(options.body);
          calls.push({
            url,
            method: options.method,
            bearer: options.headers.Authorization,
            body,
            cache: options.cache,
            credentials: options.credentials,
          });
          if (url === '/api/v1/content/moderation') {
            return body.text === 'safe legacy text'
              ? new Response(null, { status: 204 })
              : new Response(JSON.stringify({
                  statusCode: 422,
                  code: 'content_not_allowed',
                  message: 'Content contains disallowed language',
                }), { status: 422 });
          }
          return new Response(JSON.stringify({
            match: {
              matchId: parameters.matchId,
              description: body.description,
              matchVersion: 2,
            },
          }), { status: 200 });
        },
      });

      const updated = await client.updateMatchDescription(
        parameters.credential,
        parameters.matchId,
        'Updated comment',
      );
      const allowed = await client.moderateText(
        parameters.credential,
        'safe legacy text',
      );
      const rejected = await client.moderateText(
        parameters.credential,
        'disallowed legacy text',
      );

      return { calls, updated, allowed, rejected };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      matchId: MATCH_ID,
      requestKey: REQUEST_KEY,
    });

    expect(summary.updated).toEqual({
      outcome: 'match_description_updated',
      match: {
        matchId: MATCH_ID,
        description: 'Updated comment',
        matchVersion: 2,
      },
    });
    expect(summary.allowed).toEqual({ outcome: 'content_allowed' });
    expect(summary.rejected).toEqual({
      outcome: 'rejected',
      reason: 'content_not_allowed',
    });
    expect(summary.calls).toEqual([
      {
        url: `/api/v1/matches/${MATCH_ID}`,
        method: 'PATCH',
        bearer: `Bearer ${SYNTHETIC_CREDENTIAL}`,
        body: {
          requestKey: REQUEST_KEY,
          description: 'Updated comment',
        },
        cache: 'no-store',
        credentials: 'omit',
      },
      {
        url: '/api/v1/content/moderation',
        method: 'POST',
        bearer: `Bearer ${SYNTHETIC_CREDENTIAL}`,
        body: { text: 'safe legacy text' },
        cache: 'no-store',
        credentials: 'omit',
      },
      {
        url: '/api/v1/content/moderation',
        method: 'POST',
        bearer: `Bearer ${SYNTHETIC_CREDENTIAL}`,
        body: { text: 'disallowed legacy text' },
        cache: 'no-store',
        credentials: 'omit',
      },
    ]);
  });

  test('uses the private bearer boundary for player search and invitations', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const {
        createBackendSessionClient,
        isBackendMatchInvitation,
      } = await import('/src/lib/backendSessionClient.js');
      const {
        mapBackendInvitationToApp,
        mapBackendPublicPlayerToApp,
      } = await import('/src/lib/backendMatchAdapter.js');
      const {
        supportsBackendMatchInvitations,
      } = await import('/src/components/MatchDetailsScreen.jsx');

      const owner = {
        playerId: parameters.accountId,
        firstName: 'Owner',
        lastName: 'Player',
        username: 'owner',
        rating: 3,
        isVerified: true,
      };
      const invitedPlayer = {
        playerId: parameters.otherAccountId,
        firstName: 'Invited',
        lastName: 'Player',
        username: 'invited',
        photoUrl: 'https://photos.example.test/invited/avatar.webp',
        rating: 3.5,
        isVerified: true,
      };
      const invitationMatch = {
        matchId: parameters.matchId,
        ownerAccountId: parameters.accountId,
        startsAt: 1_900_086_400,
        durationMinutes: 90,
        courtId: 'court-1',
        courtName: 'Корт 1',
        courtType: 'panoramic',
        scenario: 'social',
        status: 'open',
        title: 'Invitation match',
        ratingMin: 1,
        ratingMax: 5,
        isRatingMatch: false,
        pricePerPersonSnapshot: 750,
        owner,
      };
      const invitation = {
        invitationId: parameters.invitationId,
        matchId: parameters.matchId,
        invitedByAccountId: parameters.accountId,
        invitedAccountId: parameters.otherAccountId,
        slotNumber: 2,
        status: 'pending',
        createdAt: 1_900_000_000,
        updatedAt: 1_900_000_000,
        version: 1,
        match: invitationMatch,
        invitedPlayer,
      };
      const contracts = [];
      const client = createBackendSessionClient({
        cryptoImpl: {
          randomUUID: () => parameters.requestKey,
        },
        fetchImpl: async (url, options) => {
          contracts.push({
            url,
            method: options.method,
            bearerMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            body: options.body ? JSON.parse(options.body) : null,
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });

          if (url.startsWith('/api/v1/players/search?')) {
            return new Response(JSON.stringify({
              players: [invitedPlayer],
            }), { status: 200 });
          }
          if (url === '/api/v1/match-invitations?limit=20') {
            return new Response(JSON.stringify({
              invitations: [invitation],
            }), { status: 200 });
          }
          if (
            url ===
            `/api/v1/matches/${parameters.matchId}/invitations?limit=20`
          ) {
            return new Response(JSON.stringify({
              invitations: [invitation],
            }), { status: 200 });
          }
          if (
            url ===
            `/api/v1/matches/${parameters.matchId}/invitations`
          ) {
            return new Response(JSON.stringify({ invitation }), {
              status: 201,
            });
          }
          const action = url.split('/').at(-1);
          const status = action === 'accept'
            ? 'accepted'
            : action === 'decline'
              ? 'declined'
              : 'cancelled';
          const closedInvitation = {
            ...invitation,
            status,
            updatedAt: invitation.updatedAt + 1,
            respondedAt: invitation.updatedAt + 1,
            version: 2,
          };
          if (action === 'accept') {
            return new Response(JSON.stringify({
              invitation: closedInvitation,
              participant: {
                participantId: parameters.participantId,
                accountId: parameters.otherAccountId,
                slotNumber: 2,
                status: 'active',
              },
              matchVersion: 2,
            }), { status: 201 });
          }
          return new Response(JSON.stringify({
            invitation: closedInvitation,
          }), { status: 201 });
        },
      });

      const results = [
        await client.searchPlayers(parameters.credential, '@Invited', 5),
        await client.listIncomingMatchInvitations(
          parameters.credential,
          20,
        ),
        await client.listOutgoingMatchInvitations(
          parameters.credential,
          parameters.matchId,
          20,
        ),
        await client.createMatchInvitation(
          parameters.credential,
          parameters.matchId,
          parameters.otherAccountId,
          2,
        ),
        await client.acceptMatchInvitation(
          parameters.credential,
          parameters.invitationId,
        ),
        await client.declineMatchInvitation(
          parameters.credential,
          parameters.invitationId,
        ),
        await client.cancelMatchInvitation(
          parameters.credential,
          parameters.invitationId,
        ),
      ];
      const malformed = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          invitations: [{
            ...invitation,
            slotNumber: 1,
          }],
        }), { status: 200 }),
      }).listIncomingMatchInvitations(parameters.credential, 20);
      const malformedLifecycle = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          invitations: [{
            ...invitation,
            status: 'cancelled',
          }],
        }), { status: 200 }),
      }).listIncomingMatchInvitations(parameters.credential, 20);
      const invalidSearch = await client.searchPlayers(
        parameters.credential,
        'player\u0000name',
        5,
      );
      const unsafePhotoSearch = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          players: [{
            ...invitedPlayer,
            photoUrl: 'http://photos.example.test/invited/avatar.webp',
          }],
        }), { status: 200 }),
      }).searchPlayers(parameters.credential, 'Invited', 5);
      const largePlayerSearch = Array.from(
        { length: 20 },
        (_, index) => ({
          ...invitedPlayer,
          playerId:
            `44444444-4444-4444-8444-${index
              .toString(16)
              .padStart(12, '0')}`,
          firstName: '😀'.repeat(256),
          lastName: '😀'.repeat(256),
          username: 'u'.repeat(64),
        }),
      );
      const largePlayerSearchBody = JSON.stringify({
        players: largePlayerSearch,
      });
      const largePlayerSearchResult = await createBackendSessionClient({
        fetchImpl: async () => new Response(
          largePlayerSearchBody,
          { status: 200 },
        ),
      }).searchPlayers(parameters.credential, 'player', 20);
      const mappedInvitation = mapBackendInvitationToApp(invitation);
      const mappedPlayer = mapBackendPublicPlayerToApp(invitedPlayer);

      return {
        outcomes: results.map(({ outcome }) => outcome),
        contracts,
        malformed,
        malformedLifecycle,
        invalidSearch,
        unsafePhotoSearch,
        largePlayerSearchAccepted:
          new TextEncoder().encode(largePlayerSearchBody).byteLength > 32_768 &&
          largePlayerSearchResult.outcome === 'players_loaded' &&
          largePlayerSearchResult.players.length === 20,
        validatorAcceptsCanonical:
          isBackendMatchInvitation(invitation),
        mapped: {
          invitationId: mappedInvitation.invitation_id,
          matchId: mappedInvitation.match_id,
          slotIndex: mappedInvitation.slot_index,
          organizer: mappedInvitation.organizer_first_name,
          playerId: mappedInvitation.player.id,
          playerSearchId: mappedPlayer.id,
          playerPhotoUrl: mappedPlayer.photo_url,
        },
        backendInvitationUiEnabled:
          supportsBackendMatchInvitations(
            { backendOwned: true },
            () => {},
            () => {},
          ),
        backendInvitationUiFailClosed:
          !supportsBackendMatchInvitations(
            { backendOwned: true },
            null,
            () => {},
          ),
        publicResultsHideCredential:
          !JSON.stringify(results).includes(parameters.credential),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      invitationId: INVITATION_ID,
      participantId: PARTICIPANT_ID,
      requestKey: REQUEST_KEY,
    });

    expect(summary.outcomes).toEqual([
      'players_loaded',
      'invitations_loaded',
      'invitations_loaded',
      'invitation_created',
      'invitation_accepted',
      'invitation_declined',
      'invitation_cancelled',
    ]);
    expect(summary.contracts).toEqual([
      {
        url: '/api/v1/players/search?q=%40Invited&limit=5',
        method: 'GET',
        bearerMatches: true,
        body: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      {
        url: '/api/v1/match-invitations?limit=20',
        method: 'GET',
        bearerMatches: true,
        body: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      {
        url:
          `/api/v1/matches/${MATCH_ID}/invitations?limit=20`,
        method: 'GET',
        bearerMatches: true,
        body: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      {
        url: `/api/v1/matches/${MATCH_ID}/invitations`,
        method: 'POST',
        bearerMatches: true,
        body: {
          requestKey: REQUEST_KEY,
          playerId: OTHER_ACCOUNT_ID,
          slotNumber: 2,
        },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      ...['accept', 'decline', 'cancel'].map((action) => ({
        url: `/api/v1/match-invitations/${INVITATION_ID}/${action}`,
        method: 'POST',
        bearerMatches: true,
        body: { requestKey: REQUEST_KEY },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      })),
    ]);
    expect(summary.malformed).toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(summary.malformedLifecycle).toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(summary.invalidSearch).toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(summary.unsafePhotoSearch).toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(summary.largePlayerSearchAccepted).toBe(true);
    expect(summary.validatorAcceptsCanonical).toBe(true);
    expect(summary.mapped).toEqual({
      invitationId: INVITATION_ID,
      matchId: MATCH_ID,
      slotIndex: 1,
      organizer: 'Owner',
      playerId: OTHER_ACCOUNT_ID,
      playerSearchId: OTHER_ACCOUNT_ID,
      playerPhotoUrl:
        'https://photos.example.test/invited/avatar.webp',
    });
    expect(summary.backendInvitationUiEnabled).toBe(true);
    expect(summary.backendInvitationUiFailClosed).toBe(true);
    expect(summary.publicResultsHideCredential).toBe(true);
  });

  test('uses exact private contracts for backend match waitlist', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const { normalizeBackendMatchWaitlist } = await import(
        '/src/components/MatchDetailsScreen.jsx'
      );
      const contracts = [];
      const current = {
        entryId: parameters.waitlistEntryId,
        player: {
          playerId: parameters.accountId,
          firstName: 'Current',
          lastName: 'Player',
          username: 'current_player',
          rating: 3,
          isVerified: true,
        },
        queuePosition: 2,
        joinedAt: 1_900_000_010,
        isCurrentPlayer: true,
      };
      const first = {
        entryId: parameters.firstWaitlistEntryId,
        player: {
          playerId: parameters.otherAccountId,
          firstName: 'First',
          lastName: 'Player',
          username: 'first_player',
          rating: 3.5,
          isVerified: false,
        },
        queuePosition: 1,
        joinedAt: 1_900_000_000,
        isCurrentPlayer: false,
      };
      const client = createBackendSessionClient({
        cryptoImpl: { randomUUID: () => parameters.requestKey },
        fetchImpl: async (url, options) => {
          contracts.push({
            url,
            method: options.method,
            bearerMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            contentType: options.headers['Content-Type'] ?? null,
            body: options.body === undefined
              ? null
              : JSON.parse(options.body),
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });
          if (url.endsWith('/waitlist?limit=50')) {
            return new Response(JSON.stringify({
              entries: [first, current],
              current,
              count: 2,
            }), { status: 200 });
          }
          if (url.endsWith('/waitlist/join')) {
            return new Response(JSON.stringify({
              entry: {
                entryId: parameters.waitlistEntryId,
                matchId: parameters.matchId,
                status: 'waiting',
                appliedAt: 1_900_000_010,
                version: 1,
              },
            }), { status: 201 });
          }
          return new Response(JSON.stringify({
            entry: {
              entryId: parameters.waitlistEntryId,
              matchId: parameters.matchId,
              status: 'left',
              appliedAt: 1_900_000_020,
              version: 2,
            },
          }), { status: 201 });
        },
      });

      const listed = await client.listMatchWaitlist(
        parameters.credential,
        parameters.matchId,
        50,
      );
      const joined = await client.joinMatchWaitlist(
        parameters.credential,
        parameters.matchId,
      );
      const left = await client.leaveMatchWaitlist(
        parameters.credential,
        parameters.matchId,
      );
      const malformed = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          entries: [current, first],
          current,
          count: 2,
        }), { status: 200 }),
      }).listMatchWaitlist(
        parameters.credential,
        parameters.matchId,
        50,
      );
      const normalized = normalizeBackendMatchWaitlist(listed);

      return {
        contracts,
        outcomes: [listed.outcome, joined.outcome, left.outcome],
        malformed,
        normalized: {
          playerIds: normalized?.players.map(({ user_id }) => user_id),
          positions: normalized?.players.map(
            ({ queue_position }) => queue_position,
          ),
          currentPosition: normalized?.position?.queue_position,
          count: normalized?.count,
        },
        publicResultsHideCredential:
          !JSON.stringify([listed, joined, left]).includes(
            parameters.credential,
          ),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      requestKey: REQUEST_KEY,
      waitlistEntryId: WAITLIST_ENTRY_ID,
      firstWaitlistEntryId: OLDER_MESSAGE_ID,
    });

    expect(summary.contracts).toEqual([
      {
        url: `/api/v1/matches/${MATCH_ID}/waitlist?limit=50`,
        method: 'GET',
        bearerMatches: true,
        contentType: null,
        body: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      ...['join', 'leave'].map((action) => ({
        url: `/api/v1/matches/${MATCH_ID}/waitlist/${action}`,
        method: 'POST',
        bearerMatches: true,
        contentType: 'application/json',
        body: { requestKey: REQUEST_KEY },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      })),
    ]);
    expect(summary.outcomes).toEqual([
      'waitlist_loaded',
      'waitlist_joined',
      'waitlist_left',
    ]);
    expect(summary.malformed).toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(summary.normalized).toEqual({
      playerIds: [OTHER_ACCOUNT_ID, ACCOUNT_ID],
      positions: [1, 2],
      currentPosition: 2,
      count: 2,
    });
    expect(summary.publicResultsHideCredential).toBe(true);
  });

  test('uses exact private contracts for backend match notifications', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const { mapBackendMatchNotificationToApp } = await import(
        '/src/lib/backendMatchAdapter.js'
      );
      const contracts = [];
      const notification = {
        notificationId: parameters.notificationId,
        matchId: parameters.matchId,
        notificationType: 'waitlist_promoted',
        createdAt: 1_900_000_000,
      };
      const client = createBackendSessionClient({
        fetchImpl: async (url, options) => {
          contracts.push({
            url,
            method: options.method,
            bearerMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            contentType: options.headers['Content-Type'] ?? null,
            body: options.body === undefined
              ? null
              : JSON.parse(options.body),
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });
          if (options.method === 'POST') {
            return new Response(JSON.stringify({
              notification: { ...notification, readAt: 1_900_000_010 },
            }), { status: 200 });
          }
          return new Response(JSON.stringify({
            notifications: [notification],
            unreadCount: 1,
          }), { status: 200 });
        },
      });
      const listed = await client.listMatchNotifications(
        parameters.credential,
        50,
      );
      const marked = await client.markMatchNotificationRead(
        parameters.credential,
        parameters.notificationId,
      );
      const contractsBeforeInvalid = contracts.length;
      const invalid = await client.markMatchNotificationRead(
        parameters.credential,
        'invalid-notification-id',
      );
      const malformed = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          notifications: [{ ...notification, readAt: 1_899_999_999 }],
          unreadCount: 0,
        }), { status: 200 }),
      }).listMatchNotifications(parameters.credential, 50);
      const mapped = mapBackendMatchNotificationToApp(
        listed.notifications[0],
      );
      const mappedInvalidDate = mapBackendMatchNotificationToApp({
        ...notification,
        createdAt: Number.MAX_SAFE_INTEGER,
      });

      return {
        contracts,
        contractsBeforeInvalid,
        outcomes: [listed.outcome, marked.outcome],
        invalid,
        malformed,
        mapped,
        mappedInvalidDate,
        publicResultsHideCredential:
          !JSON.stringify([listed, marked]).includes(parameters.credential),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      matchId: MATCH_ID,
      notificationId: NOTIFICATION_ID,
    });

    expect(summary.contracts).toEqual([
      {
        url: '/api/v1/match-notifications?limit=50',
        method: 'GET',
        bearerMatches: true,
        contentType: null,
        body: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      {
        url: `/api/v1/match-notifications/${NOTIFICATION_ID}/read`,
        method: 'POST',
        bearerMatches: true,
        contentType: 'application/json',
        body: {},
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
    ]);
    expect(summary.contractsBeforeInvalid).toBe(2);
    expect(summary.outcomes).toEqual([
      'notifications_loaded',
      'notification_read',
    ]);
    expect(summary.invalid).toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(summary.malformed).toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(summary.mapped).toMatchObject({
      notification_id: NOTIFICATION_ID,
      notification_type: 'waitlist_promoted',
      match_id: MATCH_ID,
      read_at: null,
      notification_provider: 'backend',
      backendOwned: true,
    });
    expect(summary.mappedInvalidDate).toBeNull();
    expect(summary.publicResultsHideCredential).toBe(true);
  });

  test('uses exact private contracts for backend match lineup', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const contracts = [];
      const player = {
        playerId: parameters.accountId,
        firstName: 'Current',
        lastName: 'Player',
        username: 'current_player',
        rating: 3,
        isVerified: true,
      };
      const slots = [
        {
          teamNumber: 1,
          courtSide: 'left',
          assignment: {
            assignmentId: parameters.assignmentId,
            player,
            assignedAt: 1_900_000_000,
            isCurrentPlayer: true,
          },
        },
        { teamNumber: 1, courtSide: 'right' },
        { teamNumber: 2, courtSide: 'left' },
        { teamNumber: 2, courtSide: 'right' },
      ];
      const mutation = (teamNumber, courtSide, appliedAt) => ({
        assignment: {
          assignmentId: parameters.assignmentId,
          matchId: parameters.matchId,
          accountId: parameters.accountId,
          teamNumber,
          courtSide,
          appliedAt,
          lineupVersion: 2,
        },
      });
      const client = createBackendSessionClient({
        cryptoImpl: { randomUUID: () => parameters.requestKey },
        fetchImpl: async (url, options) => {
          contracts.push({
            url,
            method: options.method,
            bearerMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            contentType: options.headers['Content-Type'] ?? null,
            body: options.body === undefined
              ? null
              : JSON.parse(options.body),
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });
          if (url.endsWith('/lineup')) {
            return new Response(JSON.stringify({
              lineup: {
                matchId: parameters.matchId,
                status: 'draft',
                version: 1,
                slots,
                unassignedPlayers: [],
              },
            }), { status: 200 });
          }
          if (url.endsWith('/lineup/assign')) {
            return new Response(JSON.stringify(
              mutation(2, 'right', 1_900_000_010),
            ), { status: 201 });
          }
          return new Response(JSON.stringify(
            mutation(2, 'right', 1_900_000_020),
          ), { status: 201 });
        },
      });

      const loaded = await client.readMatchLineup(
        parameters.credential,
        parameters.matchId,
      );
      const assigned = await client.assignMatchLineupSlot(
        parameters.credential,
        parameters.matchId,
        2,
        'right',
      );
      const released = await client.releaseMatchLineupSlot(
        parameters.credential,
        parameters.matchId,
      );
      const malformed = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          lineup: {
            matchId: parameters.matchId,
            status: 'draft',
            version: 1,
            slots: [slots[1], slots[0], slots[2], slots[3]],
            unassignedPlayers: [],
          },
        }), { status: 200 }),
      }).readMatchLineup(parameters.credential, parameters.matchId);

      return {
        contracts,
        outcomes: [loaded.outcome, assigned.outcome, released.outcome],
        slotOrder: loaded.lineup?.slots.map(
          ({ teamNumber, courtSide }) => `${teamNumber}:${courtSide}`,
        ),
        malformed,
        publicResultsHideCredential:
          !JSON.stringify([loaded, assigned, released]).includes(
            parameters.credential,
          ),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      accountId: ACCOUNT_ID,
      matchId: MATCH_ID,
      requestKey: REQUEST_KEY,
      assignmentId: PARTICIPANT_ID,
    });

    expect(summary.contracts).toEqual([
      {
        url: `/api/v1/matches/${MATCH_ID}/lineup`,
        method: 'GET',
        bearerMatches: true,
        contentType: null,
        body: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      {
        url: `/api/v1/matches/${MATCH_ID}/lineup/assign`,
        method: 'POST',
        bearerMatches: true,
        contentType: 'application/json',
        body: {
          requestKey: REQUEST_KEY,
          teamNumber: 2,
          courtSide: 'right',
        },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      {
        url: `/api/v1/matches/${MATCH_ID}/lineup/release`,
        method: 'POST',
        bearerMatches: true,
        contentType: 'application/json',
        body: { requestKey: REQUEST_KEY },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
    ]);
    expect(summary.outcomes).toEqual([
      'lineup_loaded',
      'lineup_assigned',
      'lineup_released',
    ]);
    expect(summary.slotOrder).toEqual([
      '1:left',
      '1:right',
      '2:left',
      '2:right',
    ]);
    expect(summary.malformed).toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(summary.publicResultsHideCredential).toBe(true);
  });

  test('uses exact private contracts for backend match results', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const contracts = [];
      const mutation = (status, appliedAt, resultVersion) => ({
        result: {
          resultId: parameters.resultId,
          matchId: parameters.matchId,
          status,
          appliedAt,
          resultVersion,
        },
      });
      const client = createBackendSessionClient({
        cryptoImpl: { randomUUID: () => parameters.requestKey },
        fetchImpl: async (url, options) => {
          contracts.push({
            url,
            method: options.method,
            bearerMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            contentType: options.headers['Content-Type'] ?? null,
            body: options.body === undefined ? null : JSON.parse(options.body),
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });
          if (url.endsWith('/result/submit')) {
            return new Response(JSON.stringify(
              mutation('submitted', 1_900_000_010, 1),
            ), { status: 201 });
          }
          if (url.endsWith('/result/confirm')) {
            return new Response(JSON.stringify(
              mutation('confirmed', 1_900_000_020, 2),
            ), { status: 201 });
          }
          if (url.endsWith('/result/dispute')) {
            return new Response(JSON.stringify(
              mutation('disputed', 1_900_000_030, 2),
            ), { status: 201 });
          }
          return new Response(JSON.stringify({
            result: {
              resultId: parameters.resultId,
              matchId: parameters.matchId,
              lineupVersion: 4,
              teams: [
                [parameters.accountId, parameters.otherAccountId],
                [parameters.thirdAccountId, parameters.fourthAccountId],
              ],
              sets: [
                { team1Games: 6, team2Games: 4 },
                { team1Games: 6, team2Games: 3 },
              ],
              winningTeam: 1,
              status: 'submitted',
              submittedByAccountId: parameters.accountId,
              submittedAt: 1_900_000_000,
              version: 1,
            },
          }), { status: 200 });
        },
      });
      const sets = [
        { team1Games: 6, team2Games: 4 },
        { team1Games: 6, team2Games: 3 },
      ];
      const loaded = await client.readMatchResult(
        parameters.credential,
        parameters.matchId,
      );
      const submitted = await client.submitMatchResult(
        parameters.credential,
        parameters.matchId,
        sets,
      );
      const confirmed = await client.confirmMatchResult(
        parameters.credential,
        parameters.matchId,
      );
      const disputed = await client.disputeMatchResult(
        parameters.credential,
        parameters.matchId,
      );
      const missing = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          code: 'match_result_not_found',
        }), { status: 404 }),
      }).readMatchResult(parameters.credential, parameters.matchId);
      const malformed = await createBackendSessionClient({
        fetchImpl: async () => new Response(JSON.stringify({
          result: {
            ...loaded.result,
            winningTeam: 2,
          },
        }), { status: 200 }),
      }).readMatchResult(parameters.credential, parameters.matchId);
      const invalidSequence = await createBackendSessionClient({
        fetchImpl: async () => {
          throw new Error('invalid result sequence must not reach fetch');
        },
      }).submitMatchResult(parameters.credential, parameters.matchId, [
        { team1Games: 6, team2Games: 0 },
        { team1Games: 6, team2Games: 0 },
        { team1Games: 0, team2Games: 6 },
      ]);

      return {
        contracts,
        outcomes: [
          loaded.outcome,
          submitted.outcome,
          confirmed.outcome,
          disputed.outcome,
        ],
        missing,
        malformed,
        invalidSequence,
        publicResultsHideCredential:
          !JSON.stringify([loaded, submitted, confirmed, disputed]).includes(
            parameters.credential,
          ),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      thirdAccountId: PARTICIPANT_ID,
      fourthAccountId: MESSAGE_ID,
      matchId: MATCH_ID,
      resultId: RESULT_ID,
      requestKey: REQUEST_KEY,
    });

    expect(summary.contracts).toEqual([
      {
        url: `/api/v1/matches/${MATCH_ID}/result`,
        method: 'GET',
        bearerMatches: true,
        contentType: null,
        body: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      ...['submit', 'confirm', 'dispute'].map((operation) => ({
        url: `/api/v1/matches/${MATCH_ID}/result/${operation}`,
        method: 'POST',
        bearerMatches: true,
        contentType: 'application/json',
        body: operation === 'submit'
          ? {
              requestKey: REQUEST_KEY,
              sets: [
                { team1Games: 6, team2Games: 4 },
                { team1Games: 6, team2Games: 3 },
              ],
            }
          : { requestKey: REQUEST_KEY },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      })),
    ]);
    expect(summary.outcomes).toEqual([
      'result_loaded',
      'result_submitted',
      'result_confirmed',
      'result_disputed',
    ]);
    expect(summary.missing).toEqual({
      outcome: 'rejected',
      reason: 'result_not_found',
    });
    expect(summary.malformed).toEqual({
      outcome: 'rejected',
      reason: 'internal_error',
    });
    expect(summary.invalidSequence).toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(summary.publicResultsHideCredential).toBe(true);
  });

  test('keeps the credential private and clears the boundary on invalid match session', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      let stored = null;
      let credentialMatched = true;
      let listCalls = 0;
      let removeCalls = 0;
      const detail = Object.freeze({
        matchId: parameters.matchId,
        ownerAccountId: parameters.accountId,
        participants: Object.freeze([]),
      });
      const lifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async () => 'synthetic-match-fingerprint',
        client: {
          async login() {
            return {
              outcome: 'authenticated',
              credential: parameters.credential,
              expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              accountKind: 'existing',
            };
          },
        },
        sessions: {
          async authenticate(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'authenticated',
              principal: {
                accountId: parameters.accountId,
                role: 'player',
                expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              },
            };
          },
        },
        matches: {
          async listMatches(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            listCalls += 1;
            return listCalls === 1
              ? { outcome: 'matches_loaded', matches: [] }
              : { outcome: 'rejected', reason: 'invalid' };
          },
          async listAccountMatches(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'matches_loaded',
              matches: [{
                matchId: parameters.matchId,
                ownerAccountId: parameters.accountId,
                participants: [],
              }],
            };
          },
          async readMatch(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return { outcome: 'match_loaded', match: detail };
          },
          async createMatch(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return { outcome: 'match_created', match: detail };
          },
          async updateMatchDescription(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'match_description_updated',
              match: {
                matchId: parameters.matchId,
                description: 'Updated comment',
                matchVersion: 2,
              },
            };
          },
          async moderateText(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return { outcome: 'content_allowed' };
          },
          async joinMatch(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'participant_joined',
              participant: {
                matchId: parameters.matchId,
                playerId: parameters.accountId,
              },
            };
          },
          async leaveMatch(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'participant_left',
              participant: {
                matchId: parameters.matchId,
                playerId: parameters.accountId,
              },
            };
          },
          async searchPlayers(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'players_loaded',
              players: [{
                playerId: parameters.otherAccountId,
              }],
            };
          },
          async listIncomingMatchInvitations(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'invitations_loaded',
              invitations: [{
                invitationId: parameters.invitationId,
                matchId: parameters.matchId,
                invitedByAccountId: parameters.otherAccountId,
                invitedAccountId: parameters.accountId,
              }],
            };
          },
          async listOutgoingMatchInvitations(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'invitations_loaded',
              invitations: [{
                invitationId: parameters.invitationId,
                matchId: parameters.matchId,
                invitedByAccountId: parameters.accountId,
                invitedAccountId: parameters.otherAccountId,
              }],
            };
          },
          async createMatchInvitation(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'invitation_created',
              invitation: {
                invitationId: parameters.invitationId,
                matchId: parameters.matchId,
                invitedByAccountId: parameters.accountId,
                invitedAccountId: parameters.otherAccountId,
                slotNumber: 2,
              },
            };
          },
          async acceptMatchInvitation(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'invitation_accepted',
              invitation: {
                invitationId: parameters.invitationId,
                invitedAccountId: parameters.accountId,
              },
              participant: {
                accountId: parameters.accountId,
              },
            };
          },
          async declineMatchInvitation(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'invitation_declined',
              invitation: {
                invitationId: parameters.invitationId,
                invitedAccountId: parameters.accountId,
              },
            };
          },
          async cancelMatchInvitation(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'invitation_cancelled',
              invitation: {
                invitationId: parameters.invitationId,
                invitedByAccountId: parameters.accountId,
              },
            };
          },
          async listMatchMessages(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'messages_loaded',
              messages: [{
                messageId: parameters.messageId,
                matchId: parameters.matchId,
              }],
            };
          },
          async sendMatchMessage(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'message_sent',
              message: {
                messageId: parameters.messageId,
                matchId: parameters.matchId,
                sender: {
                  playerId: parameters.accountId,
                },
              },
            };
          },
          async listMatchWaitlist(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            const current = {
              entryId: parameters.waitlistEntryId,
              player: { playerId: parameters.accountId },
              queuePosition: 1,
              joinedAt: 1_900_000_000,
              isCurrentPlayer: true,
            };
            return {
              outcome: 'waitlist_loaded',
              entries: [current],
              current,
              count: 1,
            };
          },
          async listMatchNotifications(credential) {
            credentialMatched =
              credentialMatched && credential === parameters.credential;
            return {
              outcome: 'notifications_loaded',
              notifications: [{
                notificationId: parameters.notificationId,
                matchId: parameters.matchId,
                notificationType: 'waitlist_promoted',
                createdAt: 1_900_000_000,
              }],
              unreadCount: 1,
            };
          },
          async markMatchNotificationRead(credential, notificationId) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential &&
              notificationId === parameters.notificationId;
            return {
              outcome: 'notification_read',
              notification: {
                notificationId,
                matchId: parameters.matchId,
                notificationType: 'waitlist_promoted',
                createdAt: 1_900_000_000,
                readAt: 1_900_000_010,
              },
            };
          },
          async joinMatchWaitlist(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'waitlist_joined',
              entry: {
                matchId: parameters.matchId,
                status: 'waiting',
              },
            };
          },
          async leaveMatchWaitlist(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'waitlist_left',
              entry: {
                matchId: parameters.matchId,
                status: 'left',
              },
            };
          },
          async readMatchLineup(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'lineup_loaded',
              lineup: {
                matchId: parameters.matchId,
                slots: [{
                  assignment: {
                    isCurrentPlayer: true,
                    player: { playerId: parameters.accountId },
                  },
                }],
              },
            };
          },
          async assignMatchLineupSlot(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'lineup_assigned',
              assignment: {
                matchId: parameters.matchId,
                accountId: parameters.accountId,
                teamNumber: 2,
                courtSide: 'right',
              },
            };
          },
          async releaseMatchLineupSlot(credential) {
            credentialMatched =
              credentialMatched &&
              credential === parameters.credential;
            return {
              outcome: 'lineup_released',
              assignment: {
                matchId: parameters.matchId,
                accountId: parameters.accountId,
              },
            };
          },
          async readMatchResult(credential) {
            credentialMatched =
              credentialMatched && credential === parameters.credential;
            return {
              outcome: 'result_loaded',
              result: { matchId: parameters.matchId },
            };
          },
          async submitMatchResult(credential) {
            credentialMatched =
              credentialMatched && credential === parameters.credential;
            return {
              outcome: 'result_submitted',
              result: {
                matchId: parameters.matchId,
                status: 'submitted',
              },
            };
          },
          async confirmMatchResult(credential) {
            credentialMatched =
              credentialMatched && credential === parameters.credential;
            return {
              outcome: 'result_confirmed',
              result: {
                matchId: parameters.matchId,
                status: 'confirmed',
              },
            };
          },
          async disputeMatchResult(credential) {
            credentialMatched =
              credentialMatched && credential === parameters.credential;
            return {
              outcome: 'result_disputed',
              result: {
                matchId: parameters.matchId,
                status: 'disputed',
              },
            };
          },
        },
        credentialStorage: {
          async read() {
            return { outcome: 'empty' };
          },
          async write(credential) {
            stored = credential;
            return { outcome: 'stored' };
          },
          async remove() {
            removeCalls += 1;
            stored = null;
            return { outcome: 'removed' };
          },
        },
      });

      const detach = lifecycle.attach('synthetic-init-data', () => {});
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (lifecycle.hasPrincipal()) break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const results = [
        await lifecycle.listMatches(),
        await lifecycle.listAccountMatches(),
        await lifecycle.loadMatch(parameters.matchId),
        await lifecycle.createMatch({}),
        await lifecycle.updateMatchDescription(
          parameters.matchId,
          'Updated comment',
        ),
        await lifecycle.moderateText('Safe legacy text'),
        await lifecycle.joinMatch(parameters.matchId),
        await lifecycle.leaveMatch(parameters.matchId),
        await lifecycle.searchPlayers('Invited', 5),
        await lifecycle.listIncomingMatchInvitations(20),
        await lifecycle.listOutgoingMatchInvitations(
          parameters.matchId,
          20,
        ),
        await lifecycle.createMatchInvitation(
          parameters.matchId,
          parameters.otherAccountId,
          2,
        ),
        await lifecycle.acceptMatchInvitation(parameters.invitationId),
        await lifecycle.declineMatchInvitation(parameters.invitationId),
        await lifecycle.cancelMatchInvitation(parameters.invitationId),
        await lifecycle.listMatchMessages(parameters.matchId, 50),
        await lifecycle.sendMatchMessage(
          parameters.matchId,
          'Synthetic message',
        ),
        await lifecycle.listMatchWaitlist(parameters.matchId, 50),
        await lifecycle.listMatchNotifications(50),
        await lifecycle.markMatchNotificationRead(parameters.notificationId),
        await lifecycle.joinMatchWaitlist(parameters.matchId),
        await lifecycle.leaveMatchWaitlist(parameters.matchId),
        await lifecycle.readMatchLineup(parameters.matchId),
        await lifecycle.assignMatchLineupSlot(
          parameters.matchId,
          2,
          'right',
        ),
        await lifecycle.releaseMatchLineupSlot(parameters.matchId),
        await lifecycle.readMatchResult(parameters.matchId),
        await lifecycle.submitMatchResult(parameters.matchId, [
          { team1Games: 6, team2Games: 4 },
          { team1Games: 6, team2Games: 3 },
        ]),
        await lifecycle.confirmMatchResult(parameters.matchId),
        await lifecycle.disputeMatchResult(parameters.matchId),
      ];
      const invalid = await lifecycle.listMatches();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (stored === null) break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      detach();

      return {
        credentialMatched,
        outcomes: results.map((result) => result.outcome),
        invalidOutcome: invalid.outcome,
        invalidReason: invalid.reason,
        publicResultsHideCredential:
          !JSON.stringify([...results, invalid]).includes(
            parameters.credential,
          ),
        hasCredential: lifecycle.hasCredential(),
        hasPrincipal: lifecycle.hasPrincipal(),
        storedCleared: stored === null,
        removeCalled: removeCalls === 1,
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      invitationId: INVITATION_ID,
      messageId: MESSAGE_ID,
      waitlistEntryId: WAITLIST_ENTRY_ID,
      notificationId: NOTIFICATION_ID,
    });

    expect(summary).toEqual({
      credentialMatched: true,
      outcomes: [
        'matches_loaded',
        'matches_loaded',
        'match_loaded',
        'match_created',
        'match_description_updated',
        'content_allowed',
        'participant_joined',
        'participant_left',
        'players_loaded',
        'invitations_loaded',
        'invitations_loaded',
        'invitation_created',
        'invitation_accepted',
        'invitation_declined',
        'invitation_cancelled',
        'messages_loaded',
        'message_sent',
        'waitlist_loaded',
        'notifications_loaded',
        'notification_read',
        'waitlist_joined',
        'waitlist_left',
        'lineup_loaded',
        'lineup_assigned',
        'lineup_released',
        'result_loaded',
        'result_submitted',
        'result_confirmed',
        'result_disputed',
      ],
      invalidOutcome: 'rejected',
      invalidReason: 'session_invalid',
      publicResultsHideCredential: true,
      hasCredential: false,
      hasPrincipal: false,
      storedCleared: true,
      removeCalled: true,
    });
  });

  test('opens a complete backend match after accepting an invitation', async ({
    page,
  }) => {
    const pageErrors = [];
    const dialogs = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.route('**/rest/v1/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let body = [];
      if (pathname.endsWith('/rpc/get_my_profile')) {
        body = [{
          id: ACCOUNT_ID,
          first_name: 'Invited',
          last_name: 'Player',
          username: 'invited_player',
          role: 'user',
          rating: 3,
          is_verified: true,
        }];
      } else if (pathname.endsWith('/rpc/get_unread_notification_count')) {
        body = [0];
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.goto('/');
    await isolateComponentHarness(page);

    await page.evaluate(async (parameters) => {
      const reactModule = await import('/@id/react');
      const React = reactModule.default ?? reactModule;
      const reactDomClientModule = await import('/@id/react-dom/client');
      const { createRoot } =
        reactDomClientModule.default ?? reactDomClientModule;
      const { default: App } = await import('/src/App.jsx');

      const container = document.createElement('div');
      container.dataset.testid = 'backend-invitation-app-root';
      document.body.append(container);
      const startsAt = Math.floor(Date.now() / 1_000) + 86_400;
      const owner = {
        playerId: parameters.otherAccountId,
        firstName: 'Match',
        lastName: 'Owner',
        username: 'match_owner',
        rating: 3,
        isVerified: true,
      };
      const invitedPlayer = {
        playerId: parameters.accountId,
        firstName: 'Invited',
        lastName: 'Player',
        username: 'invited_player',
        rating: 3,
        isVerified: true,
      };
      const detail = {
        matchId: parameters.matchId,
        ownerAccountId: parameters.otherAccountId,
        createdAt: startsAt - 3_600,
        updatedAt: startsAt - 30,
        startsAt,
        durationMinutes: 90,
        courtId: 'court-1',
        courtName: 'Court 1',
        courtType: 'panoramic',
        kind: 'match',
        visibility: 'public',
        scenario: 'social',
        status: 'open',
        description: 'Invitation regression match',
        ratingMin: 1,
        ratingMax: 5,
        isRatingMatch: false,
        pricePerPersonSnapshot: 750,
        version: 2,
        owner,
        participants: [{
          ...invitedPlayer,
          slotNumber: 2,
        }],
      };
      const invitation = {
        invitationId: parameters.invitationId,
        matchId: parameters.matchId,
        invitedByAccountId: parameters.otherAccountId,
        invitedAccountId: parameters.accountId,
        slotNumber: 2,
        status: 'pending',
        createdAt: startsAt - 600,
        updatedAt: startsAt - 600,
        version: 1,
        invitedPlayer,
        match: {
          startsAt,
          courtName: detail.courtName,
          ratingMin: detail.ratingMin,
          ratingMax: detail.ratingMax,
          isRatingMatch: detail.isRatingMatch,
          pricePerPersonSnapshot: detail.pricePerPersonSnapshot,
          owner,
        },
      };
      let accepted = false;
      window.__backendInvitationUiCalls = {
        accept: 0,
        loadMatch: 0,
      };
      const backendMatchActions = {
        async listMatches() {
          return { outcome: 'matches_loaded', matches: [] };
        },
        async listAccountMatches() {
          return { outcome: 'matches_loaded', matches: [] };
        },
        async listIncomingMatchInvitations() {
          return {
            outcome: 'invitations_loaded',
            invitations: accepted ? [] : [invitation],
          };
        },
        async listOutgoingMatchInvitations() {
          return { outcome: 'invitations_loaded', invitations: [] };
        },
        async acceptMatchInvitation(invitationId) {
          window.__backendInvitationUiCalls.accept += 1;
          accepted = true;
          return {
            outcome: 'invitation_accepted',
            invitation: {
              ...invitation,
              invitationId,
              status: 'accepted',
              version: 2,
            },
            participant: {
              matchId: parameters.matchId,
              playerId: parameters.accountId,
              slotNumber: 2,
              status: 'active',
              matchVersion: 2,
            },
          };
        },
        async loadMatch(matchId) {
          window.__backendInvitationUiCalls.loadMatch += 1;
          return {
            outcome: 'match_loaded',
            match: { ...detail, matchId },
          };
        },
      };
      const backendProfile = {
        accountId: parameters.accountId,
        role: 'player',
        firstName: invitedPlayer.firstName,
        lastName: invitedPlayer.lastName,
        username: invitedPlayer.username,
        photoUrl: null,
        languageCode: 'ru',
        phone: null,
        sidePreference: null,
        rating: invitedPlayer.rating,
        isVerified: invitedPlayer.isVerified,
      };
      const root = createRoot(container);
      root.render(React.createElement(App, {
        backendProfile,
        backendMatchRequired: true,
        backendMatchLifecycleStatus: 'authenticated',
        backendProfileStatus: 'ready',
        backendMatchActions,
        showToast() {},
        onLogout() {},
      }));
      window.__backendInvitationUiUnmount = () => {
        root.unmount();
        container.remove();
      };
    }, {
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      invitationId: INVITATION_ID,
    });

    const harness = page.getByTestId('backend-invitation-app-root');
    await expect(harness.locator('.bottom-nav button')).toHaveCount(5);
    await harness.locator('.bottom-nav button').last().click();
    const acceptButton = harness.getByTestId(
      `invitation-accept-${INVITATION_ID}`,
    );
    await expect(acceptButton).toBeVisible();
    await acceptButton.click();
    await expect(harness.getByTestId('match-joined-state')).toBeVisible();
    await expect(harness.getByText('Court 1', { exact: true })).toBeVisible();
    await expect(harness).toContainText('Invitation regression match');
    await expect.poll(() => page.evaluate(
      () => window.__backendInvitationUiCalls.accept,
    )).toBe(1);
    await expect.poll(() => page.evaluate(
      () => window.__backendInvitationUiCalls.loadMatch,
    )).toBeGreaterThanOrEqual(1);
    expect(pageErrors).toEqual([]);
    expect(dialogs).toEqual([]);
    await page.evaluate(() => window.__backendInvitationUiUnmount());
  });

  test('uses the private bearer boundary for paginated backend match chat', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const {
        createBackendSessionClient,
        isBackendMatchMessage,
      } = await import('/src/lib/backendSessionClient.js');
      const {
        mapBackendMatchMessageToApp,
      } = await import('/src/lib/backendMatchAdapter.js');
      const {
        shouldUseLegacyMatchMessages,
      } = await import('/src/App.jsx');
      const calls = [];
      const activeSender = {
        playerId: parameters.accountId,
        firstName: 'Current',
        lastName: 'Player',
        username: 'current_player',
        rating: 3,
        isVerified: true,
      };
      const newest = {
        messageId: parameters.messageId,
        matchId: parameters.matchId,
        sender: activeSender,
        body: 'Newest message',
        createdAt: 1_900_000_020,
      };
      const older = {
        messageId: parameters.olderMessageId,
        matchId: parameters.matchId,
        sender: { unavailable: true },
        body: 'Older message',
        createdAt: 1_900_000_010,
      };
      const sent = {
        messageId: '99999999-9999-4999-8999-999999999999',
        matchId: parameters.matchId,
        sender: activeSender,
        body: 'Sent message',
        createdAt: 1_900_000_030,
      };
      const client = createBackendSessionClient({
        cryptoImpl: {
          randomUUID: () => parameters.requestKey,
        },
        fetchImpl: async (url, options) => {
          calls.push({
            url,
            method: options.method,
            authorizationMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            contentType:
              options.headers['Content-Type'] ?? null,
            body:
              options.body === undefined
                ? null
                : JSON.parse(options.body),
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });
          if (options.method === 'POST') {
            return new Response(JSON.stringify({ message: sent }), {
              status: 201,
            });
          }
          if (url.includes('beforeCreatedAt=')) {
            return new Response(JSON.stringify({
              messages: [{
                ...older,
                messageId:
                  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                createdAt: 1_900_000_000,
              }],
            }), { status: 200 });
          }
          return new Response(JSON.stringify({
            messages: [newest, older],
            nextCursor: {
              createdAt: older.createdAt,
              messageId: older.messageId,
            },
          }), { status: 200 });
        },
      });

      const first = await client.listMatchMessages(
        parameters.credential,
        parameters.matchId,
        50,
      );
      const second = await client.listMatchMessages(
        parameters.credential,
        parameters.matchId,
        50,
        first.nextCursor,
      );
      const sendResult = await client.sendMatchMessage(
        parameters.credential,
        parameters.matchId,
        sent.body,
      );
      const callsBeforeInvalid = calls.length;
      const invalidSend = await client.sendMatchMessage(
        parameters.credential,
        parameters.matchId,
        ' padded ',
      );
      const malformed = isBackendMatchMessage({
        ...older,
        sender: {
          unavailable: true,
          playerId: parameters.accountId,
        },
      }, parameters.matchId);
      const mapped = first.messages
        .map(mapBackendMatchMessageToApp)
        .reverse();

      return {
        outcomes: [
          first.outcome,
          second.outcome,
          sendResult.outcome,
        ],
        contracts: calls.map((call) => ({
          ...call,
          body: undefined,
          exactSendBody:
            call.method !== 'POST' ||
            (
              Object.keys(call.body).sort().join(',') ===
                'body,requestKey' &&
              call.body.requestKey === parameters.requestKey &&
              call.body.body === sent.body
            ),
        })),
        firstCursor: first.nextCursor,
        mapped: mapped.map((message) => ({
          id: message.id,
          senderId: message.senderId,
          senderName: message.senderName,
          text: message.text,
          timestamp: message.timestamp,
        })),
        invalidRejectedLocally:
          invalidSend.outcome === 'rejected' &&
          invalidSend.reason === 'invalid_request' &&
          calls.length === callsBeforeInvalid,
        malformedUnavailableSenderRejected: !malformed,
        providerBoundary: {
          backendSkipsSupabase:
            !shouldUseLegacyMatchMessages(
              { backendOwned: true },
              true,
            ),
          legacyPrivatePreservedInBackendMode:
            shouldUseLegacyMatchMessages(
              { backendOwned: false, isPrivate: true },
              true,
            ),
          legacyPreserved:
            shouldUseLegacyMatchMessages(null, false),
        },
        sensitiveAbsent:
          !JSON.stringify({
            first,
            second,
            sendResult,
            mapped,
          }).includes(parameters.credential),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      accountId: ACCOUNT_ID,
      matchId: MATCH_ID,
      requestKey: REQUEST_KEY,
      messageId: MESSAGE_ID,
      olderMessageId: OLDER_MESSAGE_ID,
    });

    expect(summary.outcomes).toEqual([
      'messages_loaded',
      'messages_loaded',
      'message_sent',
    ]);
    expect(summary.contracts).toEqual([
      {
        url: `/api/v1/matches/${MATCH_ID}/messages?limit=50`,
        method: 'GET',
        authorizationMatches: true,
        contentType: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactSendBody: true,
      },
      {
        url:
          `/api/v1/matches/${MATCH_ID}/messages?limit=50` +
          `&beforeCreatedAt=1900000010&beforeMessageId=${OLDER_MESSAGE_ID}`,
        method: 'GET',
        authorizationMatches: true,
        contentType: null,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactSendBody: true,
      },
      {
        url: `/api/v1/matches/${MATCH_ID}/messages`,
        method: 'POST',
        authorizationMatches: true,
        contentType: 'application/json',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        exactSendBody: true,
      },
    ]);
    expect(summary.firstCursor).toEqual({
      createdAt: 1_900_000_010,
      messageId: OLDER_MESSAGE_ID,
    });
    expect(summary.mapped).toEqual([
      {
        id: OLDER_MESSAGE_ID,
        senderId: null,
        senderName: 'Игрок недоступен',
        text: 'Older message',
        timestamp: '2030-03-17T17:46:50.000Z',
      },
      {
        id: MESSAGE_ID,
        senderId: ACCOUNT_ID,
        senderName: 'Current Player',
        text: 'Newest message',
        timestamp: '2030-03-17T17:47:00.000Z',
      },
    ]);
    expect(summary.invalidRejectedLocally).toBe(true);
    expect(summary.malformedUnavailableSenderRejected).toBe(true);
    expect(summary.providerBoundary).toEqual({
      backendSkipsSupabase: true,
      legacyPrivatePreservedInBackendMode: true,
      legacyPreserved: true,
    });
    expect(summary.sensitiveAbsent).toBe(true);
  });

  test('renders the backend chat lifecycle and preserves a failed draft', async ({
    page,
  }) => {
    await page.goto('/');
    await isolateComponentHarness(page);

    await page.evaluate(async (parameters) => {
      const reactModule = await import('/@id/react');
      const React = reactModule.default ?? reactModule;
      const reactDomClientModule = await import('/@id/react-dom/client');
      const { createRoot } =
        reactDomClientModule.default ?? reactDomClientModule;
      const { default: MatchDetailsScreen } = await import(
        '/src/components/MatchDetailsScreen.jsx'
      );

      const container = document.createElement('div');
      container.dataset.testid = 'backend-chat-test-root';
      document.body.append(container);

      const currentUser = {
        id: parameters.accountId,
        role: 'user',
        firstName: 'Current',
        lastName: 'Player',
        rating: 3,
        numericRating: 3,
        ratingIdx: 2,
        isVerified: true,
      };
      const match = {
        id: parameters.matchId,
        backendOwned: true,
        ownerId: parameters.accountId,
        owner_id: parameters.accountId,
        title: 'Backend chat match',
        description: 'Initial backend comment',
        date: '1 января',
        dateISO: '2030-01-01',
        time: '10:00',
        duration: 1.5,
        courtName: 'Корт 1',
        courtType: 'panoramic',
        type: 'match',
        scenario: 'social',
        status: 'open',
        isPrivate: false,
        isRatingMatch: false,
        ratingMin: 0,
        ratingMax: 6,
        participants: [parameters.accountId],
        filledSlots: [{
          ...currentUser,
          isOrganizer: true,
          slotIndex: 0,
        }],
      };
      const initialMessage = {
        id: parameters.messageId,
        matchId: parameters.matchId,
        senderId: parameters.otherAccountId,
        senderName: 'Other Player',
        text: 'Newest message',
        timestamp: '2030-01-01T07:00:20.000Z',
      };
      const olderMessage = {
        id: parameters.olderMessageId,
        matchId: parameters.matchId,
        senderId: null,
        senderName: 'Игрок недоступен',
        text: 'Older message',
        timestamp: '2030-01-01T07:00:10.000Z',
      };
      const sentMessage = {
        id: '99999999-9999-4999-8999-999999999999',
        matchId: parameters.matchId,
        senderId: parameters.accountId,
        senderName: 'Current Player',
        text: 'Draft survives',
        timestamp: '2030-01-01T07:00:30.000Z',
      };

      function Harness() {
        const [messages, setMessages] = React.useState([
          initialMessage,
        ]);
        const [hasOlder, setHasOlder] = React.useState(true);
        const failedOnce = React.useRef(false);

        return React.createElement(MatchDetailsScreen, {
          match,
          currentUser,
          allMessages: messages,
          messagesLoading: false,
          messagesLoadError: '',
          hasOlderMessages: hasOlder,
          olderMessagesLoading: false,
          onLoadOlderMessages() {
            window.__backendChatUiCalls.loadOlder += 1;
            setMessages((previous) => [olderMessage, ...previous]);
            setHasOlder(false);
          },
          onRefreshMessages() {
            window.__backendChatUiCalls.refresh += 1;
          },
          onRetryMessages() {
            window.__backendChatUiCalls.load += 1;
          },
          async onSendMessage(_matchId, _sender, text) {
            window.__backendChatUiCalls.send += 1;
            if (!failedOnce.current) {
              failedOnce.current = true;
              throw new Error('synthetic_send_failure');
            }
            setMessages((previous) => [
              ...previous,
              { ...sentMessage, text },
            ]);
          },
          async onUpdateDescription(matchId, description) {
            window.__backendChatUiCalls.update += 1;
            window.__backendChatUiCalls.updatedMatchId = matchId;
            window.__backendChatUiCalls.updatedDescription = description;
            return { id: matchId, description, version: 2 };
          },
          onBack() {},
          onJoinSuccess() {},
          onDelete() {},
          onComplete() {},
          onConfirmScore() {},
          onDisputeScore() {},
          onUpdate() {},
          onSlotsChange() {},
          onJoinMatch() {},
          onLeaveMatch() {},
          onRefreshMatch() {},
          pendingInvitations: [],
          invitationActions: new Set(),
          showToast() {},
        });
      }

      window.__backendChatUiCalls = {
        load: 0,
        loadOlder: 0,
        refresh: 0,
        send: 0,
        update: 0,
        updatedMatchId: null,
        updatedDescription: null,
      };
      const root = createRoot(container);
      root.render(React.createElement(Harness));
      window.__backendChatUiUnmount = () => {
        root.unmount();
        container.remove();
      };
    }, {
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      messageId: MESSAGE_ID,
      olderMessageId: OLDER_MESSAGE_ID,
    });

    const harness = page.getByTestId('backend-chat-test-root');
    await expect(
      harness.getByText('Initial backend comment', { exact: true }),
    ).toBeVisible();
    await harness.getByTestId('match-description-edit-open').click();
    const commentEditor = harness.getByTestId('match-description-edit-input');
    await expect(commentEditor).toBeVisible();
    await expect(harness.locator('input[type="date"]')).toHaveCount(0);
    const emojiBoundary = '😀'.repeat(240);
    await commentEditor.fill(emojiBoundary);
    await expect(commentEditor).toHaveValue(emojiBoundary);
    await expect(harness.getByText('240/240', { exact: true })).toBeVisible();
    await commentEditor.pressSequentially('😀');
    await expect(commentEditor).toHaveValue(emojiBoundary);
    await commentEditor.fill('Updated backend comment');
    await harness.getByTestId('match-description-edit-save').click();
    await expect(
      harness.getByText('Updated backend comment', { exact: true }),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(
      () => window.__backendChatUiCalls.update,
    )).toBe(1);
    expect(await page.evaluate(() => ({
      matchId: window.__backendChatUiCalls.updatedMatchId,
      description: window.__backendChatUiCalls.updatedDescription,
    }))).toEqual({
      matchId: MATCH_ID,
      description: 'Updated backend comment',
    });

    await harness.getByTestId('match-chat-open-button').click();
    await expect.poll(() => page.evaluate(
      () => window.__backendChatUiCalls.load,
    )).toBe(1);
    await expect(
      harness.getByTestId(`chat-message-${MESSAGE_ID}`),
    ).toContainText('Newest message');

    await harness.getByTestId('chat-load-older-button').click();
    await expect(
      harness.getByTestId(`chat-message-${OLDER_MESSAGE_ID}`),
    ).toContainText('Older message');
    await expect.poll(() => page.evaluate(
      () => window.__backendChatUiCalls.loadOlder,
    )).toBe(1);

    const draft = harness.getByPlaceholder('Написать сообщение...');
    await draft.fill('Draft survives');
    await harness.locator('footer button').click();
    await expect(draft).toHaveValue('Draft survives');
    await harness.locator('footer button').click();
    await expect(draft).toHaveValue('');
    await expect(
      harness.getByTestId(
        'chat-message-99999999-9999-4999-8999-999999999999',
      ),
    ).toContainText('Draft survives');
    await expect.poll(() => page.evaluate(
      () => window.__backendChatUiCalls.send,
    )).toBe(2);

    await page.evaluate(() => window.__backendChatUiUnmount());
  });

  test('renders backend waitlist join, leave and FIFO promotion without Supabase RPC calls', async ({
    page,
  }) => {
    let legacyWaitlistCalls = 0;
    await page.route(/\/rest\/v1\/rpc\/.*waitlist/iu, async (route) => {
      legacyWaitlistCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'legacy waitlist must not run' }),
      });
    });
    await page.goto('/');
    await isolateComponentHarness(page);

    await page.evaluate(async (parameters) => {
      const reactModule = await import('/@id/react');
      const React = reactModule.default ?? reactModule;
      const reactDomClientModule = await import('/@id/react-dom/client');
      const { createRoot } =
        reactDomClientModule.default ?? reactDomClientModule;
      const { default: MatchDetailsScreen } = await import(
        '/src/components/MatchDetailsScreen.jsx'
      );

      const container = document.createElement('div');
      container.dataset.testid = 'backend-waitlist-test-root';
      document.body.append(container);
      const currentUser = {
        id: parameters.accountId,
        role: 'user',
        firstName: 'Waiting',
        lastName: 'Player',
        rating: 3,
        numericRating: 3,
        ratingIdx: 2,
        isVerified: true,
      };
      const playerIds = [
        parameters.ownerAccountId,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ];
      const initialMatch = {
        id: parameters.matchId,
        backendOwned: true,
        ownerId: parameters.ownerAccountId,
        owner_id: parameters.ownerAccountId,
        title: 'Backend waitlist match',
        description: '',
        date: '1 января',
        dateISO: '2030-01-01',
        time: '10:00',
        duration: 1.5,
        courtName: 'Корт 1',
        courtType: 'panoramic',
        type: 'match',
        scenario: 'social',
        status: 'upcoming',
        isPrivate: false,
        isRatingMatch: false,
        ratingMin: 0,
        ratingMax: 6,
        participants: playerIds,
        filledSlots: playerIds.map((id, slotIndex) => ({
          id,
          firstName: `Player ${slotIndex + 1}`,
          lastName: '',
          numericRating: 3,
          ratingIdx: 2,
          isVerified: true,
          isOrganizer: slotIndex === 0,
          slotIndex,
        })),
      };
      const currentEntry = {
        entryId: parameters.waitlistEntryId,
        player: {
          playerId: parameters.accountId,
          firstName: 'Waiting',
          lastName: 'Player',
          username: 'waiting_player',
          rating: 3,
          isVerified: true,
        },
        queuePosition: 1,
        joinedAt: 1_900_000_000,
        isCurrentPlayer: true,
      };

      function Harness() {
        const [match, setMatch] = React.useState(initialMatch);
        const entriesRef = React.useRef([]);
        const listResult = () => ({
          outcome: 'waitlist_loaded',
          entries: entriesRef.current,
          ...(entriesRef.current.length === 0
            ? {}
            : { current: currentEntry }),
          count: entriesRef.current.length,
        });

        return React.createElement(MatchDetailsScreen, {
          match,
          currentUser,
          onLoadWaitlist() {
            window.__backendWaitlistUiCalls.load += 1;
            return Promise.resolve(listResult());
          },
          async onJoinWaitlist() {
            window.__backendWaitlistUiCalls.join += 1;
            entriesRef.current = [currentEntry];
            return {
              outcome: 'waitlist_joined',
              entry: {
                entryId: parameters.waitlistEntryId,
                matchId: parameters.matchId,
                status: 'waiting',
                appliedAt: 1_900_000_000,
                version: 1,
              },
            };
          },
          async onLeaveWaitlist() {
            window.__backendWaitlistUiCalls.leave += 1;
            entriesRef.current = [];
            return {
              outcome: 'waitlist_left',
              entry: {
                entryId: parameters.waitlistEntryId,
                matchId: parameters.matchId,
                status: 'left',
                appliedAt: 1_900_000_010,
                version: 2,
              },
            };
          },
          onBack() {},
          onJoinSuccess() {},
          onDelete() {},
          onComplete() {},
          onConfirmScore() {},
          onDisputeScore() {},
          onSlotsChange() {},
          onJoinMatch() {},
          onLeaveMatch() {},
          onRefreshMatch() {
            window.__backendWaitlistUiCalls.refresh += 1;
            if (
              window.__backendWaitlistPromoteOnRefresh !== true ||
              entriesRef.current.length === 0
            ) {
              return Promise.resolve(match);
            }
            window.__backendWaitlistPromoteOnRefresh = false;
            entriesRef.current = [];
            const promotedMatch = {
              ...match,
              participants: [
                ...match.participants.slice(0, 3),
                parameters.accountId,
              ],
              filledSlots: [
                ...match.filledSlots.slice(0, 3),
                {
                  id: parameters.accountId,
                  firstName: 'Waiting',
                  lastName: 'Player',
                  numericRating: 3,
                  ratingIdx: 2,
                  isVerified: true,
                  isOrganizer: false,
                  slotIndex: 3,
                },
              ],
            };
            setMatch(promotedMatch);
            return Promise.resolve(promotedMatch);
          },
          pendingInvitations: [],
          invitationActions: new Set(),
          allMessages: [],
          messagesLoading: false,
          messagesLoadError: '',
          showToast() {},
        });
      }

      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      const waitlistPollers = new Map();
      let nextPollerId = -1;
      globalThis.setInterval = (callback, delay, ...args) => {
        if (delay !== 5_000) {
          return originalSetInterval(callback, delay, ...args);
        }
        const id = nextPollerId;
        nextPollerId -= 1;
        waitlistPollers.set(id, () => callback(...args));
        return id;
      };
      globalThis.clearInterval = (id) => {
        if (!waitlistPollers.delete(id)) originalClearInterval(id);
      };
      window.__backendWaitlistUiCalls = {
        load: 0,
        join: 0,
        leave: 0,
        refresh: 0,
      };
      window.__backendWaitlistPromoteOnRefresh = false;
      window.__runBackendWaitlistPoll = () => {
        [...waitlistPollers.values()].forEach((poll) => poll());
      };
      window.__backendWaitlistPollerCount = () => waitlistPollers.size;
      const root = createRoot(container);
      root.render(React.createElement(Harness));
      window.__backendWaitlistUiUnmount = () => {
        root.unmount();
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        waitlistPollers.clear();
        container.remove();
      };
    }, {
      accountId: ACCOUNT_ID,
      ownerAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      waitlistEntryId: WAITLIST_ENTRY_ID,
    });

    const harness = page.getByTestId('backend-waitlist-test-root');
    const joinButton = harness.getByTestId('match-waitlist-join-button');
    await expect(joinButton).toBeVisible();
    await joinButton.click();
    await expect(harness.getByTestId('match-waitlist-position')).toContainText('1');
    await expect(
      harness.getByTestId(`match-waitlist-player-${ACCOUNT_ID}`),
    ).toContainText('Waiting Player');
    await harness.getByTestId('match-waitlist-leave-button').click();
    await expect(joinButton).toBeVisible();
    await expect(harness.getByTestId('match-waitlist-position')).toHaveCount(0);
    await joinButton.click();
    await expect(harness.getByTestId('match-waitlist-position')).toContainText('1');
    await expect.poll(() => page.evaluate(
      () => window.__backendWaitlistPollerCount(),
    )).toBe(1);
    await page.evaluate(() => {
      window.__backendWaitlistPromoteOnRefresh = true;
      window.__runBackendWaitlistPoll();
    });
    await expect(harness.getByTestId('match-joined-state')).toBeVisible();
    await expect(harness.getByTestId('match-waitlist-position')).toHaveCount(0);
    await expect.poll(() => page.evaluate(
      () => window.__backendWaitlistPollerCount(),
    )).toBe(0);
    const refreshCallsAfterPromotion = await page.evaluate(
      () => window.__backendWaitlistUiCalls.refresh,
    );
    await page.evaluate(() => window.__runBackendWaitlistPoll());
    const waitlistUiCalls = await page.evaluate(
      () => window.__backendWaitlistUiCalls,
    );
    expect(waitlistUiCalls.load).toBeGreaterThanOrEqual(5);
    expect(waitlistUiCalls.join).toBe(2);
    expect(waitlistUiCalls.leave).toBe(1);
    expect(waitlistUiCalls.refresh).toBe(1);
    expect(waitlistUiCalls.refresh).toBe(refreshCallsAfterPromotion);
    expect(legacyWaitlistCalls).toBe(0);
    await page.evaluate(() => window.__backendWaitlistUiUnmount());
  });

  test('renders fixed backend pairs and blocks direct changes after a pair is formed', async ({
    page,
  }) => {
    let legacyRpcCalls = 0;
    await page.route(/\/rest\/v1\/rpc\//iu, async (route) => {
      legacyRpcCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'legacy RPC must not run' }),
      });
    });
    await page.goto('/');
    await isolateComponentHarness(page);

    await page.evaluate(async (parameters) => {
      const reactModule = await import('/@id/react');
      const React = reactModule.default ?? reactModule;
      const reactDomClientModule = await import('/@id/react-dom/client');
      const { createRoot } =
        reactDomClientModule.default ?? reactDomClientModule;
      const {
        default: MatchDetailsScreen,
        supportsBackendMatchLineup,
      } = await import('/src/components/MatchDetailsScreen.jsx');

      const container = document.createElement('div');
      container.dataset.testid = 'backend-lineup-test-root';
      document.body.append(container);
      const currentUser = {
        id: parameters.accountId,
        role: 'user',
        firstName: 'Current',
        lastName: 'Player',
        rating: 3,
        numericRating: 3,
        ratingIdx: 2,
        isVerified: true,
      };
      const match = {
        id: parameters.matchId,
        backendOwned: true,
        ownerId: parameters.ownerAccountId,
        owner_id: parameters.ownerAccountId,
        title: 'Backend lineup match',
        description: '',
        date: '1 января',
        dateISO: '2030-01-01',
        time: '10:00',
        duration: 1.5,
        courtName: 'Корт 1',
        courtType: 'panoramic',
        type: 'match',
        scenario: 'social',
        status: 'upcoming',
        isPrivate: false,
        isRatingMatch: false,
        ratingMin: 0,
        ratingMax: 6,
        participants: [parameters.ownerAccountId, parameters.accountId],
        filledSlots: [
          {
            id: parameters.ownerAccountId,
            firstName: 'Owner',
            lastName: 'Player',
            numericRating: 3,
            ratingIdx: 2,
            isVerified: true,
            isOrganizer: true,
            slotIndex: 0,
          },
          {
            id: parameters.accountId,
            firstName: 'Current',
            lastName: 'Player',
            numericRating: 3,
            ratingIdx: 2,
            isVerified: true,
            isOrganizer: false,
            slotIndex: 1,
          },
        ],
      };
      const ownerPlayer = {
        playerId: parameters.ownerAccountId,
        firstName: 'Owner',
        lastName: 'Player',
        rating: 3,
        isVerified: true,
      };
      const currentPlayer = {
        playerId: parameters.accountId,
        firstName: 'Current',
        lastName: 'Player',
        rating: 3,
        isVerified: true,
      };
      let currentCell = null;
      let lineupStatus = 'draft';
      const lineupResult = () => ({
        outcome: 'lineup_loaded',
        lineup: {
          matchId: parameters.matchId,
          status: lineupStatus,
          version: window.__backendLineupUiCalls.assign +
            window.__backendLineupUiCalls.release + 1,
          slots: [
            {
              teamNumber: 1,
              courtSide: 'left',
              assignment: {
                assignmentId: parameters.ownerAssignmentId,
                player: ownerPlayer,
                assignedAt: 1_900_000_000,
                isCurrentPlayer: false,
              },
            },
            ...[
              [1, 'right'],
              [2, 'left'],
              [2, 'right'],
            ].map(([teamNumber, courtSide]) => ({
              teamNumber,
              courtSide,
              ...(currentCell === `${teamNumber}:${courtSide}`
                ? {
                    assignment: {
                      assignmentId: parameters.currentAssignmentId,
                      player: currentPlayer,
                      assignedAt: 1_900_000_010,
                      isCurrentPlayer: true,
                    },
                  }
                : {}),
            })),
          ],
          unassignedPlayers: currentCell === null ? [currentPlayer] : [],
        },
      });

      window.__backendLineupUiCalls = {
        load: 0,
        assign: 0,
        release: 0,
        assignments: [],
      };
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      const lineupPollers = new Map();
      let nextPollerId = -10_000;
      globalThis.setInterval = (callback, delay, ...args) => {
        if (delay !== 5_000) {
          return originalSetInterval(callback, delay, ...args);
        }
        const id = nextPollerId;
        nextPollerId -= 1;
        lineupPollers.set(id, () => callback(...args));
        return id;
      };
      globalThis.clearInterval = (id) => {
        if (!lineupPollers.delete(id)) originalClearInterval(id);
      };
      window.__backendLineupPollerCount = () => lineupPollers.size;
      window.__runBackendLineupPoll = () => {
        [...lineupPollers.values()].forEach((poll) => poll());
      };
      window.__lockBackendLineup = () => {
        lineupStatus = 'locked';
        window.__runBackendLineupPoll();
      };
      window.__legacyLineupBoundary =
        supportsBackendMatchLineup(
          { backendOwned: false },
          () => {},
          () => {},
          () => {},
        ) === false;

      const root = createRoot(container);
      root.render(React.createElement(MatchDetailsScreen, {
        match,
        currentUser,
        onLoadLineup() {
          window.__backendLineupUiCalls.load += 1;
          return Promise.resolve(lineupResult());
        },
        onAssignLineupSlot(matchId, teamNumber, courtSide) {
          window.__backendLineupUiCalls.assign += 1;
          window.__backendLineupUiCalls.assignments.push({
            matchId,
            teamNumber,
            courtSide,
          });
          currentCell = `${teamNumber}:${courtSide}`;
          return Promise.resolve({
            outcome: 'lineup_assigned',
            assignment: {
              assignmentId: parameters.currentAssignmentId,
              matchId: parameters.matchId,
              accountId: parameters.accountId,
              teamNumber,
              courtSide,
              appliedAt: 1_900_000_010,
              lineupVersion: window.__backendLineupUiCalls.assign + 1,
            },
          });
        },
        onReleaseLineupSlot() {
          window.__backendLineupUiCalls.release += 1;
          const [teamNumber, courtSide] = currentCell.split(':');
          currentCell = null;
          return Promise.resolve({
            outcome: 'lineup_released',
            assignment: {
              assignmentId: parameters.currentAssignmentId,
              matchId: parameters.matchId,
              accountId: parameters.accountId,
              teamNumber: Number(teamNumber),
              courtSide,
              appliedAt: 1_900_000_020,
              lineupVersion: window.__backendLineupUiCalls.release + 2,
            },
          });
        },
        onBack() {},
        onJoinSuccess() {},
        onDelete() {},
        onComplete() {},
        onConfirmScore() {},
        onDisputeScore() {},
        onSlotsChange() {},
        onJoinMatch() {},
        onLeaveMatch() {},
        onRefreshMatch() { return Promise.resolve(match); },
        pendingInvitations: [],
        invitationActions: new Set(),
        allMessages: [],
        messagesLoading: false,
        messagesLoadError: '',
        showToast() {},
      }));
      window.__backendLineupUiUnmount = () => {
        root.unmount();
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        lineupPollers.clear();
        container.remove();
      };
    }, {
      accountId: ACCOUNT_ID,
      ownerAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      ownerAssignmentId: PARTICIPANT_ID,
      currentAssignmentId: WAITLIST_ENTRY_ID,
    });

    const harness = page.getByTestId('backend-lineup-test-root');
    await expect(harness.getByTestId('match-lineup')).toBeVisible();
    await expect(harness.getByTestId('match-lineup-team-1')).toContainText('Owner Player');
    await expect(harness.getByTestId('match-lineup-team-2')).toContainText('Выбрать');
    await expect(harness.getByTestId('match-lineup-slot-1-left')).toBeDisabled();

    await harness.getByTestId('match-lineup-slot-2-right').click();
    await expect(harness.getByTestId('match-lineup-slot-2-right')).toContainText('Current Player');
    await expect(harness.getByTestId('match-lineup-release')).toBeVisible();

    await harness.getByTestId('match-lineup-release').click();
    await expect(harness.getByTestId('match-lineup-release')).toHaveCount(0);
    await expect(harness.getByTestId('match-lineup-slot-2-right')).toContainText('Выбрать');

    await harness.getByTestId('match-lineup-slot-2-right').click();
    await expect(harness.getByTestId('match-lineup-slot-2-right')).toContainText('Current Player');

    await harness.getByTestId('match-lineup-slot-1-right').click();
    await expect(harness.getByTestId('match-lineup-slot-1-right')).toContainText('Current Player');
    await expect(harness.getByTestId('match-lineup-slot-2-right')).toContainText('Свободно');
    await expect(harness.getByTestId('match-lineup-release')).toHaveCount(0);
    await expect(harness.getByTestId('match-lineup-slot-2-right')).toBeDisabled();

    await expect.poll(() => page.evaluate(
      () => window.__backendLineupPollerCount(),
    )).toBe(1);
    await page.evaluate(() => window.__lockBackendLineup());
    await expect.poll(() => page.evaluate(
      () => window.__backendLineupPollerCount(),
    )).toBe(0);
    const loadsAfterLock = await page.evaluate(
      () => window.__backendLineupUiCalls.load,
    );
    await page.evaluate(() => window.__runBackendLineupPoll());
    expect(await page.evaluate(
      () => window.__backendLineupUiCalls.load,
    )).toBe(loadsAfterLock);

    const summary = await page.evaluate(() => ({
      calls: window.__backendLineupUiCalls,
      legacyBoundary: window.__legacyLineupBoundary,
    }));
    expect(summary.calls.load).toBeGreaterThanOrEqual(4);
    expect(summary.calls.assign).toBe(3);
    expect(summary.calls.release).toBe(1);
    expect(summary.calls.assignments).toEqual([
      { matchId: MATCH_ID, teamNumber: 2, courtSide: 'right' },
      { matchId: MATCH_ID, teamNumber: 2, courtSide: 'right' },
      { matchId: MATCH_ID, teamNumber: 1, courtSide: 'right' },
    ]);
    expect(summary.legacyBoundary).toBe(true);
    expect(legacyRpcCalls).toBe(0);
    await page.evaluate(() => window.__backendLineupUiUnmount());
  });

  test('renders account-scoped Home matches without reading legacy Supabase matches', async ({
    page,
  }) => {
    await page.goto('/');
    await isolateComponentHarness(page);

    await page.evaluate(async (parameters) => {
      const reactModule = await import('/@id/react');
      const React = reactModule.default ?? reactModule;
      const reactDomClientModule = await import('/@id/react-dom/client');
      const { createRoot } =
        reactDomClientModule.default ?? reactDomClientModule;
      const { supabase } = await import('/src/lib/supabaseClient.js');
      const { default: App } = await import('/src/App.jsx');
      const { createBackendMatchActions } = await import(
        '/src/components/AuthGate.jsx'
      );

      const originalSupabase = {
        rpc: supabase.rpc,
        from: supabase.from,
        channel: supabase.channel,
        removeChannel: supabase.removeChannel,
      };
      const nativeSetTimeout = window.setTimeout.bind(window);
      const nativeClearTimeout = window.clearTimeout.bind(window);
      const trackedTimers = new Set();
      window.setTimeout = (handler, delay, ...args) => {
        let timeoutId;
        timeoutId = nativeSetTimeout(() => {
          trackedTimers.delete(timeoutId);
          handler(...args);
        }, delay);
        if (Number(delay) >= 25) trackedTimers.add(timeoutId);
        return timeoutId;
      };
      window.clearTimeout = (timeoutId) => {
        trackedTimers.delete(timeoutId);
        nativeClearTimeout(timeoutId);
      };

      const legacyUserId =
        '99999999-9999-4999-8999-999999999999';
      const legacyBooking = {
        id: 'legacy-private-booking',
        owner_id: legacyUserId,
        participants: [legacyUserId],
        filled_slots: [],
        type: 'private',
        isPrivate: true,
        status: 'upcoming',
        title: 'Legacy private booking',
        description: 'Legacy private booking comment',
        date_iso: '2035-01-02',
        time: '10:00',
        duration: 1.5,
        court_id: 'legacy-court',
        court_name: 'Legacy court',
        court_type: 'indoor',
        price_per_person: 0,
      };
      const query = {
        select() {
          return this;
        },
        order() {
          return Promise.resolve({
            data: [legacyBooking],
            error: null,
          });
        },
      };
      window.__legacyMatchReads = 0;
      supabase.from = () => {
        window.__legacyMatchReads += 1;
        return query;
      };
      window.__legacyProfileCalls = 0;
      supabase.rpc = async (name) => {
        if (name === 'get_my_profile') {
          window.__legacyProfileCalls += 1;
          throw new Error('SUPABASE_PROFILE_MUST_NOT_LOAD_IN_BACKEND_MODE');
        }
        if (name === 'get_unread_notification_count') {
          return { data: 0, error: null };
        }
        return { data: [], error: null };
      };
      supabase.channel = () => {
        const channel = {
          on() {
            return channel;
          },
          subscribe() {
            return channel;
          },
        };
        return channel;
      };
      supabase.removeChannel = () => {};

      const owner = {
        playerId: parameters.accountId,
        firstName: 'Backend',
        lastName: 'Owner',
        username: 'backend_owner',
        rating: 3,
        isVerified: true,
      };
      const otherOwner = {
        playerId: parameters.otherAccountId,
        firstName: 'Other',
        lastName: 'Owner',
        username: 'other_owner',
        rating: 3,
        isVerified: true,
      };
      const now = Math.floor(Date.now() / 1_000);
      const feedRecord = ({
        matchId,
        ownerRecord,
        title,
        startsAt,
        participants = [],
      }) => ({
        matchId,
        ownerAccountId: ownerRecord.playerId,
        startsAt,
        durationMinutes: 90,
        courtId: 'court-1',
        courtName: 'Backend court',
        courtType: 'indoor',
        scenario: 'social',
        status: 'open',
        title,
        description: `${title} comment`,
        ratingMin: 1,
        ratingMax: 5,
        isRatingMatch: false,
        pricePerPersonSnapshot: 750,
        occupiedSlots: 1 + participants.length,
        version: 1,
        owner: ownerRecord,
        participants,
      });
      const expiringAccountMatch = feedRecord({
        matchId: parameters.matchId,
        ownerRecord: owner,
        title: 'Expiring account match',
        startsAt: now + 3,
      });
      const participantAccountMatch = feedRecord({
        matchId:
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ownerRecord: otherOwner,
        title: 'Participant account match',
        startsAt: now + 3_600,
        participants: [{
          ...owner,
          playerId: parameters.accountId,
          slotNumber: 2,
        }],
      });
      const foregroundAccountMatch = feedRecord({
        matchId:
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ownerRecord: owner,
        title: 'Foreground account match',
        startsAt: now + 7_200,
      });
      const publicOnlyMatch = feedRecord({
        matchId:
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ownerRecord: otherOwner,
        title: 'Public-only unrelated match',
        startsAt: now + 7_200,
      });

      window.__accountMatchGeneration = 0;
      window.__accountMatchCalls = 0;
      const backendMatchActions = createBackendMatchActions({
        sessionReady: true,
        async listMatches() {
          return {
            outcome: 'matches_loaded',
            matches: [publicOnlyMatch],
          };
        },
        async listAccountMatches() {
          window.__accountMatchCalls += 1;
          return {
            outcome: 'matches_loaded',
            matches: [
              expiringAccountMatch,
              participantAccountMatch,
              ...(window.__accountMatchGeneration > 0
                ? [foregroundAccountMatch]
                : []),
            ],
          };
        },
        async listIncomingMatchInvitations() {
          return {
            outcome: 'invitations_loaded',
            invitations: [],
          };
        },
      });
      const container = document.createElement('div');
      container.dataset.testid = 'backend-home-test-root';
      document.body.append(container);
      const root = createRoot(container);
      root.render(React.createElement(App, {
        backendProfile: {
          accountId: parameters.accountId,
          firstName: 'Backend',
          lastName: 'Owner',
          username: 'backend_owner',
          photoUrl: null,
          sidePreference: 'Both',
          phone: null,
          rating: 3,
          isVerified: true,
          role: 'player',
        },
        backendMatchRequired: true,
        backendMatchLifecycleStatus: 'authenticated',
        backendProfileStatus: 'ready',
        backendMatchActions,
        showToast() {},
        onLogout() {},
      }));

      window.__refreshAccountMatches = () => {
        window.__accountMatchGeneration = 1;
        window.dispatchEvent(new Event('focus'));
      };
      window.__backendHomeTimerCount = () => trackedTimers.size;
      window.__backendHomeUnmount = () => {
        root.unmount();
        container.remove();
        supabase.rpc = originalSupabase.rpc;
        supabase.from = originalSupabase.from;
        supabase.channel = originalSupabase.channel;
        supabase.removeChannel = originalSupabase.removeChannel;
        window.setTimeout = nativeSetTimeout;
        window.clearTimeout = nativeClearTimeout;
      };
    }, {
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
    });

    const harness = page.getByTestId('backend-home-test-root');
    await expect(
      harness.getByText('Expiring account match comment').first(),
    ).toBeVisible();
    await expect(
      harness.getByText('Participant account match comment').first(),
    ).toBeVisible();
    await expect(
      harness.getByText('Legacy private booking comment'),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.__legacyProfileCalls)).toBe(0);
    expect(await page.evaluate(() => window.__legacyMatchReads)).toBe(0);
    await expect(
      harness.getByText('Public-only unrelated match comment'),
    ).toHaveCount(0);

    await page.evaluate(() => window.__refreshAccountMatches());
    await expect(
      harness.getByText('Foreground account match comment').first(),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(
      () => window.__accountMatchCalls,
    )).toBeGreaterThanOrEqual(2);

    await expect(
      harness.getByText('Expiring account match comment'),
    ).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(() => page.evaluate(
      () => window.__backendHomeTimerCount(),
    )).toBeGreaterThan(0);

    const callsBeforeUnmount = await page.evaluate(
      () => window.__accountMatchCalls,
    );
    await page.evaluate(() => window.__backendHomeUnmount());
    await expect.poll(() => page.evaluate(
      () => window.__backendHomeTimerCount(),
    )).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(50);
    expect(await page.evaluate(
      () => window.__accountMatchCalls,
    )).toBe(callsBeforeUnmount);
  });

  test('requires the backend own profile before rendering a Telegram session', async ({
    page,
  }) => {
    await page.goto('/');

    const states = await page.evaluate(async () => {
      const { resolveOwnProfileGate } = await import(
        '/src/components/AuthGate.jsx'
      );
      const { mergeProfileSources } = await import('/src/App.jsx');
      const backendWithoutRating = mergeProfileSources(
        {
          first_name: 'Legacy',
          rating: 1.5,
          is_verified: true,
        },
        {
          firstName: 'Backend',
          lastName: 'Player',
          username: 'backend_player',
        },
      );
      return {
        legacy: resolveOwnProfileGate({
          backendRequired: false,
          sessionReady: false,
          profileStatus: 'inactive',
          hasProfile: false,
        }),
        loginPending: resolveOwnProfileGate({
          backendRequired: true,
          sessionReady: false,
          profileStatus: 'inactive',
          hasProfile: false,
        }),
        profilePending: resolveOwnProfileGate({
          backendRequired: true,
          sessionReady: true,
          profileStatus: 'loading',
          hasProfile: false,
        }),
        profileRejected: resolveOwnProfileGate({
          backendRequired: true,
          sessionReady: true,
          profileStatus: 'error',
          hasProfile: false,
        }),
        profileMissing: resolveOwnProfileGate({
          backendRequired: true,
          sessionReady: true,
          profileStatus: 'ready',
          hasProfile: false,
        }),
        ready: resolveOwnProfileGate({
          backendRequired: true,
          sessionReady: true,
          profileStatus: 'ready',
          hasProfile: true,
        }),
        backendIdentity: {
          firstName: backendWithoutRating.first_name,
          rating: backendWithoutRating.rating,
          isVerified: backendWithoutRating.is_verified,
        },
      };
    });

    expect(states).toEqual({
      legacy: 'legacy',
      loginPending: 'loading',
      profilePending: 'loading',
      profileRejected: 'error',
      profileMissing: 'error',
      ready: 'ready',
      backendIdentity: {
        firstName: 'Backend',
        rating: 3,
        isVerified: false,
      },
    });
  });

  test('maps backend match data into the existing UI without sensitive fields', async ({
    page,
  }) => {
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const {
        BACKEND_PRIVATE_MATCH_CREATION_ENABLED,
        applyBackendParticipantResult,
        createBackendMatchDraft,
        isBackendOwnedMatch,
        mapBackendMatchToApp,
        mergeAccountUpcomingMatches,
        preferConfirmedBackendMatchMutation,
        resolveBackendMatchMode,
        resolveMatchSource,
        selectBackendAccountMatches,
        selectFutureBackendMatches,
        shouldApplyBackendMatchDetail,
        shouldApplyBackendMatchFeedResponse,
      } = await import('/src/lib/backendMatchAdapter.js');
      const {
        isPrivateMatchCreationEnabled,
      } = await import('/src/components/MatchCreationScreen.jsx');
      const {
         refreshLegacyMatchWaitlist,
         supportsMatchChat,
         tryBeginMatchAction,
        supportsLegacyMatchExtensions,
      } = await import('/src/components/MatchDetailsScreen.jsx');
      const draft = createBackendMatchDraft({
        dateISO: '2030-01-02',
        time: '10:30',
        duration: 1.5,
        courtId: 'court-1',
        scenario: 'social',
        title: '  Match title  ',
        description: 'Synthetic description',
        ratingMin: 1,
        ratingMax: 5,
        isRatingMatch: true,
      });
      const detailRecord = {
        matchId: parameters.matchId,
        ownerAccountId: parameters.accountId,
        createdAt: 1_893_499_200,
        updatedAt: 1_893_499_200,
        startsAt: draft.startsAt,
        durationMinutes: 90,
        courtId: 'court-1',
        courtName: 'Корт 1',
        courtType: 'panoramic',
        kind: 'match',
        visibility: 'public',
        scenario: 'social',
        status: 'confirmed',
        title: 'Match title',
        description: 'Synthetic description',
        ratingMin: 1,
        ratingMax: 5,
        isRatingMatch: true,
        pricePerPersonSnapshot: 750,
        version: 2,
        owner: {
          playerId: parameters.accountId,
          firstName: 'Synthetic',
          lastName: 'Owner',
          username: 'synthetic_owner',
          rating: 3,
          isVerified: true,
        },
        participants: [{
          playerId: parameters.otherAccountId,
          slotNumber: 3,
          firstName: 'Visible',
          lastName: 'Player',
          username: 'visible_player',
          rating: 4.25,
          isVerified: true,
        }],
      };
      const match = mapBackendMatchToApp(detailRecord, {
        accountId: parameters.accountId,
        firstName: 'Synthetic',
        lastName: 'Owner',
        username: 'synthetic_owner',
        photoUrl: null,
        sidePreference: 'Both',
        rating: 3,
        isVerified: true,
      });
      const matchForOtherViewer = mapBackendMatchToApp(
        detailRecord,
        {
          accountId: parameters.otherAccountId,
          firstName: 'Private local alias',
          lastName: '',
          username: '',
          photoUrl: null,
          sidePreference: 'Left',
          rating: 1,
          isVerified: false,
        },
      );
      const {
        owner: _legacyOwner,
        participants: _legacyParticipants,
        ...legacyFeedRecord
      } = detailRecord;
      const legacyFeedMatch = mapBackendMatchToApp(
        {
          ...legacyFeedRecord,
          occupiedSlots: 2,
        },
        {
          accountId: parameters.accountId,
          firstName: 'Synthetic',
          lastName: 'Owner',
          username: 'synthetic_owner',
          photoUrl: null,
          sidePreference: 'Both',
          rating: 3,
          isVerified: true,
        },
      );
      const exactStartMatch = Object.freeze({
        ...match,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        startsAt: draft.startsAt - 1,
      });
      const unrelatedMatch = Object.freeze({
        ...match,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ownerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        owner_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        participants: Object.freeze([
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ]),
      });
      const participantMatch = Object.freeze({
        ...match,
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        ownerId: parameters.otherAccountId,
        owner_id: parameters.otherAccountId,
        participants: Object.freeze([
          parameters.otherAccountId,
          parameters.accountId,
        ]),
      });
      const terminalMatch = Object.freeze({
        ...match,
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: 'completed',
      });
      const futureMatches = selectFutureBackendMatches(
        [
          match,
          exactStartMatch,
          unrelatedMatch,
          participantMatch,
          terminalMatch,
        ],
        draft.startsAt - 1,
      );
      const accountMatches = selectBackendAccountMatches(
        [
          match,
          exactStartMatch,
          unrelatedMatch,
          participantMatch,
          terminalMatch,
        ],
        parameters.accountId,
        draft.startsAt - 1,
      );
      const mergedUpcomingMatches = mergeAccountUpcomingMatches(
        [{ id: 'legacy-private-booking', type: 'private' }],
        [match, exactStartMatch, unrelatedMatch, participantMatch],
        parameters.accountId,
        draft.startsAt - 1,
      );
      const joinableMatch = mapBackendMatchToApp({
        matchId: parameters.matchId,
        ownerAccountId: parameters.accountId,
        createdAt: 1_893_499_200,
        updatedAt: 1_893_499_200,
        startsAt: draft.startsAt,
        durationMinutes: 90,
        courtId: 'court-1',
        courtName: 'РљРѕСЂС‚ 1',
        courtType: 'panoramic',
        kind: 'match',
        visibility: 'public',
        scenario: 'social',
        status: 'open',
        title: 'Match title',
        description: 'Synthetic description',
        ratingMin: 1,
        ratingMax: 5,
        isRatingMatch: true,
        pricePerPersonSnapshot: 750,
        version: 2,
        owner: {
          playerId: parameters.accountId,
          firstName: 'Synthetic',
          lastName: 'Owner',
          username: 'synthetic_owner',
          rating: 3,
          isVerified: true,
        },
        participants: [],
      }, {
        accountId: parameters.accountId,
        firstName: 'Synthetic',
        lastName: 'Owner',
        username: 'synthetic_owner',
        photoUrl: null,
        sidePreference: 'Both',
        rating: 3,
        isVerified: true,
      });
      const joiningPlayer = Object.freeze({
        id: parameters.otherAccountId,
        firstName: 'Synthetic',
        lastName: 'Player',
        username: '',
        photoUrl: null,
        sidePreference: 'Both',
        numericRating: 3,
        rating: 3,
        ratingIdx: 2,
        isVerified: false,
      });
      const joinedMatch = applyBackendParticipantResult(
        joinableMatch,
        {
          matchId: parameters.matchId,
          matchVersion: 3,
          playerId: parameters.otherAccountId,
          slotNumber: 2,
          status: 'active',
        },
        joiningPlayer,
      );
      const leftMatch = applyBackendParticipantResult(
        joinedMatch,
        {
          matchId: parameters.matchId,
          matchVersion: 4,
          playerId: parameters.otherAccountId,
          slotNumber: 2,
          status: 'left',
        },
        joiningPlayer,
      );
      const staleAfterLeave = {
        ...joinedMatch,
        version: 3,
      };
      const refreshedAfterLeave = {
        ...leftMatch,
        version: 5,
      };
      const leaveActionRef = { current: false };
      const firstLeaveStarted = tryBeginMatchAction(leaveActionRef);
      const secondLeaveStarted = tryBeginMatchAction(leaveActionRef);
      leaveActionRef.current = false;
      const laterLeaveStarted = tryBeginMatchAction(leaveActionRef);
      let backendWaitlistCalls = 0;
      let legacyWaitlistCalls = 0;
      await refreshLegacyMatchWaitlist(match, () => {
        backendWaitlistCalls += 1;
      });
      await refreshLegacyMatchWaitlist(
        { backendOwned: false },
        () => {
          legacyWaitlistCalls += 1;
          return 'legacy-refreshed';
        },
      );

      return {
        draft,
        routing: {
          backendSelectedWithLegacyCollision:
            isBackendOwnedMatch(resolveMatchSource(
              parameters.matchId,
              match,
              [],
              [{
                id: parameters.matchId,
                backendOwned: false,
              }],
            )),
          legacySelectedWhileBackendAvailable:
            !isBackendOwnedMatch(resolveMatchSource(
              'legacy-match',
              {
                id: 'legacy-match',
                backendOwned: false,
              },
              [match],
              [],
            )),
          matchingDetailApplies:
            shouldApplyBackendMatchDetail(
              match,
              parameters.matchId,
              match,
            ),
          staleDetailRejected:
            !shouldApplyBackendMatchDetail(
              {
                ...match,
                id: 'newer-match',
              },
              parameters.matchId,
              match,
            ),
          olderSameMatchDetailRejected:
            !shouldApplyBackendMatchDetail(
              match,
              parameters.matchId,
              {
                ...match,
                version: 1,
              },
            ),
          backendProfileLoadingDoesNotFallBack:
            resolveBackendMatchMode({
              backendRequired: true,
              hasBackendActions: true,
              lifecycleStatus: 'checking',
              profileStatus: 'loading',
              accountId: null,
            }) === 'loading',
          backendProfileErrorDoesNotFallBack:
            resolveBackendMatchMode({
              backendRequired: true,
              hasBackendActions: true,
              lifecycleStatus: 'session_restored',
              profileStatus: 'error',
              accountId: null,
            }) === 'error',
          backendProfileReady:
            resolveBackendMatchMode({
              backendRequired: true,
              hasBackendActions: true,
              lifecycleStatus: 'session_restored',
              profileStatus: 'ready',
              accountId: parameters.accountId,
            }) === 'ready',
          backendBootstrapDoesNotFallBack:
            resolveBackendMatchMode({
              backendRequired: true,
              hasBackendActions: false,
              lifecycleStatus: 'checking',
              profileStatus: 'inactive',
              accountId: null,
            }) === 'loading',
          invalidBackendSessionDoesNotFallBack:
            resolveBackendMatchMode({
              backendRequired: true,
              hasBackendActions: false,
              lifecycleStatus: 'idle',
              profileStatus: 'error',
              accountId: null,
            }) === 'error',
          legacyWithoutBackendActions:
            resolveBackendMatchMode({
              backendRequired: false,
              hasBackendActions: false,
              lifecycleStatus: 'disabled',
              profileStatus: 'inactive',
              accountId: null,
            }) === 'legacy',
          staleFeedRejected:
            !shouldApplyBackendMatchFeedResponse(2, 1),
          latestFeedApplied:
            shouldApplyBackendMatchFeedResponse(2, 2),
        },
        postWriteFallback: {
          joinApplied:
            joinedMatch?.version === 3 &&
            joinedMatch?.participants.includes(
              parameters.otherAccountId,
            ),
          leaveApplied:
            leftMatch?.version === 4 &&
            !leftMatch?.participants.includes(
              parameters.otherAccountId,
            ),
          staleParticipantRejected:
            applyBackendParticipantResult(
              leftMatch,
              {
                matchId: parameters.matchId,
                matchVersion: 3,
                playerId: parameters.otherAccountId,
                slotNumber: 2,
                status: 'active',
              },
              joiningPlayer,
            ) === null,
          staleRefreshCannotRestoreParticipant:
            preferConfirmedBackendMatchMutation(
              leftMatch,
              staleAfterLeave,
            ) === leftMatch,
          newerRefreshAccepted:
            preferConfirmedBackendMatchMutation(
              leftMatch,
              refreshedAfterLeave,
            ) === refreshedAfterLeave,
          invitationPlaceholderUsesRefreshedDetail: (() => {
            const refreshed = preferConfirmedBackendMatchMutation(
              { id: parameters.matchId, backendOwned: true },
              match,
            );
            return refreshed === match && refreshed.time === '10:30';
          })(),
        },
        leaveSingleFlight: {
          firstLeaveStarted,
          secondLeaveBlocked: !secondLeaveStarted,
          laterLeaveStarted,
        },
        waitlistBoundary: {
          backendWaitlistCalls,
          legacyWaitlistCalls,
        },
        privateCreation: {
          backendCapability:
            BACKEND_PRIVATE_MATCH_CREATION_ENABLED,
          backendRequestRejected:
            !isPrivateMatchCreationEnabled(
              BACKEND_PRIVATE_MATCH_CREATION_ENABLED,
              true,
            ),
          legacyRequestPreserved:
            isPrivateMatchCreationEnabled(true, true),
        },
         legacyExtensions: {
           backendPinnedMessageHidden:
             !supportsLegacyMatchExtensions(match),
           legacyPinnedMessagePreserved:
             supportsLegacyMatchExtensions({ backendOwned: false }),
           backendChatEnabled:
             supportsMatchChat(true, () => {}, () => {}),
           backendChatFailsClosedWithoutBoundary:
             !supportsMatchChat(true, null, () => {}),
         },
        match: {
          id: match.id,
          ownerId: match.ownerId,
          dateISO: match.dateISO,
          time: match.time,
          duration: match.duration,
          isRatingMatch: match.isRatingMatch,
          backendOwned: match.backendOwned,
          participants: match.participants,
          slotIds: match.filledSlots.map(
            (player) => player?.id ?? null,
          ),
          slotIndexes: match.filledSlots.map(
            (player) => player?.slotIndex ?? null,
          ),
          slotNames: match.filledSlots
            .filter(Boolean)
            .map((player) => player.firstName),
          slotRatings: match.filledSlots
            .filter(Boolean)
            .map((player) => player.rating),
          slotVerification: match.filledSlots
            .filter(Boolean)
            .map((player) => player.isVerified),
          slotSides: match.filledSlots
            .filter(Boolean)
            .map((player) => player.sidePreference),
        },
        crossViewerPublicNames:
          matchForOtherViewer.filledSlots
            .filter(Boolean)
            .map((player) => player.firstName),
        rollingUpgradePlaceholderNames:
          legacyFeedMatch.filledSlots
            .filter(Boolean)
            .map((player) => player.firstName),
        accountProjection: {
          futureIds: futureMatches.map(({ id }) => id),
          accountIds: accountMatches.map(({ id }) => id),
          mergedIds: mergedUpcomingMatches.map(({ id }) => id),
          exactStartExcluded: !futureMatches.includes(exactStartMatch),
          terminalExcluded: !futureMatches.includes(terminalMatch),
          unrelatedExcluded: !accountMatches.includes(unrelatedMatch),
        },
        sensitiveAbsent:
          !/credential|requestKey|digest|authorization/iu.test(
            JSON.stringify({ draft, match }),
          ),
      };
    }, {
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
    });

    expect(summary.draft).toEqual({
      startsAt: 1893569400,
      durationMinutes: 90,
      courtId: 'court-1',
      scenario: 'social',
      description: 'Synthetic description',
      ratingMin: 1,
      ratingMax: 5,
      isRatingMatch: true,
    });
    expect(summary.match).toEqual({
      id: MATCH_ID,
      ownerId: ACCOUNT_ID,
      dateISO: '2030-01-02',
      time: '10:30',
      duration: 1.5,
      isRatingMatch: true,
      backendOwned: true,
      participants: [ACCOUNT_ID, OTHER_ACCOUNT_ID],
      slotIds: [ACCOUNT_ID, null, OTHER_ACCOUNT_ID, null],
      slotIndexes: [0, null, 2, null],
      slotNames: ['Synthetic', 'Visible'],
      slotRatings: [3, 4.25],
      slotVerification: [true, true],
      slotSides: ['Both', null],
    });
    expect(summary.crossViewerPublicNames).toEqual([
      'Synthetic',
      'Visible',
    ]);
    expect(summary.rollingUpgradePlaceholderNames).toEqual([
      'Synthetic',
      'Игрок',
    ]);
    expect(summary.accountProjection).toEqual({
      futureIds: [
        MATCH_ID,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ],
      accountIds: [
        MATCH_ID,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ],
      mergedIds: [
        'legacy-private-booking',
        MATCH_ID,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ],
      exactStartExcluded: true,
      terminalExcluded: true,
      unrelatedExcluded: true,
    });
    expect(summary.routing).toEqual({
      backendSelectedWithLegacyCollision: true,
      legacySelectedWhileBackendAvailable: true,
      matchingDetailApplies: true,
      staleDetailRejected: true,
      olderSameMatchDetailRejected: true,
      backendProfileLoadingDoesNotFallBack: true,
      backendProfileErrorDoesNotFallBack: true,
      backendProfileReady: true,
      backendBootstrapDoesNotFallBack: true,
      invalidBackendSessionDoesNotFallBack: true,
      legacyWithoutBackendActions: true,
      staleFeedRejected: true,
      latestFeedApplied: true,
    });
    expect(summary.postWriteFallback).toEqual({
      joinApplied: true,
      leaveApplied: true,
      staleParticipantRejected: true,
      staleRefreshCannotRestoreParticipant: true,
      newerRefreshAccepted: true,
      invitationPlaceholderUsesRefreshedDetail: true,
    });
    expect(summary.leaveSingleFlight).toEqual({
      firstLeaveStarted: true,
      secondLeaveBlocked: true,
      laterLeaveStarted: true,
    });
    expect(summary.waitlistBoundary).toEqual({
      backendWaitlistCalls: 0,
      legacyWaitlistCalls: 1,
    });
    expect(summary.privateCreation).toEqual({
      backendCapability: false,
      backendRequestRejected: true,
      legacyRequestPreserved: true,
    });
    expect(summary.legacyExtensions).toEqual({
      backendPinnedMessageHidden: true,
      legacyPinnedMessagePreserved: true,
      backendChatEnabled: true,
      backendChatFailsClosedWithoutBoundary: true,
    });
    expect(summary.sensitiveAbsent).toBe(true);
  });

  test('renders independent match avatar badges and mini-profile rating', async ({
    page,
  }) => {
    await page.goto('/');
    await isolateComponentHarness(page);

    await page.evaluate(async (parameters) => {
      const reactModule = await import('/@id/react');
      const React = reactModule.default ?? reactModule;
      const reactDomClientModule = await import('/@id/react-dom/client');
      const { createRoot } =
        reactDomClientModule.default ?? reactDomClientModule;
      const { default: MatchDetailsScreen } =
        await import('/src/components/MatchDetailsScreen.jsx');

      const players = [
        {
          id: parameters.accountId,
          firstName: 'Owner',
          lastName: 'Player',
          numericRating: 3,
          ratingIdx: 2,
          photo: null,
          isVerified: true,
          isOrganizer: true,
          sidePreference: 'Left',
          slotIndex: 0,
        },
        {
          id: parameters.otherAccountId,
          firstName: 'Partner',
          lastName: 'One',
          numericRating: 4.2,
          ratingIdx: 3,
          photo: 'https://photos.example.test/partner/avatar.webp',
          isVerified: true,
          isOrganizer: false,
          sidePreference: 'Right',
          slotIndex: 1,
        },
        {
          id: parameters.thirdAccountId,
          firstName: 'Unknown',
          lastName: 'Side',
          numericRating: 3.5,
          ratingIdx: 3,
          photo: null,
          isVerified: false,
          isOrganizer: false,
          sidePreference: null,
          slotIndex: 2,
        },
      ];
      const match = {
        id: parameters.matchId,
        backendOwned: true,
        ownerId: parameters.accountId,
        owner_id: parameters.accountId,
        description: '',
        date: '1 января',
        dateISO: '2030-01-01',
        time: '10:00',
        startsAt: 1_893_456_000,
        duration: 1,
        durationMinutes: 60,
        courtName: 'Корт 1',
        courtType: 'panoramic',
        type: 'match',
        scenario: 'social',
        status: 'upcoming',
        isPrivate: false,
        isRatingMatch: true,
        ratingMin: 0,
        ratingMax: 6,
        participants: players.map(({ id }) => id),
        filledSlots: [...players, null],
      };

      const container = document.createElement('div');
      container.dataset.testid = 'backend-player-badges-test-root';
      document.body.append(container);
      const root = createRoot(container);
      root.render(React.createElement(MatchDetailsScreen, {
        match,
        currentUser: {
          ...players[0],
          role: 'user',
          rating: 3,
        },
        onLoadLineup: async () => ({
          outcome: 'rejected',
          reason: 'lineup_not_found',
        }),
        onLoadResult: async () => ({
          outcome: 'rejected',
          reason: 'result_not_found',
        }),
        onBack() {},
        onJoinSuccess() {},
        onDelete() {},
        onComplete() {},
        onConfirmScore() {},
        onDisputeScore() {},
        onSlotsChange() {},
        onJoinMatch() {},
        onLeaveMatch() {},
        pendingInvitations: [],
        invitationActions: new Set(),
        allMessages: [],
        messagesLoading: false,
        messagesLoadError: '',
        showToast() {},
      }));
      window.__backendPlayerBadgesUiUnmount = () => {
        root.unmount();
        container.remove();
      };
    }, {
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      thirdAccountId: PARTICIPANT_ID,
      matchId: MATCH_ID,
    });

    const harness = page.getByTestId('backend-player-badges-test-root');
    await expect(harness.getByTestId('match-player-rating-0')).toHaveText('3.0');
    await expect(harness.getByTestId('match-player-side-0')).toHaveText('L');
    await expect(harness.getByTestId('match-player-status-0')).toHaveText('О');
    await expect(harness.getByTestId('match-player-rating-1')).toHaveText('4.2');
    await expect(harness.getByTestId('match-player-side-1')).toHaveText('R');
    await expect(harness.getByTestId('match-player-status-1')).toHaveText('✓');
    await expect(harness.getByTestId('match-player-side-2')).toHaveCount(0);
    await harness.getByTestId('match-filled-slot-1').click();
    await expect(harness.getByTestId('player-mini-profile-level')).toHaveText('B');
    await expect(harness.getByTestId('player-mini-profile-rating')).toHaveText('4.2');
    await expect(harness).not.toContainText('3.0–3.4');
    await harness.getByTestId('player-mini-profile-close').click();

    await page.evaluate(() => window.__backendPlayerBadgesUiUnmount?.());
  });

  test('submits, resolves and polls a backend result with the locked lineup', async ({
    page,
  }) => {
    test.slow();
    let legacyRpcCalls = 0;
    await page.route(/\/rest\/v1\/rpc\//iu, async (route) => {
      legacyRpcCalls += 1;
      await route.fulfill({ status: 500, body: '{}' });
    });
    await page.goto('/');
    await isolateComponentHarness(page);

    await page.evaluate(async (parameters) => {
      const reactModule = await import('/@id/react');
      const React = reactModule.default ?? reactModule;
      const reactDomClientModule = await import('/@id/react-dom/client');
      const { createRoot } =
        reactDomClientModule.default ?? reactDomClientModule;
      const {
        default: MatchDetailsScreen,
        supportsBackendMatchResult,
      } = await import('/src/components/MatchDetailsScreen.jsx');

      const players = [
        [parameters.accountId, 'Owner', 'Player'],
        [parameters.otherAccountId, 'Partner', 'One'],
        [parameters.thirdAccountId, 'Opponent', 'One'],
        [parameters.fourthAccountId, 'Opponent', 'Two'],
      ].map(([id, firstName, lastName], slotIndex) => ({
        id,
        firstName,
        lastName,
        numericRating: slotIndex === 1 ? 4.2 : 3,
        ratingIdx: slotIndex === 1 ? 3 : 2,
        photo: slotIndex === 1
          ? 'https://photos.example.test/partner/avatar.webp'
          : null,
        isVerified: true,
        isOrganizer: slotIndex === 0,
        slotIndex,
      }));
      const match = {
        id: parameters.matchId,
        backendOwned: true,
        ownerId: parameters.accountId,
        owner_id: parameters.accountId,
        description: '',
        date: '1 января',
        dateISO: '2023-11-14',
        time: '10:00',
        startsAt: 1_700_000_000,
        duration: 1,
        durationMinutes: 60,
        courtName: 'Корт 1',
        courtType: 'panoramic',
        type: 'match',
        scenario: 'social',
        status: 'upcoming',
        isPrivate: false,
        isRatingMatch: true,
        ratingMin: 0,
        ratingMax: 6,
        participants: players.map(({ id }) => id),
        filledSlots: players,
      };
      let resultRecord = null;
      let lineupStatus = 'draft';
      const resultCalls = {
        load: 0,
        submit: 0,
        confirm: 0,
        dispute: 0,
        submittedSets: null,
      };
      const lineup = () => ({
        outcome: 'lineup_loaded',
        lineup: {
          matchId: parameters.matchId,
          status: lineupStatus,
          version: lineupStatus === 'locked' ? 2 : 1,
          slots: players.map((player, index) => ({
            teamNumber: index < 2 ? 1 : 2,
            courtSide: index % 2 === 0 ? 'left' : 'right',
            assignment: {
              assignmentId: [
                parameters.assignment1,
                parameters.assignment2,
                parameters.assignment3,
                parameters.assignment4,
              ][index],
              player: {
                playerId: player.id,
                firstName: player.firstName,
                lastName: player.lastName,
                ...(player.photo ? { photoUrl: player.photo } : {}),
                rating: player.numericRating,
                isVerified: true,
              },
              assignedAt: 1_700_000_010 + index,
              isCurrentPlayer: false,
            },
          })),
          unassignedPlayers: [],
        },
      });

      function Harness() {
        const [accountId, setAccountId] = React.useState(parameters.accountId);
        const [instance, setInstance] = React.useState(0);
        React.useEffect(() => {
          window.__switchBackendResultAccount = setAccountId;
          window.__resetBackendResultToSubmitted = () => {
            const {
              confirmedAt,
              confirmedByAccountId,
              disputedAt,
              disputedByAccountId,
              ...pendingResult
            } = resultRecord;
            resultRecord = {
              ...pendingResult,
              status: 'submitted',
              version: resultRecord.version + 1,
            };
            setInstance((value) => value + 1);
          };
          window.__externallyDisputeBackendResult = () => {
            resultRecord = {
              ...resultRecord,
              status: 'disputed',
              disputedByAccountId: parameters.fourthAccountId,
              disputedAt: 1_700_000_300,
              version: resultRecord.version + 1,
            };
          };
        }, []);
        const current = players.find((player) => player.id === accountId);
        const currentUser = {
          ...current,
          role: 'user',
          rating: 3,
        };
        return React.createElement(MatchDetailsScreen, {
          key: instance,
          match,
          currentUser,
          onLoadLineup: async () => {
            const value = lineup();
            value.lineup.slots.forEach((slot) => {
              slot.assignment.isCurrentPlayer =
                slot.assignment.player.playerId === accountId;
            });
            return value;
          },
          onAssignLineupSlot() {},
          onReleaseLineupSlot() {},
          onLoadResult: async () => {
            resultCalls.load += 1;
            return resultRecord === null
              ? { outcome: 'rejected', reason: 'result_not_found' }
              : { outcome: 'result_loaded', result: resultRecord };
          },
          onSubmitResult: async (matchId, sets) => {
            resultCalls.submit += 1;
            resultCalls.submittedSets = sets;
            lineupStatus = 'locked';
            resultRecord = {
              resultId: parameters.resultId,
              matchId,
              lineupVersion: 1,
              teams: [
                [parameters.accountId, parameters.otherAccountId],
                [parameters.thirdAccountId, parameters.fourthAccountId],
              ],
              sets,
              winningTeam: 1,
              status: 'submitted',
              submittedByAccountId: parameters.accountId,
              submittedAt: 1_700_000_100,
              version: 1,
            };
            return {
              outcome: 'result_submitted',
              result: { matchId, status: 'submitted' },
            };
          },
          onConfirmResult: async (matchId) => {
            resultCalls.confirm += 1;
            resultRecord = {
              ...resultRecord,
              status: 'confirmed',
              confirmedByAccountId: accountId,
              confirmedAt: 1_700_000_200,
              version: 2,
            };
            return {
              outcome: 'result_confirmed',
              result: { matchId, status: 'confirmed' },
            };
          },
          onDisputeResult: async (matchId) => {
            resultCalls.dispute += 1;
            resultRecord = {
              ...resultRecord,
              status: 'disputed',
              disputedByAccountId: accountId,
              disputedAt: 1_700_000_250,
              version: resultRecord.version + 1,
            };
            return {
              outcome: 'result_disputed',
              result: { matchId, status: 'disputed' },
            };
          },
          onRefreshMatch: async () => ({ ...match, status: 'completed' }),
          onBack() {},
          onJoinSuccess() {},
          onDelete() {},
          onComplete() {},
          onConfirmScore() {},
          onDisputeScore() {},
          onSlotsChange() {},
          onJoinMatch() {},
          onLeaveMatch() {},
          pendingInvitations: [],
          invitationActions: new Set(),
          allMessages: [],
          messagesLoading: false,
          messagesLoadError: '',
          showToast() {},
        });
      }

      const container = document.createElement('div');
      container.dataset.testid = 'backend-result-test-root';
      document.body.append(container);
      const root = createRoot(container);
      root.render(React.createElement(Harness));
      window.__backendResultUiCalls = resultCalls;
      window.__backendResultLegacyBoundary =
        supportsBackendMatchResult(
          { backendOwned: false },
          () => {},
          () => {},
          () => {},
          () => {},
        ) === false;
      window.__backendResultUiUnmount = () => {
        root.unmount();
        container.remove();
      };
    }, {
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      thirdAccountId: PARTICIPANT_ID,
      fourthAccountId: MESSAGE_ID,
      matchId: MATCH_ID,
      resultId: RESULT_ID,
      assignment1: INVITATION_ID,
      assignment2: WAITLIST_ENTRY_ID,
      assignment3: OLDER_MESSAGE_ID,
      assignment4: REQUEST_KEY,
    });

    const harness = page.getByTestId('backend-result-test-root');
    const submit = harness.getByTestId('match-result-submit-open');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(harness.getByTestId('finish-player-0')).toBeDisabled();
    await expect(harness.getByTestId('finish-player-2')).toBeDisabled();
    await expect(harness.getByTestId('finish-player-1').locator('img')).toHaveAttribute(
      'src',
      'https://photos.example.test/partner/avatar.webp',
    );
    for (let index = 0; index < 6; index += 1) {
      await harness.getByTestId('finish-set-1-team-1-plus').click();
      await harness.getByTestId('finish-set-2-team-1-plus').click();
    }
    for (let index = 0; index < 4; index += 1) {
      await harness.getByTestId('finish-set-1-team-2-plus').click();
    }
    for (let index = 0; index < 3; index += 1) {
      await harness.getByTestId('finish-set-2-team-2-plus').click();
    }
    await harness.getByTestId('finish-match-save').click();
    await expect(harness).toContainText('Ожидает подтверждения счёта');
    await expect(harness.getByTestId('match-result-confirm')).toHaveCount(0);

    await page.evaluate((accountId) => {
      window.__switchBackendResultAccount(accountId);
    }, PARTICIPANT_ID);
    await expect(harness.getByTestId('match-result-confirm')).toBeVisible();
    await expect(harness.getByTestId('match-result-dispute')).toBeVisible();
    await harness.getByTestId('match-result-dispute').click();
    await expect(harness).toContainText('Счёт оспорен');

    await page.evaluate(() => window.__resetBackendResultToSubmitted());
    await expect(harness.getByTestId('match-result-confirm')).toBeVisible();
    await harness.getByTestId('match-result-confirm').click();
    await expect(harness).toContainText('Матч завершён');
    await expect(harness).toContainText('6:4, 6:3');

    await page.evaluate(() => window.__resetBackendResultToSubmitted());
    await expect(harness.getByTestId('match-result-confirm')).toBeVisible();
    await page.evaluate(() => window.__externallyDisputeBackendResult());
    await expect(harness).toContainText('Счёт оспорен', { timeout: 7_000 });
    const loadCallsAfterTerminalStatus = await page.evaluate(
      () => window.__backendResultUiCalls.load,
    );
    await page.waitForTimeout(5_500);
    expect(await page.evaluate(
      () => window.__backendResultUiCalls.load,
    )).toBe(loadCallsAfterTerminalStatus);

    const summary = await page.evaluate(() => ({
      calls: window.__backendResultUiCalls,
      legacyBoundary: window.__backendResultLegacyBoundary,
    }));
    expect(summary.calls.submit).toBe(1);
    expect(summary.calls.confirm).toBe(1);
    expect(summary.calls.dispute).toBe(1);
    expect(summary.calls.submittedSets).toEqual([
      { team1Games: 6, team2Games: 4 },
      { team1Games: 6, team2Games: 3 },
    ]);
    expect(summary.legacyBoundary).toBe(true);
    expect(legacyRpcCalls).toBe(0);
    await page.evaluate(() => window.__backendResultUiUnmount());
  });

  test('polls backend notifications, marks them read and never opens the Supabase notification provider', async ({
    page,
  }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await isolateComponentHarness(page);

    await page.evaluate(async (parameters) => {
      const reactModule = await import('/@id/react');
      const React = reactModule.default ?? reactModule;
      const reactDomClientModule = await import('/@id/react-dom/client');
      const { createRoot } =
        reactDomClientModule.default ?? reactDomClientModule;
      const { supabase } = await import('/src/lib/supabaseClient.js');
      const { default: App } = await import('/src/App.jsx');
      const originalSupabase = {
        rpc: supabase.rpc,
        from: supabase.from,
        channel: supabase.channel,
        removeChannel: supabase.removeChannel,
      };
      const boundary = {
        rpcNames: [],
        channelNames: [],
        listNotifications: 0,
        markRead: 0,
        loadMatch: 0,
      };
      supabase.rpc = async (name) => {
        boundary.rpcNames.push(name);
        if (name === 'get_my_profile') {
          return {
            data: [{
              id: parameters.accountId,
              first_name: 'Current',
              last_name: 'Player',
              username: 'current_player',
              rating: 3,
              is_verified: true,
              role: 'user',
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      };
      supabase.from = () => ({
        select() { return this; },
        order() {
          return Promise.resolve({ data: [], error: null });
        },
      });
      supabase.channel = (name) => {
        boundary.channelNames.push(name);
        const channel = {
          on() { return channel; },
          subscribe() { return channel; },
        };
        return channel;
      };
      supabase.removeChannel = () => {};

      const startsAt = Math.floor(Date.now() / 1_000) + 86_400;
      const owner = {
        playerId: parameters.otherAccountId,
        firstName: 'Match',
        lastName: 'Owner',
        username: 'match_owner',
        rating: 3,
        isVerified: true,
      };
      const currentPlayer = {
        playerId: parameters.accountId,
        firstName: 'Current',
        lastName: 'Player',
        username: 'current_player',
        rating: 3,
        isVerified: true,
      };
      const detail = {
        matchId: parameters.matchId,
        ownerAccountId: parameters.otherAccountId,
        createdAt: startsAt - 3_600,
        updatedAt: startsAt - 30,
        startsAt,
        durationMinutes: 90,
        courtId: 'court-1',
        courtName: 'Court 1',
        courtType: 'panoramic',
        kind: 'match',
        visibility: 'public',
        scenario: 'social',
        status: 'confirmed',
        description: 'Waitlist promotion match',
        ratingMin: 1,
        ratingMax: 5,
        isRatingMatch: false,
        pricePerPersonSnapshot: 750,
        version: 2,
        owner,
        participants: [{ ...currentPlayer, slotNumber: 2 }],
      };
      const notification = {
        notificationId: parameters.notificationId,
        matchId: parameters.matchId,
        notificationType: 'waitlist_promoted',
        createdAt: startsAt - 60,
      };
      const backendMatchActions = {
        async listMatches() {
          return { outcome: 'matches_loaded', matches: [] };
        },
        async listAccountMatches() {
          return { outcome: 'matches_loaded', matches: [] };
        },
        async listIncomingMatchInvitations() {
          return { outcome: 'invitations_loaded', invitations: [] };
        },
        async listMatchNotifications() {
          boundary.listNotifications += 1;
          return {
            outcome: 'notifications_loaded',
            notifications:
              boundary.listNotifications === 1 ? [] : [notification],
            unreadCount: boundary.listNotifications === 1 ? 0 : 1,
          };
        },
        async markMatchNotificationRead(notificationId) {
          boundary.markRead += 1;
          return {
            outcome: 'notification_read',
            notification: {
              ...notification,
              notificationId,
              readAt: notification.createdAt + 120,
            },
          };
        },
        async loadMatch() {
          boundary.loadMatch += 1;
          return { outcome: 'match_loaded', match: detail };
        },
      };
      const backendProfile = {
        accountId: parameters.accountId,
        role: 'player',
        firstName: currentPlayer.firstName,
        lastName: currentPlayer.lastName,
        username: currentPlayer.username,
        photoUrl: null,
        languageCode: 'ru',
        phone: null,
        sidePreference: null,
        rating: currentPlayer.rating,
        isVerified: currentPlayer.isVerified,
        capabilities: [],
      };
      const container = document.createElement('div');
      container.dataset.testid = 'backend-notification-app-root';
      document.body.append(container);
      const root = createRoot(container);
      root.render(React.createElement(App, {
        backendProfile,
        backendMatchRequired: true,
        backendMatchLifecycleStatus: 'authenticated',
        backendProfileStatus: 'ready',
        backendMatchActions,
        showToast() {},
        onLogout() {},
      }));
      window.__backendNotificationBoundary = boundary;
      window.__backendNotificationUiUnmount = () => {
        root.unmount();
        container.remove();
        supabase.rpc = originalSupabase.rpc;
        supabase.from = originalSupabase.from;
        supabase.channel = originalSupabase.channel;
        supabase.removeChannel = originalSupabase.removeChannel;
      };
    }, {
      accountId: ACCOUNT_ID,
      otherAccountId: OTHER_ACCOUNT_ID,
      matchId: MATCH_ID,
      notificationId: NOTIFICATION_ID,
    });

    const harness = page.getByTestId('backend-notification-app-root');
    await expect(harness.locator('.bottom-nav button')).toHaveCount(5);
    await harness.locator('.bottom-nav button').last().click();
    await expect(harness.getByTestId('notifications-empty')).toBeVisible();
    const card = harness.getByTestId(
      `notification-card-${NOTIFICATION_ID}`,
    );
    await expect(card).toBeVisible({ timeout: 7_000 });
    await expect(card).toContainText('Вы в матче');
    await expect(card.getByLabel('Непрочитанное')).toBeVisible();
    await card.click();
    await expect(harness).toContainText('Waitlist promotion match');
    await expect(harness).toContainText('Court 1');

    const boundary = await page.evaluate(
      () => window.__backendNotificationBoundary,
    );
    expect(boundary.listNotifications).toBeGreaterThanOrEqual(2);
    expect(boundary.markRead).toBe(1);
    expect(boundary.loadMatch).toBeGreaterThanOrEqual(1);
    expect(boundary.rpcNames).not.toContain('get_my_notifications');
    expect(boundary.rpcNames).not.toContain('get_unread_notification_count');
    expect(boundary.rpcNames).not.toContain('mark_notification_read');
    expect(boundary.channelNames).not.toContain('public:notifications');
    expect(pageErrors).toEqual([]);
    await page.evaluate(() => window.__backendNotificationUiUnmount());
  });
});
