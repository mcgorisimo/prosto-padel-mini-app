import { isCanonicalSessionCredential } from './sessionCredential';

const MAX_RESPONSE_BYTES = 32_768;
const MINE_PATH = '/api/v1/memberships/mine';
const CATALOG_PATH = '/api/v1/memberships/catalog';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MEMBERSHIP_STATUSES = new Set(['active', 'scheduled', 'expired', 'exhausted']);
const rejected = (reason) => Object.freeze({ outcome: 'rejected', reason });
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value, keys) => isRecord(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const hasControlCharacters = (value) => [...value].some((character) => {
  const code = character.charCodeAt(0);
  return code <= 31 || (code >= 127 && code <= 159);
});
const isBoundedText = (value, maximum) => typeof value === 'string' &&
  value.trim().length > 0 && value.length <= maximum && !hasControlCharacters(value);
const isNullableCount = (value, maximum) => value === null ||
  (Number.isSafeInteger(value) && value >= 0 && value <= maximum);
const isNullablePositiveCount = (value, maximum) => value === null ||
  (Number.isSafeInteger(value) && value > 0 && value <= maximum);

function isIsoDate(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function readMembership(value) {
  if (!hasExactKeys(value, ['id', 'title', 'status', 'remainingVisits', 'expiresOn']) ||
      typeof value.id !== 'string' || !UUID.test(value.id) ||
      !isBoundedText(value.title, 160) || !MEMBERSHIP_STATUSES.has(value.status) ||
      !isNullableCount(value.remainingVisits, 10_000) || !isIsoDate(value.expiresOn)) return null;
  return Object.freeze({
    id: value.id.toLowerCase(),
    title: value.title.trim(),
    status: value.status,
    remainingVisits: value.remainingVisits,
    expiresOn: value.expiresOn,
  });
}

function readProduct(value) {
  if (!hasExactKeys(value, ['id', 'title', 'description', 'visitCount', 'validityDays']) ||
      typeof value.id !== 'string' || !UUID.test(value.id) ||
      !isBoundedText(value.title, 160) ||
      !(value.description === null || isBoundedText(value.description, 500)) ||
      !isNullablePositiveCount(value.visitCount, 10_000) ||
      !isNullablePositiveCount(value.validityDays, 3_650)) return null;
  return Object.freeze({
    id: value.id.toLowerCase(),
    title: value.title.trim(),
    description: value.description === null ? null : value.description.trim(),
    visitCount: value.visitCount,
    validityDays: value.validityDays,
  });
}

export function readOwnMembershipsResponse(value) {
  if (!hasExactKeys(value, ['outcome', 'memberships']) || !Array.isArray(value.memberships)) return null;
  if (value.outcome === 'not_configured' || value.outcome === 'unavailable') {
    return value.memberships.length === 0
      ? Object.freeze({ outcome: value.outcome, memberships: Object.freeze([]) })
      : null;
  }
  if (value.outcome !== 'loaded' || value.memberships.length > 100) return null;
  const memberships = value.memberships.map(readMembership);
  if (memberships.some((item) => item === null)) return null;
  return Object.freeze({ outcome: 'loaded', memberships: Object.freeze(memberships) });
}

export function readMembershipCatalogResponse(value) {
  if (!hasExactKeys(value, ['outcome', 'products']) || !Array.isArray(value.products)) return null;
  if (value.outcome === 'not_configured' || value.outcome === 'unavailable') {
    return value.products.length === 0
      ? Object.freeze({ outcome: value.outcome, products: Object.freeze([]) })
      : null;
  }
  if (value.outcome !== 'loaded' || value.products.length > 100) return null;
  const products = value.products.map(readProduct);
  if (products.some((item) => item === null)) return null;
  return Object.freeze({ outcome: 'loaded', products: Object.freeze(products) });
}

async function readBoundedJson(response) {
  if (!/^application\/json(?:;|$)/iu.test(response.headers.get('content-type') ?? '') ||
      response.headers.get('cache-control') !== 'no-store') return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const bytes = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (bytes.length + chunk.value.byteLength > MAX_RESPONSE_BYTES) return null;
      bytes.push(...chunk.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)));
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createMembershipReadClient({ fetchImpl = globalThis.fetch?.bind(globalThis), requestTimeoutMs = 8_000 } = {}) {
  async function read(path, credential, parser, { signal } = {}) {
    if (!isCanonicalSessionCredential(credential)) return rejected('invalid');
    if (signal?.aborted) return Object.freeze({ outcome: 'cancelled' });
    if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) return rejected('internal_error');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, requestTimeoutMs);
    try {
      const response = await fetchImpl(path, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 401) return rejected('invalid');
      if (response.status === 429 || response.status >= 500) return rejected('unavailable');
      if (response.status !== 200) return rejected('invalid_response');
      return parser(await readBoundedJson(response)) ?? rejected('invalid_response');
    } catch {
      return signal?.aborted ? Object.freeze({ outcome: 'cancelled' }) : rejected('unavailable');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return Object.freeze({
    readMine: (credential, options) => read(MINE_PATH, credential, readOwnMembershipsResponse, options),
    readCatalog: (credential, options) => read(CATALOG_PATH, credential, readMembershipCatalogResponse, options),
  });
}

export const membershipReadClient = createMembershipReadClient();
