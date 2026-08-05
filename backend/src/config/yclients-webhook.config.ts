import { ConfigService } from '@nestjs/config';

export const YCLIENTS_WEBHOOK_CONFIG_KEYS = Object.freeze({
  enabled: 'YCLIENTS_WEBHOOK_ENABLED',
  companyId: 'YCLIENTS_COMPANY_ID',
} as const);

export interface YclientsWebhookConfiguration {
  readonly enabled: boolean;
  readonly companyId: number | undefined;
}

export function readYclientsWebhookConfiguration(
  config: ConfigService,
): YclientsWebhookConfiguration {
  const enabled =
    config.get<boolean>(YCLIENTS_WEBHOOK_CONFIG_KEYS.enabled) === true;
  const companyId = config.get<number>(YCLIENTS_WEBHOOK_CONFIG_KEYS.companyId);

  return Object.freeze({
    enabled,
    companyId:
      Number.isSafeInteger(companyId) && (companyId ?? 0) > 0
        ? companyId
        : undefined,
  });
}
