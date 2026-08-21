# D4 payment persistence/concurrency contract

Status: `review_only`; local proposal based on payment foundation commit
`3f1fe588e9873dd9f862742b9eef64a8e482fb58`.

This document defines the persistence and concurrency acceptance contract for
`PaymentOrder` and initiate-only `PaymentAttempt`. It does not implement a
repository, database schema, migration, service, worker, controller, provider
adapter or runtime wiring.

## 1. Scope and authority

In scope:

- atomic start of one payment attempt;
- owner-scoped ledger idempotency;
- one unresolved attempt per order;
- transaction and process crash windows around an external acquiring write;
- fail-closed `unknown` state and read-only reconciliation;
- conceptual persistence constraints that a later migration must prove.

Out of scope:

- SQL or a migration file;
- selecting an acquiring or fiscal-receipt provider;
- capture, cancellation, refund, compensation, receipt execution or webhook
  inbox;
- Nest modules, controllers, jobs, queues, API routes or UI;
- DB, provider, server or Selectel calls;
- secrets, environment variables and production.

The existing `PaymentOrder` and `PaymentAttempt` state machines remain the only
domain transition authority. Persistence must reject an invalid hydrated pair
before any external call. Redirects, UI state and legacy `paymentStatus`,
`ownerPaid`, `holdAmount` or `prepay` fields are never payment evidence.

## 2. Aggregate persistence boundary

The atomic aggregate is one order plus its attempts:

- every repository command is scoped by `ownerAccountId`;
- an attempt must bind the same owner and order as the aggregate;
- the immutable order snapshot is never rewritten after creation;
- mutable order status, active-attempt binding and version change together with
  the corresponding attempt transition;
- reads that find mismatched owner/order/attempt/digest state return an invalid
  persisted-state failure and never repair it implicitly.

Required logical records are:

1. Payment order state and immutable economic snapshot.
2. Append-preserving payment-attempt ledger.
3. Owner/idempotency serialization claim.
4. External-write dispatch control for an attempt.
5. Reconciliation control metadata.

The last three may be columns or separate records in a future proposal. This
contract fixes their semantics, not their SQL representation.

Raw phone, email, receipt contact or fiscal payload must not be stored in these
records. `receiptContactSnapshotDigest` is an opaque digest produced by a
separately approved privacy adapter. Any later recoverable contact snapshot
requires its own encryption, access, retention and audit contract.

## 3. Required logical constraints

A future persistence design must prove all of the following atomically:

- unique order identity with owner-bound lookup;
- unique attempt identity with owner-bound lookup;
- unique `(ownerAccountId, idempotencyKey)` ledger scope;
- one active attempt for an order where active means `pending` or `unknown`;
- attempt owner/order binding cannot reference another aggregate;
- order `activeAttemptId` equals the sole active attempt ID;
- terminal order binding equals the terminal attempt acquiring binding;
- request digest and immutable request cannot change after insertion;
- optimistic order version increments exactly once per applied transition;
- timestamps are monotonic and terminal data is immutable.

Database isolation alone is insufficient for a missing idempotency row. Before
locking an order, a start transaction must acquire a collision-safe durable
serialization claim for the exact owner/key scope. A future migration review
must choose and prove the mechanism; a process-local mutex is not acceptable.

Lock order is fixed to avoid cross-path deadlocks:

1. owner/idempotency serialization claim;
2. payment order;
3. payment attempt;
4. dispatch or reconciliation control.

A transition that starts from an attempt ID may perform an unlocked owner-bound
lookup only to discover its key. It must then acquire the locks in the fixed
order and re-read every record before applying a transition.

## 4. Atomic attempt start

`startAttemptAtomically` has one transaction boundary:

1. Validate exact input shape, actor/owner and order binding.
2. Acquire the owner/idempotency serialization claim.
3. Lock and hydrate the owner-scoped order.
4. Look up the attempt by `(ownerAccountId, idempotencyKey)`.
5. If it exists, compare order, owner, type, route and request digest:
   - exact match returns that persisted attempt in any state;
   - any mismatch returns an idempotency/binding conflict.
6. If it does not exist, reject a non-pending order or any active attempt.
7. Apply the existing domain start transition.
8. Insert the attempt and update order active binding/version in one transaction.
9. Return `started` only after commit is known to have succeeded.

Two different keys racing for one order may both acquire their key claims, but
the order lock serializes them. After the winner commits, the loser rehydrates
the order and receives an active-attempt conflict without creating an attempt.

The same key value under different owners is independent. Repository responses
must not reveal whether another owner has the same key, order or attempt ID.

If commit acknowledgement is lost, the caller does not have authority to invoke
the acquiring port. It retries the atomic start lookup with the same owner/key;
the result is either the exact committed attempt or a fresh safe start. A storage
error must never be translated to local payment rejection.

## 5. External-write dispatch contract

No network call occurs inside a database transaction or while holding an order
lock. A write command may be built only from a committed, freshly hydrated
pending order/attempt pair that passes `paymentAttemptMatchesOrder`.

Before emitting request bytes, an executor must atomically claim dispatch for
the attempt. The claim is durable and single-winner. It binds:

- owner, order and attempt IDs;
- request digest;
- stable provider idempotency token derived from the attempt ID;
- claim time and control version.

An unclaimed pending attempt can be claimed later. Once a dispatch claim commit
has succeeded, the system must never automatically issue another acquiring
write for that attempt. A crash after the claim is indistinguishable from a
crash after request bytes reached the provider. Recovery therefore moves the
aggregate to `unknown` and uses reconciliation, even when the provider may not
have observed the request.

This fail-closed rule does not assume any provider idempotency duration or
capability. A later provider contract may strengthen recovery but cannot weaken
the ledger rule without separate review.

## 6. Crash-window matrix

| Window                                             | Durable local evidence                         | Required recovery                          | Forbidden action                |
| -------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ | ------------------------------- |
| Before start commit                                | none or rolled-back rows                       | retry atomic start with the same owner/key | call acquiring port             |
| Start commit succeeded, response lost              | exact pending attempt and active order binding | owner/key lookup returns exact attempt     | insert a second attempt         |
| Before dispatch-claim commit                       | committed pending attempt, no claim            | another executor may claim once            | emit without a committed claim  |
| Dispatch claim committed, before request bytes     | pending attempt plus claim                     | mark/recover as `unknown`, reconcile       | automatic write retry           |
| Request sent, response lost or malformed           | dispatch claim, no authoritative result        | atomically mark `unknown`, reconcile       | infer rejection or success      |
| Provider response received, result not committed   | dispatch claim; terminal result is not durable | recover as `unknown`, reconcile            | repeat write from memory        |
| Result transaction committed, acknowledgement lost | terminal order/attempt pair                    | exact outcome replay/no-op after hydration | apply a second transition       |
| Process restarts with claimed nonterminal attempt  | durable dispatch claim                         | converge to `unknown` before further work  | construct another write command |

If persistence is unavailable while marking `unknown`, the durable dispatch
claim remains the safety fence. Recovery must not dispatch and must keep retrying
the local unknown transition before reconciliation scheduling.

## 7. Atomic result transitions

Provider observations are inputs, not authority until persisted with the
aggregate. Result persistence must:

1. acquire locks in the fixed order;
2. hydrate and validate the order, attempt and dispatch claim;
3. prove the observation belongs to the claimed request digest and route;
4. apply one domain transition;
5. update order, attempt and control metadata in one transaction;
6. return success only after commit success.

Confirmed/rejected, `mark_unknown` and reconciled outcomes all use that pattern.
A constraint or version conflict after a possibly successful external write is
an uncertain local outcome: it must retain the dispatch fence and enter recovery,
not become `rejected`.

The current domain model has no transition command ID/evidence digest. Before
runtime orchestration, a later code-only slice must define exact replay semantics
for terminal and unknown observations, or the repository must persist an
equivalent immutable observation fingerprint. This proposal does not pretend
that terminal replay is already solved.

## 8. Unknown and reconciliation

`unknown` is unresolved authority, not a retryable failure:

- it remains the sole active attempt for the order;
- it blocks every new payment write for that order;
- only a provider read/reconciliation path may resolve it;
- absence at the provider is `still_unknown` unless a later reviewed provider
  contract defines authoritative nonexistence;
- an operator cannot manually mark paid/rejected without separately modelled,
  auditable evidence.

Reconciliation claim/update transactions use the same lock order. At most one
worker holds a claim for a reconciliation cycle. The provider read occurs after
claim commit and outside the transaction. Duplicate reads after crashes are
acceptable because reconciliation is read-only; duplicate writes are not.

An authoritative result is applied atomically to order and attempt. A competing
worker that observes the same terminal result returns an exact no-op; different
terminal evidence is an integrity conflict. `still_unknown` records bounded
attempt metadata without clearing the active attempt or dispatch fence.

Backoff, scheduling limits, retention and manual escalation policy require a
separate operational proposal. No infinite tight retry loop is permitted.

## 9. Repository failure contract

Repository failures must distinguish at least:

- invalid input or invalid persisted state;
- ownership/binding/idempotency conflict;
- active-attempt conflict;
- optimistic transaction conflict;
- commit outcome uncertain;
- database unavailable or storage failure.

Only a domain rejection proven before any dispatch can be returned as rejected
payment intent. Transaction conflict and storage failures are not acquiring
outcomes. Error/log metadata may contain internal IDs, fixed reason/stage codes
and correlation IDs, but no raw contact, fiscal payload, provider response body
or secrets.

## 10. Focused acceptance matrix for a later implementation

1. Concurrent same owner/key/digest creates one attempt and returns it to all
   callers.
2. Same owner/key with different digest, route or order yields conflict and no
   second attempt.
3. Different keys racing for one order create only one active attempt.
4. The same key under different owners is independent and leaks no existence.
5. Lost start-commit acknowledgement resolves by exact owner/key lookup before
   any acquiring call.
6. Only one executor can commit a dispatch claim.
7. Every crash after dispatch-claim commit converges to `unknown` without a
   second write.
8. Unknown blocks new attempts and permits reconciliation only.
9. Concurrent reconcilers apply one terminal result; exact replay is a no-op and
   conflicting evidence fails closed.
10. Corrupt owner/order/attempt/route/digest/version state fails before a port.
11. Terminal transition updates order, attempt and control metadata atomically.
12. Logs and persistence contain no raw receipt contact or fiscal payload.

Mocked concurrency tests must control transaction commit boundaries and external
call barriers; ordinary sequential mocks are insufficient evidence for cases
1, 3, 5, 6, 7 and 9.

## 11. Gates before any implementation

This contract requires separate future approval for each gate:

1. Repository types and deterministic concurrent mocked tests.
2. Observation replay/control state-machine additions.
3. Privacy and retention contract for recoverable receipt contacts, if needed.
4. Migration proposal with exact constraints, indexes and rollback boundaries.
5. SQL review and explicit migration approval.
6. Runtime orchestration and provider capability contract.
7. Selectel test rollout only if a later slice changes active runtime.

Current deployment status is `not_needed`: this proposal is documentation only,
and the existing payment foundation remains disconnected from Nest/runtime.
