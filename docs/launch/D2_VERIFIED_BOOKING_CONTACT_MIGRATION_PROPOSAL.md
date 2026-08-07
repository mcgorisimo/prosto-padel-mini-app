# D2 verified booking contact — migration proposal

Status: `product_and_schema_approval_required`; no SQL is included or approved.

## Proven blocker

- YCLIENTS create currently rejects a client snapshot unless `fullName`, `phone`
  and `email` are all present and valid (`YclientsBookingService.readClient`).
- The backend profile schema stores first/last name and an owner-editable phone,
  but no email and no phone/email verification state. `isVerified` belongs to
  player rating and cannot prove contact ownership.
- The existing booking controller trusts `client` from the request body, while
  the approved D2 contract requires the snapshot to come only from backend
  profile data. The frontend currently has no profile email and supplies an
  empty value.
- Migration 033 can persist encrypted client snapshots and has the required
  provider-attempt, reconciliation, active-operation and slot-hold fields. It
  does not define the authoritative verified contact source, and should not.

Continuing without a new contact source would require client-controlled PII,
a synthetic email, or treating an editable phone as verified. All three are
fail-open and explicitly forbidden.

## Minimal recommended schema

Add an expand-only `backend_auth.verified_booking_contacts` table:

- `account_id uuid` primary key and FK to `backend_auth.accounts(id)`;
- separately AEAD-encrypted canonical E.164 phone and lowercase email, each with
  ciphertext, nonce/tag, algorithm and key version; keys remain outside the DB;
- separate domain-keyed phone/email digests for equality and optional
  uniqueness, without a publicly testable ordinary PII hash;
- per-field `phone_verified_at` / `email_verified_at`, allowlisted authority,
  immutable verification reference (or keyed audit digest) and verification
  version, so proof for one field can never verify the other; no OTPs/tokens;
- `version`, `created_at`, `updated_at` with monotonic checks;
- unique keyed phone/email digest constraints only if product policy requires
  one contact to belong to one account;
- least-privilege application grants and no public/Supabase access.

`fullName` remains derived server-side from backend-owned profile first/last
name. At create time the backend reads the profile and verified-contact row in
one transaction, builds the YCLIENTS snapshot in memory, and persists only the
approved AEAD-encrypted operation snapshot plus keyed digest from migration 033.
PII must not enter logs, errors, traces, idempotency responses or ordinary JSON.
Only the backend decrypts contacts. The owner may read their own values;
authenticated `club_admin` may read full values only after backend RBAC, and
every admin read creates a PII-free security audit event. Other players cannot
read another account's contacts.

Migration 015 already defines the phone external-identity lookup digest and OTP
challenge substrate. An OTP-verified booking phone must reference that existing
phone identity/proof rather than create a competing phone-identity meaning. An
admin-verified phone uses its own allowlisted audit-backed authority and must
not be presented as an OTP-linked external identity. Migration 015 has no email
identity provider, so email still needs its own field-bound verification proof
unless a separately reviewed auth expansion is chosen.

## Required product decisions

1. Who may establish verification for each field: the existing phone OTP
   workflow, authenticated `club_admin`, or an explicitly trusted CRM import.
   Recommended first rollout for missing booking contacts: club-admin
   verification with an append-only security audit; the proof remains bound to
   its exact phone or email field and canonical value version.
2. Whether canonical phone/email must be globally unique across accounts.
3. Whether changing a verified contact invalidates the prior verification or
   creates a new versioned verification event. Recommended: invalidate and
   require a new verification event.
4. Retention/anonymization behavior on account deletion; no retention period is
   assumed here.

## Safe rollout order after approval

1. Review and approve a separate expand-only migration, PRECHECK/POSTCHECK and
   fail-closed rollback boundary; do not backfill unverified values.
2. Implement owner read/update plus the approved verification authority and
   PII-free audit. Profiles without both verified contacts receive a stable
   `booking_contact_required` response and no YCLIENTS request.
3. Implement the already requested reservation repository/workflows and source
   every create snapshot from this backend contract.
4. Run local contracts, integrate, apply only to Selectel test under a separate
   migration approval, then roll out and perform Telegram Mini App smoke.

Until steps 1–2 are approved and complete, runtime reservation create wiring is
blocked. No change is required to migration 033 itself.
