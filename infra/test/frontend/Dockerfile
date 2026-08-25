ARG NODE_IMAGE=node:20.11.0-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27.4-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app

ARG VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true
ARG VITE_ONBOARDING_LEGAL_PUBLISHED=false
ARG VITE_ONBOARDING_LEGAL_POLICY_ALIGNED=false
ARG VITE_ONBOARDING_LEGAL_TEST_ONLY=false
ARG VITE_ONBOARDING_TERMS_URL=
ARG VITE_ONBOARDING_TERMS_VERSION=
ARG VITE_ONBOARDING_PRIVACY_URL=
ARG VITE_ONBOARDING_PRIVACY_VERSION=
ARG VITE_ONBOARDING_CANCELLATION_URL=
ARG VITE_ONBOARDING_CANCELLATION_VERSION=
ARG VITE_ONBOARDING_PERSONAL_DATA_CONSENT_URL=
ARG VITE_ONBOARDING_PERSONAL_DATA_CONSENT_VERSION=

RUN if [ "${VITE_TELEGRAM_BACKEND_LOGIN_ENABLED}" != "true" ] && \
       [ "${VITE_TELEGRAM_BACKEND_LOGIN_ENABLED}" != "false" ]; then \
      echo "VITE_TELEGRAM_BACKEND_LOGIN_ENABLED must be true or false" >&2; \
      exit 1; \
    fi

RUN for value in "${VITE_ONBOARDING_LEGAL_PUBLISHED}" \
                 "${VITE_ONBOARDING_LEGAL_POLICY_ALIGNED}" \
                 "${VITE_ONBOARDING_LEGAL_TEST_ONLY}"; do \
      if [ "${value}" != "true" ] && [ "${value}" != "false" ]; then \
        echo "Onboarding legal publication flags must be true or false" >&2; \
        exit 1; \
      fi; \
    done && \
    if [ "${VITE_ONBOARDING_LEGAL_PUBLISHED}" != \
         "${VITE_ONBOARDING_LEGAL_POLICY_ALIGNED}" ]; then \
      echo "Published legal documents require an aligned backend policy" >&2; \
      exit 1; \
    fi && \
    if [ "${VITE_ONBOARDING_LEGAL_PUBLISHED}" = "true" ] && \
       { [ "${VITE_ONBOARDING_TERMS_URL}" != "https://test-app.prostopdl.ru/legal/terms/terms-2026-08-26-v1/" ] || \
         [ "${VITE_ONBOARDING_TERMS_VERSION}" != "terms-2026-08-26-v1" ] || \
         [ "${VITE_ONBOARDING_PRIVACY_URL}" != "https://test-app.prostopdl.ru/legal/privacy/privacy-2026-08-26-v1/" ] || \
         [ "${VITE_ONBOARDING_PRIVACY_VERSION}" != "privacy-2026-08-26-v1" ] || \
         [ "${VITE_ONBOARDING_CANCELLATION_URL}" != "https://test-app.prostopdl.ru/legal/cancellation/cancellation-2026-08-26-v1/" ] || \
         [ "${VITE_ONBOARDING_CANCELLATION_VERSION}" != "cancellation-2026-08-26-v1" ] || \
         [ "${VITE_ONBOARDING_PERSONAL_DATA_CONSENT_URL}" != "https://test-app.prostopdl.ru/legal/personal-data-consent/personal-data-consent-2026-08-26-v1/" ] || \
         [ "${VITE_ONBOARDING_PERSONAL_DATA_CONSENT_VERSION}" != "personal-data-consent-2026-08-26-v1" ]; }; then \
      echo "Published legal build values must match the packaged versioned pages" >&2; \
      exit 1; \
    fi && \
    if [ "${VITE_ONBOARDING_LEGAL_TEST_ONLY}" = "true" ]; then \
      echo "Legacy test-only legal pages are archived and cannot be used for onboarding" >&2; \
      exit 1; \
    fi

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js postcss.config.js tailwind.config.js ./
COPY src ./src
COPY infra/test/legal-pages ./legal-pages
RUN npm run build
RUN mkdir -p dist/legal/assets dist/legal/terms dist/legal/cancellation dist/legal/privacy dist/legal/personal-data-consent && \
    cp legal-pages/assets/legal.css dist/legal/assets/legal.css && \
    cp -R legal-pages/terms-2026-08-26-v1 dist/legal/terms/terms-2026-08-26-v1 && \
    cp -R legal-pages/cancellation-2026-08-26-v1 dist/legal/cancellation/cancellation-2026-08-26-v1 && \
    cp -R legal-pages/privacy-2026-08-26-v1 dist/legal/privacy/privacy-2026-08-26-v1 && \
    cp -R legal-pages/personal-data-consent-2026-08-26-v1 dist/legal/personal-data-consent/personal-data-consent-2026-08-26-v1

FROM ${NGINX_IMAGE} AS runtime

COPY infra/test/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080
