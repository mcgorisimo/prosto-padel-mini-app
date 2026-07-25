import { spawn } from 'node:child_process';
import runnerUrl from './runner-url.cjs';

const SAFE_CONFIGURATION_ERROR =
  'Auth integration runner configuration is invalid';
const EXPECTED_DATABASE_NAME =
  runnerUrl.AUTH_INTEGRATION_RUNNER_DATABASE_NAME;
const LIST_TESTS_ARGUMENT = '--listTests';

function failConfiguration() {
  process.stderr.write(`${SAFE_CONFIGURATION_ERROR}\n`);
  process.exit(64);
}

function clearConnectionEnvironment() {
  delete process.env.AUTH_INTEGRATION_TESTS_ENABLED;
  delete process.env.AUTH_INTEGRATION_DISPOSABLE_DATABASE;
  delete process.env.AUTH_INTEGRATION_EXPECTED_DATABASE_NAME;
  delete process.env.AUTH_INTEGRATION_DATABASE_PASSWORD;
  delete process.env.AUTH_INTEGRATION_DATABASE_URL;
}

function prepareIntegrationEnvironment() {
  if (
    process.env.AUTH_INTEGRATION_TESTS_ENABLED !== 'true' ||
    process.env.AUTH_INTEGRATION_DISPOSABLE_DATABASE !== 'true' ||
    process.env.AUTH_INTEGRATION_EXPECTED_DATABASE_NAME !==
      EXPECTED_DATABASE_NAME
  ) {
    failConfiguration();
  }

  const suppliedUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;
  const suppliedPassword =
    process.env.AUTH_INTEGRATION_DATABASE_PASSWORD;
  const hasUrl =
    typeof suppliedUrl === 'string' && suppliedUrl.length > 0;
  const hasPassword =
    typeof suppliedPassword === 'string' &&
    suppliedPassword.length > 0;

  if (hasUrl === hasPassword) {
    failConfiguration();
  }

  if (hasPassword) {
    try {
      process.env.AUTH_INTEGRATION_DATABASE_URL =
        runnerUrl.buildAuthIntegrationDatabaseUrl(
          suppliedPassword,
        );
    } catch {
      failConfiguration();
    }
  }

  delete process.env.AUTH_INTEGRATION_DATABASE_PASSWORD;
}

function runJest(argumentsForJest) {
  const child = spawn(
    'npm',
    [
      'run',
      'test:integration:auth',
      '--',
      ...argumentsForJest,
    ],
    {
      env: process.env,
      shell: false,
      stdio: 'inherit',
    },
  );

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };
  const forwardInterrupt = () => forwardSignal('SIGINT');
  const forwardTermination = () => forwardSignal('SIGTERM');

  process.once('SIGINT', forwardInterrupt);
  process.once('SIGTERM', forwardTermination);

  child.once('error', () => {
    process.stderr.write(
      'Auth integration runner could not start the test command\n',
    );
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forwardInterrupt);
    process.removeListener('SIGTERM', forwardTermination);

    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 1;
  });
}

const runnerArguments = process.argv.slice(2);
const isListTests =
  runnerArguments.length === 1 &&
  runnerArguments[0] === LIST_TESTS_ARGUMENT;

if (isListTests) {
  clearConnectionEnvironment();
  runJest([LIST_TESTS_ARGUMENT]);
} else if (runnerArguments.length === 0) {
  prepareIntegrationEnvironment();
  runJest([]);
} else {
  failConfiguration();
}
