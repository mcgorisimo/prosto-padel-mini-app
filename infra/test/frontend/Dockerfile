ARG NODE_IMAGE=node:20.11.0-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27.4-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app

ARG VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true
ARG VITE_ONBOARDING_LEGAL_PUBLISHED=false
ARG VITE_ONBOARDING_LEGAL_POLICY_ALIGNED=false
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
                 "${VITE_ONBOARDING_LEGAL_POLICY_ALIGNED}"; do \
      if [ "${value}" != "true" ] && [ "${value}" != "false" ]; then \
        echo "Onboarding legal publication flags must be true or false" >&2; \
        exit 1; \
      fi; \
    done && \
    if [ "${VITE_ONBOARDING_LEGAL_PUBLISHED}" != \
         "${VITE_ONBOARDING_LEGAL_POLICY_ALIGNED}" ]; then \
      echo "Published legal documents require an aligned backend policy" >&2; \
      exit 1; \
    fi

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js postcss.config.js tailwind.config.js ./
COPY src ./src
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime

COPY infra/test/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080
