# D2 YCLIENTS controlled runner — operational runbook

Status: `prepared_for_independent_review`. This document does not authorize a
push, Selectel access, provider call or write. Application runtime and
containers remain disconnected from this runner.

## Compiled entrypoint and fixed plan

The owner-only entrypoint is compiled from
`backend/src/integrations/yclients/yclients-controlled-launcher.ts` to:

```text
backend/dist/integrations/yclients/yclients-controlled-launcher.js
```

It contains the exact reviewed non-PII plan from
`D2_YCLIENTS_CONTROLLED_RUNBOOK.md`: company, run-scoped external reference,
service, slots A/B, list windows and identity binding. Its digest must be:

```text
5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d
```

The launcher requires effective UID 0, the canonical
`https://api.yclients.com` endpoint, the exact reviewed paths listed below,
concrete cross-process approval and root-only binding gates. Alternate paths,
unknown/duplicate flags, positional arguments, unknown modes and the
wrong/missing execute digest fail before identity, secret or provider access.
Dry-run is the default and cannot accept an approval digest.

## Root-only input layout

Only after the first approval gate, create this isolated host layout; do not
mount it into the application containers:

```text
/root/prosto-padel-d2-controlled/                 0700
  checkout/                                      isolated detached checkout
  secrets/                                       0700
    identity.json                                0600
    yclients-partner-token                       0600
    yclients-user-token                          0600
  artifacts/                                     0700
    approval.sha256                              0600; absent for dry-run
    approval.sha256.consumed                     created atomically by execute
    provider-binding.json                        created only after known create
```

Provision the two token files from the already approved Selectel host secret
files without printing their values. Provision `identity.json` through a secure
root-only editor/input channel; never place its contents in shell history. The
file must be one canonical UTF-8 JSON object, optional final LF, in this exact
key order:

```json
{"version":1,"binding":"d2-disposable-identity-v1","fullName":"<VALUE>","phone":"<VALUE>","email":"<VALUE>"}
```

The placeholders above are documentation only. The real PII is not in Git,
argv, stdout, errors or evidence. Parent ownership/mode, symlinks, UID and inode
stability are validated by the compiled file store. The launcher derives a
domain-separated HMAC binding from the canonical identity and the two existing
root-only YCLIENTS token files, then hashes it with the fixed plan digest into
an opaque `approvalDigest`. Neither a public PII verifier nor an ordinary PII
digest is stored in Git. Replacing the identity contents, token files or any
reviewed path changes `approvalDigest` and makes the previously approved file
fail before lifecycle/provider access.

## Gate 1 — delivery, isolated build and dry-run

This gate needs a separate owner approval after independent review of the
operational checkpoint. It may authorize only:

1. push the exact D2 branch commit;
2. create the isolated root-only checkout/layout on Selectel test;
3. fetch and detach at that exact commit, verify `git rev-parse HEAD`;
4. run `npm ci`, backend build and the dry-run command below;
5. retain only PII-safe stdout and file metadata evidence.

It must not authorize application checkout changes, image/container rebuild,
compose/env/runtime changes, provider requests or booking writes. The exact
dry-run command from `checkout/backend` is:

```text
node dist/integrations/yclients/yclients-controlled-launcher.js --api-base-url https://api.yclients.com --identity-file /root/prosto-padel-d2-controlled/secrets/identity.json --artifact-dir /root/prosto-padel-d2-controlled/artifacts --partner-token-file /root/prosto-padel-d2-controlled/secrets/yclients-partner-token --user-token-file /root/prosto-padel-d2-controlled/secrets/yclients-user-token
```

PASS requires exit code 0 and exactly one safe terminal object with
`outcome=dry_run_ready`, the plan digest above, one opaque 64-hex
`approvalDigest` and `providerRequestCount=0`. The Gate 1 evidence records that
opaque approval digest without tokens or PII.
`approval.sha256`, its consumed marker and provider binding must still be
absent; the launcher itself rejects a dry-run when any is present. Any mismatch
stops the sequence.

Suggested exact Gate 1 wording, replacing the placeholder only after this
checkpoint is committed and independently accepted:

> Разрешаю push D2 branch с exact operational checkpoint
> `<OPERATIONAL_CHECKPOINT_SHA>` и только isolated root-only setup/build/dry-run
> на Selectel test по `D2_YCLIENTS_OPERATIONAL_RUNBOOK.md`. Application checkout,
> runtime, containers, compose/env, production и любые YCLIENTS provider calls
> или writes не менять. При несовпадении SHA, ownership/mode, build или digest
> немедленно остановиться.

## Gate 2 — one-time controlled lifecycle

Gate 2 is considered only after Gate 1 evidence and a new independent review.
Before execution, the owner separately approves the exact Gate 1
`approvalDigest` together with the plan digest and checkpoint. A root operator
writes exactly that approval digest plus optional LF to
`artifacts/approval.sha256` as `0600`; both
`approval.sha256.consumed` and `provider-binding.json` must be absent. Then the
same detached checkout and compiled file are invoked with only these extra
arguments:

```text
--mode execute --plan-digest 5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d
```

The full Gate 2 wording remains in `D2_YCLIENTS_CONTROLLED_RUNBOOK.md`, but must
reference the accepted operational checkpoint and the exact opaque
`approvalDigest`, not only the public plan digest or superseded `481c578...`.
Unknown/cleanup-required recovery still needs a new record-specific approval;
it is not included in Gate 2.
