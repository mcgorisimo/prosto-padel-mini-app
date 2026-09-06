import type { TrainingSessionCandidate } from './training-schedule.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const label = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 160 &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

/** Pure, unwired parser of the documented activity/search row. No I/O.
 * https://developers.yclients.com/ru/#operation/api.location.activity.search
 * Callers must separately prove publication, group service scope and stable
 * opaque ID ownership. Successful parsing never grants those permissions.
 */
export function normalizeYclientsTrainingSession(
  value: unknown,
  expectedCompanyId: number,
  opaqueId: string,
): TrainingSessionCandidate | null {
  if (!positiveInteger(expectedCompanyId) || typeof opaqueId !== 'string' || !UUID.test(opaqueId) ||
      !record(value) || value.company_id !== expectedCompanyId || !positiveInteger(value.id) ||
      !positiveInteger(value.service_id) || !positiveInteger(value.staff_id) ||
      !record(value.service) || value.service.id !== value.service_id || !label(value.service.title) ||
      !record(value.staff) || value.staff.id !== value.staff_id || !label(value.staff.name) ||
      !positiveInteger(value.date) || value.date > 253_402_214_399 ||
      !positiveInteger(value.length) || value.length > 86_400) return null;

  const resources = value.resource_instances ?? [];
  if (!Array.isArray(resources) || resources.length > 16 ||
      resources.some((resource: unknown) => !record(resource) || !label(resource.title))) return null;

  // Do not project raw provider IDs, clients, comments, stream links, prices,
  // capacity or records_count (records may each occupy multiple seats).
  return Object.freeze({
    id: opaqueId.toLowerCase(),
    title: value.service.title.trim(),
    coachName: value.staff.name.trim(),
    startsAt: new Date(value.date * 1_000).toISOString(),
    durationSeconds: value.length,
    resourceNames: Object.freeze(resources.map((resource: { title: string }) => resource.title.trim())),
  });
}
