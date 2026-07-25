ARG NODE_IMAGE=node:20.11.0-bookworm-slim

FROM ${NODE_IMAGE}

ENV NODE_ENV=test \
    NPM_CONFIG_CACHE=/tmp/npm-cache
WORKDIR /app

RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY --chown=node:node nest-cli.json tsconfig.json tsconfig.build.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node test ./test

ENTRYPOINT ["node", "/app/test/auth-integration/runner-entrypoint.mjs"]
