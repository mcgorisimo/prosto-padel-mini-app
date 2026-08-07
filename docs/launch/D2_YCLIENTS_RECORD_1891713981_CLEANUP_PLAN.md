# D2 YCLIENTS record 1891713981 cleanup plan

Status: `review_only`; not executable and not approved for provider access.
Preparing this document performs no YCLIENTS, database or server call and no
write. The original controlled-lifecycle approval is consumed and cannot be
reused.

## Fixed incident binding

- Origin checkpoint: `e7ceeb49052f25b91aa4d20845cd41c4666d44e8`.
- Original plan digest:
  `5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d`.
- Durable provider binding: record `1891713981`, appointment `1`, slot `A`.
- Expected effect: service `30539679`, resource/court `5730531`, start
  `2026-08-17T12:00:00+03:00`.
- Gate 2 stopped after request 6 with `cleanup_required / snapshot_incomplete`.
  No reschedule or cancel request was made. Slot A remains held until canonical
  cancel proof.

Before any future provider request, an authenticated `club_admin` must verify
in the YCLIENTS UI that record `1891713981` is the disposable record at the
fixed effect above, is still active, and belongs to the approved disposable
identity. Evidence records only equality flags, not PII, screenshots containing
PII, tokens, record hash or raw provider data. A mismatch stops cleanup.

## Required code-only checkpoint

Implement and independently review a separate runtime-disabled cleanup
launcher. It must not reuse the consumed basic-lifecycle approval or accept
ad-hoc scripts/curl. It must:

- pin the exact record, appointment, slot A effect and isolated root-only paths;
- use a new plan digest and opaque identity-bound approval digest;
- reuse the existing admin read/write clients and shared conservative limiter;
- retain one in-flight request, at most one request per second and a hard
  provider budget of four requests;
- expose only allowlisted status/equality/effect evidence;
- contain no create, PUT/reschedule, repeat-delete or fallback endpoint;
- remain unreachable from Nest/application runtime and preserve the original
  audit and binding artifacts.

Do not weaken the canonical full-record parser to make cleanup pass. The
cleanup-specific pre-delete proof may use the durable binding, the recorded
manual UI verification and a bounded safe-list projection. If extra parser
diagnostics are needed, they may emit field-presence/equality flags only.

## Proposed one-time lifecycle

The future reviewed runner may perform exactly this sequence:

1. One bounded records page for resource `5730531` and `2026-08-17`, with
   `with_deleted=true`. Continue only when the page is exhaustive and exactly
   one row matches record `1891713981`, the fixed slot A effect and the original
   external-reference equality. Zero, multiple or mismatched candidates stop
   with `cleanup_required`; no DELETE is sent.
2. Send exactly one admin DELETE for record `1891713981`. No automatic retry,
   repeat-delete or alternate endpoint is allowed.
3. Perform one exact admin GET readback for the same record.
4. Perform one bounded exhaustive page readback with `with_deleted=true` and
   the same fixed projection.

Canonical cancel proof requires a unique matching record and consistent
deleted/cancelled evidence from the permitted readbacks. Only then may D2 mark
the provider cancellation confirmed and release slot A. An undocumented or
incomplete exact GET, stale list visibility, zero/multiple candidates, or
conflicting evidence is the safe terminal result `unknown`; it is not a reason
to widen the date/page window or send another write.

If DELETE has a transport timeout, HTTP 408/425/429/5xx, an invalid body or an
ambiguous success, classify the write as `unknown` and run only steps 3-4
within the same four-request budget. Never send a second DELETE. A documented
rejection also stops without retry. Slot A remains held for every result except
canonical cancel proof.

If a club administrator manually cancels the record before this lifecycle,
the write plan becomes invalid. A separately reviewed read-only proof plan and
new digest are then required; the cleanup runner must not issue DELETE.

## Evidence and recovery

Future artifacts may contain only checkpoint/digests, record and appointment
IDs, slot alias, step number, request count, status class, equality flags and
UTC timestamps. They must not contain the disposable client's name, phone or
email, auth headers/tokens, record hash, ciphertext or raw request/response
bodies. Use a new root-owned `0700/0600` cleanup layout and audit directory such
as:

```text
/root/prosto-padel-yclients-audit/cleanup-1891713981-<UTC>-<commit>/
```

Preserve the existing Gate 2 audit, consumed approval and provider binding. On
`unknown` or `cleanup_required`, retain the evidence and the slot A hold for a
new owner decision; do not silently perform manual cleanup.

## Approval gates still required

1. Owner approval for the separate code-only cleanup implementation.
2. Mocked contract tests plus independent P0/P1 security/concurrency/privacy
   review and a clean checkpoint.
3. Separate approval for isolated delivery/build and a dry-run with zero
   provider requests, producing the exact cleanup plan digest and one opaque
   approval digest.
4. Separate one-time execution approval naming the exact checkpoint, both
   digests, record `1891713981` and the maximum four-request lifecycle above.

No gate in this document authorizes API access, a provider write, server
change, deployment or manual cancellation.
