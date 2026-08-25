import { ConfigService } from '@nestjs/config';
import {
  PLAYER_ONBOARDING_POLICY_CONFIG_KEYS,
  PlayerOnboardingPolicyConfigurationError,
  readPlayerOnboardingPolicyConfiguration,
} from './player-onboarding-policy.config';

const TEST_ONLY_VERSIONS = Object.freeze({
  [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion]:
    'terms-test-2026-08-23-v1',
  [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion]:
    'privacy-test-2026-08-23-v1',
  [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.cancellationVersion]:
    'cancellation-test-2026-08-23-v1',
  [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.personalDataProcessingVersion]:
    'personal-data-consent-test-2026-08-23-v1',
});

describe('player onboarding policy configuration', () => {
  it('stays fail-closed with no legal policy values', () => {
    expect(
      readPlayerOnboardingPolicyConfiguration(new ConfigService({})),
    ).toEqual({ enabled: false, documentVersions: null });
  });

  it('reads the exact enabled four-document version contract', () => {
    const configuration = readPlayerOnboardingPolicyConfiguration(
      new ConfigService({
        [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled]: true,
        ...TEST_ONLY_VERSIONS,
      }),
    );

    expect(configuration).toEqual({
      enabled: true,
      documentVersions: {
        terms: 'terms-test-2026-08-23-v1',
        privacy: 'privacy-test-2026-08-23-v1',
        cancellation: 'cancellation-test-2026-08-23-v1',
        personalDataProcessing: 'personal-data-consent-test-2026-08-23-v1',
      },
    });
  });

  it.each([
    [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion, undefined],
    [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.termsVersion, ''],
    [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.privacyVersion, 'Draft version'],
    [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.cancellationVersion, '../current'],
    [
      PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.personalDataProcessingVersion,
      'Consent version',
    ],
  ])(
    'rejects invalid enabled version key %s without returning values',
    (key, value) => {
      expect(() =>
        readPlayerOnboardingPolicyConfiguration(
          new ConfigService({
            [PLAYER_ONBOARDING_POLICY_CONFIG_KEYS.enabled]: true,
            ...TEST_ONLY_VERSIONS,
            [key]: value,
          }),
        ),
      ).toThrow(PlayerOnboardingPolicyConfigurationError);
    },
  );
});
