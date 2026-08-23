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
    if [ "${VITE_ONBOARDING_LEGAL_TEST_ONLY}" = "true" ] && \
       [ "${VITE_ONBOARDING_LEGAL_PUBLISHED}" != "true" ]; then \
      echo "Test-only legal documents must be explicitly published and aligned" >&2; \
      exit 1; \
    fi && \
    if [ "${VITE_ONBOARDING_LEGAL_TEST_ONLY}" = "true" ] && \
       { [ "${VITE_ONBOARDING_TERMS_URL}" != "https://test-app.prostopdl.ru/legal/test-only/terms-test-2026-08-23-v1/" ] || \
         [ "${VITE_ONBOARDING_TERMS_VERSION}" != "terms-test-2026-08-23-v1" ] || \
         [ "${VITE_ONBOARDING_PRIVACY_URL}" != "https://test-app.prostopdl.ru/legal/test-only/privacy-test-2026-08-23-v1/" ] || \
         [ "${VITE_ONBOARDING_PRIVACY_VERSION}" != "privacy-test-2026-08-23-v1" ] || \
         [ "${VITE_ONBOARDING_CANCELLATION_URL}" != "https://test-app.prostopdl.ru/legal/test-only/cancellation-test-2026-08-23-v1/" ] || \
         [ "${VITE_ONBOARDING_CANCELLATION_VERSION}" != "cancellation-test-2026-08-23-v1" ]; }; then \
      echo "Test-only legal build values must match the packaged versioned pages" >&2; \
      exit 1; \
    fi

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js postcss.config.js tailwind.config.js ./
COPY src ./src
COPY docs/legal/TERMS_DRAFT.md docs/legal/PRIVACY_POLICY_DRAFT.md docs/legal/CANCELLATION_POLICY_DRAFT.md ./legal-source/
COPY infra/test/legal-pages ./legal-pages
RUN npm run build && \
    mkdir -p dist/legal/test-only/source && \
    cp -R legal-pages/assets dist/legal/test-only/assets && \
    cp -R legal-pages/terms-test-2026-08-23-v1 dist/legal/test-only/terms-test-2026-08-23-v1 && \
    cp -R legal-pages/privacy-test-2026-08-23-v1 dist/legal/test-only/privacy-test-2026-08-23-v1 && \
    cp -R legal-pages/cancellation-test-2026-08-23-v1 dist/legal/test-only/cancellation-test-2026-08-23-v1 && \
    cp legal-source/TERMS_DRAFT.md legal-source/PRIVACY_POLICY_DRAFT.md legal-source/CANCELLATION_POLICY_DRAFT.md dist/legal/test-only/source/

FROM ${NGINX_IMAGE} AS runtime

COPY infra/test/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080
