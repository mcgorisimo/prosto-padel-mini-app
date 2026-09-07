export const TRAINING_SCHEDULE_POLICY = Object.freeze({
  companyId: 2_079_564,
  serviceIds: Object.freeze([30_920_295] as const),
  horizonDays: 7,
  maximumSessions: 8,
  cacheTtlMilliseconds: 5 * 60_000,
  failureCacheTtlMilliseconds: 30_000,
  timezone: 'Europe/Moscow',
  opaqueIdNamespace: 'prosto-padel:group-training:v1',
});
