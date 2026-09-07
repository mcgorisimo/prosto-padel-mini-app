import { isCanonicalSessionCredential } from './sessionCredential';

const PATH = '/api/v1/trainings/schedule';
const MAX_RESPONSE_BYTES = 16_384;
const MAX_SESSIONS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const rejected = (reason) => Object.freeze({ outcome: 'rejected', reason });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const hasControlCharacter = (value) => [...value].some((character) => {
  const code = character.codePointAt(0);
  return code <= 31 || (code >= 127 && code <= 159);
});
const safeLabel = (value) => typeof value === 'string' && value.trim() === value &&
  value.length > 0 && value.length <= 160 && !hasControlCharacter(value);
const canonicalIso = (value) => typeof value === 'string' && ISO.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function parseSession(value) {
  if (!isObject(value)) return null;
  const optionalKeys = ['courtName', 'coachName'].filter((key) => value[key] !== undefined);
  if (!exactKeys(value, ['id', 'title', 'startsAt', 'durationSeconds', 'capacity', 'occupied', 'remaining', ...optionalKeys]) ||
      typeof value.id !== 'string' || !UUID.test(value.id) || !safeLabel(value.title) || !canonicalIso(value.startsAt) ||
      !Number.isSafeInteger(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > 86_400 ||
      !Number.isSafeInteger(value.capacity) || value.capacity < 1 || value.capacity > 1_000 ||
      !Number.isSafeInteger(value.occupied) || value.occupied < 0 || value.occupied > 1_000 ||
      value.remaining !== Math.max(value.capacity - value.occupied, 0) ||
      (value.courtName !== undefined && !safeLabel(value.courtName)) ||
      (value.coachName !== undefined && !safeLabel(value.coachName))) return null;
  return Object.freeze({
    id: value.id.toLowerCase(),
    title: value.title,
    startsAt: value.startsAt,
    durationSeconds: value.durationSeconds,
    ...(value.courtName === undefined ? {} : { courtName: value.courtName }),
    ...(value.coachName === undefined ? {} : { coachName: value.coachName }),
    capacity: value.capacity,
    occupied: value.occupied,
    remaining: value.remaining,
  });
}

export function readTrainingScheduleResponse(body) {
  if (!isObject(body) || !Array.isArray(body.sessions)) return null;
  if (['not_configured', 'unavailable', 'error'].includes(body.outcome)) {
    return exactKeys(body, ['outcome', 'sessions']) && body.sessions.length === 0
      ? Object.freeze({ outcome: body.outcome, sessions: Object.freeze([]) }) : null;
  }
  if (body.outcome === 'empty' || body.outcome === 'stale') {
    return exactKeys(body, ['outcome', 'sessions', 'lastUpdatedAt']) && body.sessions.length === 0 && canonicalIso(body.lastUpdatedAt)
      ? Object.freeze({ outcome: body.outcome, sessions: Object.freeze([]), lastUpdatedAt: body.lastUpdatedAt }) : null;
  }
  if (body.outcome !== 'loaded' || !exactKeys(body, ['outcome', 'sessions', 'lastUpdatedAt']) ||
      !canonicalIso(body.lastUpdatedAt) || body.sessions.length < 1 || body.sessions.length > MAX_SESSIONS) return null;
  const sessions = body.sessions.map(parseSession);
  if (sessions.some((session) => session === null)) return null;
  const ids = new Set(sessions.map((session) => session.id));
  if (ids.size !== sessions.length || sessions.some((session, index) => index > 0 &&
      (sessions[index - 1].startsAt > session.startsAt ||
        sessions[index - 1].startsAt === session.startsAt && sessions[index - 1].id > session.id))) return null;
  return Object.freeze({ outcome: 'loaded', sessions: Object.freeze(sessions), lastUpdatedAt: body.lastUpdatedAt });
}

export function isTrainingScheduleResponse(value) {
  return readTrainingScheduleResponse(value) !== null;
}

export function isUnconfiguredTrainingSchedule(value) {
  return readTrainingScheduleResponse(value)?.outcome === 'not_configured';
}

export function createTrainingScheduleClient({ fetchImpl = globalThis.fetch?.bind(globalThis), requestTimeoutMs = 15_000 } = {}) {
  return Object.freeze({
    async read(credential, { signal } = {}) {
      if (!isCanonicalSessionCredential(credential)) return rejected('invalid');
      if (signal?.aborted) return Object.freeze({ outcome: 'cancelled' });
      if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) return rejected('internal_error');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, requestTimeoutMs);
      let reader;
      try {
        const response = await fetchImpl(PATH, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` },
          cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
        });
        if (response.status === 401) return rejected('invalid');
        if (response.status !== 200) return rejected('unavailable');
        if (!/^application\/json(?:;|$)/iu.test(response.headers.get('content-type') ?? '') ||
            response.headers.get('cache-control') !== 'no-store') return rejected('invalid_response');
        reader = response.body?.getReader();
        if (!reader) return rejected('invalid_response');
        const bytes = [];
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (bytes.length + chunk.value.byteLength > MAX_RESPONSE_BYTES) return rejected('invalid_response');
          bytes.push(...chunk.value);
        }
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)));
        return readTrainingScheduleResponse(body) ?? rejected('invalid_response');
      } catch {
        return signal?.aborted ? Object.freeze({ outcome: 'cancelled' }) : rejected('unavailable');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (reader) await reader.cancel().catch(() => {});
      }
    },
  });
}

export const trainingScheduleClient = createTrainingScheduleClient();
