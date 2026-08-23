import { describe, expect, it } from 'vitest';
import {
  hasCurrentLegalConsents,
  legalConsentContract,
  readOnboardingLegalConfig,
  readOnboardingSurveyDefinition,
} from './playerOnboardingUiPolicy';

function publishedEnvironment(overrides = {}) {
  return {
    VITE_ONBOARDING_LEGAL_PUBLISHED: 'true',
    VITE_ONBOARDING_LEGAL_POLICY_ALIGNED: 'true',
    VITE_ONBOARDING_LEGAL_TEST_ONLY: 'false',
    VITE_ONBOARDING_TERMS_URL: 'https://legal.example.test/terms',
    VITE_ONBOARDING_TERMS_VERSION: 'terms-2026-08-26',
    VITE_ONBOARDING_PRIVACY_URL: 'https://legal.example.test/privacy',
    VITE_ONBOARDING_PRIVACY_VERSION: 'privacy-2026-08-26',
    VITE_ONBOARDING_CANCELLATION_URL: 'https://legal.example.test/cancellation',
    VITE_ONBOARDING_CANCELLATION_VERSION: 'cancellation-2026-08-26',
    ...overrides,
  };
}

function testOnlyEnvironment(overrides = {}) {
  return publishedEnvironment({
    VITE_ONBOARDING_LEGAL_TEST_ONLY: 'true',
    VITE_ONBOARDING_TERMS_URL:
      'https://test-app.prostopdl.ru/legal/test-only/terms-test-2026-08-23-v1/',
    VITE_ONBOARDING_TERMS_VERSION: 'terms-test-2026-08-23-v1',
    VITE_ONBOARDING_PRIVACY_URL:
      'https://test-app.prostopdl.ru/legal/test-only/privacy-test-2026-08-23-v1/',
    VITE_ONBOARDING_PRIVACY_VERSION: 'privacy-test-2026-08-23-v1',
    VITE_ONBOARDING_CANCELLATION_URL:
      'https://test-app.prostopdl.ru/legal/test-only/cancellation-test-2026-08-23-v1/',
    VITE_ONBOARDING_CANCELLATION_VERSION:
      'cancellation-test-2026-08-23-v1',
    ...overrides,
  });
}

describe('player onboarding UI policy', () => {
  it('keeps legal drafts unavailable unless publication is explicit', () => {
    expect(readOnboardingLegalConfig({})).toEqual({
      status: 'unavailable',
      reason: 'not_published',
      documents: [],
    });
    expect(
      readOnboardingLegalConfig({
        ...publishedEnvironment(),
        VITE_ONBOARDING_LEGAL_PUBLISHED: 'false',
      }),
    ).toEqual({
      status: 'unavailable',
      reason: 'not_published',
      documents: [],
    });
  });

  it('requires complete HTTPS URLs and versions after publication', () => {
    expect(
      readOnboardingLegalConfig({
        ...publishedEnvironment(),
        VITE_ONBOARDING_LEGAL_POLICY_ALIGNED: 'false',
      }),
    ).toEqual({
      status: 'unavailable',
      reason: 'backend_policy_unaligned',
      documents: [],
    });
    expect(
      readOnboardingLegalConfig(
        publishedEnvironment({ VITE_ONBOARDING_PRIVACY_URL: '/draft' }),
      ),
    ).toEqual({
      status: 'unavailable',
      reason: 'invalid_configuration',
      documents: [],
    });
    expect(
      readOnboardingLegalConfig(
        publishedEnvironment({
          VITE_ONBOARDING_CANCELLATION_VERSION: 'Draft version',
        }),
      ),
    ).toEqual({
      status: 'unavailable',
      reason: 'invalid_configuration',
      documents: [],
    });
  });

  it('builds the exact three-document consent contract from published config', () => {
    const config = readOnboardingLegalConfig(publishedEnvironment());

    expect(config.status).toBe('ready');
    expect(config.scope).toBe('production');
    expect(legalConsentContract(config)).toEqual([
      { kind: 'terms', documentVersion: 'terms-2026-08-26' },
      { kind: 'privacy', documentVersion: 'privacy-2026-08-26' },
      {
        kind: 'cancellation',
        documentVersion: 'cancellation-2026-08-26',
      },
    ]);
    expect(
      hasCurrentLegalConsents(
        {
          consents: [
            {
              kind: 'cancellation',
              documentVersion: 'cancellation-2026-08-26',
            },
            { kind: 'terms', documentVersion: 'terms-2026-08-26' },
            { kind: 'privacy', documentVersion: 'privacy-2026-08-26' },
          ],
        },
        config,
      ),
    ).toBe(true);
    expect(
      hasCurrentLegalConsents(
        {
          consents: [
            { kind: 'terms', documentVersion: 'historical-v1' },
            { kind: 'terms', documentVersion: 'terms-2026-08-26' },
            { kind: 'privacy', documentVersion: 'privacy-2026-08-26' },
            {
              kind: 'cancellation',
              documentVersion: 'cancellation-2026-08-26',
            },
          ],
        },
        config,
      ),
    ).toBe(true);
    expect(
      hasCurrentLegalConsents(
        {
          consents: [
            { kind: 'terms', documentVersion: 'old-version' },
            { kind: 'privacy', documentVersion: 'privacy-2026-08-26' },
            {
              kind: 'cancellation',
              documentVersion: 'cancellation-2026-08-26',
            },
          ],
        },
        config,
      ),
    ).toBe(false);
  });

  it('accepts only exact test-host URLs and visibly versioned test-only documents', () => {
    const config = readOnboardingLegalConfig(testOnlyEnvironment());

    expect(config.status).toBe('ready');
    expect(config.scope).toBe('test_only');
    expect(legalConsentContract(config)).toEqual([
      { kind: 'terms', documentVersion: 'terms-test-2026-08-23-v1' },
      { kind: 'privacy', documentVersion: 'privacy-test-2026-08-23-v1' },
      {
        kind: 'cancellation',
        documentVersion: 'cancellation-test-2026-08-23-v1',
      },
    ]);

    for (const environment of [
      testOnlyEnvironment({
        VITE_ONBOARDING_TERMS_URL:
          'https://app.prostopdl.ru/legal/test-only/terms-test-2026-08-23-v1/',
      }),
      testOnlyEnvironment({
        VITE_ONBOARDING_PRIVACY_URL:
          'https://test-app.prostopdl.ru/legal/test-only/privacy-test-2026-08-23-v2/',
      }),
      testOnlyEnvironment({ VITE_ONBOARDING_LEGAL_TEST_ONLY: 'invalid' }),
      publishedEnvironment({
        VITE_ONBOARDING_TERMS_VERSION: 'terms-test-2026-08-23-v1',
      }),
    ]) {
      expect(readOnboardingLegalConfig(environment)).toEqual({
        status: 'unavailable',
        reason: 'invalid_configuration',
        documents: [],
      });
    }
  });

  it('exposes only the supported versioned level survey', () => {
    expect(readOnboardingSurveyDefinition('initial_level_v1')).toMatchObject({
      version: 'initial_level_v1',
      answers: [
        { code: 'beginner' },
        { code: 'intermediate' },
        { code: 'advanced' },
      ],
    });
    expect(readOnboardingSurveyDefinition('future_level_v2')).toBeNull();
  });
});
