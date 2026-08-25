import { ConfigService } from '@nestjs/config';
import { deterministicUuid } from '../../../test/deterministic-uuid';
import { internalUuid } from '../internal-uuid';
import { BackendDomainEventLogger } from './backend-domain-event.logger';
import { RequestContextStore } from './request-context.store';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';
const REQUEST_ID = internalUuid(deterministicUuid('domain-log-request'));
const MATCH_ID = deterministicUuid('domain-log-match');
const MESSAGE_ID = deterministicUuid('domain-log-message');
const PRIVATE_MARKER = 'SYNTHETIC_DOMAIN_LOG_PRIVATE_MARKER';

function harness(config: Record<string, unknown> = {}) {
  const requests = new RequestContextStore();
  const logger = new BackendDomainEventLogger(
    new ConfigService({ NODE_ENV: 'test', APP_RELEASE: RELEASE, ...config }),
    requests,
  );
  const log = jest.fn();
  const warn = jest.fn();
  (
    logger as unknown as {
      logger: { log: typeof log; warn: typeof warn };
    }
  ).logger = { log, warn };
  return { logger, requests, log, warn };
}

describe('BackendDomainEventLogger', () => {
  it('emits correlated allowlisted domain success fields', () => {
    const subject = harness();

    subject.requests.run({ requestId: REQUEST_ID }, () => {
      subject.logger.record({
        domain: 'match_chat',
        action: 'send_message',
        outcome: 'sent',
        matchId: MATCH_ID,
        messageId: MESSAGE_ID,
      });
    });

    expect(subject.warn).not.toHaveBeenCalled();
    expect(subject.log).toHaveBeenCalledWith({
      event: 'domain_operation_completed',
      service: 'prosto-padel-backend',
      environment: 'test',
      release: RELEASE,
      requestId: REQUEST_ID,
      domain: 'match_chat',
      action: 'send_message',
      outcome: 'sent',
      matchId: MATCH_ID,
      messageId: MESSAGE_ID,
    });
  });

  it('warns for a bounded rejected outcome without copying extra input', () => {
    const subject = harness();

    subject.logger.record({
      domain: 'private_booking',
      action: 'create',
      outcome: 'rejected',
      reason: 'provider_rejected',
      email: PRIVATE_MARKER,
      authorization: PRIVATE_MARKER,
    } as never);

    expect(subject.log).not.toHaveBeenCalled();
    expect(subject.warn).toHaveBeenCalledWith({
      event: 'domain_operation_completed',
      service: 'prosto-padel-backend',
      environment: 'test',
      release: RELEASE,
      domain: 'private_booking',
      action: 'create',
      outcome: 'rejected',
      reason: 'provider_rejected',
    });
    expect(JSON.stringify(subject.warn.mock.calls)).not.toContain(
      PRIVATE_MARKER,
    );
  });

  it('keeps an idempotent retry distinct from a new transition', () => {
    const subject = harness();

    subject.logger.record({
      domain: 'match_slot',
      action: 'join',
      outcome: 'idempotent_retry',
      matchId: MATCH_ID,
      slotNumber: 2,
    });

    expect(subject.warn).not.toHaveBeenCalled();
    expect(subject.log).toHaveBeenCalledWith({
      event: 'domain_operation_completed',
      service: 'prosto-padel-backend',
      environment: 'test',
      release: RELEASE,
      domain: 'match_slot',
      action: 'join',
      outcome: 'idempotent_retry',
      matchId: MATCH_ID,
      slotNumber: 2,
    });
  });

  it('fails closed for unknown event and deployment metadata values', () => {
    const subject = harness({
      NODE_ENV: PRIVATE_MARKER,
      APP_RELEASE: PRIVATE_MARKER,
    });

    subject.logger.record({
      domain: PRIVATE_MARKER,
      action: PRIVATE_MARKER,
      outcome: PRIVATE_MARKER,
      body: PRIVATE_MARKER,
    } as never);

    expect(subject.log).not.toHaveBeenCalled();
    expect(subject.warn).toHaveBeenCalledWith({
      event: 'domain_operation_log_rejected',
      service: 'prosto-padel-backend',
      environment: 'unknown',
      release: 'unavailable',
      outcome: 'invalid_logging_input',
    });
    expect(JSON.stringify(subject.warn.mock.calls)).not.toContain(
      PRIVATE_MARKER,
    );
  });

  it('never changes the operation when the logger throws', () => {
    const subject = harness();
    subject.log.mockImplementation(() => {
      throw new Error(PRIVATE_MARKER);
    });

    expect(() =>
      subject.logger.record({
        domain: 'auth',
        action: 'session_logout',
        outcome: 'logged_out',
      }),
    ).not.toThrow();
  });
});
