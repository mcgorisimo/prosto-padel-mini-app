# Manual YCLIENTS binding — TEST rollout

Date: 2026-09-15. Owner explicitly approved configuration, main integration,
TEST backup, migrations 046/047, frontend/backend rollout and enabling manual
binding. WORKLOG is deliberately unchanged by the owner's separate instruction.

Current TEST runtime: `85d21aea0851087449f9d160888c01a587eceeaf` (email follow-up).
The original `4da0f1b` rollout below is retained as migration/backup history;
current rollout and smoke evidence are in the final section.

## Applied release

- Environment: Selectel TEST, Compose project `prosto-padel-test`, database
  `prosto_padel_test_migration_cycle`, PostgreSQL 14.23. Public checks used
  `https://app.prostopdl.ru` on the existing TEST deployment.
- Exact integrated and deployed runtime commit:
  `4da0f1bec6c7449a01d6b4f2ba0d2247707e2cdc`.
- Main fast-forwarded from `3530fd8`; server checkout was clean before/after.
- Rebuilt and recreated only `backend` and `frontend`. Existing nginx,
  PostgreSQL and monitoring services were not recreated.
- Backend image: `sha256:25e15a691ed0a34c1eab1bc8cf0e7d7dac5b4d3287030398ed226a30b1fb0099`.
- Frontend image: `sha256:0b78f0c6e3e56242445f59368e5f47ba58920b23845df352e2889f6ba2ca6f6c`.
- Backend `APP_RELEASE` matches the full commit above;
  `CRM_MANUAL_BINDING_ENABLED=true`. Only these two env entries changed;
  existing owner and mode 0600 were preserved. Other flags/secrets were kept.
- No production rollout or YCLIENTS mutation was performed.

## Backup and schema evidence

Root-only audit directory (mode 0700):
`/root/prosto-padel-migration-audit/046-047-manual-20260915T193148Z`.
Contains database custom dump, globals, previous env, checksums, exact migration
artifacts and precheck/apply/postcheck output. Dump and globals are mode 0600;
checksums and `pg_restore --list` passed. The database dump is 897207 bytes.
This is an on-host operational backup, not a new external recovery copy.

- Existing 042 exact POSTCHECK passed, including unchanged fingerprints/ACLs
  and all six tables empty. 042 was not reapplied.
- Restored schema only into a separate temporary validation database, then
  applied exact 046 and 047. No player data was copied into that database.
- Real PostgreSQL tests passed with synthetic identities: authorized/denied
  context; concurrent attempts for one company/client yield one binding;
  capability revocation waits on the active context; revoked access is denied;
  app cannot mutate bindings or read 042 contacts; immutable guard rejects
  deletion; phone A→B→A advances revision. No provider requests occurred.
- Validation results saved in `postgres-validation.json`. The temporary
  validation database was removed after success.
- Applied 046 followed by 047 to TEST. Inspected actual POSTCHECK output:
  unique keys/FKs/checks present; immutable triggers enabled; public function
  access false; app narrow execution and state-update grants true; broad
  mutation grants false; SECURITY DEFINER context has a fixed search_path.
  New binding/draft tables were empty immediately after apply.

## Release checks

- Backend: typecheck, 4305 unit tests, 4 e2e tests and build PASS.
- Frontend: full Playwright 132 passed / 1 existing skip; build PASS.
- Runtime Compose static contract and `config --quiet` PASS.
- Independent migration/Compose review CLEAR before apply.
- Both recreated containers healthy, restart count zero. Public `/healthz`
  and `/api/v1/health` returned HTTP 200. Manual preview without a session
  returned HTTP 401.
- Public frontend asset `/assets/index-DGCtLACD.js` returned HTTP 200, contains
  the manual binding UI and exactly matches the container bytes (SHA-256
  `745a758607b0143faea6eb57812bbe0e4a1132d6be9e21d1f0916967a913c692`).
- Bounded post-rollout log check: backend 118 lines, frontend 18 lines,
  zero ERROR/FATAL/unhandled-rejection lines. No raw logs or contacts exported.

## Remaining live acceptance

Deployment is applied and health verified. The owner-selected real card/account
pair still needs provider lookup and manual browser confirmation, then a read
of the persisted binding and a retry check. Do not call that business scenario
complete until these pass. Do not manufacture an administrator session or SMS
verification state to complete the check.
The proposed phone-based provider lookup was not executed: automatic approval
review required explicit permission for that phone egress. The owner is instead
locating the card's internal ID/address. No binding has been created by this task.

This evidence-only documentation update has `deployment=not_needed`; it changes
no runtime, schema or configuration. The deployed runtime SHA remains the exact
release above, even when main advances by this documentation commit.

## Recovery

Disable only `CRM_MANUAL_BINDING_ENABLED` and recreate backend if the manual
feature needs to be stopped. The existing automatic phone-binding path remains
closed. Previous images are retained as
`prosto-padel-test-backend:crm-before-20260915` and
`prosto-padel-test-frontend:crm-before-20260915` (source release `3530fd8`).
No destructive schema rollback is supplied; investigate and use a reviewed
forward migration if needed. Do not drop the applied binding/audit tables.

## Email follow-up — 2026-09-15

Owner requested adding email after discussing email-based manual CRM lookup.
The existing onboarding `normalized_email` column already stores declared
contact data. Own-profile GET/PATCH now exposes, edits and clears it; the
personal-information screen carries the value through the credential lifecycle.
Public player projections remain unchanged. Email is not verified identity.

Manual preview accepts exactly one selector: numeric `clientId` or `email` in
the authenticated POST body. Current administrator capability is checked before
provider access. Email search is company-scoped and bounded, verifies exact
normalized email on each candidate, rejects ambiguous matches, and rechecks
search pagination. The exact card version must remain unchanged between lookup,
preview and confirmation. Existing durable drafts and administrator attestation
remain the binding authority; searching alone never creates a binding.

No new migration, dependency, configuration flag or provider mutation is needed.
TEST preflight: clean runtime `4da0f1b`, healthy services, existing email column
constraint and app-role SELECT/UPDATE privileges verified (all true).

Validation: backend typecheck, 4326 unit tests, 4 e2e tests and build PASS;
frontend 207 unit tests, 132 Playwright tests with 1 existing skip, build PASS.
Changed frontend modules pass ESLint. Browser coverage includes invalid email,
normalization, save/reopen/clear and manual email/ID preview with safe retry.
Portrait manual-email preview visually checked. Existing bundle-size warning
remains. Final integration, deployed SHA and post-rollout evidence follow below.
WORKLOG remains unchanged under the owner's earlier explicit instruction.

Independent review CLEAR after closing one incomplete-candidate ambiguity:
missing/malformed email on any exact candidate returns unknown (six regressions).
Real TEST PostgreSQL smoke under app role verified write/read/clear and isolation
from a second synthetic account. The entire transaction was rolled back; zero
synthetic rows remain. No real contact or provider query was used for this smoke.

### Email rollout completed

- Commit `85d21aea0851087449f9d160888c01a587eceeaf` was committed and pushed
  atomically to the feature branch and `main` by fast-forward. TEST checkout and
  backend APP_RELEASE equal that exact SHA; manual binding remains enabled.
- Only frontend/backend were recreated, both healthy with zero restarts.
  All other containers retained their IDs; no migration or database rebuild.
- Backend image: `sha256:c3afe8fe137cdcddbf9315f89389ec0e18f7ec728aa1ef4324ba9a02cfbfd5d8`.
- Frontend image: `sha256:14a61ce737ca861ea8ab9173979112c8dcf36ac2c32e6aeb7933cd96a7dbc3f2`.
- Public TEST `/healthz` and `/api/v1/health`: HTTP 200. Own profile and email
  preview without a session: HTTP 401. Public `/assets/index-BGYW94r1.js` contains
  both email controls and exactly matches the frontend container bytes;
  SHA-256 `6c14ee94831573b87a80de6211da1e075c783f939abb45da054f6f121674ad8f`.
- Post-rollout smoke extracted the actual deployed profile writer's parameterized
  SQL and executed its write/read/clear flow against TEST PostgreSQL under the
  app role. A second synthetic account stayed unchanged, the transaction was
  rolled back, and zero synthetic accounts remained. No provider calls.
- Post-rollout bounded logs: backend 119 lines, frontend 20 lines, zero errors.
- Root-only audit: `/root/prosto-padel-migration-audit/email-20260915T200346Z`.
  Previous env is saved as mode 0600; build/rollout/post-smoke evidence is there.
  Previous images retained with tag `crm-email-before-85d21ae` for both services.
- User flow: reopen Mini App; Settings > Personal information > Email; save.
  Administrator opens a player and uses Email or client ID in the YCLIENTS
  section, reviews the returned card, then personally confirms the identity.
  End-to-end acceptance against the owner's real CRM card remains pending that
  explicit lookup and confirmation; synthetic tests are not real CRM acceptance.

This post-rollout evidence update is docs-only (`deployment=not_needed`);
runtime remains the exact SHA above. No production rollout was performed.

## Live email lookup failure — 2026-09-15

The owner reported a failed email preview. After explicit permission for that
email to be sent to api.yclients.com, a bounded read-only reproduction using
the deployed integration returned HTTP 403 on the first client-search request,
with the provider reason "Нет прав на управление компанией". No card, draft,
binding or provider data was changed by the diagnostic. Personal contact values
and tokens are deliberately omitted from this report.

The application previously collapsed this denial into `unknown` and displayed
confirmation-retry guidance even when only a preview had been requested.
Manual email lookup and exact-card reads now classify provider HTTP 401/403 as
`provider_forbidden`, with fixed UI guidance to check the integration's club
connection and client permissions. Raw provider messages are not returned.
Other preview failures invite a search retry; unknown confirmation keeps its
existing same-draft retry behavior. The closed phone-verification flow retains
its existing contract. No migration, dependency or configuration change.

Validation: backend typecheck, 4330 unit tests, 4 e2e tests and build PASS;
frontend 210 unit tests, 132 Playwright tests with 1 existing skip and build PASS.
Changed frontend modules pass ESLint; diff check PASS. Browser coverage tests
provider denial followed by successful retry for email and numeric ID, personal
attestation and an unknown confirmation retry. Existing bundle-size warning
remains. Runtime impact: frontend/backend; controlled TEST rollout follows.

Real successful lookup/link acceptance remains blocked on YCLIENTS integration
access to company 2079564. The owner must verify the connected application and
system user's client-base rights; see the official API access instructions:
https://support.yclients.ru/67-68-199--dostup-k-api/ . This is an external access
dependency, not a completed business scenario. WORKLOG remains unchanged under
the owner's earlier explicit instruction.
