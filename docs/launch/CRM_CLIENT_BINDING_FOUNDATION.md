# Telegram account → YCLIENTS client: local foundation

Date: 2026-09-15. Base: `3530fd8aebc22eca49342b878381cf272ef4e4c9` (live
origin/main read). Local implementation only; `deployment_deferred_by_user`.
WORKLOG is intentionally unchanged by direct owner instruction.

## Approved manual workflow (supersedes the SMS-first next step)

Owner chose manual linking on 2026-09-15. The existing administrator player
detail now has a YCLIENTS section: enter CRM client ID, inspect exact-read name
and masked phone, personally check that this application account and CRM card
belong to the same person, then explicitly attest. No SMS is required for this
method. A name, username or entered phone alone remains insufficient evidence.

`POST /admin/players/:playerId/crm-binding/preview` creates a five-minute durable
draft. `POST .../confirm` accepts only that draft UUID and `identityChecked:true`.
Identity authority is the authenticated administrator's current `club_admin`
capability, checked in PostgreSQL before provider read and again under short
locks before save; a normal player's boolean grants nothing. The draft binds
actor, target account, configured company, exact client ID, local profile revision
and provider `last_change_date`. Confirmation exact-reads again and refuses a
changed card, expired draft, revoked admin, phone revision change or occupied
binding. HTTP reads use no DB locks. No CRM mutation occurs.

`evidence_method=admin_attested`, administrator ID, draft ID and confirmed time
record the manual decision. No SMS verification state is forged. Unique owner/
company and company/client constraints are shared with the existing automatic
foundation. Successful retries recheck authority and current revision; unknown
outcomes can retry the same draft. There is no transfer/delete/rebind operation.
The existing owner GET status exposes only linked/not_linked/review_required.

Local runtime wiring is complete behind `CRM_MANUAL_BINDING_ENABLED=false` by
default; enabling requires database and YCLIENTS reads. UI never stores CRM
contacts/IDs in browser storage, never receives tokens, and clears pending work
through the existing session lifecycle. An admin sees only a name and four phone
digits from the provider. Existing membership reads/enrollment stay closed.

Unapplied migration 047 extends 046 for manual evidence and durable drafts.
Schema order is 042 → 046 → 047; the 042 dependency is storage only, not a working
SMS provider. Prepared drafts/committed attestations have no new retention policy
or cleanup job in this slice. Before rollout: real PostgreSQL migrations/ACL/
concurrency and controlled read-only YCLIENTS tests, then separate owner approval
for exact-commit integration and TEST rollout. No migrations or server flags have
been changed here; deployment remains `deployment_deferred_by_user`.

## Automatic phone path (still closed)

Authenticated player-only `GET` / `POST /api/v1/profile/crm-binding` take no
identity, company, contact or verification fields. Responses contain only
`outcome`; bearer guard sends `Cache-Control: no-store`. The automatic POST uses
`ClosedCrmBindingStore` and returns `not_configured`: no CRM or database call.
GET uses the manual status reader only when its separate flag is enabled.
No environment switch can manufacture successful phone verification.

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

046/047 SQL and read-only PRECHECK/POSTCHECK are artifacts only, not applied.
Require separately approved 042 deployment first, backup, exact database,
catalog/ACL review and real PostgreSQL concurrency checks before enabling the
Postgres adapter. No destructive rollback is supplied; disable runtime and use
a separately reviewed forward migration if recovery becomes necessary.

Impact: backend image/module, new schema and frontend bundle; no new dependencies.
No server env, payment, notification, reservation, GT.2 worktree or production
change. Push, main integration, migration and TEST deployment are explicitly
deferred. This is not ready for players.

Next step: approve controlled TEST validation and rollout of the manual workflow.
SMS verification is no longer a prerequisite for manual linking.
## Manual workflow local validation

Owner authorized main integration, TEST backup, migrations 046/047, frontend/
backend rollout and enabling manual binding on 2026-09-15. Fresh read-only
preflight confirmed TEST backend and clean server checkout at `3530fd8`,
PostgreSQL 14.23 and exact 042 POSTCHECK PASS with all six tables empty.
042 must not be reapplied. 046/047 targets and profile fence columns are absent;
owner/app privileges match the prerequisites. Runtime Compose now passes
`CRM_MANUAL_BINDING_ENABLED`, defaulting to false in the checked-in example.
No real binding is authorized without the owner's chosen account/card pair.
The historical deferred status above is superseded by this rollout approval;
the actual rollout result must be recorded separately after verification.

- Backend: typecheck/build PASS, all 207 unit suites / 4305 tests PASS,
  both e2e suites / 4 tests PASS. Final binding-only check: 8 suites / 138 tests.
- Frontend: 34 unit files / 205 tests PASS; build PASS (existing chunk-size
  warning). Full Playwright: 132 passed, 1 existing feature-disabled skip.
  The existing rating test now clicks the named Save button rather than the
  last button on the page; its original behavior assertions remain intact.
- Changed-file ESLint PASS. Repository-wide lint still reports existing issues
  in untouched AdminPlayersScreen.jsx and PlayerProfile.jsx; no baseline edits.
- Independent read-only review: CLEAR, including both phone orientations.
  Provider and DB tests here use doubles, not a real YCLIENTS card or PostgreSQL.
- Deployed environment/commit for this change: none. Containers changed: none.
  Public TEST `/healthz` and `/api/v1/health` returned HTTP 200 on 2026-09-15;
  this describes the existing deployment, not the unshipped manual feature.
  Live manual business smoke/log checks are pending the approved TEST gate;
  the current live commit is not verified (read-only SSH timed out).

The exact local checkpoint commit is recorded in the task response.
