import { isCanonicalSessionCredential } from './sessionCredential';
import { normalizeContactEmail } from './contactEmail';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const outcomes = [
  'not_configured',
  'forbidden',
  'not_found',
  'review_required',
  'unknown',
  'linked',
];
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const safeText = (value) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 241 &&
  ![...value].some(
    (char) =>
      char.charCodeAt(0) <= 31 ||
      (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
  );
export function readManualCrmResponse(value) {
  if (outcomes.includes(value?.outcome) && exact(value, ['outcome']))
    return Object.freeze({ outcome: value.outcome });
  if (
    value?.outcome !== 'preview' ||
    !exact(value, ['outcome', 'draftId', 'name', 'phoneHint', 'expiresAt']) ||
    !UUID.test(value.draftId) ||
    !safeText(value.name) ||
    !/^•••• [0-9]{4}$/u.test(value.phoneHint) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= 0
  )
    return null;
  return Object.freeze({ ...value });
}
export function createManualCrmBindingClient({
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  async function call(action, credential, playerId, body, { signal } = {}) {
    const reject = (reason) => Object.freeze({ outcome: 'rejected', reason });
    if (!isCanonicalSessionCredential(credential)) return reject('invalid');
    if (
      !UUID.test(playerId) ||
      (action === 'preview' &&
        (Object.hasOwn(body, 'email') ? !normalizeContactEmail(body.email) :
          (!Number.isSafeInteger(body.clientId) || body.clientId <= 0))) ||
      (action === 'confirm' && !UUID.test(body.draftId))
    )
      return reject('invalid_request');
    if (signal?.aborted) return { outcome: 'cancelled' };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Object.hasOwn(body, 'email') ? 30_000 : 12_000);
    let reader;
    try {
      const response = await fetchImpl(
        `/api/v1/admin/players/${playerId}/crm-binding/${action}`,
        {
          method: 'POST',
          body: JSON.stringify(body),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credential}`,
          },
          signal: controller.signal,
        },
      );
      if (response.status === 401) return reject('invalid');
      if (
        response.status !== 200 ||
        response.headers.get('cache-control') !== 'no-store' ||
        !/^application\/json(?:;|$)/iu.test(
          response.headers.get('content-type') ?? '',
        )
      )
        return reject('unavailable');
      reader = response.body?.getReader();
      if (!reader) return reject('invalid_response');
      const bytes = [];
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (bytes.length + part.value.byteLength > 4096)
          return reject('invalid_response');
        bytes.push(...part.value);
      }
      const result = readManualCrmResponse(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            new Uint8Array(bytes),
          ),
        ),
      );
      if (!result || (action === 'confirm' && result.outcome === 'preview'))
        return reject('invalid_response');
      return result;
    } catch {
      return signal?.aborted
        ? { outcome: 'cancelled' }
        : { outcome: 'unknown' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (reader) await reader.cancel().catch(() => {});
    }
  }
  return Object.freeze({
    preview: (credential, playerId, selector, options) =>
      call('preview', credential, playerId, typeof selector === 'string'
        ? { email: normalizeContactEmail(selector) } : { clientId: selector }, options),
    confirm: (credential, playerId, draftId, options) =>
      call(
        'confirm',
        credential,
        playerId,
        { draftId, identityChecked: true },
        options,
      ),
  });
}
export const manualCrmBindingClient = createManualCrmBindingClient();
