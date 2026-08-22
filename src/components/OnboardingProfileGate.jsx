import { useEffect, useRef, useState } from 'react';

const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;

function normalizePhone(value) {
  return value.trim().replace(/[\s().-]/gu, '');
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function initialFields(onboarding) {
  return {
    firstName: onboarding?.profile?.firstName ?? '',
    lastName: onboarding?.profile?.lastName ?? '',
    phone: onboarding?.contacts?.phone ?? '',
    email: onboarding?.contacts?.normalizedEmail ?? '',
  };
}

export function buildOnboardingProfileDraft(fields, expectedRevision) {
  const firstName = fields.firstName.trim();
  const lastName = fields.lastName.trim();
  const phone = normalizePhone(fields.phone);
  const email = normalizeEmail(fields.email);
  const errors = {};

  if (!firstName) {
    errors.firstName = 'Укажите имя.';
  } else if ([...firstName].length > 256) {
    errors.firstName = 'Имя слишком длинное.';
  }
  if ([...lastName].length > 256) {
    errors.lastName = 'Фамилия слишком длинная.';
  }
  if (!PHONE_PATTERN.test(phone)) {
    errors.phone = 'Введите телефон в международном формате: + и 7–15 цифр.';
  }
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    errors.email = 'Введите корректный email.';
  }

  if (Object.keys(errors).length > 0) {
    return Object.freeze({
      draft: null,
      errors: Object.freeze(errors),
    });
  }

  return Object.freeze({
    draft: Object.freeze({
      expectedRevision,
      profile: Object.freeze({
        firstName,
        lastName: lastName || null,
      }),
      contacts: Object.freeze({
        phone,
        email,
      }),
    }),
    errors: Object.freeze({}),
  });
}

export default function OnboardingProfileGate({
  onboarding,
  onReload,
  onSave,
}) {
  const [fields, setFields] = useState(() => initialFields(onboarding));
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const phoneRef = useRef(null);
  const emailRef = useRef(null);

  useEffect(() => {
    setFields(initialFields(onboarding));
    setErrors({});
  }, [onboarding]);

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setFields((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
    setNotice(null);
  };

  const focusFirstError = (validationErrors) => {
    const refs = {
      firstName: firstNameRef,
      lastName: lastNameRef,
      phone: phoneRef,
      email: emailRef,
    };
    const firstInvalidField = ['firstName', 'lastName', 'phone', 'email'].find(
      (field) => validationErrors[field],
    );
    refs[firstInvalidField]?.current?.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const validation = buildOnboardingProfileDraft(fields, onboarding.revision);
    if (!validation.draft) {
      setErrors(validation.errors);
      setNotice({
        tone: 'error',
        message: 'Проверьте отмеченные поля.',
      });
      queueMicrotask(() => focusFirstError(validation.errors));
      return;
    }

    setSubmitting(true);
    setErrors({});
    setNotice(null);
    try {
      const result = await onSave(validation.draft);
      if (result.outcome === 'saved') {
        setNotice({ tone: 'success', message: 'Профиль сохранён.' });
        return;
      }
      if (result.outcome === 'reconciled') {
        setNotice({
          tone: 'warning',
          message:
            'На сервере уже есть более новая версия. Поля обновлены — проверьте их и сохраните снова.',
        });
        return;
      }
      if (
        result.outcome === 'rejected' &&
        result.reason === 'unknown_outcome'
      ) {
        setNotice({
          tone: 'error',
          message:
            'Не удалось подтвердить сохранение. Обновите данные перед повторной отправкой.',
          canReload: true,
        });
        return;
      }
      if (result.outcome !== 'cancelled') {
        setNotice({
          tone: 'error',
          message:
            'Не удалось сохранить профиль. Проверьте данные и попробуйте снова.',
        });
      }
    } catch {
      setNotice({
        tone: 'error',
        message: 'Не удалось сохранить профиль. Попробуйте снова.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReload = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await onReload();
      if (result.outcome === 'loaded') {
        setNotice({
          tone: 'success',
          message: 'Данные обновлены. Проверьте поля перед сохранением.',
        });
      } else if (result.outcome !== 'cancelled') {
        setNotice({
          tone: 'error',
          message: 'Не удалось обновить данные. Попробуйте снова позже.',
          canReload: true,
        });
      }
    } catch {
      setNotice({
        tone: 'error',
        message: 'Не удалось обновить данные. Попробуйте снова позже.',
        canReload: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      className="onboarding-profile-screen"
      data-testid="onboarding-profile-gate"
    >
      <section
        className="onboarding-profile-card"
        aria-labelledby="onboarding-profile-title"
      >
        <p className="onboarding-profile-eyebrow">Просто Падел</p>
        <h1 id="onboarding-profile-title">Давайте познакомимся</h1>
        <p className="onboarding-profile-intro">
          Заполните профиль, чтобы продолжить в приложении.
        </p>

        <form noValidate onSubmit={handleSubmit}>
          <div className="onboarding-profile-field">
            <label htmlFor="onboarding-first-name">Имя *</label>
            <input
              ref={firstNameRef}
              id="onboarding-first-name"
              name="firstName"
              type="text"
              required
              aria-required="true"
              autoComplete="given-name"
              maxLength={256}
              value={fields.firstName}
              aria-invalid={Boolean(errors.firstName)}
              aria-describedby={
                errors.firstName ? 'onboarding-first-name-error' : undefined
              }
              onChange={handleChange('firstName')}
            />
            {errors.firstName && (
              <p
                id="onboarding-first-name-error"
                className="onboarding-profile-error"
                role="alert"
              >
                {errors.firstName}
              </p>
            )}
          </div>

          <div className="onboarding-profile-field">
            <label htmlFor="onboarding-last-name">Фамилия</label>
            <input
              ref={lastNameRef}
              id="onboarding-last-name"
              name="lastName"
              type="text"
              autoComplete="family-name"
              maxLength={256}
              value={fields.lastName}
              aria-invalid={Boolean(errors.lastName)}
              aria-describedby={
                errors.lastName ? 'onboarding-last-name-error' : undefined
              }
              onChange={handleChange('lastName')}
            />
            {errors.lastName && (
              <p
                id="onboarding-last-name-error"
                className="onboarding-profile-error"
                role="alert"
              >
                {errors.lastName}
              </p>
            )}
          </div>

          <div className="onboarding-profile-field">
            <label htmlFor="onboarding-phone">Телефон *</label>
            <input
              ref={phoneRef}
              id="onboarding-phone"
              name="phone"
              type="tel"
              required
              aria-required="true"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+79991234567"
              value={fields.phone}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={
                errors.phone
                  ? 'onboarding-phone-hint onboarding-phone-error'
                  : 'onboarding-phone-hint'
              }
              onChange={handleChange('phone')}
            />
            <p id="onboarding-phone-hint" className="onboarding-profile-hint">
              Международный формат: + и 7–15 цифр.
            </p>
            {errors.phone && (
              <p
                id="onboarding-phone-error"
                className="onboarding-profile-error"
                role="alert"
              >
                {errors.phone}
              </p>
            )}
          </div>

          <div className="onboarding-profile-field">
            <label htmlFor="onboarding-email">Email *</label>
            <input
              ref={emailRef}
              id="onboarding-email"
              name="email"
              type="email"
              required
              aria-required="true"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck="false"
              maxLength={320}
              value={fields.email}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={
                errors.email ? 'onboarding-email-error' : undefined
              }
              onChange={handleChange('email')}
            />
            {errors.email && (
              <p
                id="onboarding-email-error"
                className="onboarding-profile-error"
                role="alert"
              >
                {errors.email}
              </p>
            )}
          </div>

          <p className="onboarding-profile-declared-note">
            Телефон и email сохраняются как указанные контакты. Их подтверждение
            выполняется отдельно.
          </p>

          {notice && (
            <div
              className={`onboarding-profile-notice onboarding-profile-notice--${notice.tone}`}
              role={notice.tone === 'error' ? 'alert' : 'status'}
              aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
              aria-atomic="true"
            >
              <span>{notice.message}</span>
              {notice.canReload && (
                <button
                  type="button"
                  className="onboarding-profile-reload"
                  onClick={handleReload}
                  disabled={submitting}
                >
                  Обновить данные
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            className="onboarding-profile-submit"
            disabled={submitting}
          >
            {submitting ? 'Сохраняем…' : 'Сохранить профиль'}
          </button>
        </form>
      </section>
    </main>
  );
}
