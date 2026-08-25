# Migration 041 — personal data processing consent evidence

Status: `candidate_not_applied_runtime_disconnected`

This migration widens the existing immutable consent ledger with the distinct
kind `personal_data_processing`. It does not rename, update, delete, or backfill
historical `privacy` evidence. It also does not connect any frontend or backend
runtime writer.

## Exact evidence contract

The onboarding transition guard accepts only these distinct kind sets for the
same account, flow version, and existing acceptance time window:

- legacy: `cancellation`, `privacy`, `terms`;
- new: `cancellation`, `personal_data_processing`, `terms`;
- transition: `cancellation`, `personal_data_processing`, `privacy`, `terms`.

No other three-of-four subset is valid. Exact document versions remain an
application-policy responsibility; the ledger continues to bind every accepted
kind to its immutable `document_version`, `flow_version`, and `accepted_at`.

The primary key, foreign key, immutable UPDATE/DELETE trigger, existing rows,
table privileges, and column-scoped application INSERT privilege remain
unchanged. The historical `privacy` kind stays allowed so existing evidence and
old runtime behavior continue to work.

## Separate apply gate

This candidate must not be applied during local implementation review. After an
exact commit is integrated, a separately approved Selectel test-DB/schema gate
must:

1. verify the exact migration artifacts and a clean server checkout;
2. stop the unchanged backend for the schema/guard lock window;
3. create and verify a backup;
4. run `041_backend_personal_data_processing_consent_PRECHECK.sql` read-only and
   record its row count, by-kind counts, and evidence digest;
5. apply only `041_backend_personal_data_processing_consent.sql` with
   fail-on-error;
6. run `041_backend_personal_data_processing_consent_POSTCHECK.sql` read-only and
   compare the row count and evidence digest with PRECHECK;
7. restart the same backend image and verify health and logs.

The schema migration is backward compatible with the current three-kind
runtime. New two-checkbox consent UI, policy versions, re-consent endpoints, and
runtime writes for `personal_data_processing` are later, separately reviewed
slices. The auth-integration catalog intentionally remains unchanged because
its exact test inventory does not include onboarding relations or this guard.

## Rollback boundary

`041_backend_personal_data_processing_consent_ROLLBACK.sql` is not part of the
apply sequence and requires a separate explicit command. It refuses before and
after acquiring locks if any `personal_data_processing` evidence exists. It
never deletes evidence. When no new-kind evidence exists, it restores the exact
migration-035 three-kind constraint, migration-037 transition guard and
post-036 function ACL.

After any new-kind evidence exists, recovery must use a reviewed forward
migration. Earlier onboarding rollback artifacts must not run before migration
041 has been safely rolled back.

## Deployment impact

The candidate changes only unapplied SQL/Markdown artifacts and a focused
contract test. Frontend/backend runtime, DB/schema, Selectel, provider, and
production remain unchanged: `deployment=not_applied_not_needed_for_candidate`.
