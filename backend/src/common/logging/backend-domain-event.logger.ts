import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isInternalUuid } from '../internal-uuid';
import { BackendMetricsService } from '../metrics/backend-metrics.service';
import { RequestContextStore } from './request-context.store';

const BACKEND_SERVICE = 'prosto-padel-backend';
const RELEASE_PATTERN = /^[0-9a-f]{40}$/u;
const ENVIRONMENTS = ['development', 'test', 'production'] as const;
const RESERVATION_STATUSES = [
  'unbooked',
  'pending_confirmation',
  'confirmed',
  'reschedule_pending',
  'cancel_pending',
  'cancelled',
  'rejected',
  'unknown',
] as const;

const TELEGRAM_LOGIN_REJECTIONS = [
  'invalid_telegram_data',
  'telegram_proof_expired',
  'proof_replayed',
  'request_conflict',
  'account_unavailable',
  'temporary_conflict',
  'dependency_unavailable',
  'internal_failure',
] as const;
const SESSION_REFRESH_REJECTIONS = [
  'invalid_request',
  'session_refresh_reopen_required',
  'session_expired',
  'session_invalid',
  'session_request_conflict',
  'temporary_unavailable',
  'internal_failure',
] as const;
const SESSION_LOGOUT_REJECTIONS = [
  'invalid_request',
  'session_invalid',
  'session_request_conflict',
  'temporary_unavailable',
  'internal_failure',
] as const;
const MATCH_REJECTIONS = [
  'invalid_request',
  'forbidden',
  'match_not_found',
  'match_closed',
  'match_not_joinable',
  'match_started',
  'reservation_not_found',
  'reservation_not_confirmed',
  'provider_binding_missing',
  'unsupported_duration',
  'content_not_allowed',
  'rating_verification_required',
  'rating_out_of_range',
  'owner_cannot_join',
  'already_joined',
  'invitation_pending',
  'match_full',
  'participant_not_active',
  'request_conflict',
  'match_conflict',
  'temporary_unavailable',
  'internal_failure',
] as const;
const CHAT_REJECTIONS = [
  'invalid_request',
  'content_not_allowed',
  'match_not_found',
  'match_closed',
  'request_conflict',
  'temporary_unavailable',
  'internal_failure',
] as const;
const BOOKING_REJECTIONS = [
  'invalid_request',
  'contact_incomplete',
  'not_bookable',
  'conflict',
  'provider_rejected',
  'unavailable',
] as const;

type TelegramLoginRejection = (typeof TELEGRAM_LOGIN_REJECTIONS)[number];
type SessionRefreshRejection = (typeof SESSION_REFRESH_REJECTIONS)[number];
type SessionLogoutRejection = (typeof SESSION_LOGOUT_REJECTIONS)[number];
type MatchRejection = (typeof MATCH_REJECTIONS)[number];
type ChatRejection = (typeof CHAT_REJECTIONS)[number];
type BookingRejection = (typeof BOOKING_REJECTIONS)[number];
type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export type BackendDomainEvent =
  | Readonly<{
      domain: 'auth';
      action: 'telegram_login';
      outcome: 'authenticated';
      accountKind: 'existing' | 'new';
    }>
  | Readonly<{
      domain: 'auth';
      action: 'telegram_login';
      outcome: 'rejected';
      reason: TelegramLoginRejection;
    }>
  | Readonly<{
      domain: 'auth';
      action: 'session_refresh';
      outcome: 'refreshed';
    }>
  | Readonly<{
      domain: 'auth';
      action: 'session_refresh';
      outcome: 'rejected';
      reason: SessionRefreshRejection;
    }>
  | Readonly<{
      domain: 'auth';
      action: 'session_logout';
      outcome: 'logged_out';
    }>
  | Readonly<{
      domain: 'auth';
      action: 'session_logout';
      outcome: 'rejected';
      reason: SessionLogoutRejection;
    }>
  | Readonly<{
      domain: 'match';
      action: 'create';
      outcome: 'created' | 'idempotent_retry';
      matchId: string;
    }>
  | Readonly<{
      domain: 'match';
      action: 'create';
      outcome: 'rejected';
      reason: MatchRejection;
    }>
  | Readonly<{
      domain: 'match_slot';
      action: 'join' | 'leave';
      outcome: 'occupied' | 'released' | 'idempotent_retry';
      matchId: string;
      slotNumber: number;
    }>
  | Readonly<{
      domain: 'match_slot';
      action: 'join' | 'leave';
      outcome: 'rejected';
      matchId: string;
      reason: MatchRejection;
    }>
  | Readonly<{
      domain: 'match_chat';
      action: 'send_message';
      outcome: 'sent' | 'idempotent_retry';
      matchId: string;
      messageId: string;
    }>
  | Readonly<{
      domain: 'match_chat';
      action: 'send_message';
      outcome: 'rejected';
      matchId: string;
      reason: ChatRejection;
    }>
  | Readonly<{
      domain: 'private_booking';
      action: 'create';
      outcome: 'created' | 'idempotent_retry' | 'unknown';
      reservationId: string;
      reservationStatus: ReservationStatus;
    }>
  | Readonly<{
      domain: 'private_booking';
      action: 'create';
      outcome: 'rejected';
      reason: BookingRejection;
    }>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function includes<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function safeEnvironment(value: unknown): string {
  return includes(ENVIRONMENTS, value) ? value : 'unknown';
}

function safeRelease(value: unknown): string {
  return value === 'local' ||
    (typeof value === 'string' && RELEASE_PATTERN.test(value))
    ? value
    : 'unavailable';
}

function safeSlotNumber(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 4
    ? Number(value)
    : undefined;
}

function safeEvent(
  value: unknown,
): Readonly<Record<string, string | number>> | undefined {
  if (!isRecord(value)) return undefined;

  if (value.domain === 'auth' && value.action === 'telegram_login') {
    if (
      value.outcome === 'authenticated' &&
      (value.accountKind === 'existing' || value.accountKind === 'new')
    ) {
      return Object.freeze({
        domain: 'auth',
        action: 'telegram_login',
        outcome: 'authenticated',
        accountKind: value.accountKind,
      });
    }
    if (
      value.outcome === 'rejected' &&
      includes(TELEGRAM_LOGIN_REJECTIONS, value.reason)
    ) {
      return Object.freeze({
        domain: 'auth',
        action: 'telegram_login',
        outcome: 'rejected',
        reason: value.reason,
      });
    }
  }

  if (value.domain === 'auth' && value.action === 'session_refresh') {
    if (value.outcome === 'refreshed') {
      return Object.freeze({
        domain: 'auth',
        action: 'session_refresh',
        outcome: 'refreshed',
      });
    }
    if (
      value.outcome === 'rejected' &&
      includes(SESSION_REFRESH_REJECTIONS, value.reason)
    ) {
      return Object.freeze({
        domain: 'auth',
        action: 'session_refresh',
        outcome: 'rejected',
        reason: value.reason,
      });
    }
  }

  if (value.domain === 'auth' && value.action === 'session_logout') {
    if (value.outcome === 'logged_out') {
      return Object.freeze({
        domain: 'auth',
        action: 'session_logout',
        outcome: 'logged_out',
      });
    }
    if (
      value.outcome === 'rejected' &&
      includes(SESSION_LOGOUT_REJECTIONS, value.reason)
    ) {
      return Object.freeze({
        domain: 'auth',
        action: 'session_logout',
        outcome: 'rejected',
        reason: value.reason,
      });
    }
  }

  if (value.domain === 'match' && value.action === 'create') {
    if (
      (value.outcome === 'created' || value.outcome === 'idempotent_retry') &&
      isInternalUuid(value.matchId)
    ) {
      return Object.freeze({
        domain: 'match',
        action: 'create',
        outcome: value.outcome,
        matchId: value.matchId,
      });
    }
    if (
      value.outcome === 'rejected' &&
      includes(MATCH_REJECTIONS, value.reason)
    ) {
      return Object.freeze({
        domain: 'match',
        action: 'create',
        outcome: 'rejected',
        reason: value.reason,
      });
    }
  }

  if (
    value.domain === 'match_slot' &&
    (value.action === 'join' || value.action === 'leave') &&
    isInternalUuid(value.matchId)
  ) {
    const slotNumber = safeSlotNumber(value.slotNumber);
    if (
      (value.outcome === 'idempotent_retry' ||
        (value.action === 'join' && value.outcome === 'occupied') ||
        (value.action === 'leave' && value.outcome === 'released')) &&
      slotNumber !== undefined
    ) {
      return Object.freeze({
        domain: 'match_slot',
        action: value.action,
        outcome: value.outcome,
        matchId: value.matchId,
        slotNumber,
      });
    }
    if (
      value.outcome === 'rejected' &&
      includes(MATCH_REJECTIONS, value.reason)
    ) {
      return Object.freeze({
        domain: 'match_slot',
        action: value.action,
        outcome: 'rejected',
        matchId: value.matchId,
        reason: value.reason,
      });
    }
  }

  if (
    value.domain === 'match_chat' &&
    value.action === 'send_message' &&
    isInternalUuid(value.matchId)
  ) {
    if (
      (value.outcome === 'sent' || value.outcome === 'idempotent_retry') &&
      isInternalUuid(value.messageId)
    ) {
      return Object.freeze({
        domain: 'match_chat',
        action: 'send_message',
        outcome: value.outcome,
        matchId: value.matchId,
        messageId: value.messageId,
      });
    }
    if (
      value.outcome === 'rejected' &&
      includes(CHAT_REJECTIONS, value.reason)
    ) {
      return Object.freeze({
        domain: 'match_chat',
        action: 'send_message',
        outcome: 'rejected',
        matchId: value.matchId,
        reason: value.reason,
      });
    }
  }

  if (value.domain === 'private_booking' && value.action === 'create') {
    if (
      (value.outcome === 'created' ||
        value.outcome === 'idempotent_retry' ||
        value.outcome === 'unknown') &&
      isInternalUuid(value.reservationId) &&
      includes(RESERVATION_STATUSES, value.reservationStatus)
    ) {
      return Object.freeze({
        domain: 'private_booking',
        action: 'create',
        outcome: value.outcome,
        reservationId: value.reservationId,
        reservationStatus: value.reservationStatus,
      });
    }
    if (
      value.outcome === 'rejected' &&
      includes(BOOKING_REJECTIONS, value.reason)
    ) {
      return Object.freeze({
        domain: 'private_booking',
        action: 'create',
        outcome: 'rejected',
        reason: value.reason,
      });
    }
  }

  return undefined;
}

@Injectable()
export class BackendDomainEventLogger {
  private readonly logger = new Logger('DomainEvent');

  constructor(
    private readonly config: ConfigService,
    private readonly requests: RequestContextStore,
    private readonly metrics: BackendMetricsService,
  ) {}

  record(input: BackendDomainEvent): void {
    try {
      const event = safeEvent(input);
      const common = Object.freeze({
        event:
          event === undefined
            ? 'domain_operation_log_rejected'
            : 'domain_operation_completed',
        service: BACKEND_SERVICE,
        environment: safeEnvironment(this.config.get('NODE_ENV')),
        release: safeRelease(this.config.get('APP_RELEASE')),
        ...(this.requests.requestId() === undefined
          ? {}
          : { requestId: this.requests.requestId() }),
      });

      if (event === undefined) {
        this.logger.warn({
          ...common,
          outcome: 'invalid_logging_input',
        });
        return;
      }

      try {
        this.metrics.recordDomain({
          domain: String(event.domain),
          action: String(event.action),
          outcome: String(event.outcome),
          ...(event.reason === undefined
            ? {}
            : { reason: String(event.reason) }),
        });
      } catch {
        // Metrics are best-effort and must not suppress the domain log.
      }

      const output = Object.freeze({ ...common, ...event });
      if (event.outcome === 'rejected' || event.outcome === 'unknown') {
        this.logger.warn(output);
        return;
      }
      this.logger.log(output);
    } catch {
      // Observability is best-effort and must never alter a domain operation.
    }
  }
}
