const { test, expect } = require('@playwright/test');

const SYNTHETIC_CREDENTIAL = 'A'.repeat(43);
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_KEY = '44444444-4444-4444-8444-444444444444';

test.describe('backend match credential lifecycle', () => {
  test('uses exact no-store contracts for feed, detail, create, join and leave', async ({
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
        title: 'Synthetic match',
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
        title: detail.title,
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
        title: detail.title,
        description: detail.description,
        ratingMin: detail.ratingMin,
        ratingMax: detail.ratingMax,
        isRatingMatch: detail.isRatingMatch,
      };

      const results = [
        await client.listMatches(parameters.credential, 20),
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
                'courtId,description,durationMinutes,isRatingMatch,ratingMax,ratingMin,requestKey,scenario,startsAt,title' &&
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
              photoUrl: 'https://example.invalid/private',
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
          Object.isFrozen(results[1].match.owner) &&
          Object.isFrozen(results[1].match.participants[0]),
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
        await lifecycle.loadMatch(parameters.matchId),
        await lifecycle.createMatch({}),
        await lifecycle.joinMatch(parameters.matchId),
        await lifecycle.leaveMatch(parameters.matchId),
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
      matchId: MATCH_ID,
    });

    expect(summary).toEqual({
      credentialMatched: true,
      outcomes: [
        'matches_loaded',
        'match_loaded',
        'match_created',
        'participant_joined',
        'participant_left',
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
        resolveBackendMatchMode,
        resolveMatchSource,
        shouldApplyBackendMatchDetail,
        shouldApplyBackendMatchFeedResponse,
      } = await import('/src/lib/backendMatchAdapter.js');
      const {
        isPrivateMatchCreationEnabled,
      } = await import('/src/components/MatchCreationScreen.jsx');
      const {
        refreshLegacyMatchWaitlist,
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
        },
        match: {
          id: match.id,
          ownerId: match.ownerId,
          dateISO: match.dateISO,
          time: match.time,
          duration: match.duration,
          title: match.title,
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
        },
        crossViewerPublicNames:
          matchForOtherViewer.filledSlots
            .filter(Boolean)
            .map((player) => player.firstName),
        rollingUpgradePlaceholderNames:
          legacyFeedMatch.filledSlots
            .filter(Boolean)
            .map((player) => player.firstName),
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
      title: 'Match title',
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
      title: 'Match title',
      isRatingMatch: true,
      backendOwned: true,
      participants: [ACCOUNT_ID, OTHER_ACCOUNT_ID],
      slotIds: [ACCOUNT_ID, null, OTHER_ACCOUNT_ID, null],
      slotIndexes: [0, null, 2, null],
      slotNames: ['Synthetic', 'Visible'],
      slotRatings: [3, 4.25],
      slotVerification: [true, true],
    });
    expect(summary.crossViewerPublicNames).toEqual([
      'Synthetic',
      'Visible',
    ]);
    expect(summary.rollingUpgradePlaceholderNames).toEqual([
      'Synthetic',
      'Игрок',
    ]);
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
    });
    expect(summary.sensitiveAbsent).toBe(true);
  });
});
