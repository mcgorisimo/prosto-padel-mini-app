# Telegram account → YCLIENTS client: local foundation

Date: 2026-09-15. Base: `3530fd8aebc22eca49342b878381cf272ef4e4c9` (live
origin/main read). Local implementation only; `deployment_deferred_by_user`.
WORKLOG is intentionally unchanged by direct owner instruction.

## Runtime and blocker

Authenticated player-only `GET` / `POST /api/v1/profile/crm-binding` take no
identity, company, contact or verification fields. Responses contain only
`outcome`; bearer guard sends `Cache-Control: no-store`. Runtime uses
`ClosedCrmBindingStore` and returns `not_configured`: no CRM or database call.
No environment switch can turn this into a successful verification.

Actual D5.2 has domain contracts, AEAD/digest adapters, an unapplied/disconnected
042 persistence package and a snapshot reader. It has no connected SMS
delivery/verifier/controller or runtime contact keyring. Telegram authentication,
profile phone, rating `isVerified`, email and client booleans are not phone proof.
The profile currently stores/edit phones independently of 042 contacts.

The implemented Postgres adapter reads a server-owned verified `phone_sms_otp`
challenge for `contact_ownership`, matching account, current contact version,
keyed subject digest and key version. It checks verification within challenge
expiry, valid server command ID, decrypts the existing AEAD contact bound to the
account/version, and compares it to the current profile phone. It never accepts
a browser-supplied proof. First binding requires verification younger than 600s;
this is a conservative local binding policy, not a YCLIENTS requirement.

## Lookup contract

Official [YCLIENTS REST API](https://developers.yclients.com/ru/) OpenAPI 3.0.3
was re-read on 2026-09-15 from its embedded `__redoc_state.spec.data`. Relevant
operations and schemas were inspected directly; no CRM customer call occurred.
The locally serialized full OpenAPI SHA-256 is
`418de644a3f0e378491fdbc137a469dea319e8ef7ed85752bb649a9448e5efa8`.

- `POST /api/v1/company/{company_id}/clients/search` is a read. Canonical phone
  digits appear only in JSON `quick_search.state.value`; fields request only ID,
  sorting uses ID ASC. Generic filter schema says array, while the official
  quick_search example uses string; this adapter follows that example.
- `GET /api/v1/client/{company_id}/{id}` exact read has an example, no formal
  response schema. It documents main `data.phone` as a number. Parser accepts
  bounded strings/safe integers, normalizes Russian 8/7 and formatting, checks
  exact ID and main phone. Name/email/additional phone are never identity keys.
- Scope is the single server-configured company at `https://api.yclients.com`.
  Redirects are forbidden. Explicit conflicting company IDs fail closed; the
  exact-read example omits company ID, so company scope comes from its URL.
- Bounds: 2 pages × 10, at most 20 candidates/24 requests, 15s whole lookup,
  3s HTTP request, 128 KiB response. Shared conservative limiter, no retries.
  Queued calls cannot dispatch after deadline. A second full candidate pass
  detects ordinary pagination drift; repeated/unsorted IDs, changing counts,
  incomplete pages, missing primary phones, 429/timeouts/errors → `unknown`.
- No rows after both complete passes → `no_match`. Candidates with zero main
  phone matches or multiple main matches → `review_required`. Exactly one main
  match in complete stable candidate passes → eligible to save.

YCLIENTS offers no consistent snapshot or CRM phone uniqueness guarantee. The
two passes cannot prove the absence of a concurrent, invisible provider change.
Future membership/enrollment integration must revalidate the exact CRM client;
`linked` status alone does not authorize reading or spending a membership.
Both membership endpoints remain closed in this stage.

## Local concurrency and phone changes

Short transactions use an owner advisory lock, then lock active account,
profile, contact and verified challenge. All locks/connections are released
before HTTP. Save re-reads the same challenge, contact version/digest, profile
revision and freshness. Unique `(account_id,company_id)` and
`(company_id,client_id)` arbitrate competing requests. Insert-only bindings
are never overwritten, deleted or transferred. Repeated successful binds read
current proof; in-flight double clicks return `unknown`, then may retry safely.
No cached success or negative result can bypass current proof validation.

Migration 046 adds two internal profile fence columns and a trigger on every
phone mutation, including A→B→A. Only challenges started strictly after the last
phone edit second qualify. This intentionally requires a new challenge after
initial migration and rejects same-second edits conservatively. Contact/proof
key material stays outside PostgreSQL; binding stores internal IDs and keyed
digest only. A changed/reconfirmed phone never silently rewrites an existing
binding: `phone_verification_required` or `review_required` blocks reuse.

The restricted SECURITY DEFINER proof-read function has a fixed search_path
and returns encrypted evidence only to the backend role; 042 table ACLs remain
unchanged. Profile phone is included transiently for comparison. No proof/body,
raw CRM ID or provider exception is returned publicly or logged.

## Migration / release handoff

046 SQL and read-only PRECHECK/POSTCHECK are artifacts only, not applied.
Requires separately approved 042 deployment first, backup, exact database,
catalog/ACL review and real PostgreSQL concurrency checks before enabling the
Postgres adapter. No destructive rollback is supplied; disable runtime and use
a separately reviewed forward migration if recovery becomes necessary.

Impact: backend image/module and new schema; no dependencies or frontend change.
No server env, payment, notification, reservation, GT.2 worktree or production
change. Push, main integration, migration and TEST deployment are explicitly
deferred. This is not ready for players.

Next step: complete the existing D5.2 SMS verification runtime and its trusted
contact write path; then approve and test the combined migration/runtime on TEST.
Exact tests, independent review and local commit are recorded in task messages.
