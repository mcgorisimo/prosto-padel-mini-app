# D2 legacy unbound reservation cleanup plan

Status: `applied_verified` on Selectel test; the one-time cleanup completed on
2026-08-10 and must not be executed again.

Prepared artifact:

- script: `docs/migrations/D2_legacy_unbound_reservation_cleanup.sql`;
- SHA-256: `f6a9e06ea416198a248d586db604cf3a4e9eb3b8ef3a6c80be7b49e743eb8142`;
- static contract suite:
  `backend/src/database/d2-legacy-unbound-reservation-cleanup.spec.ts`.

The suite validates the exact bytes, target set, lock/update order, backup
boundary including the atomic no-clobber claim, guarded row counts,
migration-033 terminal shapes, forbidden
hard-delete/schema/payment mutations and postcheck-before-commit ordering. It
does not execute the script or make a database connection.

Execution evidence:

- exact source commit:
  `4515549f58d714624a333fbb059dd4054b1e1439`;
- exact script SHA-256:
  `f6a9e06ea416198a248d586db604cf3a4e9eb3b8ef3a6c80be7b49e743eb8142`;
- fixed result: `D2_LEGACY_UNBOUND_CLEANUP_PASS|8|8`;
- independent read-only postcheck: eight rejected reservations, eight
  reconciled/rejected operations, eight released holds, zero active holds and
  unchanged cancelled negative control;
- durable root-owned `0600` backup was created inside the atomic root-owned
  `0700` claim. The claim remains and forbids a repeated invocation.

The first temporary client launch failed before a PostgreSQL connection because
the Compose env names were not mapped into the client. Claim absence and the
unchanged `5 pending / 3 unknown / 8 holds` state were proved before the exact
script was started. The successful PostgreSQL 14 client run emitted five
`SHELL_ERROR` meta-command compatibility warnings even though all five shell
commands succeeded. The fixed PASS plus independent artifact/DB postchecks
prove this execution result; the consumed script must not be reused as a
general PostgreSQL-14 runbook.

## Scope and evidence

This is a one-time Selectel test data repair for eight reservations created
while provider-create finalization was broken. The product owner confirmed that
the corresponding old bookings were removed in YCLIENTS. These local rows have
no reservation or operation YCLIENTS record binding, so normal exact refresh
cannot obtain canonical deletion proof.

Only these reservation IDs are in scope:

| Reservation ID | Pre-execution reservation / create-operation status |
| --- | --- |
| `b286b04e-66af-4237-84fb-10bc2a9c99c9` | `unknown / unknown` |
| `953f1810-9a65-4a1b-bee5-c2b9d9cd4f12` | `unknown / unknown` |
| `3d49b170-61a6-4b77-b497-ad62b4f414f6` | `unknown / unknown` |
| `4257aa93-00ee-4c2d-b971-1111a07a71f5` | `pending_confirmation / pending` |
| `1e1fa95a-c042-4141-a922-29a0d78bf61f` | `pending_confirmation / pending` |
| `d7a8a984-7131-4047-94da-38e39c5b597a` | `pending_confirmation / pending` |
| `48c74dee-5248-4f75-8fc7-cfafc4a3223c` | `pending_confirmation / pending` |
| `94105b19-c497-4ff3-816b-bc28691daab5` | `pending_confirmation / pending` |

Before execution, every target had exactly one active `reservation` hold. Fully-bound
reservation `2cf39988-358d-4009-b64c-c017d3c1d0b5`, already proved
`cancelled` with zero active holds, is an explicit negative control and must not
be changed.

## Intended terminal representation

The rows must not be hard-deleted and must not be marked `cancelled`:
migration 033 correctly requires a full provider binding for `cancelled`.
Instead, the maintenance transaction records the legacy create outcome as
administratively resolved without a provider binding:

- reservation: `rejected`, terminal timestamp set;
- create operation: `reconciled`, `reconciliation_outcome='rejected'`;
- fixed reason: `admin_confirmed_legacy_unbound_cleanup`;
- pending operations first receive the `unknown` shape before reconciliation;
- reconciliation attempts increment once and `last_reconciliation_at` is set;
- the one active hold is released, not deleted;
- encrypted client snapshot, digests, idempotency key, request, targets and
  provider-attempt timestamps remain unchanged.

This mirrors the domain path `pending -> unknown -> reconciled/rejected` and
`unknown -> reconciled/rejected`. The UI already excludes `rejected` bookings.

## Historical execution precheck

Execution required an exact approval. The reviewed script used `ON_ERROR_STOP`,
`BEGIN ISOLATION LEVEL SERIALIZABLE`, a bounded `statement_timeout` and
`lock_timeout`, and lock rows in this order: reservations, create operations,
then active holds, each ordered by reservation ID.

Before mutation, the reviewed precheck required all assertions simultaneously:

1. the target set equals the eight IDs above; no extra or missing row;
2. each has exactly one create operation and no other active operation;
3. statuses equal the table above;
4. all reservation and operation provider-binding columns are null;
5. each target has exactly one unreleased `reservation` hold and no reschedule
   hold;
6. owner, target, operation request/digest, snapshot and hold bindings are
   internally consistent;
7. the negative-control reservation remains `cancelled`, fully bound and has
   zero active holds;
8. a single cleanup timestamp is not earlier than any affected `updated_at`;
9. exact affected rows are exported to a root-owned `0600` sensitive backup
   artifact without printing owner IDs, ciphertext, digests or contact data;
   the artifact is not deleted by the cleanup gate.

Any mismatch required `ROLLBACK` and STOP. The target set was not widened.

## Executed transaction order

The reviewed execution script used guarded `UPDATE ... WHERE` statements
with exact expected row counts:

1. materialize the five pending reservation/operation pairs as `unknown`,
   preserving the absence of a provider binding;
2. transition all eight reservations to `rejected` and all eight operations to
   `reconciled/rejected` with the fixed reason and monotonic timestamps;
3. release exactly eight active holds using `released_at`, `updated_at` and
   `version=version+1` required by the migration-033 hold trigger;
4. run all postchecks below before `COMMIT`.

No application endpoint, YCLIENTS read/write, provider retry, new migration,
schema change, snapshot crypto destruction or runtime deployment was part of
this cleanup.

## Postcheck and rollback boundary

Before commit, the postcheck required exactly:

- eight `rejected` reservations with null provider binding;
- eight `reconciled/rejected` create operations with the fixed reason;
- zero active holds for the eight targets;
- unchanged encrypted snapshot count and immutable operation/request fields;
- the negative control unchanged;
- migration-033 constraint and trigger checks passing.

After commit, one bounded owner refresh hid all eight legacy cards. Health and
PII-safe critical-log checks remained clean.

Before `COMMIT`, any failure uses transaction rollback. After commit, do not
blindly restore holds: a new booking may already occupy an interval. Any
post-commit rollback needs separate approval, the sensitive backup, a fresh
overlap precheck and an exact restore plan.

## Remaining gates

The one-time execution gate is complete. Do not remove the claim and do not
execute this script again. Any future data repair requires a new target-specific
artifact, PostgreSQL-client compatibility tests, independent review and a new
explicit approval.

## Historical approval template

The template below is retained as historical review evidence and no longer
authorizes an execution:

> Разрешаю исполнить exact cleanup script commit `<reviewed_commit>`, SHA-256
> `<script_sha256>`, одноразово и только на Selectel
> test для восьми reservation IDs из
> D2_LEGACY_UNBOUND_RESERVATION_CLEANUP_PLAN.md: выполнить backup и fail-closed
> PRECHECK, затем в одной SERIALIZABLE transaction перевести только эти
> unbound legacy reservations/operations в rejected/reconciled-rejected и
> освободить ровно восемь holds, выполнить POSTCHECK и commit только при полном
> совпадении. YCLIENTS/API calls, hard delete, schema/migration/runtime/
> production changes и расширение target set запрещены. При любом расхождении
> выполнить ROLLBACK и остановиться.
