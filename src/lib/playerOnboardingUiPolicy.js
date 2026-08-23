const DOCUMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;

const LEGAL_DOCUMENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    kind: 'terms',
    title: 'Условия использования',
    acceptanceLabel: 'Принимаю условия этой версии',
    urlKey: 'VITE_ONBOARDING_TERMS_URL',
    versionKey: 'VITE_ONBOARDING_TERMS_VERSION',
  }),
  Object.freeze({
    kind: 'privacy',
    title: 'Политика конфиденциальности',
    acceptanceLabel: 'Подтверждаю ознакомление с этой версией',
    urlKey: 'VITE_ONBOARDING_PRIVACY_URL',
    versionKey: 'VITE_ONBOARDING_PRIVACY_VERSION',
  }),
  Object.freeze({
    kind: 'cancellation',
    title: 'Правила отмены',
    acceptanceLabel: 'Принимаю правила этой версии',
    urlKey: 'VITE_ONBOARDING_CANCELLATION_URL',
    versionKey: 'VITE_ONBOARDING_CANCELLATION_VERSION',
  }),
]);

const INITIAL_LEVEL_SURVEY = Object.freeze({
  version: 'initial_level_v1',
  question: 'Какой у вас опыт игры в падел?',
  answers: Object.freeze([
    Object.freeze({ code: 'beginner', label: 'Начинаю играть' }),
    Object.freeze({
      code: 'intermediate',
      label: 'Играю время от времени',
    }),
    Object.freeze({ code: 'advanced', label: 'Играю регулярно' }),
  ]),
});

function frozen(value) {
  return Object.freeze(value);
}

function readHttpsUrl(value) {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length > 2048
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function readOnboardingLegalConfig(environment = import.meta.env) {
  if (environment?.VITE_ONBOARDING_LEGAL_PUBLISHED !== 'true') {
    return frozen({
      status: 'unavailable',
      reason: 'not_published',
      documents: frozen([]),
    });
  }
  if (environment?.VITE_ONBOARDING_LEGAL_POLICY_ALIGNED !== 'true') {
    return frozen({
      status: 'unavailable',
      reason: 'backend_policy_unaligned',
      documents: frozen([]),
    });
  }

  const documents = [];
  for (const definition of LEGAL_DOCUMENT_DEFINITIONS) {
    const url = readHttpsUrl(environment?.[definition.urlKey]);
    const version = environment?.[definition.versionKey];
    if (
      url === null ||
      typeof version !== 'string' ||
      !DOCUMENT_VERSION_PATTERN.test(version)
    ) {
      return frozen({
        status: 'unavailable',
        reason: 'invalid_configuration',
        documents: frozen([]),
      });
    }
    documents.push(
      frozen({
        kind: definition.kind,
        title: definition.title,
        acceptanceLabel: definition.acceptanceLabel,
        url,
        version,
      }),
    );
  }

  return frozen({
    status: 'ready',
    reason: null,
    documents: frozen(documents),
  });
}

export function legalConsentContract(legalConfig) {
  if (legalConfig?.status !== 'ready') return null;
  return frozen(
    legalConfig.documents.map(({ kind, version }) =>
      frozen({ kind, documentVersion: version }),
    ),
  );
}

export function hasCurrentLegalConsents(onboarding, legalConfig) {
  const expected = legalConsentContract(legalConfig);
  if (expected === null || !Array.isArray(onboarding?.consents)) return false;
  const actualPairs = new Set(
    onboarding.consents.map(
      ({ kind, documentVersion }) => `${kind}\0${documentVersion}`,
    ),
  );
  return expected.every(({ kind, documentVersion }) =>
    actualPairs.has(`${kind}\0${documentVersion}`),
  );
}

export function readOnboardingSurveyDefinition(version) {
  return version === INITIAL_LEVEL_SURVEY.version ? INITIAL_LEVEL_SURVEY : null;
}
