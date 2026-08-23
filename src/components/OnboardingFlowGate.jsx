import { useEffect, useMemo, useRef, useState } from 'react';
import OnboardingProfileGate from './OnboardingProfileGate';
import {
  hasCurrentLegalConsents,
  legalConsentContract,
  readOnboardingLegalConfig,
  readOnboardingSurveyDefinition,
} from '../lib/playerOnboardingUiPolicy';

function OnboardingShell({ testId, title, intro, children }) {
  return (
    <main className="onboarding-profile-screen" data-testid={testId}>
      <section
        className="onboarding-profile-card"
        aria-labelledby={`${testId}-title`}
      >
        <p className="onboarding-profile-eyebrow">Просто Падел</p>
        <h1 id={`${testId}-title`}>{title}</h1>
        <p className="onboarding-profile-intro">{intro}</p>
        {children}
      </section>
    </main>
  );
}

function LegalUnavailableGate() {
  return (
    <OnboardingShell
      testId="onboarding-legal-unavailable-gate"
      title="Документы готовятся"
      intro="Условия, политика конфиденциальности и правила отмены ещё не опубликованы. Продолжение станет доступно после публикации утверждённых документов."
    >
      <p className="onboarding-profile-declared-note" role="status">
        Черновики не используются для принятия согласий. Ваш профиль уже
        сохранён, и этот шаг откроется при следующем запуске.
      </p>
    </OnboardingShell>
  );
}

function TestOnlyLegalNotice({ legalConfig }) {
  if (legalConfig.scope !== 'test_only') return null;
  return (
    <aside
      className="onboarding-legal-test-only-note"
      aria-label="Временные документы тестового контура"
    >
      Тестовый контур: это временные версии документов, не публикация для
      production. Новые версии нельзя считать принятыми без отдельного
      повторного согласия.
    </aside>
  );
}

function OnboardingConsentsGate({
  onboarding,
  legalConfig,
  onReload,
  onAdvance,
}) {
  const [accepted, setAccepted] = useState({});
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const checkboxRefs = useRef(new Map());
  const consents = useMemo(
    () => legalConsentContract(legalConfig),
    [legalConfig],
  );

  useEffect(() => {
    setAccepted({});
    setNotice(null);
  }, [onboarding.revision]);

  if (consents === null) return <LegalUnavailableGate />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const firstMissing = legalConfig.documents.find(
      ({ kind }) => accepted[kind] !== true,
    );
    if (firstMissing) {
      setNotice({
        tone: 'error',
        kind: 'validation',
        message: 'Подтвердите ознакомление со всеми тремя документами.',
      });
      queueMicrotask(() =>
        checkboxRefs.current.get(firstMissing.kind)?.focus(),
      );
      return;
    }

    setSubmitting(true);
    setNotice(null);
    try {
      const result = await onAdvance({
        expectedRevision: onboarding.revision,
        flowVersion: onboarding.flowVersion,
        nextStep: 'level_survey',
        consents,
      });
      if (result.outcome === 'advanced' || result.outcome === 'cancelled') {
        return;
      }
      if (result.outcome === 'reconciled') {
        setNotice({
          tone: 'warning',
          message:
            'На сервере уже есть более новая версия анкеты. Проверьте текущий шаг.',
        });
        return;
      }
      setNotice({
        tone: 'error',
        message:
          result.reason === 'conflict'
            ? 'На сервере сохранён другой набор документов. Обновите анкету перед продолжением.'
            : 'Не удалось сохранить согласия. Обновите анкету и попробуйте снова.',
        canReload: true,
      });
    } catch {
      setNotice({
        tone: 'error',
        message: 'Не удалось сохранить согласия. Попробуйте снова позже.',
        canReload: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReload = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onReload();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingShell
      testId="onboarding-consents-gate"
      title="Документы и согласия"
      intro="Откройте и прочитайте каждый опубликованный документ, затем подтвердите принятие условий и ознакомление с политикой."
    >
      <p className="onboarding-step-indicator">Шаг 2 из 3</p>
      <TestOnlyLegalNotice legalConfig={legalConfig} />
      <form
        noValidate
        aria-describedby={
          notice?.kind === 'validation'
            ? 'onboarding-consents-notice'
            : undefined
        }
        onSubmit={handleSubmit}
      >
        <div className="onboarding-legal-list">
          {legalConfig.documents.map((document) => {
            const inputId = `onboarding-consent-${document.kind}`;
            return (
              <section className="onboarding-legal-item" key={document.kind}>
                <a
                  className="onboarding-legal-link"
                  href={document.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{document.title}</span>
                  <small>Версия {document.version}</small>
                </a>
                <label className="onboarding-consent-check" htmlFor={inputId}>
                  <input
                    ref={(element) => {
                      if (element)
                        checkboxRefs.current.set(document.kind, element);
                    }}
                    id={inputId}
                    type="checkbox"
                    required
                    aria-required="true"
                    aria-invalid={notice?.kind === 'validation'}
                    aria-describedby={
                      notice?.kind === 'validation'
                        ? 'onboarding-consents-notice'
                        : undefined
                    }
                    aria-label={`${document.acceptanceLabel}: ${document.title}, версия ${document.version}`}
                    checked={accepted[document.kind] === true}
                    onChange={(event) => {
                      setAccepted((previous) => ({
                        ...previous,
                        [document.kind]: event.target.checked,
                      }));
                      setNotice(null);
                    }}
                  />
                  <span>{document.acceptanceLabel}</span>
                </label>
              </section>
            );
          })}
        </div>

        {notice && (
          <div
            id="onboarding-consents-notice"
            className={`onboarding-profile-notice onboarding-profile-notice--${notice.tone}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          >
            <span>{notice.message}</span>
            {notice.canReload && (
              <button
                type="button"
                className="onboarding-profile-reload"
                onClick={handleReload}
                disabled={submitting}
              >
                Обновить анкету
              </button>
            )}
          </div>
        )}

        <button
          type="submit"
          className="onboarding-profile-submit"
          disabled={submitting}
        >
          {submitting ? 'Сохраняем…' : 'Продолжить'}
        </button>
      </form>
    </OnboardingShell>
  );
}

function OnboardingSurveyGate({
  onboarding,
  legalConfig,
  onReload,
  onComplete,
}) {
  const [answer, setAnswer] = useState('');
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const firstAnswerRef = useRef(null);
  const survey = readOnboardingSurveyDefinition(onboarding.surveyVersion);
  const consents = legalConsentContract(legalConfig);
  const canComplete =
    survey !== null &&
    consents !== null &&
    hasCurrentLegalConsents(onboarding, legalConfig);

  useEffect(() => {
    setAnswer('');
    setNotice(null);
  }, [onboarding.revision]);

  if (!canComplete) {
    return (
      <OnboardingShell
        testId="onboarding-completion-unavailable-gate"
        title="Продолжение недоступно"
        intro="Для завершения нужны опубликованные документы актуальных версий и поддерживаемая версия опроса."
      >
        <TestOnlyLegalNotice legalConfig={legalConfig} />
        <p className="onboarding-profile-declared-note" role="alert">
          Анкета сохранена. Мы не будем отправлять ответы или завершать
          onboarding, пока конфигурация документов не станет актуальной.
        </p>
      </OnboardingShell>
    );
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!survey.answers.some(({ code }) => code === answer)) {
      setNotice({
        tone: 'error',
        kind: 'validation',
        message: 'Выберите один вариант.',
      });
      queueMicrotask(() => firstAnswerRef.current?.focus());
      return;
    }

    setSubmitting(true);
    setNotice(null);
    try {
      const result = await onComplete({
        expectedRevision: onboarding.revision,
        flowVersion: onboarding.flowVersion,
        consents,
        survey: {
          version: survey.version,
          answers: { experience: answer },
        },
      });
      if (result.outcome === 'completed' || result.outcome === 'cancelled') {
        return;
      }
      if (result.outcome === 'reconciled') {
        setNotice({
          tone: 'warning',
          message:
            'На сервере уже есть более новая версия анкеты. Проверьте текущий шаг.',
        });
        return;
      }
      setNotice({
        tone: 'error',
        message:
          result.reason === 'conflict'
            ? 'Этот запрос отличается от уже обработанного. Обновите анкету перед повтором.'
            : 'Не удалось завершить анкету. Обновите данные и попробуйте снова.',
        canReload: true,
      });
    } catch {
      setNotice({
        tone: 'error',
        message: 'Не удалось завершить анкету. Попробуйте снова позже.',
        canReload: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReload = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onReload();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingShell
      testId="onboarding-level-survey-gate"
      title="Ваш начальный уровень"
      intro="Ответ поможет подобрать подходящие матчи. Рейтинг и верификация контактов этим ответом не подтверждаются."
    >
      <p className="onboarding-step-indicator">Шаг 3 из 3</p>
      <TestOnlyLegalNotice legalConfig={legalConfig} />
      <form noValidate onSubmit={handleSubmit}>
        <fieldset
          className="onboarding-survey-fieldset"
          aria-required="true"
          aria-invalid={notice?.kind === 'validation'}
          aria-describedby={
            notice?.kind === 'validation'
              ? 'onboarding-survey-notice'
              : undefined
          }
        >
          <legend>{survey.question} *</legend>
          {survey.answers.map((option, index) => (
            <label className="onboarding-survey-option" key={option.code}>
              <input
                ref={index === 0 ? firstAnswerRef : undefined}
                type="radio"
                required
                aria-required="true"
                name="onboarding-experience"
                value={option.code}
                checked={answer === option.code}
                onChange={(event) => {
                  setAnswer(event.target.value);
                  setNotice(null);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        {notice && (
          <div
            id="onboarding-survey-notice"
            className={`onboarding-profile-notice onboarding-profile-notice--${notice.tone}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          >
            <span>{notice.message}</span>
            {notice.canReload && (
              <button
                type="button"
                className="onboarding-profile-reload"
                onClick={handleReload}
                disabled={submitting}
              >
                Обновить анкету
              </button>
            )}
          </div>
        )}

        <button
          type="submit"
          className="onboarding-profile-submit"
          disabled={submitting}
        >
          {submitting ? 'Завершаем…' : 'Завершить настройку'}
        </button>
      </form>
    </OnboardingShell>
  );
}

export default function OnboardingFlowGate({
  onboarding,
  legalConfig = readOnboardingLegalConfig(),
  onReload,
  onSaveProfile,
  onAdvance,
  onComplete,
}) {
  if (
    onboarding.currentStep === 'profile' ||
    onboarding.currentStep === 'contacts'
  ) {
    const saveAndAdvance = async (draft) => {
      const saved = await onSaveProfile(draft);
      if (saved.outcome !== 'saved') return saved;
      const savedState = saved.onboarding;
      const advanced = await onAdvance({
        expectedRevision: savedState.revision,
        flowVersion: savedState.flowVersion,
        nextStep: 'consents',
      });
      return advanced.outcome === 'advanced'
        ? Object.freeze({
            outcome: 'advanced',
            onboarding: advanced.onboarding,
          })
        : advanced.outcome === 'reconciled' || advanced.outcome === 'cancelled'
          ? advanced
          : Object.freeze({
              ...advanced,
              profileSaved: true,
            });
    };
    return (
      <OnboardingProfileGate
        onboarding={onboarding}
        onReload={onReload}
        onSave={saveAndAdvance}
      />
    );
  }
  if (onboarding.currentStep === 'consents') {
    return (
      <OnboardingConsentsGate
        onboarding={onboarding}
        legalConfig={legalConfig}
        onReload={onReload}
        onAdvance={onAdvance}
      />
    );
  }
  if (onboarding.currentStep === 'level_survey') {
    return (
      <OnboardingSurveyGate
        onboarding={onboarding}
        legalConfig={legalConfig}
        onReload={onReload}
        onComplete={onComplete}
      />
    );
  }
  return null;
}
