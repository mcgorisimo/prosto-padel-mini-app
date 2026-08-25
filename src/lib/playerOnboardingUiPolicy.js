const DOCUMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;
const TEST_ONLY_LEGAL_HOST = 'test-app.prostopdl.ru';
const TEST_ONLY_LEGAL_PATH_PREFIX = '/legal/test-only/';

const LEGAL_DOCUMENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    kind: 'terms',
    title: 'Условия использования',
    testOnlyVersionPrefix: 'terms-test-',
    urlKey: 'VITE_ONBOARDING_TERMS_URL',
    versionKey: 'VITE_ONBOARDING_TERMS_VERSION',
  }),
  Object.freeze({
    kind: 'cancellation',
    title: 'Правила отмены',
    testOnlyVersionPrefix: 'cancellation-test-',
    urlKey: 'VITE_ONBOARDING_CANCELLATION_URL',
    versionKey: 'VITE_ONBOARDING_CANCELLATION_VERSION',
  }),
  Object.freeze({
    kind: 'privacy',
    title: 'Политика конфиденциальности',
    testOnlyVersionPrefix: 'privacy-test-',
    urlKey: 'VITE_ONBOARDING_PRIVACY_URL',
    versionKey: 'VITE_ONBOARDING_PRIVACY_VERSION',
  }),
  Object.freeze({
    kind: 'personal_data_processing',
    title: 'Согласие на обработку персональных данных',
    testOnlyVersionPrefix: 'personal-data-consent-test-',
    urlKey: 'VITE_ONBOARDING_PERSONAL_DATA_CONSENT_URL',
    versionKey: 'VITE_ONBOARDING_PERSONAL_DATA_CONSENT_VERSION',
  }),
]);

const CONSENT_EVIDENCE_KINDS = Object.freeze([
  'cancellation',
  'personal_data_processing',
  'terms',
]);

const INITIAL_LEVEL_SURVEY = Object.freeze({
  version: 'initial_level_v2',
  questions: Object.freeze([
    Object.freeze({
      code: 'match_count',
      question: 'Сколько матчей в падел вы сыграли?',
      answers: Object.freeze([
        Object.freeze({ code: 'none', label: 'Пока не играл(а)' }),
        Object.freeze({ code: 'one_to_ten', label: '1–10 матчей' }),
        Object.freeze({ code: 'eleven_to_thirty', label: '11–30 матчей' }),
        Object.freeze({
          code: 'thirty_one_to_ninety_nine',
          label: '31–99 матчей',
        }),
        Object.freeze({
          code: 'one_hundred_plus',
          label: '100 матчей и больше',
        }),
      ]),
    }),
    Object.freeze({
      code: 'rally_stability',
      question: 'Насколько стабильно вы поддерживаете розыгрыш?',
      answers: Object.freeze([
        Object.freeze({
          code: 'learning_contact',
          label: 'Учусь уверенно попадать по мячу',
        }),
        Object.freeze({
          code: 'short_rallies',
          label: 'Поддерживаю короткие розыгрыши',
        }),
        Object.freeze({
          code: 'steady_slow',
          label: 'Стабильно играю в спокойном темпе',
        }),
        Object.freeze({
          code: 'steady_under_pressure',
          label: 'Сохраняю стабильность под давлением',
        }),
        Object.freeze({
          code: 'controls_pace',
          label: 'Контролирую темп и направление розыгрыша',
        }),
      ]),
    }),
    Object.freeze({
      code: 'glass_play',
      question: 'Как вы играете мяч после отскока от стекла?',
      answers: Object.freeze([
        Object.freeze({ code: 'not_used', label: 'Пока не играю от стекла' }),
        Object.freeze({
          code: 'rarely_returns',
          label: 'Редко возвращаю мяч после стекла',
        }),
        Object.freeze({
          code: 'basic_returns',
          label: 'Возвращаю простые мячи после стекла',
        }),
        Object.freeze({
          code: 'confident_returns',
          label: 'Уверенно играю большинство мячей от стекла',
        }),
        Object.freeze({
          code: 'uses_tactically',
          label: 'Использую стекло тактически',
        }),
      ]),
    }),
    Object.freeze({
      code: 'serve_return_net',
      question: 'Как вы оцениваете подачу, приём и игру у сетки?',
      answers: Object.freeze([
        Object.freeze({
          code: 'learning_basics',
          label: 'Осваиваю основные удары',
        }),
        Object.freeze({
          code: 'inconsistent',
          label: 'Получается нестабильно',
        }),
        Object.freeze({
          code: 'stable_basics',
          label: 'Стабильно выполняю базовые действия',
        }),
        Object.freeze({
          code: 'confident_patterns',
          label: 'Уверенно разыгрываю типовые ситуации',
        }),
        Object.freeze({
          code: 'advanced_patterns',
          label: 'Использую продвинутые игровые комбинации',
        }),
      ]),
    }),
    Object.freeze({
      code: 'match_experience_year',
      question: 'Какой у вас матчевый опыт за последний год?',
      answers: Object.freeze([
        Object.freeze({
          code: 'none',
          label: 'Не играл(а) матчей за последний год',
        }),
        Object.freeze({
          code: 'casual_few',
          label: 'Несколько дружеских матчей',
        }),
        Object.freeze({
          code: 'regular_social',
          label: 'Регулярные любительские матчи',
        }),
        Object.freeze({
          code: 'league_or_club',
          label: 'Клубная лига или соревнования',
        }),
        Object.freeze({ code: 'tournament', label: 'Турниры' }),
      ]),
    }),
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

  const testOnlyValue = environment?.VITE_ONBOARDING_LEGAL_TEST_ONLY ?? 'false';
  if (testOnlyValue !== 'true' && testOnlyValue !== 'false') {
    return frozen({
      status: 'unavailable',
      reason: 'invalid_configuration',
      documents: frozen([]),
    });
  }
  const scope = testOnlyValue === 'true' ? 'test_only' : 'production';

  const documents = [];
  const documentUrls = new Set();
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
    const parsedUrl = new URL(url);
    const versionIsPathSegment = parsedUrl.pathname
      .split('/')
      .some((segment) => segment === version);
    const isTestOnlyVersion = version.startsWith(
      definition.testOnlyVersionPrefix,
    );
    const isTestOnlyUrl =
      parsedUrl.hostname === TEST_ONLY_LEGAL_HOST &&
      parsedUrl.port === '' &&
      parsedUrl.search === '' &&
      parsedUrl.pathname === `${TEST_ONLY_LEGAL_PATH_PREFIX}${version}/`;
    if (
      (scope === 'test_only' && (!isTestOnlyVersion || !isTestOnlyUrl)) ||
      (scope === 'production' &&
        (isTestOnlyVersion ||
          isTestOnlyUrl ||
          parsedUrl.search !== '' ||
          !versionIsPathSegment)) ||
      documentUrls.has(url)
    ) {
      return frozen({
        status: 'unavailable',
        reason: 'invalid_configuration',
        documents: frozen([]),
      });
    }
    documentUrls.add(url);
    documents.push(
      frozen({
        kind: definition.kind,
        title: definition.title,
        url,
        version,
      }),
    );
  }

  return frozen({
    status: 'ready',
    reason: null,
    scope,
    documents: frozen(documents),
  });
}

export function legalConsentContract(legalConfig) {
  if (legalConfig?.status !== 'ready') return null;
  return frozen(
    CONSENT_EVIDENCE_KINDS.map((kind) => {
      const document = legalConfig.documents.find(
        (candidate) => candidate.kind === kind,
      );
      return frozen({ kind, documentVersion: document.version });
    }),
  );
}

export function currentLegalConsentGroups(onboarding, legalConfig) {
  const expected = legalConsentContract(legalConfig);
  if (expected === null || !Array.isArray(onboarding?.consents)) return null;
  const actualPairs = new Set(
    onboarding.consents.map(
      ({ kind, documentVersion }) => `${kind}\0${documentVersion}`,
    ),
  );
  const hasKind = (kind) => {
    const required = expected.find((consent) => consent.kind === kind);
    return actualPairs.has(`${required.kind}\0${required.documentVersion}`);
  };
  return frozen({
    offer: hasKind('terms') && hasKind('cancellation'),
    personalDataProcessing: hasKind('personal_data_processing'),
  });
}

export function hasCurrentLegalConsents(onboarding, legalConfig) {
  const groups = currentLegalConsentGroups(onboarding, legalConfig);
  return groups?.offer === true && groups.personalDataProcessing === true;
}

export function readOnboardingSurveyDefinition(version) {
  return version === INITIAL_LEVEL_SURVEY.version ? INITIAL_LEVEL_SURVEY : null;
}
