import type { YclientsControlledLoadedIdentity } from './yclients-controlled-operational-plan';
import { YCLIENTS_CONTROLLED_IDENTITY_BINDING } from './yclients-controlled-operational-plan';
import {
  createYclientsControlledCleanupPlanDigest,
  YclientsControlledCleanupRunnerPlan,
} from './yclients-controlled-cleanup-runner';

export const YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST =
  '83a904bd7b04ba8f5565cf7ce01a41e365c49ed9466f84cc109341ee225b4532';

export function buildYclientsControlledCleanupOperationalPlan(
  identity: YclientsControlledLoadedIdentity,
): YclientsControlledCleanupRunnerPlan {
  const plan: YclientsControlledCleanupRunnerPlan = Object.freeze({
    planVersion: 1,
    planId: 'd2-cleanup-record-1891713981',
    companyId: 2_079_564,
    identityBinding: YCLIENTS_CONTROLLED_IDENTITY_BINDING,
    lifecycle: Object.freeze({
      companyId: 2_079_564,
      recordId: 1_891_713_981,
      appointmentId: 1,
      apiId: 184_993_463_877_968,
      identityBinding: YCLIENTS_CONTROLLED_IDENTITY_BINDING,
      client: identity.clientForPlan(),
      slotA: Object.freeze({
        alias: 'A' as const,
        serviceId: 30_539_679,
        resourceId: 5_730_531,
        datetime: '2026-08-17T12:00:00+03:00',
      }),
      deletedListA: Object.freeze({
        page: 1,
        count: 50,
        resourceId: 5_730_531,
        dateFrom: '2026-08-17',
        dateTo: '2026-08-17',
        withDeleted: true,
      }),
    }),
  });
  if (
    createYclientsControlledCleanupPlanDigest(plan) !==
    YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST
  ) {
    throw new TypeError('Controlled cleanup plan integrity failure');
  }
  return plan;
}
