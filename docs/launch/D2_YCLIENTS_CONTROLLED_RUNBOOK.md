# D2 YCLIENTS controlled lifecycle — prepared runbook

Status: `prepared_for_independent_review`; real YCLIENTS create/reschedule/cancel
writes are **not approved**. This runbook is Selectel test only.

Operational note: checkpoint `481c578e418cb6302cf072bb04524c488637f823`
is superseded for real writes pending the concrete launcher checkpoint. Delivery,
isolated build and dry-run now follow `D2_YCLIENTS_OPERATIONAL_RUNBOOK.md` and
require their own approval before the separate one-time write approval below.

## Exact non-PII plan

- plan ID: `d2-controlled-basic-20260817`;
- plan digest:
  `5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d`;
- company: `2079564`;
- identity binding: `d2-disposable-identity-v1`; the owner supplied the
  disposable full name, phone and email, but their values are not stored in Git,
  logs, evidence or this runbook;
- service: `30539679`, «Аренда корта 1ч.»;
- slot A: `2026-08-17T12:00:00+03:00`, Корт №1, resource `5730531`, 3600 seconds;
- slot B: `2026-08-18T12:00:00+03:00`, Корт №2, resource `5762241`, 3600 seconds;
- list A: page 1, count 50, resource A, date `2026-08-17`,
  `with_deleted=false`;
- deleted/final list B: page 1, count 50, resource B, date `2026-08-18`,
  `with_deleted=true`;
- a run-scoped server-derived external reference is bound into the digest but is
  omitted from normal output and evidence; duplicate-reference testing is not
  part of this plan.

On 2026-08-07 the existing Selectel test configuration was checked without
printing values. Both mounted YCLIENTS credentials, enabled flag and company
binding were present. The disposable identity was confirmed by the owner and
was not persisted. Nine bounded preparation requests were made: three safe
mapping reads and six final date/time/preflight reads. Both slots were visible
and `book_check` returned `bookable`. No booking record was created, changed or
deleted. Availability is point-in-time evidence only: approved execution must
repeat lifecycle steps 1–4 and stop before create if either slot is no longer
bookable.

## Runner gate

`YclientsControlledTestRunner.run()` is dry-run by default and performs zero
provider requests. The concrete launcher returns the plan digest plus an
opaque, root-secret-keyed `approvalDigest`; neither value exposes PII.
Execution requires all of:

1. mode `execute`;
2. the exact digest above supplied separately;
3. a root-only approval file containing the separately owner-approved
   `approvalDigest` for the same identity/token snapshot and an atomic
   cross-process consumed marker claimed before lifecycle construction;
4. a fresh lifecycle instance using the existing guarded create client, shared
   conservative limiter, exact/bounded readers and controlled PUT/DELETE client.

A mismatch, missing/consumed approval or failed identity binding causes zero
provider requests. One execution has a hard maximum of 14 sequential provider
requests. There is no retry/fallback create, PUT or DELETE path. SMS/email state
must be proven completely off by exact GET before PUT; otherwise execution stops
before reschedule. Evidence contains only the existing allowlisted action,
status/effect aliases, request count and UTC timestamp.

The approved operational layout is a new owner-only (`0700`) directory outside
the repository and application container mounts. For this plan its files are
`approval.sha256` (`0600`, exact opaque approval digest plus optional final LF),
`approval.sha256.consumed` (`0600`, created with exclusive-create semantics),
and `provider-binding.json` (`0600`, also exclusive-create). The executable
assembly accepts only a cross-process approval gate and a root-only exclusive
binding sink. No approval or artifact file exists yet. A stale or existing
consumed marker blocks all provider calls even after process restart.

The executable also accepts only the canonical
`https://api.yclients.com` endpoint (a trailing slash is normalized away).
HTTP, another host, credentials in URL, query, fragment or any extra path fail
before identity verification, approval consumption or client construction.
The POSIX artifact store requires the effective runner UID to own the final
`0700` directory and every `0600` file; ancestors may be owned only by root or
that UID and cannot be group/world-writable. Symlinks and directory/inode
changes fail closed.

Immediately after a successful create response and before exact GET, the
binding sink must durably write only version, slot alias, appointment ID and
record ID. Failure or an existing artifact stops the lifecycle at request 5 as
`cleanup_required`; no further provider call is allowed. PII, external
reference, record hash, auth and raw bodies are excluded from this artifact.

## Recovery and cleanup

Every result is terminal for the current approval. A second write always needs
a new explicit cleanup approval. A known create is recoverable from the
root-only exclusive binding artifact even after a runner crash; record hash,
PII and raw bodies are never copied.

| Result | Allowed automatic readback | Holds / required action |
|---|---|---|
| uncertain create (`C5`) | Skip exact GET because record ID is unknown; perform only the planned bounded list A projection. | 0 or more than 1 candidate remains `unknown`; exactly 1 candidate is `cleanup_required`. Keep A held. Do not cancel without new approval. In YCLIENTS UI locate the exact A/time/identity candidate, capture its record ID only in the root-only binding artifact, then use exact GET before separately approved cleanup. |
| known create, binding artifact failure, incomplete snapshot/list | No extra write. Use the create response while the process is alive; otherwise the state is `cleanup_required` and manual UI reconciliation is required. When persisted, the known record ID may be used for a separately approved exact GET. | Keep A held. Manually compare record ID, A, service and identity in YCLIENTS UI; cancellation is a new approval. |
| uncertain reschedule (`C8`) | Exact GET step 9 only; classify effect as A, B or ambiguous. | Keep both A and B held. No cancel/repeated PUT. Use the known record ID for manual UI comparison and a separately approved cleanup plan. |
| rejected reschedule after known create | No automatic cancel. | Keep A held and mark `cleanup_required`; verify the known record ID by exact GET/UI before a new cleanup approval. |
| uncertain first cancel (`C10`) | Exact GET step 11 and bounded `with_deleted` list step 12 only. | Never repeat DELETE. Canonical exact+list deleted proof releases the hold; otherwise keep B held and reconcile the known record ID manually. |
| uncertain repeat-delete (`C13`) | Final bounded deleted list step 14 only. | No further write. Deleted proof leaves no hold; missing/ambiguous proof remains `unknown` for manual record-ID reconciliation. |
| evidence failure or any unexpected result | Only the contingency read already allowed for the step, if any. | Stop, preserve all indicated holds and do not widen page/date windows. Manual YCLIENTS UI cleanup must target the exact known record ID and then obtain canonical deleted proof before releasing a court. |

Manual YCLIENTS cleanup evidence records only run ID, record ID in the root-only
binding artifact, A/B alias, action/status class and UTC timestamp. Screenshots
must be cropped/redacted so no identity or unrelated club records are visible.

## Exact next approval wording

Do not request or execute this approval until the runner checkpoint passes an
independent review. The owner can then use exactly this wording, replacing only
the checkpoint placeholder with the reviewed commit SHA:

> Одобряю однократный controlled YCLIENTS basic lifecycle только на Selectel
> test для runner checkpoint `<RUNNER_CHECKPOINT_SHA>` и plan digest
> `5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d`.
> Разрешаю максимум 14 последовательных provider requests по утверждённой цепочке
> availability/preflight A и B → один create A → exact/list proof → один
> cross-resource reschedule B → exact proof → один cancel → exact/list cancel
> proof → repeat-delete classification, включая только заранее описанные
> read-only C5/C8/C10/C13 contingency steps. Disposable identity binding и слоты
> A/B должны точно совпасть с runbook; SMS/email полностью off. Любой uncertain
> write запрещает дальнейшие writes. Duplicate api_id experiment, blind retries,
> runtime/Nest wiring, DB/schema/migration, deploy и production не разрешаю.

The final Gate 2 wording must additionally include the exact
`<APPROVAL_DIGEST>` captured from the accepted Gate 1 dry-run. The public plan
digest alone is insufficient and must never be copied into
`approval.sha256`.

Any manual cleanup after an unknown/cleanup-required result is deliberately not
covered by that approval and needs a new exact record-ID cleanup decision.
