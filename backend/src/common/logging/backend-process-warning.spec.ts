import { ConsoleLogger } from '@nestjs/common';
import { writeBackendProcessWarning } from './backend-process-warning';

const PRIVATE_WARNING_MARKER = 'private-warning-marker';

describe('writeBackendProcessWarning', () => {
  it('maps a runtime warning to a bounded event without raw diagnostics', () => {
    const warn = jest.fn();
    const warning = new Error(PRIVATE_WARNING_MARKER);
    warning.name = 'NodeVersionSupportWarning';
    warning.stack = `NodeVersionSupportWarning: ${PRIVATE_WARNING_MARKER}`;

    writeBackendProcessWarning(
      { warn } as Pick<ConsoleLogger, 'warn'>,
      warning,
      'test',
      '0123456789abcdef0123456789abcdef01234567',
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      event: 'backend_process_warning',
      service: 'prosto-padel-backend',
      environment: 'test',
      release: '0123456789abcdef0123456789abcdef01234567',
      outcome: 'degraded',
      warningKind: 'node_version_support_warning',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      PRIVATE_WARNING_MARKER,
    );
  });

  it('fails closed for unrecognized warning and metadata values', () => {
    const warn = jest.fn();
    const warning = new Error('not logged');
    warning.name = 'private-warning-name';

    writeBackendProcessWarning(
      { warn } as Pick<ConsoleLogger, 'warn'>,
      warning,
      'private-environment',
      'private-release',
    );

    expect(warn).toHaveBeenCalledWith({
      event: 'backend_process_warning',
      service: 'prosto-padel-backend',
      environment: 'unknown',
      release: 'unavailable',
      outcome: 'degraded',
      warningKind: 'process_warning',
    });
  });
});
