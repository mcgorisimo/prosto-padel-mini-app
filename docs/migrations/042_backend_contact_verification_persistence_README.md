# Migration 042 — backend contact-verification persistence

Status: `prepared_for_review`, `not_applied`, `runtime_disconnected`.

This expand-only package prepares provider-neutral Selectel PostgreSQL storage
for current encrypted account contacts, phone/email verification challenges,
append-only commands, durable delivery reservations, durable abuse buckets and
PII-safe append-only audit. It does not select or call an SMS/email provider,
connect a repository/controller/module, add secrets, alter checkout/UI, or
change any payment, rating, YCLIENTS, Supabase or production behavior.

## Privacy and concurrency boundary

- Canonical phone/email values, active proof material, delivery payloads and
  optional reconciliation references are stored only as bounded AEAD envelopes
  with algorithm/key version metadata. Equality and byte-equivalence use keyed
  32-byte digests with their own key versions. Keys and plaintext remain outside
  PostgreSQL.
- Challenges bind the authenticated account, contact field/version, closed
  field/method pair and the single `contact_ownership` purpose. One partial
  unique index permits at most one pending challenge per account and field.
- Start and command/resend idempotency keys bind stored request digests. Command
  history is append-only and has a unique aggregate sequence. Resend keeps the
  original verifier/expiry/attempt budget and is constrained by the 60-second
  cooldown snapshot.
- A dispatch and its encrypted payload exist before any future provider call.
  `reserved`, `pending` and `unknown` retain that payload; durable outcomes and
  invalidation erase it. `not_found` is intentionally not a stored status.
  Future recovery must reconcile the same dispatch ID, then lock and recheck the
  pending challenge, current contact version and exclusive expiry before exact
  redelivery.
- Contact, challenge, dispatch and rate-bucket rows carry positive lock versions
  and monotonic timestamps. Guards reject terminal revival, verifier/expiry
  mutation, cooldown bypass and a contact edit while recoverable work remains.
  Future repositories must still make bucket consumption and aggregate/contact
  locking one transaction; this migration does not claim runtime wiring.
- Audit stores only allowlisted internal identifiers, field/method/purpose,
  operation, contact version, outcome and timestamp. It has no free-form/JSON,
  contact, proof, digest, idempotency, ciphertext, adapter-response or key fields.

No cleanup or retention period is invented. Only the approved proof/payload
expiry is encoded. Contact deletion/anonymization and audit retention require a
separate policy and forward migration.

## Review/apply ordering

These artifacts are review-only and must not be run in this D5.2 slice:

1. `042_backend_contact_verification_persistence_PRECHECK.sql` — read-only
   foundation/absence evidence.
2. `042_backend_contact_verification_persistence.sql` — one transactional,
   expand-only apply.
3. `042_backend_contact_verification_persistence_POSTCHECK.sql` — read-only
   catalog, privilege, fingerprint and empty-state evidence.

A future apply requires a separate exact-commit, Selectel test DB/schema command,
verified backup and archived PRECHECK/POSTCHECK output. Runtime must remain
stopped/disconnected until its own repository/adapters/controllers gate.

## Rollback boundary

`042_backend_contact_verification_persistence_ROLLBACK.sql` is a read-only,
fail-closed boundary, not a down migration. It performs no DDL or row DML and
refuses when any migration-042 relation exists. Recovery after apply must use a
separately reviewed forward migration. No `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`
or `CASCADE` behavior is authorized.

## Deployment impact

The package is unapplied SQL, tests and documentation only. Runtime, container
images, configuration, database, Selectel, providers, secrets and production
remain unchanged: `deployment=not_needed` for this local candidate.
