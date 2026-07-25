'use strict';

const SAFE_URL_ERROR =
  'Auth integration runner database URL is invalid';
const AUTH_INTEGRATION_RUNNER_DATABASE_NAME =
  'prosto_padel_test_auth_integration_test';

function buildAuthIntegrationDatabaseUrl(password) {
  try {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error(SAFE_URL_ERROR);
    }

    const encodedPassword = encodeURIComponent(password);
    const databaseUrl =
      `postgresql://backend_auth_app:${encodedPassword}` +
      `@postgres:5432/${AUTH_INTEGRATION_RUNNER_DATABASE_NAME}`;

    if (new URL(databaseUrl).toString() !== databaseUrl) {
      throw new Error(SAFE_URL_ERROR);
    }

    return databaseUrl;
  } catch {
    throw new Error(SAFE_URL_ERROR);
  }
}

module.exports = Object.freeze({
  AUTH_INTEGRATION_RUNNER_DATABASE_NAME,
  buildAuthIntegrationDatabaseUrl,
});
