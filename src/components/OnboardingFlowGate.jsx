import { useEffect, useMemo, useRef, useState } from 'react';
import OnboardingProfileGate from './OnboardingProfileGate';
import {
  currentLegalConsentGroups,
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

function legalDocument(legalConfig, kind) {
  return legalConfig.documents.find((document) => document.kind === kind);
}

function legalRevisionDate(version) {
  const match = /(?:^|-)(\d{4})-(\d{2})-(\d{2})(?:-|$)/u.exec(version);
  if (match === null) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${day}.${month}.${year}`;
}

function legalRevisionLabel(...documents) {
  const dates = documents.map((document) =>
    legalRevisionDate(document.version),
  );
  return dates.every((date) => date !== null && date === dates[0])
    ? `Редакция от ${dates[0]}`
    : 'Актуальные редакции';
}

function LegalConsentControls({
  accepted,
  disabled,
  idPrefix = 'onboarding-consent',
  legalConfig,
  locked = {},
  onChange,
}) {
  const consents = legalConsentContract(legalConfig);
  if (consents === null) return <LegalUnavailableNotice />;

  const terms = legalDocument(legalConfig, 'terms');
  const cancellation = legalDocument(legalConfig, 'cancellation');
  const privacy = legalDocument(legalConfig, 'privacy');
  const personalData = legalDocument(legalConfig, 'personal_data_processing');
  const rows = [
    {
      key: 'offer',
      label: (
        <>
          Принимаю{' '}
          <a href={terms.url} target="_blank" rel="noopener noreferrer">
            Условия использования
          </a>{' '}
          и{' '}
          <a href={cancellation.url} target="_blank" rel="noopener noreferrer">
            Правила отмены
          </a>
          <small>{legalRevisionLabel(terms, cancellation)}</small>
        </>
      ),
      ariaLabel: `Принимаю Условия использования и Правила отмены, ${legalRevisionLabel(terms, cancellation).toLocaleLowerCase('ru-RU')}`,
    },
    {
      key: 'personalDataProcessing',
      label: (
        <>
          Даю отдельное{' '}
          <a href={personalData.url} target="_blank" rel="noopener noreferrer">
            согласие на обработку персональных данных
          </a>
          <small>{legalRevisionLabel(personalData)}</small>
        </>
      ),
      ariaLabel: `Даю отдельное согласие на обработку персональных данных, ${legalRevisionLabel(personalData).toLocaleLowerCase('ru-RU')}`,
    },
  ];

  return (
    <>
      <TestOnlyLegalNotice legalConfig={legalConfig} />
      <fieldset className="onboarding-consent-list" disabled={disabled}>
        <legend>Откройте документы и отметьте два обязательных пункта *</legend>
        {rows.map((row) => {
          const inputId = `${idPrefix}-${row.key}`;
          return (
            <div className="onboarding-consent-row" key={row.key}>
              <label className="onboarding-consent-toggle" htmlFor={inputId}>
                <input
                  id={inputId}
                  type="checkbox"
                  required
                  aria-required="true"
                  aria-label={row.ariaLabel}
                  checked={accepted[row.key] === true}
                  disabled={disabled || locked[row.key] === true}
                  onChange={(event) => onChange(row.key, event.target.checked)}
                />
              </label>
              <div className="onboarding-consent-copy">{row.label}</div>
            </div>
          );
        })}
      </fieldset>
      <p className="onboarding-privacy-note">
        Информация об обработке данных:{' '}
        <a href={privacy.url} target="_blank" rel="noopener noreferrer">
          Политика конфиденциальности
        </a>{' '}
        <small>{legalRevisionLabel(privacy)}</small>
      </p>
    </>
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
    accepted.offer === true &&
    accepted.personalDataProcessing === true;

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
          <LegalConsentControls
            accepted={accepted}
            disabled={submitting}
            legalConfig={legalConfig}
            onChange={(key, checked) => {
              setAccepted((previous) => ({ ...previous, [key]: checked }));
            }}
          />
          <p
            id="onboarding-legal-readiness"
            className="onboarding-consent-hint"
          >
            {allAccepted
              ? 'Оба обязательных пункта отмечены.'
              : 'Продолжение станет доступно после заполнения профиля и двух подтверждений.'}
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

export function LegalReconsentGate({
  onboarding,
  legalConfig = readOnboardingLegalConfig(),
  onAccept,
  onAccepted,
}) {
  const currentGroups = currentLegalConsentGroups(onboarding, legalConfig);
  const [accepted, setAccepted] = useState(() => ({
    offer: currentGroups?.offer === true,
    personalDataProcessing: currentGroups?.personalDataProcessing === true,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const consents = legalConsentContract(legalConfig);
  const allAccepted =
    consents !== null &&
    accepted.offer === true &&
    accepted.personalDataProcessing === true;

  useEffect(() => {
    setAccepted({
      offer: currentGroups?.offer === true,
      personalDataProcessing: currentGroups?.personalDataProcessing === true,
    });
    setError('');
  }, [
    currentGroups?.offer,
    currentGroups?.personalDataProcessing,
    onboarding.revision,
  ]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!allAccepted || consents === null || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await onAccept({ consents });
      if (result.outcome === 'accepted') {
        onAccepted(result.onboarding);
        return;
      }
      setError('Не удалось сохранить подтверждения. Попробуйте ещё раз.');
    } catch {
      setError('Не удалось сохранить подтверждения. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingShell
      testId="onboarding-legal-reconsent-gate"
      title="Документы обновились"
      intro="Перед продолжением подтвердите актуальные версии документов. Предыдущие подтверждения сохраняются."
    >
      <form onSubmit={handleSubmit}>
        <LegalConsentControls
          accepted={accepted}
          disabled={submitting}
          idPrefix="onboarding-reconsent"
          legalConfig={legalConfig}
          locked={{
            offer: currentGroups?.offer === true,
            personalDataProcessing:
              currentGroups?.personalDataProcessing === true,
          }}
          onChange={(key, checked) => {
            setAccepted((previous) => ({ ...previous, [key]: checked }));
          }}
        />
        {error ? <p role="alert">{error}</p> : null}
        <button
          type="submit"
          className="onboarding-profile-submit"
          disabled={!allAccepted || submitting}
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
    if (!currentQuestion.answers.some(({ code }) => code === currentAnswer)) {
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
