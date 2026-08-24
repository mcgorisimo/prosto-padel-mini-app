import { useEffect, useMemo, useRef, useState } from 'react';
import { readOnboardingSurveyDefinition } from '../lib/playerOnboardingUiPolicy';

function ReassessmentShell({ children, intro, testId, title }) {
  return (
    <main className="onboarding-profile-screen" data-testid={testId}>
      <section
        className="onboarding-profile-card"
        aria-labelledby={`${testId}-title`}
      >
        <p className="onboarding-profile-eyebrow">Просто Падел</p>
        <h1 id={`${testId}-title`}>{title}</h1>
        {intro && <p className="onboarding-profile-intro">{intro}</p>}
        {children}
      </section>
    </main>
  );
}

function completedAnswers(survey, answers) {
  return Object.fromEntries(
    survey.questions.map(({ code }) => [code, answers[code]]),
  );
}

function hasEveryAnswer(survey, answers) {
  return survey.questions.every((question) =>
    question.answers.some(({ code }) => code === answers[question.code]),
  );
}

export default function InitialLevelReassessmentGate({
  reassessment,
  onComplete,
  onEnterApp,
  onReconcile,
}) {
  const survey = useMemo(
    () => readOnboardingSurveyDefinition(reassessment.surveyVersion),
    [reassessment.surveyVersion],
  );
  const [source, setSource] = useState(reassessment.source);
  const [answers, setAnswers] = useState({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [result, setResult] = useState(null);
  const completionRef = useRef(null);
  const questionTitleRef = useRef(null);
  const firstAnswerRef = useRef(null);
  const shouldFocusQuestionRef = useRef(false);

  useEffect(() => {
    setSource(reassessment.source);
  }, [reassessment.source]);

  useEffect(() => {
    if (!shouldFocusQuestionRef.current) return;
    shouldFocusQuestionRef.current = false;
    questionTitleRef.current?.focus();
  }, [questionIndex]);

  if (survey === null) return null;

  if (result !== null) {
    return (
      <ReassessmentShell
        testId="initial-level-reassessment-result-gate"
        title="Готово"
      >
        <p className="onboarding-initial-level-result" role="status">
          Ваш начальный уровень: <strong>{result.initialLevelLabel}</strong>
        </p>
        <button
          type="button"
          className="onboarding-profile-submit"
          onClick={() => onEnterApp(result)}
        >
          Перейти в приложение
        </button>
      </ReassessmentShell>
    );
  }

  const currentQuestion = survey.questions[questionIndex];
  const currentAnswer = answers[currentQuestion.code];
  const isLastQuestion = questionIndex === survey.questions.length - 1;

  const updateAnswer = (answer) => {
    completionRef.current = null;
    setAnswers((previous) => ({
      ...previous,
      [currentQuestion.code]: answer,
    }));
    setNotice(null);
  };

  const reconcile = async () => {
    const refreshed = await onReconcile();
    if (refreshed.outcome !== 'loaded') return refreshed;
    if (refreshed.reassessment.status === 'completed') {
      setResult(refreshed.reassessment);
      return Object.freeze({
        outcome: 'reconciled',
        reassessment: refreshed.reassessment,
      });
    }
    if (refreshed.reassessment.status === 'not_eligible') {
      onEnterApp(null);
      return Object.freeze({
        outcome: 'reconciled',
        reassessment: refreshed.reassessment,
      });
    }
    setSource(refreshed.reassessment.source);
    completionRef.current = null;
    setNotice({
      tone: 'warning',
      message: 'Состояние обновлено. Проверьте ответы и попробуйте снова.',
    });
    return Object.freeze({
      outcome: 'reconciled',
      reassessment: refreshed.reassessment,
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!currentQuestion.answers.some(({ code }) => code === currentAnswer)) {
      setNotice({
        kind: 'validation',
        tone: 'error',
        message: 'Выберите один вариант.',
      });
      queueMicrotask(() => firstAnswerRef.current?.focus());
      return;
    }

    if (!isLastQuestion) {
      setQuestionIndex((previous) => previous + 1);
      setNotice(null);
      shouldFocusQuestionRef.current = true;
      return;
    }

    const finalAnswers = completedAnswers(survey, answers);
    if (!hasEveryAnswer(survey, finalAnswers)) {
      const firstUnanswered = survey.questions.findIndex(
        (question) =>
          !question.answers.some(
            ({ code }) => code === finalAnswers[question.code],
          ),
      );
      setQuestionIndex(Math.max(firstUnanswered, 0));
      setNotice({
        kind: 'validation',
        tone: 'error',
        message: 'Ответьте на каждый вопрос.',
      });
      shouldFocusQuestionRef.current = true;
      return;
    }

    const completion =
      completionRef.current ??
      Object.freeze({
        source,
        survey: Object.freeze({
          version: survey.version,
          answers: Object.freeze(finalAnswers),
        }),
      });
    completionRef.current = completion;
    setSubmitting(true);
    setNotice(null);
    try {
      const completed = await onComplete(completion);
      if (completed.outcome === 'completed') {
        setResult(completed.reassessment);
        return;
      }
      if (completed.outcome === 'cancelled') return;
      if (
        completed.outcome === 'rejected' &&
        (completed.reason === 'conflict' ||
          completed.reason === 'stale_source' ||
          completed.reason === 'not_eligible')
      ) {
        const reconciled = await reconcile();
        if (reconciled.outcome === 'reconciled') return;
      }
      setNotice({
        tone: 'error',
        message: 'Не удалось завершить анкету. Попробуйте снова.',
      });
    } catch {
      setNotice({
        tone: 'error',
        message: 'Не удалось завершить анкету. Попробуйте снова.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    if (submitting || questionIndex === 0) return;
    setQuestionIndex((previous) => previous - 1);
    setNotice(null);
    shouldFocusQuestionRef.current = true;
  };

  return (
    <ReassessmentShell
      testId="initial-level-reassessment-gate"
      title="Уточним начальный уровень"
      intro="Ответьте на пять коротких вопросов, чтобы обновить начальный уровень."
    >
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
              ? 'initial-level-reassessment-notice'
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
                name={`initial-level-reassessment-${currentQuestion.code}`}
                value={option.code}
                checked={currentAnswer === option.code}
                onChange={(event) => updateAnswer(event.target.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        {notice && (
          <div
            id="initial-level-reassessment-notice"
            className={`onboarding-profile-notice onboarding-profile-notice--${notice.tone}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          >
            {notice.message}
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
              ? 'Сохраняем…'
              : isLastQuestion
                ? 'Узнать уровень'
                : 'Далее'}
          </button>
        </div>
      </form>
    </ReassessmentShell>
  );
}
