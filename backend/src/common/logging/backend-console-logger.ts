import { ConsoleLogger } from '@nestjs/common';

export function createBackendConsoleLogger(): ConsoleLogger {
  return new ConsoleLogger({
    colors: false,
    compact: true,
    json: true,
    logLevels: ['log', 'warn', 'error', 'fatal'],
  });
}
