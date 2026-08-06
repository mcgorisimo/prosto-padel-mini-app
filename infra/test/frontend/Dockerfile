ARG NODE_IMAGE=node:20.11.0-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27.4-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app

ARG VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true

RUN if [ "${VITE_TELEGRAM_BACKEND_LOGIN_ENABLED}" != "true" ] && \
       [ "${VITE_TELEGRAM_BACKEND_LOGIN_ENABLED}" != "false" ]; then \
      echo "VITE_TELEGRAM_BACKEND_LOGIN_ENABLED must be true or false" >&2; \
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
