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

function LegalUnavailableNotice() {
  return (
    <div
      id="onboarding-legal-readiness"
      className="onboarding-legal-unavailable-note"
      data-testid="onboarding-legal-unavailable-note"
      role="status"
    >
      Документы ещё не опубликованы или не согласованы с backend policy.
      Черновики не используются для принятия согласий, поэтому продолжение пока
      недоступно.
    </div>
  );
}

function TestOnlyLegalNotice({ legalConfig }) {
  if (legalConfig.scope !== 'test_only') return null;
  return (
    <aside
      className="onboarding-legal-test-only-note"
      aria-label="Временные документы тестового контура"
    >
      Тестовый контур: временные версии, не публикация для production.
    </aside>
  );
}

function OnboardingIdentityGate({
  onboarding,
  legalConfig,
  onReload,
  onSaveProfile,
  onAdvance,
}) {
  const [accepted, setAccepted] = useState({});
  const consents = useMemo(
    () => legalConsentContract(legalConfig),
    [legalConfig],
  );
  const allAccepted =
    consents !== null &&
    legalConfig.documents.every(({ kind }) => accepted[kind] === true);

  useEffect(() => {
    setAccepted({});
  }, [onboarding.revision]);

  const withSavedProfile = (result) =>
    result.outcome === 'reconciled' || result.outcome === 'cancelled'
      ? result
      : Object.freeze({ ...result, profileSaved: true });

  const saveAndAdvance = async (draft) => {
    if (consents === null || !allAccepted) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'legal_consents_required',
      });
    }

    const saved = await onSaveProfile(draft);
    if (saved.outcome !== 'saved') return saved;
    let current = saved.onboarding;

    if (
      current.currentStep === 'profile' ||
      current.currentStep === 'contacts'
    ) {
      const consentStep = await onAdvance({
        expectedRevision: current.revision,
        flowVersion: current.flowVersion,
        nextStep: 'consents',
      });
      if (consentStep.outcome !== 'advanced') {
        return withSavedProfile(consentStep);
      }
      current = consentStep.onboarding;
    }

    if (current.currentStep !== 'consents') {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'conflict',
        profileSaved: true,
      });
    }

    const surveyStep = await onAdvance({
      expectedRevision: current.revision,
      flowVersion: current.flowVersion,
      nextStep: 'level_survey',
      consents,
    });
    return surveyStep.outcome === 'advanced'
      ? surveyStep
      : withSavedProfile(surveyStep);
  };

  const renderLegalControls = ({ submitting }) => (
    <section
      className="onboarding-profile-consents"
      aria-labelledby="onboarding-consents-title"
    >
      <h2 id="onboarding-consents-title">Обязательные согласия</h2>
      {consents === null ? (
        <LegalUnavailableNotice />
      ) : (
        <>
          <TestOnlyLegalNotice legalConfig={legalConfig} />
          <fieldset className="onboarding-consent-list" disabled={submitting}>
            <legend>Откройте документы и отметьте все три пункта *</legend>
            {legalConfig.documents.map((document) => {
              const inputId = `onboarding-consent-${document.kind}`;
              return (
                <div className="onboarding-consent-row" key={document.kind}>
                  <label
                    className="onboarding-consent-toggle"
                    htmlFor={inputId}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      required
                      aria-required="true"
                      aria-label={`${document.acceptanceLabel}: ${document.title}, версия ${document.version}`}
                      checked={accepted[document.kind] === true}
                      onChange={(event) => {
                        setAccepted((previous) => ({
                          ...previous,
                          [document.kind]: event.target.checked,
                        }));
                      }}
                    />
                  </label>
                  <a
                    className="onboarding-legal-link"
                    href={document.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{document.title}</span>
                    <small>Версия {document.version}</small>
                  </a>
                </div>
              );
            })}
          </fieldset>
          <p
            id="onboarding-legal-readiness"
            className="onboarding-consent-hint"
          >
            {allAccepted
              ? 'Все три согласия отмечены.'
              : 'Продолжение станет доступно после заполнения профиля и трёх согласий.'}
          </p>
        </>
      )}
    </section>
  );

  return (
    <OnboardingProfileGate
      onboarding={onboarding}
      onReload={onReload}
      onSave={saveAndAdvance}
      title="Давайте познакомимся"
      intro="Заполните личные данные, ознакомьтесь с документами и подтвердите обязательные согласия."
      stepIndicator="Шаг 1 из 2"
      supplementalContent={renderLegalControls}
      submitLabel="Продолжить"
      submittingLabel="Сохраняем и продолжаем…"
      submitReady={allAccepted}
      disableUntilValid
      submitDescriptionId="onboarding-legal-readiness"
    />
  );
}

function OnboardingSurveyGate({
  onboarding,
  legalConfig,
  onReload,
  onComplete,
  onEnterApp,
}) {
  const survey = readOnboardingSurveyDefinition(onboarding.surveyVersion);
  const initialProgress = useMemo(() => {
    const answers = {};
    if (survey === null) return { answers, questionIndex: 0 };
    for (const question of survey.questions) {
      const persistedAnswer = onboarding.surveyAnswers?.[question.code];
      if (question.answers.some(({ code }) => code === persistedAnswer)) {
        answers[question.code] = persistedAnswer;
      }
    }
    const firstUnanswered = survey.questions.findIndex(
      ({ code }) => answers[code] === undefined,
    );
    return {
      answers,
      questionIndex:
        firstUnanswered === -1
          ? Math.max(survey.questions.length - 1, 0)
          : firstUnanswered,
    };
  }, [onboarding.surveyAnswers, survey]);
  const [answers, setAnswers] = useState(initialProgress.answers);
  const [questionIndex, setQuestionIndex] = useState(
    initialProgress.questionIndex,
  );
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [completedOnboarding, setCompletedOnboarding] = useState(null);
  const [shouldFocusQuestion, setShouldFocusQuestion] = useState(false);
  const firstAnswerRef = useRef(null);
  const questionTitleRef = useRef(null);
  const consents = legalConsentContract(legalConfig);
  const canComplete =
    survey !== null &&
    consents !== null &&
    hasCurrentLegalConsents(onboarding, legalConfig);

  useEffect(() => {
    setAnswers(initialProgress.answers);
    setQuestionIndex(initialProgress.questionIndex);
    setNotice(null);
    setCompletedOnboarding(null);
  }, [initialProgress]);

  useEffect(() => {
    if (!shouldFocusQuestion) return;
    questionTitleRef.current?.focus();
    setShouldFocusQuestion(false);
  }, [questionIndex, shouldFocusQuestion]);

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

  if (completedOnboarding !== null) {
    return (
      <OnboardingShell
        testId="onboarding-initial-level-result-gate"
        title="Анкета завершена"
        intro="Можно переходить в приложение."
      >
        <p
          className="onboarding-initial-level-result"
          data-testid="onboarding-initial-level-result"
          role="status"
        >
          Ваш начальный уровень:{' '}
          <strong>{completedOnboarding.initialLevelLabel}</strong>
        </p>
        <button
          type="button"
          className="onboarding-profile-submit"
          onClick={() => onEnterApp(completedOnboarding)}
        >
          Перейти в приложение
        </button>
      </OnboardingShell>
    );
  }

  const currentQuestion = survey.questions[questionIndex];
  const currentAnswer = answers[currentQuestion.code];
  const isLastQuestion = questionIndex === survey.questions.length - 1;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (
      !currentQuestion.answers.some(({ code }) => code === currentAnswer)
    ) {
      setNotice({
        tone: 'error',
        kind: 'validation',
        message: 'Выберите один вариант.',
      });
      queueMicrotask(() => firstAnswerRef.current?.focus());
      return;
    }

    if (!isLastQuestion) {
      setQuestionIndex((previous) => previous + 1);
      setNotice(null);
      setShouldFocusQuestion(true);
      return;
    }

    const completedAnswers = Object.fromEntries(
      survey.questions.map(({ code }) => [code, answers[code]]),
    );
    if (
      survey.questions.some(
        (question) =>
          !question.answers.some(
            ({ code }) => code === completedAnswers[question.code],
          ),
      )
    ) {
      const firstUnanswered = survey.questions.findIndex(
        (question) =>
          !question.answers.some(
            ({ code }) => code === completedAnswers[question.code],
          ),
      );
      setQuestionIndex(Math.max(firstUnanswered, 0));
      setNotice({
        tone: 'error',
        kind: 'validation',
        message: 'Ответьте на каждый вопрос.',
      });
      setShouldFocusQuestion(true);
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
          answers: completedAnswers,
        },
      });
      if (result.outcome === 'completed') {
        setCompletedOnboarding(result.onboarding);
        return;
      }
      if (result.outcome === 'cancelled') {
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

  const handleBack = () => {
    if (submitting || questionIndex === 0) return;
    setQuestionIndex((previous) => previous - 1);
    setNotice(null);
    setShouldFocusQuestion(true);
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
      <p className="onboarding-step-indicator">Шаг 2 из 2</p>
      <TestOnlyLegalNotice legalConfig={legalConfig} />
      <form noValidate onSubmit={handleSubmit}>
        <div className="onboarding-survey-progress" aria-live="polite">
          <span>
            Вопрос {questionIndex + 1} из {survey.questions.length}
          </span>
          <progress
            aria-label="Прогресс анкеты"
            max={survey.questions.length}
            value={questionIndex + 1}
          />
        </div>
        <fieldset
          className="onboarding-survey-fieldset"
          disabled={submitting}
          aria-required="true"
          aria-invalid={notice?.kind === 'validation'}
          aria-describedby={
            notice?.kind === 'validation'
              ? 'onboarding-survey-notice'
              : undefined
          }
        >
          <legend ref={questionTitleRef} tabIndex="-1">
            {currentQuestion.question} *
          </legend>
          {currentQuestion.answers.map((option, index) => (
            <label className="onboarding-survey-option" key={option.code}>
              <input
                ref={index === 0 ? firstAnswerRef : undefined}
                type="radio"
                required
                aria-required="true"
                name={`onboarding-${currentQuestion.code}`}
                value={option.code}
                checked={currentAnswer === option.code}
                onChange={(event) => {
                  setAnswers((previous) => ({
                    ...previous,
                    [currentQuestion.code]: event.target.value,
                  }));
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

        <div className="onboarding-survey-actions">
          {questionIndex > 0 && (
            <button
              type="button"
              className="onboarding-profile-reload"
              onClick={handleBack}
              disabled={submitting}
            >
              Назад
            </button>
          )}
          <button
            type="submit"
            className="onboarding-profile-submit"
            disabled={submitting}
            aria-busy={submitting || undefined}
          >
            {submitting
              ? 'Завершаем…'
              : isLastQuestion
                ? 'Узнать уровень'
                : 'Далее'}
          </button>
        </div>
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
  onEnterApp,
}) {
  if (
    onboarding.currentStep === 'profile' ||
    onboarding.currentStep === 'contacts' ||
    onboarding.currentStep === 'consents'
  ) {
    return (
      <OnboardingIdentityGate
        onboarding={onboarding}
        legalConfig={legalConfig}
        onReload={onReload}
        onSaveProfile={onSaveProfile}
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
        onEnterApp={onEnterApp}
      />
    );
  }
  return null;
}
