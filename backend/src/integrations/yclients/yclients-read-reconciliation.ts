import type {
  YclientsBoundedAdminRecordsQuery,
  YclientsBoundedAdminRecordsResult,
  YclientsExactAdminRecordResult,
  YclientsSafeAdminRecord,
} from './yclients-admin-read.client';

export interface YclientsAdminRecordReader {
  getRecord(recordId: number): Promise<YclientsExactAdminRecordResult>;
  listRecords(
    query: YclientsBoundedAdminRecordsQuery,
  ): Promise<YclientsBoundedAdminRecordsResult>;
}

type EffectExpectation = Readonly<{
  apiId: number;
  resourceId: number;
  serviceIds: ReadonlyArray<number>;
  datetime: string;
  deleted: boolean;
}>;

export type YclientsKnownRecordExpectation = Readonly<
  EffectExpectation & { recordId: number }
>;

export type YclientsReadbackUnknownReason =
  | 'invalid_expectation'
  | 'disabled'
  | 'unauthorized'
  | 'not_found'
  | 'rejected'
  | 'rate_limited'
  | 'unavailable'
  | 'provider_unknown'
  | 'effect_mismatch'
  | 'no_candidate'
  | 'ambiguous_candidates';

type YclientsUnknownReadback = Readonly<{
  outcome: 'unknown';
  reason: YclientsReadbackUnknownReason;
}>;

export type YclientsKnownRecordReadbackResult =
  | Readonly<{ outcome: 'matched'; record: YclientsSafeAdminRecord }>
  | YclientsUnknownReadback;

export type YclientsBoundedCandidateScanResult =
  | Readonly<{ outcome: 'candidate'; record: YclientsSafeAdminRecord }>
  | YclientsUnknownReadback;

const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validIsoDatetime(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATETIME_PATTERN.test(value)) {
    return false;
  }
  const date = value.slice(0, 10);
  const dateTimestamp = Date.parse(`${date}T00:00:00.000Z`);
  return (
    Number.isFinite(dateTimestamp) &&
    new Date(dateTimestamp).toISOString().slice(0, 10) === date &&
    Number.isFinite(Date.parse(value))
  );
}

function canonicalServiceIds(
  value: unknown,
): ReadonlyArray<number> | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 64 ||
    value.some((serviceId) => !positiveSafeInteger(serviceId)) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return Object.freeze(
    (value as number[]).slice().sort((left, right) => left - right),
  );
}

function validExpectation(
  value: EffectExpectation,
): Readonly<EffectExpectation> | undefined {
  const serviceIds = canonicalServiceIds(value?.serviceIds);
  if (
    !positiveSafeInteger(value?.apiId) ||
    !positiveSafeInteger(value?.resourceId) ||
    serviceIds === undefined ||
    !validIsoDatetime(value?.datetime) ||
    typeof value?.deleted !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    apiId: value.apiId,
    resourceId: value.resourceId,
    serviceIds,
    datetime: value.datetime,
    deleted: value.deleted,
  });
}

function sameEffect(
  record: YclientsSafeAdminRecord,
  expectation: EffectExpectation,
): boolean {
  return (
    record.apiId === expectation.apiId &&
    record.resourceId === expectation.resourceId &&
    record.datetime === expectation.datetime &&
    record.deleted === expectation.deleted &&
    record.serviceIds.length === expectation.serviceIds.length &&
    record.serviceIds.every(
      (serviceId, index) => serviceId === expectation.serviceIds[index],
    )
  );
}

function unknownFromReadOutcome(
  outcome:
    | Exclude<YclientsExactAdminRecordResult['outcome'], 'found'>
    | Exclude<YclientsBoundedAdminRecordsResult['outcome'], 'loaded'>,
): YclientsUnknownReadback {
  switch (outcome) {
    case 'disabled':
    case 'unauthorized':
    case 'not_found':
    case 'rejected':
    case 'rate_limited':
    case 'unavailable':
      return Object.freeze({ outcome: 'unknown' as const, reason: outcome });
    case 'invalid_request':
      return Object.freeze({
        outcome: 'unknown' as const,
        reason: 'invalid_expectation' as const,
      });
    case 'unknown':
      return Object.freeze({
        outcome: 'unknown' as const,
        reason: 'provider_unknown' as const,
      });
  }
}

/** Performs one exact read only. It never falls back to a list or a write. */
export async function reconcileKnownYclientsRecord(
  reader: YclientsAdminRecordReader,
  expectation: YclientsKnownRecordExpectation,
): Promise<YclientsKnownRecordReadbackResult> {
  const effect = validExpectation(expectation);
  if (effect === undefined || !positiveSafeInteger(expectation?.recordId)) {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'invalid_expectation' as const,
    });
  }

  let result: YclientsExactAdminRecordResult;
  try {
    result = await reader.getRecord(expectation.recordId);
  } catch {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'unavailable' as const,
    });
  }
  if (result.outcome !== 'found') {
    return unknownFromReadOutcome(result.outcome);
  }
  return result.record.recordId === expectation.recordId &&
    sameEffect(result.record, effect)
    ? Object.freeze({ outcome: 'matched' as const, record: result.record })
    : Object.freeze({
        outcome: 'unknown' as const,
        reason: 'effect_mismatch' as const,
      });
}

/** Performs one caller-bounded page read only; api_id is compared locally. */
export async function scanBoundedYclientsCandidates(
  reader: YclientsAdminRecordReader,
  query: YclientsBoundedAdminRecordsQuery,
  expectation: EffectExpectation,
): Promise<YclientsBoundedCandidateScanResult> {
  const effect = validExpectation(expectation);
  if (effect === undefined) {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'invalid_expectation' as const,
    });
  }

  let result: YclientsBoundedAdminRecordsResult;
  try {
    result = await reader.listRecords(query);
  } catch {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'unavailable' as const,
    });
  }
  if (result.outcome !== 'loaded') {
    return unknownFromReadOutcome(result.outcome);
  }
  const referenceMatches = result.records.filter(
    (record) => record.apiId === effect.apiId,
  );
  if (referenceMatches.length === 0) {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'no_candidate' as const,
    });
  }
  if (referenceMatches.length !== 1) {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'ambiguous_candidates' as const,
    });
  }
  const candidate = referenceMatches[0];
  return sameEffect(candidate, effect)
    ? Object.freeze({ outcome: 'candidate' as const, record: candidate })
    : Object.freeze({
        outcome: 'unknown' as const,
        reason: 'effect_mismatch' as const,
      });
}
