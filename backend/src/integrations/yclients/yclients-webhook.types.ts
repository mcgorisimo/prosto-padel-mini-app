export type YclientsRecordEventType = 'create' | 'update' | 'delete';

export interface YclientsRecordWebhookSignal {
  readonly companyId: number;
  readonly recordId: number;
  readonly eventType: YclientsRecordEventType;
  readonly receivedAt: number;
}

export function isYclientsPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isYclientsRecordEventType(
  value: unknown,
): value is YclientsRecordEventType {
  return value === 'create' || value === 'update' || value === 'delete';
}
