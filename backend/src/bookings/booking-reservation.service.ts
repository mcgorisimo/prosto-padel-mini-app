import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  CourtReservationPersistenceError,
  CourtReservationPersistenceFailure,
  CourtReservationPersistenceCause,
  CourtReservationPersistenceStage,
} from '../database/court-reservation.repository';
import { PostgresCourtReservationRepository } from '../database/postgres-court-reservation.repository';
import { PostgresPlayerProfileReader } from '../database/postgres-player-profile-reader';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import { YclientsAdminReadClient } from '../integrations/yclients/yclients-admin-read.client';
import { YclientsAvailabilityService } from '../integrations/yclients/yclients-availability.service';
import { YclientsBookingService } from '../integrations/yclients/yclients-booking.service';
import { scanBoundedYclientsCandidates } from '../integrations/yclients/yclients-read-reconciliation';
import { createCourtReservation } from '../reservations/reservation.state-machine';
import {
  CourtReservation,
  CourtReservationId,
  ReservationIdempotencyKey,
  ReservationOperation,
  courtReservationId,
  isReservationClientSnapshot,
  newCourtReservationId,
  newReservationOperationId,
  reservationIdempotencyKey,
  reservationProviderRejectionReason,
} from '../reservations/reservation.types';
import {
  BOOKING_RESERVATION_DIAGNOSTIC_SINK,
  BookingReservationDiagnosticSink,
  BookingReservationFinalizationOutcome,
  BookingReservationFinalizationStage,
} from './booking-reservation.diagnostics';

export const BOOKING_RESERVATION_CLOCK = Symbol('BOOKING_RESERVATION_CLOCK');
export interface BookingReservationClock { nowEpochSeconds(): number }

export type BookingReservationView = Readonly<{
  reservationId: CourtReservationId;
  status: CourtReservation['status'];
  serviceId: number;
  courtId: number;
  startsAt: string;
  endsAt: string;
  stale: boolean;
}>;

export type CreateBookingReservationResult =
  | Readonly<{ outcome: 'created' | 'idempotent_retry'; reservation: BookingReservationView }>
  | Readonly<{ outcome: 'unknown'; reservation: BookingReservationView }>
  | Readonly<{ outcome: 'invalid_request' | 'contact_incomplete' | 'not_bookable' | 'conflict' | 'provider_rejected' | 'unavailable' }>;

export type ReadBookingReservationResult =
  | Readonly<{ outcome: 'found'; reservation: BookingReservationView }>
  | Readonly<{ outcome: 'not_found' }>
  | Readonly<{ outcome: 'unavailable' }>;

export type ListBookingReservationsResult =
  | Readonly<{ outcome: 'loaded'; reservations: ReadonlyArray<BookingReservationView> }>
  | Readonly<{ outcome: 'unavailable' }>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_SIGNED_INTEGER = 2_147_483_647;
const STALE_PROVIDER_ATTEMPT_SECONDS = 120;

function now(clock: BookingReservationClock) {
  const value = clock.nowEpochSeconds();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid booking clock');
  return unixEpochSeconds(value);
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 320 && EMAIL_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

function fullName(firstName: string, lastName?: string): string | undefined {
  const normalized = [firstName, lastName].filter(Boolean).join(' ').trim();
  return normalized.length > 0 && normalized.length <= 256 ? normalized : undefined;
}

function apiId(ownerAccountId: AccountId, requestKey: ReservationIdempotencyKey): number {
  const digest = createHash('sha256')
    .update('yclients-booking\0', 'utf8')
    .update(ownerAccountId, 'utf8')
    .update('\0', 'utf8')
    .update(requestKey, 'utf8')
    .digest();
  return (digest.readUInt32BE(0) % MAX_SIGNED_INTEGER) + 1;
}

function view(reservation: CourtReservation, stale: boolean): BookingReservationView {
  return Object.freeze({
    reservationId: reservation.reservationId,
    status: reservation.status,
    serviceId: reservation.target.serviceId,
    courtId: reservation.target.courtId,
    startsAt: reservation.target.startsAt,
    endsAt: reservation.target.endsAt,
    stale,
  });
}

function terminalResult(operation: ReservationOperation, reservation: CourtReservation): CreateBookingReservationResult {
  if (operation.status === 'confirmed' || (operation.status === 'reconciled' && operation.result.outcome === 'confirmed')) {
    return Object.freeze({ outcome: 'idempotent_retry', reservation: view(reservation, false) });
  }
  if (operation.status === 'rejected' || (operation.status === 'reconciled' && operation.result.outcome === 'rejected')) {
    return Object.freeze({ outcome: 'provider_rejected' });
  }
  return Object.freeze({ outcome: 'unknown', reservation: view(reservation, true) });
}

function persistenceDiagnosticOutcome(
  error: unknown,
): Readonly<{
  outcome: CourtReservationPersistenceFailure | 'unexpected_failure';
  persistenceStage?: CourtReservationPersistenceStage;
  persistenceCause?: CourtReservationPersistenceCause;
}> {
  return error instanceof CourtReservationPersistenceError
    ? Object.freeze({
        outcome: error.reason,
        ...(error.stage === 'unspecified'
          ? {}
          : { persistenceStage: error.stage }),
        ...(error.cause === undefined
          ? {}
          : { persistenceCause: error.cause }),
      })
    : Object.freeze({ outcome: 'unexpected_failure' });
}

@Injectable()
export class BookingReservationService {
  constructor(
    private readonly transactions: PostgresTransactionRunner,
    private readonly reservations: PostgresCourtReservationRepository,
    private readonly profiles: PostgresPlayerProfileReader,
    private readonly availability: YclientsAvailabilityService,
    private readonly booking: YclientsBookingService,
    private readonly adminRead: YclientsAdminReadClient,
    @Inject(BOOKING_RESERVATION_CLOCK) private readonly clock: BookingReservationClock,
    @Inject(BOOKING_RESERVATION_DIAGNOSTIC_SINK)
    private readonly diagnostics: BookingReservationDiagnosticSink,
  ) {}

  private recordFinalization(
    reservation: CourtReservation,
    operation: ReservationOperation,
    stage: BookingReservationFinalizationStage,
    outcome: BookingReservationFinalizationOutcome,
    persistenceStage?: CourtReservationPersistenceStage,
    persistenceCause?: CourtReservationPersistenceCause,
  ): void {
    try {
      this.diagnostics.record(Object.freeze({
        reservationId: reservation.reservationId,
        operationId: operation.operationId,
        stage,
        outcome,
        ...(persistenceStage === undefined ? {} : { persistenceStage }),
        ...(persistenceCause === undefined ? {} : { persistenceCause }),
      }));
    } catch {
      // Diagnostics are best-effort and must never alter reservation safety.
    }
  }

  private async persistUnknownAfterDispatch(
    ownerAccountId: AccountId,
    reservation: CourtReservation,
    operation: ReservationOperation,
    timestamp: ReturnType<typeof now>,
  ): Promise<CourtReservation> {
    try {
      const fallback = await this.transactions.runInTransaction((tx) =>
        this.reservations.finalizeStartedCreateOperation(
          tx,
          ownerAccountId,
          reservation.reservationId,
          operation,
          {
            type: 'mark_unknown',
            actorAccountId: ownerAccountId,
            now: timestamp,
          },
        ),
      );
      if (fallback.outcome === 'transitioned') {
        this.recordFinalization(
          fallback.reservation,
          fallback.operation,
          'persist_unknown_fallback',
          'unknown_persisted',
        );
        return fallback.reservation;
      }
      this.recordFinalization(
        reservation,
        operation,
        'persist_unknown_fallback',
        'transition_rejected',
      );
    } catch (error) {
      const diagnostic = persistenceDiagnosticOutcome(error);
      this.recordFinalization(
        reservation,
        operation,
        'persist_unknown_fallback',
        diagnostic.outcome,
        diagnostic.persistenceStage,
        diagnostic.persistenceCause,
      );
    }
    return reservation;
  }

  async create(ownerAccountId: AccountId, input: Readonly<{requestKey: string;serviceId:number;courtId:number;datetime:string;email:string}>): Promise<CreateBookingReservationResult> {
    let requestKey: ReservationIdempotencyKey;
    const email = normalizeEmail(input?.email);
    try { requestKey = reservationIdempotencyKey(input?.requestKey); }
    catch { return Object.freeze({ outcome: 'invalid_request' }); }
    if (!Number.isSafeInteger(input?.serviceId) || input.serviceId < 1 || !Number.isSafeInteger(input?.courtId) || input.courtId < 1 || typeof input?.datetime !== 'string' || !Number.isFinite(Date.parse(input.datetime)) || email === undefined) {
      return Object.freeze({ outcome: 'invalid_request' });
    }

    let contact: Readonly<{phone:string;fullName:string;email:string}>;
    try {
      const profileResult = await this.transactions.runInTransaction((tx) => this.profiles.findByAccountId(tx, { accountId: ownerAccountId }));
      const name = profileResult.outcome === 'found' ? fullName(profileResult.profile.firstName, profileResult.profile.lastName) : undefined;
      const phone = profileResult.outcome === 'found' ? profileResult.profile.phone : undefined;
      if (name === undefined || phone === undefined || !/^\+[1-9]\d{6,14}$/u.test(phone)) return Object.freeze({ outcome: 'contact_incomplete' });
      const snapshot = Object.freeze({ phone, fullName: name, email });
      if (!isReservationClientSnapshot(snapshot)) {
        return Object.freeze({ outcome: 'contact_incomplete' });
      }
      contact = snapshot;
    } catch { return Object.freeze({ outcome: 'unavailable' }); }

    let started: Readonly<{reservation:CourtReservation;operation:ReservationOperation;retry:boolean}> | undefined;
    try {
      started = await this.transactions.runInTransaction(async (tx) => {
        await this.reservations.lockIdempotencyKey(tx, ownerAccountId, requestKey);
        const existing = await this.reservations.findOperationByIdempotencyKey(tx, ownerAccountId, requestKey);
        if (existing === null || existing.request.type !== 'create') return undefined;
        const reservation = await this.reservations.findById(tx, ownerAccountId, existing.reservationId);
        if (reservation === null) throw new Error('missing idempotent reservation');
        const timestamp = now(this.clock);
        const result = await this.reservations.startOperation(tx, ownerAccountId, existing.reservationId, {
          operationId: existing.operationId, actorAccountId: ownerAccountId,
          idempotencyKey: requestKey, now: timestamp,
          request: { type: 'create', reservationId: existing.reservationId, ownerAccountId, externalReference: { apiId: apiId(ownerAccountId, requestKey) }, client: contact,
            target: { serviceId: input.serviceId, courtId: input.courtId, startsAt: input.datetime, endsAt: existing.request.target.endsAt } },
        });
        if (result.outcome === 'rejected') throw Object.assign(new Error('create rejected'), { domainReason: result.reason });
        return Object.freeze({ reservation: result.reservation, operation: result.operation, retry: true });
      });
    } catch (error) {
      return Object.freeze({ outcome: (error as {domainReason?:string})?.domainReason === 'idempotency_key_conflict' ? 'conflict' : 'unavailable' });
    }

    if (started === undefined) {
      const date = input.datetime.slice(0, 10);
      let durationSeconds: number | undefined;
      try {
        const available = await this.availability.listAvailableTimes({ serviceId: input.serviceId, courtId: input.courtId, date });
        durationSeconds = available.outcome === 'loaded'
          ? available.times.find((slot) => slot.datetime === input.datetime)?.durationSeconds
          : undefined;
        if (available.outcome === 'loaded' && durationSeconds === undefined) return Object.freeze({ outcome: 'not_bookable' });
        if (available.outcome !== 'loaded') return Object.freeze({ outcome: 'unavailable' });
      } catch { return Object.freeze({ outcome: 'unavailable' }); }
      if (durationSeconds === undefined) return Object.freeze({ outcome: 'unavailable' });
      const endsAt = new Date(Date.parse(input.datetime) + durationSeconds * 1_000).toISOString();
      try {
        started = await this.transactions.runInTransaction(async (tx) => {
          await this.reservations.lockIdempotencyKey(tx, ownerAccountId, requestKey);
          const existing = await this.reservations.findOperationByIdempotencyKey(tx, ownerAccountId, requestKey);
          const reservationId = existing?.reservationId ?? newCourtReservationId();
          let reservation = await this.reservations.findById(tx, ownerAccountId, reservationId);
          const timestamp = now(this.clock);
          if (reservation === null) {
            reservation = createCourtReservation({ reservationId, ownerAccountId, target: { serviceId: input.serviceId, courtId: input.courtId, startsAt: input.datetime, endsAt }, now: timestamp });
            const created = await this.reservations.create(tx, reservation);
            if (created.outcome === 'rejected') throw new Error('reservation conflict');
            reservation = created.reservation;
          }
          const result = await this.reservations.startOperation(tx, ownerAccountId, reservationId, {
            operationId: existing?.operationId ?? newReservationOperationId(), actorAccountId: ownerAccountId,
            idempotencyKey: requestKey, now: timestamp,
            request: { type: 'create', reservationId, ownerAccountId, externalReference: { apiId: apiId(ownerAccountId, requestKey) }, client: contact,
              target: { serviceId: input.serviceId, courtId: input.courtId, startsAt: input.datetime, endsAt } },
          });
          if (result.outcome === 'rejected') throw Object.assign(new Error('create rejected'), { domainReason: result.reason });
          return Object.freeze({ reservation: result.reservation, operation: result.operation, retry: result.outcome === 'idempotent_retry' });
        });
      } catch (error) {
        return Object.freeze({ outcome: (error as {domainReason?:string})?.domainReason === 'idempotency_key_conflict' ? 'conflict' : 'unavailable' });
      }
    }

    if (started.retry && started.operation.status !== 'pending') {
      return terminalResult(started.operation, started.reservation);
    }
    type DispatchClaim = 'not_attempted'|'claimed'|'already_started'|'not_pending'|'failed';
    let claim: DispatchClaim = 'not_attempted';
    let provider;
    try {
      provider = await this.booking.createBooking(
        { apiId: started.operation.request.externalReference.apiId, serviceId: input.serviceId, courtId: input.courtId, datetime: input.datetime, client: { phone: contact.phone.slice(1), fullName: contact.fullName, email: contact.email } },
        async () => {
          try {
            claim = await this.transactions.runInTransaction((tx) => this.reservations.claimProviderAttempt(tx, ownerAccountId, started.operation.operationId, now(this.clock)));
            return claim === 'claimed';
          } catch {
            claim = 'failed';
            return false;
          }
        },
      );
    } catch { provider = Object.freeze({ outcome: 'unknown_outcome' as const }); }
    if (provider.outcome === 'not_dispatched') {
      const claimResult = claim as DispatchClaim;
      if (claimResult === 'already_started') {
        try {
          const timestamp = now(this.clock);
          const attempt = await this.transactions.runInTransaction((tx) => this.reservations.readProviderAttempt(tx, ownerAccountId, started.operation.operationId));
          if (attempt?.startedAt !== undefined && attempt.startedAt <= Number(timestamp) - STALE_PROVIDER_ATTEMPT_SECONDS) {
            await this.transactions.runInTransaction((tx) => this.reservations.transitionOperation(tx, ownerAccountId, started.reservation.reservationId, started.operation.operationId, {type:'mark_unknown',actorAccountId:ownerAccountId,now:timestamp}));
          }
        } catch { /* held fail-closed */ }
        return Object.freeze({ outcome: 'unknown', reservation: view(started.reservation, true) });
      }
      return claimResult === 'failed' || claimResult === 'not_attempted'
        ? Object.freeze({ outcome: 'unavailable' })
        : Object.freeze({ outcome: 'unknown', reservation: view(started.reservation, true) });
    }
    const dispatchClaim = claim as DispatchClaim;
    const timestamp = now(this.clock);
    const finalizationStage: BookingReservationFinalizationStage =
      provider.outcome === 'created' ? 'confirm_binding' : 'persist_unknown';
    try {
      const transitioned = await this.transactions.runInTransaction((tx) => {
        if (dispatchClaim !== 'claimed') return this.reservations.transitionOperation(tx, ownerAccountId, started.reservation.reservationId, started.operation.operationId, { type:'reject',actorAccountId:ownerAccountId,now:timestamp,reason:reservationProviderRejectionReason(provider.outcome==='not_bookable'?'not_bookable':'provider_not_dispatched') });
        if (provider.outcome === 'created') return this.reservations.finalizeStartedCreateOperation(tx, ownerAccountId, started.reservation.reservationId, started.operation, { type:'confirm',actorAccountId:ownerAccountId,now:timestamp,providerBinding:{provider:'yclients',appointmentId:provider.appointmentId,recordId:provider.recordId,recordHash:provider.recordHash} });
        return this.reservations.finalizeStartedCreateOperation(tx, ownerAccountId, started.reservation.reservationId, started.operation, {type:'mark_unknown',actorAccountId:ownerAccountId,now:timestamp});
      });
      if (transitioned.outcome !== 'transitioned') {
        this.recordFinalization(
          started.reservation,
          started.operation,
          finalizationStage,
          'transition_rejected',
        );
        if (dispatchClaim === 'claimed') {
          const held = await this.persistUnknownAfterDispatch(
            ownerAccountId,
            started.reservation,
            started.operation,
            timestamp,
          );
          return Object.freeze({ outcome:'unknown', reservation:view(held,true) });
        }
        return Object.freeze({outcome:'unknown',reservation:view(started.reservation,true)});
      }
      if (transitioned.operation.status === 'confirmed') {
        this.recordFinalization(
          transitioned.reservation,
          transitioned.operation,
          'confirm_binding',
          'confirmed',
        );
        return Object.freeze({ outcome:'created', reservation:view(transitioned.reservation,false) });
      }
      if (transitioned.operation.status === 'rejected') return Object.freeze({ outcome: provider.outcome === 'not_bookable' ? 'not_bookable' : 'unavailable' });
      this.recordFinalization(
        transitioned.reservation,
        transitioned.operation,
        'persist_unknown',
        'unknown_persisted',
      );
      return Object.freeze({outcome:'unknown',reservation:view(transitioned.reservation,true)});
    } catch (error) {
      const diagnostic = persistenceDiagnosticOutcome(error);
      this.recordFinalization(
        started.reservation,
        started.operation,
        finalizationStage,
        diagnostic.outcome,
        diagnostic.persistenceStage,
        diagnostic.persistenceCause,
      );
      if (dispatchClaim !== 'claimed') {
        return Object.freeze({ outcome: 'unknown', reservation: view(started.reservation, true) });
      }
      const held = await this.persistUnknownAfterDispatch(
        ownerAccountId,
        started.reservation,
        started.operation,
        timestamp,
      );
      return Object.freeze({ outcome: 'unknown', reservation: view(held, true) });
    }
  }

  async read(ownerAccountId: AccountId, rawReservationId: string): Promise<ReadBookingReservationResult> {
    let reservationId: CourtReservationId;
    try { reservationId = courtReservationId(rawReservationId); } catch { return Object.freeze({outcome:'not_found'}); }
    let reservation: CourtReservation | null;
    try { reservation = await this.transactions.runInTransaction((tx) => this.reservations.findById(tx, ownerAccountId, reservationId)); }
    catch { return Object.freeze({outcome:'unavailable'}); }
    if (reservation === null) return Object.freeze({outcome:'not_found'});
    if (reservation.providerBinding === undefined) {
      let current = reservation;
      let candidateAttempt: Readonly<{ apiId: number }> | null = null;
      if (reservation.status === 'pending_confirmation') {
        try {
          const timestamp = now(this.clock);
          const classified = await this.transactions.runInTransaction(async (tx) => {
            const attempt = await this.reservations.readLatestCreateAttempt(
              tx,
              ownerAccountId,
              reservationId,
            );
            if (
              attempt === null ||
              attempt.status !== 'pending' ||
              (attempt.startedAt ?? attempt.createdAt) >
                Number(timestamp) - STALE_PROVIDER_ATTEMPT_SECONDS
            ) {
              return Object.freeze({ reservation: current, attempt: null });
            }
            const transition = await this.reservations.transitionOperation(
              tx,
              ownerAccountId,
              reservationId,
              attempt.operationId,
              attempt.startedAt === undefined
                ? {
                    type: 'reject',
                    actorAccountId: ownerAccountId,
                    now: timestamp,
                    reason: reservationProviderRejectionReason(
                      'provider_not_dispatched',
                    ),
                  }
                : {
                    type: 'mark_unknown',
                    actorAccountId: ownerAccountId,
                    now: timestamp,
                  },
            );
            if (transition.outcome !== 'transitioned') {
              return Object.freeze({ reservation: current, attempt: null });
            }
            if (transition.operation.status !== 'unknown') {
              return Object.freeze({
                reservation: transition.reservation,
                attempt: null,
              });
            }
            const claimed = await this.reservations.claimUnknownCreateReconciliation(
              tx,
              ownerAccountId,
              reservationId,
              timestamp,
            );
            return Object.freeze({
              reservation: transition.reservation,
              attempt: claimed,
            });
          });
          current = classified.reservation;
          candidateAttempt = classified.attempt;
        } catch { /* stale pending remains held fail-closed */ }
      } else if (reservation.status === 'unknown') {
        try {
          const timestamp = now(this.clock);
          candidateAttempt = await this.transactions.runInTransaction((tx) =>
            this.reservations.claimUnknownCreateReconciliation(
              tx,
              ownerAccountId,
              reservationId,
              timestamp,
            ),
          );
        } catch { /* bounded readback remains safely unknown */ }
      }
      if (candidateAttempt !== null) {
        try {
          await scanBoundedYclientsCandidates(
            this.adminRead,
            {page:1,count:50,resourceId:current.target.courtId,dateFrom:current.target.startsAt.slice(0,10),dateTo:current.target.startsAt.slice(0,10),withDeleted:true},
            {apiId:candidateAttempt.apiId,resourceId:current.target.courtId,serviceIds:[current.target.serviceId],datetime:current.target.startsAt,deleted:false},
          );
        } catch {
          /* claimed readback stays unknown/held and is not repeated */
        }
      }
      return Object.freeze({
        outcome:'found',
        reservation:view(
          current,
          current.status==='unknown' || current.status==='pending_confirmation',
        ),
      });
    }
    if (reservation.status !== 'confirmed') return Object.freeze({outcome:'found',reservation:view(reservation,false)});
    let exact;
    try { exact = await this.adminRead.getRecord(reservation.providerBinding.recordId); }
    catch { exact = Object.freeze({outcome:'unknown' as const}); }
    if (exact.outcome === 'not_found') {
      try {
        const deleted = await scanBoundedYclientsCandidates(
          this.adminRead,
          {
            page: 1,
            count: 50,
            resourceId: reservation.target.courtId,
            dateFrom: reservation.target.startsAt.slice(0, 10),
            dateTo: reservation.target.startsAt.slice(0, 10),
            withDeleted: true,
          },
          {
            apiId: await this.transactions.runInTransaction(async (tx) => {
              const operation = await this.reservations.readLatestCreateAttempt(
                tx,
                ownerAccountId,
                reservationId,
              );
              if (operation === null) throw new Error('missing create operation');
              return operation.apiId;
            }),
            resourceId: reservation.target.courtId,
            serviceIds: [reservation.target.serviceId],
            datetime: reservation.target.startsAt,
            deleted: true,
          },
        );
        if (
          deleted.outcome === 'candidate' &&
          deleted.record.recordId === reservation.providerBinding.recordId
        ) {
          const exactApiId = deleted.record.apiId;
          if (exactApiId === undefined) throw new Error('missing external id');
          const updated = await this.transactions.runInTransaction((tx) =>
            this.reservations.applyExactRefresh(tx, ownerAccountId, reservationId, {
              expectedVersion: reservation.version,
              companyId: deleted.record.companyId,
              recordId: deleted.record.recordId,
              proof: { kind: 'external_api_id', apiId: exactApiId },
              serviceId: reservation.target.serviceId,
              courtId: reservation.target.courtId,
              startsAt: reservation.target.startsAt,
              endsAt: reservation.target.endsAt,
              deleted: true,
              now: now(this.clock),
            }),
          );
          if (updated.outcome === 'updated') {
            return Object.freeze({
              outcome: 'found',
              reservation: view(updated.reservation, false),
            });
          }
        }
      } catch {
        // A 404/list mismatch remains stale and held; no provider write follows.
      }
      try { await this.transactions.runInTransaction((tx) => this.reservations.noteReconciliationAttempt(tx,ownerAccountId,reservationId,now(this.clock))); } catch { /* response stays stale */ }
      return Object.freeze({outcome:'found',reservation:view(reservation,true)});
    }
    if (
      exact.outcome !== 'found' ||
      exact.record.recordId !== reservation.providerBinding.recordId ||
      exact.record.serviceIds.length !== 1 ||
      exact.record.seanceLengthSeconds === undefined
    ) {
      try { await this.transactions.runInTransaction((tx) => this.reservations.noteReconciliationAttempt(tx,ownerAccountId,reservationId,now(this.clock))); } catch { /* response stays stale */ }
      return Object.freeze({outcome:'found',reservation:view(reservation,true)});
    }
    try {
      const serviceId = exact.record.serviceIds[0];
      if (serviceId === undefined) return Object.freeze({outcome:'found',reservation:view(reservation,true)});
      const endsAt = new Date(Date.parse(exact.record.datetime) + exact.record.seanceLengthSeconds * 1_000).toISOString();
      // A CRM mutation may omit api_id from either an active or a soft-deleted
      // record. Only the exact endpoint for the already-persisted terminal
      // record binding may use recordId itself as the refresh proof.
      const proof = exact.record.apiId === undefined
        ? exact.record.deleted
          ? Object.freeze({ kind: 'exact_deleted_record' as const })
          : Object.freeze({ kind: 'exact_active_record' as const })
        : Object.freeze({
            kind: 'external_api_id' as const,
            apiId: exact.record.apiId,
          });
      const updated=await this.transactions.runInTransaction((tx)=>this.reservations.applyExactRefresh(tx,ownerAccountId,reservationId,{expectedVersion:reservation.version,companyId:exact.record.companyId,recordId:exact.record.recordId,proof,serviceId,courtId:exact.record.resourceId,startsAt:exact.record.datetime,endsAt,deleted:exact.record.deleted,now:now(this.clock)}));
      return updated.outcome==='updated' ? Object.freeze({outcome:'found',reservation:view(updated.reservation,false)}) : Object.freeze({outcome:'found',reservation:view(reservation,true)});
    } catch { return Object.freeze({outcome:'found',reservation:view(reservation,true)}); }
  }

  async readByRequestKey(
    ownerAccountId: AccountId,
    rawRequestKey: string,
  ): Promise<ReadBookingReservationResult> {
    let requestKey: ReservationIdempotencyKey;
    try { requestKey = reservationIdempotencyKey(rawRequestKey); }
    catch { return Object.freeze({ outcome: 'not_found' }); }
    try {
      const operation = await this.transactions.runInTransaction((tx) =>
        this.reservations.findOperationByIdempotencyKey(tx, ownerAccountId, requestKey),
      );
      if (operation === null || operation.type !== 'create') {
        return Object.freeze({ outcome: 'not_found' });
      }
      return this.read(ownerAccountId, operation.reservationId);
    } catch {
      return Object.freeze({ outcome: 'unavailable' });
    }
  }

  async list(ownerAccountId: AccountId): Promise<ListBookingReservationsResult> {
    try {
      const reservations = await this.transactions.runInTransaction((tx) =>
        this.reservations.listByOwner(tx, ownerAccountId, 20),
      );
      return Object.freeze({
        outcome: 'loaded',
        reservations: Object.freeze(
          reservations.map((reservation) =>
            view(
              reservation,
              reservation.status === 'unknown' ||
                reservation.status === 'pending_confirmation',
            ),
          ),
        ),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' });
    }
  }
}
