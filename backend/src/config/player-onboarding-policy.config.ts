import { ConfigService } from '@nestjs/config';

export const PLAYER_ONBOARDING_POLICY_CONFIG_KEYS = Object.freeze({
  enabled: 'PLAYER_ONBOARDING_LEGAL_POLICY_ENABLED',
  termsVersion: 'PLAYER_ONBOARDING_TERMS_VERSION',
  privacyVersion: 'PLAYER_ONBOARDING_PRIVACY_VERSION',
  cancellationVersion: 'PLAYER_ONBOARDING_CANCELLATION_VERSION',
} as const);

export const PLAYER_ONBOARDING_DOCUMENT_VERSION_PATTERN =
  /^[a-z0-9][a-z0-9_.-]{0,63}$/u;

export type PlayerOnboardingDocumentVersions = Readonly<{
  terms: string;
  privacy: string;
  cancellation: string;
}>;

export type PlayerOnboardingPolicyConfiguration =
  | Readonly<{ enabled: false; documentVersions: null }>
  | Readonly<{
      enabled: true;
      documentVersions: PlayerOnboardingDocumentVersions;
    }>;

export class PlayerOnboardingPolicyConfigurationError extends Error {
  constructor() {
    super('Invalid player onboarding legal policy configuration');
    this.name = 'PlayerOnboardingPolicyConfigurationError';
  }
}

function readDocumentVersion(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (
    typeof value !== 'string' ||
    !PLAYER_ONBOARDING_DOCUMENT_VERSION_PATTERN.test(value)
  ) {
    throw new PlayerOnboardingPolicyConfigurationError();
  }
  return value;
}

export function readPlayerOnboardingPolicyConfiguration(
  config: ConfigService,
): PlayerOnboardingPolicyConfiguration {
  if (
    config.get<boolean>(PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled) !== true
  ) {
    return Object.freeze({ enabled: false, documentVersions: null });
  }

  return Object.freeze({
    enabled: true,
    documentVersions: Object.freeze({
      terms: readDocumentVersion(
        config,
        PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion,
      ),
      privacy: readDocumentVersion(
        config,
        PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion,
      ),
      cancellation: readDocumentVersion(
        config,
        PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.cancellationVersion,
      ),
    }),
  });
}
