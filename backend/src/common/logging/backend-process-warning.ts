import { ConsoleLogger } from '@nestjs/common';
import { createBackendConsoleLogger } from './backend-console-logger';

const BACKEND_SERVICE = 'prosto-padel-backend';
const UNKNOWN_ENVIRONMENT = 'unknown';
const UNKNOWN_RELEASE = 'unavailable';

const SAFE_WARNING_KINDS = new Map<string, string>([
  ['DeprecationWarning', 'deprecation_warning'],
  ['ExperimentalWarning', 'experimental_warning'],
  ['MaxListenersExceededWarning', 'max_listeners_warning'],
  ['NodeVersionSupportWarning', 'node_version_support_warning'],
]);

function safeEnvironment(value: unknown): string {
  return value === 'development' || value === 'test' || value === 'production'
    ? value
    : UNKNOWN_ENVIRONMENT;
}

function safeRelease(value: unknown): string {
  return typeof value === 'string' && /^(?:local|[0-9a-f]{40})$/u.test(value)
    ? value
    : UNKNOWN_RELEASE;
}

function safeWarningKind(warning: Error): string {
  return SAFE_WARNING_KINDS.get(warning.name) ?? 'process_warning';
}

export function writeBackendProcessWarning(
  logger: Pick<ConsoleLogger, 'warn'>,
  warning: Error,
  environment: unknown,
  release: unknown,
): void {
  try {
    logger.warn(
      Object.freeze({
        event: 'backend_process_warning',
        service: BACKEND_SERVICE,
        environment: safeEnvironment(environment),
        release: safeRelease(release),
        outcome: 'degraded',
        warningKind: safeWarningKind(warning),
      }),
    );
  } catch {
    // Warning diagnostics must never terminate the backend process.
  }
}

export function registerBackendProcessWarningLogging(): void {
  const logger = createBackendConsoleLogger();
  process.on('warning', (warning) => {
    writeBackendProcessWarning(
      logger,
      warning,
      process.env.NODE_ENV,
      process.env.APP_RELEASE,
    );
  });
}
