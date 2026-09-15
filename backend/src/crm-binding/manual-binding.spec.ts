import { accountId } from '../accounts/account.types';
import { ManualBindingService } from './manual-binding.service';
import { ExactClient, ManualDraft } from './manual-binding.types';
import { YclientsManualClientReader } from './yclients-manual-client.reader';
import { envValidationSchema } from '../config/env.validation';
const A = accountId('11111111-1111-4111-8111-111111111111');
const B = accountId('22222222-2222-4222-8222-222222222222');
const D = '33333333-3333-4333-8333-333333333333';
const draft = (): ManualDraft => ({
  draftId: D,
  actorId: A,
  targetId: B,
  companyId: 17,
  clientId: 5,
  profileRevision: 2,
  clientVersion: '2026-09-15T12:00:00+03:00',
  expiresAt: 1900000300,
  state: 'prepared',
});
const client = (): ExactClient => ({
  outcome: 'loaded',
  companyId: 17,
  clientId: 5,
  name: 'Тест Игрок',
  phoneHint: '•••• 2233',
  version: draft().clientVersion,
});
function setup(enabled = true) {
  const repository = {
    context: jest.fn().mockResolvedValue({ outcome: 'ready', revision: 2 }),
    prepare: jest.fn().mockResolvedValue(draft()),
    readDraft: jest.fn().mockResolvedValue(draft()),
    commit: jest.fn().mockResolvedValue({ outcome: 'linked' }),
    ownStatus: jest.fn().mockResolvedValue({ outcome: 'linked' }),
  };
  const readExact = jest.fn().mockResolvedValue(client());
  return {
    repository,
    readExact,
    service: new ManualBindingService({
      enabled,
      companyId: 17,
      repository,
      clients: { readExact },
    }),
  };
}
describe('manual CRM identity is an administrator attestation, never an SMS boolean', () => {
  it('is disabled with no DB or CRM calls', async () => {
    const h = setup(false);
    expect(await h.service.preview(A, B, 5)).toEqual({
      outcome: 'not_configured',
    });
    expect(await h.service.confirm(A, B, D, true)).toEqual({
      outcome: 'not_configured',
    });
    expect(h.repository.context).not.toHaveBeenCalled();
    expect(h.readExact).not.toHaveBeenCalled();
    expect(
      envValidationSchema.validate({}).value.CRM_MANUAL_BINDING_ENABLED,
    ).toBe(false);
    expect(
      envValidationSchema.validate({
        CRM_MANUAL_BINDING_ENABLED: true,
        DATABASE_ENABLED: false,
      }).error,
    ).toBeDefined();
  });
  it('checks admin rights before even reading the CRM card', async () => {
    const h = setup();
    h.repository.context.mockResolvedValue({ outcome: 'forbidden' });
    expect(await h.service.preview(A, B, 5)).toEqual({ outcome: 'forbidden' });
    expect(h.readExact).not.toHaveBeenCalled();
  });
  it('prepares an actor-scoped preview without phone proof and rechecks exact CRM on confirm', async () => {
    const h = setup();
    expect(await h.service.preview(A, B, 5)).toEqual({
      outcome: 'preview',
      draftId: D,
      name: 'Тест Игрок',
      phoneHint: '•••• 2233',
      expiresAt: 1900000300,
    });
    expect(h.repository.prepare).toHaveBeenCalledWith(
      A,
      B,
      17,
      5,
      2,
      draft().clientVersion,
    );
    expect(await h.service.confirm(A, B, D, true)).toEqual({
      outcome: 'linked',
    });
    expect(h.readExact).toHaveBeenCalledTimes(2);
    expect(h.repository.commit).toHaveBeenCalledWith(draft());
  });
  it('requires the explicit admin attestation', async () => {
    const h = setup();
    expect(await h.service.confirm(A, B, D, false)).toEqual({
      outcome: 'unknown',
    });
    expect(h.repository.commit).not.toHaveBeenCalled();
    expect(h.readExact).not.toHaveBeenCalled();
  });
  it.each([{ actorId: B }, { targetId: A }, { companyId: 18 }, { draftId: A }])(
    'rejects a swapped draft %#',
    async (change) => {
      const h = setup();
      h.repository.readDraft.mockResolvedValue({ ...draft(), ...change });
      expect(await h.service.confirm(A, B, D, true)).toEqual({
        outcome: 'review_required',
      });
      expect(h.readExact).not.toHaveBeenCalled();
    },
  );
  it('expired, revoked or locally changed drafts cannot proceed', async () => {
    const h = setup();
    h.repository.readDraft.mockResolvedValue(undefined);
    expect(await h.service.confirm(A, B, D, true)).toEqual({
      outcome: 'review_required',
    });
    expect(h.readExact).not.toHaveBeenCalled();
  });
  it.each([
    { companyId: 18 },
    { clientId: 6 },
    { version: '2026-09-15T12:01:00+03:00' },
  ])('rejects CRM changes after preview %#', async (change) => {
    const h = setup();
    h.readExact.mockResolvedValue({ ...client(), ...change });
    expect(await h.service.confirm(A, B, D, true)).toEqual({
      outcome: 'review_required',
    });
    expect(h.repository.commit).not.toHaveBeenCalled();
  });
  it('final transaction may reject revocation/change during the network read', async () => {
    const h = setup();
    h.repository.commit.mockResolvedValue({ outcome: 'forbidden' });
    expect(await h.service.confirm(A, B, D, true)).toEqual({
      outcome: 'forbidden',
    });
  });
  it('committed retries still use repository authority without another CRM read', async () => {
    const h = setup();
    h.repository.readDraft.mockResolvedValue({
      ...draft(),
      state: 'committed',
    });
    expect(await h.service.confirm(A, B, D, true)).toEqual({
      outcome: 'linked',
    });
    expect(h.readExact).not.toHaveBeenCalled();
    expect(h.repository.commit).toHaveBeenCalled();
  });
  it('suppresses raw provider and DB failures', async () => {
    const h = setup();
    h.readExact.mockRejectedValue(
      new Error('phone +79991112233 token private'),
    );
    expect(await h.service.preview(A, B, 5)).toEqual({ outcome: 'unknown' });
    h.repository.ownStatus.mockRejectedValue(new Error('private SQL'));
    expect(await h.service.ownStatus(B)).toEqual({ outcome: 'unknown' });
  });
  it('bounds double-click work', async () => {
    const h = setup();
    let resolve!: (value: ExactClient) => void;
    h.readExact.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = h.service.preview(A, B, 5);
    expect(await h.service.preview(A, B, 5)).toEqual({ outcome: 'unknown' });
    resolve(client());
    await first;
    expect(h.readExact).toHaveBeenCalledTimes(1);
  });
});

describe('manual exact read privacy/bounds', () => {
  const runtime = {
    enabled: true,
    bookingWriteEnabled: false,
    baseUrl: 'https://api.yclients.com',
    companyId: 17,
    partnerToken: 'private-partner',
    userToken: 'private-user',
  };
  const payload = () => ({
    success: true,
    data: {
      id: 5,
      name: 'Тест',
      surname: 'Игрок',
      phone: 79991112233,
      last_change_date: draft().clientVersion,
    },
  });
  function reader(body: unknown = payload(), status = 200) {
    const fetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));
    return {
      fetch,
      reader: new YclientsManualClientReader({
        runtime,
        fetch,
        limiter: { run: async (work) => work() },
      }),
    };
  }
  it('only GETs IDs and projects admin name plus masked phone', async () => {
    const h = reader();
    expect(await h.reader.readExact(17, 5)).toEqual(client());
    expect(h.fetch.mock.calls[0][0]).toBe(
      'https://api.yclients.com/api/v1/client/17/5',
    );
    expect(h.fetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
    });
    expect(
      JSON.stringify(await reader().reader.readExact(17, 5)),
    ).not.toContain('79991112233');
  });
  it.each([401, 403, 429, 500, 302])(
    'fails closed on HTTP %s without retry',
    async (status) => {
      const h = reader({}, status);
      expect(await h.reader.readExact(17, 5)).toEqual({ outcome: 'unknown' });
      expect(h.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { id: 6 },
    { company_id: 18 },
    { phone: null },
    { name: '' },
    { last_change_date: null },
  ])('rejects bad exact payload %#', async (changes) => {
    const h = reader({
      success: true,
      data: { ...payload().data, ...changes },
    });
    expect(await h.reader.readExact(17, 5)).toEqual({ outcome: 'unknown' });
  });
  it('does not query another company and bounds oversized bodies', async () => {
    const h = reader();
    expect(await h.reader.readExact(18, 5)).toEqual({ outcome: 'unknown' });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(
      await reader({ huge: 'x'.repeat(140000) }).reader.readExact(17, 5),
    ).toEqual({ outcome: 'unknown' });
  });
  it('times out queued work and does not dispatch it later', async () => {
    jest.useFakeTimers();
    try {
      let work!: () => Promise<unknown>;
      const fetch = jest.fn();
      const reader = new YclientsManualClientReader({
        runtime,
        fetch,
        limiter: {
          run: (fn) => {
            work = fn;
            return new Promise(() => {});
          },
        },
      });
      const result = reader.readExact(17, 5);
      await jest.advanceTimersByTimeAsync(8000);
      expect(await result).toEqual({ outcome: 'unknown' });
      await work();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
