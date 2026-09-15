import { describe, it, expect, vi } from 'vitest';
import {
  createManualCrmBindingClient,
  readManualCrmResponse,
} from './manualCrmBindingClient';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL = 'A'.repeat(43);
const preview = {
  outcome: 'preview',
  draftId: DRAFT,
  name: 'Тест Игрок',
  phoneHint: '•••• 2233',
  expiresAt: 1900000300,
};
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
describe('manual binding browser contract', () => {
  it('uses one same-origin bearer POST per explicit action, IDs only in body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(response({ outcome: 'linked' }));
    const client = createManualCrmBindingClient({ fetchImpl });
    expect(await client.preview(CREDENTIAL, OWNER, 5)).toEqual(preview);
    expect(await client.confirm(CREDENTIAL, OWNER, DRAFT)).toEqual({
      outcome: 'linked',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      draftId: DRAFT,
      identityChecked: true,
    });
  });
  it.each([
    { ...preview, clientId: 5 },
    { ...preview, phoneHint: '+79991112233' },
    { ...preview, name: 'bad\nname' },
    { outcome: 'linked', token: 'private' },
    { ...preview, draftId: 'invalid' },
  ])('rejects unexpected PII or malformed result %#', (value) => {
    expect(readManualCrmResponse(value)).toBeNull();
  });
  it('never retries an unknown write and maps 401 into session invalidation', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('private'))
      .mockResolvedValueOnce(response({}, 401));
    const client = createManualCrmBindingClient({ fetchImpl });
    expect(await client.confirm(CREDENTIAL, OWNER, DRAFT)).toEqual({
      outcome: 'unknown',
    });
    expect(await client.confirm(CREDENTIAL, OWNER, DRAFT)).toEqual({
      outcome: 'rejected',
      reason: 'invalid',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
