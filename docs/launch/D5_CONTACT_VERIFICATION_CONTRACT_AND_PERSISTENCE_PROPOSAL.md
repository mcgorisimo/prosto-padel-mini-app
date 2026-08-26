# D5 contact verification — contract, threat model and persistence proposal

Status: `local_contract_candidate`; no SQL, provider selection, secrets,
controller/module wiring, DB write or runtime rollout is included.

This slice starts after the owner-confirmed D5.1 handoff. It defines contact
ownership verification for an already authenticated and onboarded account. It
does not define sign-in, sign-up, account recovery, rating verification or a
payment-provider state.

## Product boundary

- A player with completed onboarding may enter and use the application without
  verified contacts.
- A future paid-court checkout is eligible only when the backend has both a
  verified phone and a verified email for the current contact versions.
- Phone verification uses `phone_sms_otp` only. Email verification uses either
  `email_code` or `email_link`. A proof for one field or method cannot verify
  the other field.
- `isVerified` remains player-rating state. `paymentStatus`, `ownerPaid`,
  `holdAmount` and `prepay` remain untouched and are not accepted as contact
  authority.
- The existing `auth/otp` aggregate remains authentication/fresh-auth state and
  must not be reused as contact verification state.

The runtime-disabled TypeScript candidate lives in
`backend/src/contacts/contact-verification.*`. It is not imported by
`AuthModule`, a controller, a repository or an application bootstrap.

## Provider-neutral HTTP contract proposal

All mutations require the current bearer account, an opaque idempotency key and
a canonical request digest computed by the backend. Responses never echo a
phone, email, protected digest, submitted code/token or provider payload.

Suggested future routes:

| Operation          | Proposed route                                                                                              | Contract                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Read own states    | `GET /api/v1/profile/contacts/verification`                                                                 | separate `phone` and `email` states; no secret or digest                            |
| Start phone        | `POST /api/v1/profile/contacts/phone/challenges`                                                            | current canonical E.164 phone revision only; `phone_sms_otp`                        |
| Start email        | `POST /api/v1/profile/contacts/email/challenges`                                                            | current lowercase email revision; explicit `email_code` or `email_link`             |
| Reserve resend     | `POST /api/v1/profile/contacts/challenges/:challengeId/resend`                                              | challenge-scoped resend key/digest; returns the original dispatch on an exact retry |
| Submit code/token  | `POST /api/v1/profile/contacts/challenges/:challengeId/verify`                                              | atomic attempt consumption and current-revision compare                             |
| Cancel/supersede   | `POST /api/v1/profile/contacts/challenges/:challengeId/cancel`                                              | idempotent terminal transition                                                      |
| Email-link landing | `GET` renders a non-mutating landing page; a separate authenticated or CSRF-bound `POST` consumes the token | scanners/prefetch must not verify or burn the link                                  |

Start and resend return the same coarse accepted response whether the contact
is new, already known or intentionally suppressed. Provider acceptance means
only that a dispatch was accepted; it is never contact proof.

## Challenge and proof contract

Every challenge is bound to:

- internal `challengeId` and authenticated `accountId`;
- closed `field + method` pair;
- monotonically increasing `contactVersion`;
- secret-peppered canonical contact subject digest;
- secret-peppered verifier digest for the code or link token;
- create idempotency key plus immutable request digest;
- `createdAt`, exclusive `expiresAt`, attempt budget and append-only commands.

Every command timestamp comes from a trusted backend transaction-time clock,
never from an HTTP body, client, provider response or delivery callback. A new
command whose timestamp is before challenge creation or the latest applied
command fails closed; exact idempotent retries still return their stored result.

Terminal states are `verified`, `expired`, `attempts_exhausted` and
`cancelled`. `superseded` and `contact_changed` are allowlisted cancellation
reasons. The verified proof repeats the account, field, method, contact version
and subject digest binding. A contact edit increments the version and makes the
old proof ineligible immediately; it never mutates the old audit/history row.

Command idempotency is challenge-scoped. An exact retry of the same command ID
and protected request returns the original result without spending another
attempt. Reusing the ID with a changed digest, command type or reason fails
closed as `command_reuse_conflict`.

Resend has an additional challenge-scoped idempotency key and immutable request
digest. Persistence must resolve that pair before consuming rate buckets or
reserving delivery. An exact retry returns the first dispatch ID and outcome;
the same key with a different digest fails closed. A new reservation is allowed
only while pending and unexpired, after cooldown and abuse checks, and never
resets the submit-attempt budget.

The reservation transaction also writes a TTL-limited AEAD-encrypted delivery
envelope before any provider call. A worker recovering `reserved` or `unknown`
must reconcile the same dispatch ID first. Only an authoritative `not_found`
may redeliver the byte-equivalent decrypted envelope under that same dispatch
ID, and `not_found` alone is insufficient: immediately before delivery the
backend atomically rechecks that the challenge is pending, the bound contact
version is current and database time is before expiry. A failed check
invalidates the dispatch and erases its envelope. `pending` and `unknown` remain
reconciliation-only states. Resend reserves a new dispatch for the current
challenge proof and does not rotate its verifier.

## Initial abuse and expiry policy

These are product safety defaults, independent of an SMS/email provider:

| Method          |        TTL |                            Submit attempts |
| --------------- | ---------: | -----------------------------------------: |
| `phone_sms_otp` | 10 minutes |                                          5 |
| `email_code`    | 10 minutes |                                          5 |
| `email_link`    | 15 minutes | 5; successful consumption remains one-time |

- Resend cooldown: 60 seconds.
- Starts: at most 3 per 15 minutes and 10 per 24 hours.
- Start/resend consumes account, protected-contact and protected-network
  buckets atomically. A partial bucket write must fail closed.
- Submit attempts are consumed atomically with the state transition.
- Resend does not reset attempts. A new challenge cannot bypass an exhausted
  account/contact budget; the durable abuse ledger spans challenge IDs.
- Limits apply before any provider call. Rate-limit responses expose only a
  coarse retry time and never identify which scope was hit.

Changing these numbers is a separate reviewed product/security decision. A
provider's own rate limits may be stricter but cannot weaken these limits.

## Threat model and required controls

| Threat                                  | Required control / regression                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Brute-force code guessing               | atomic five-attempt budget; exact retry spends zero extra attempts; final failure is terminal                   |
| Resend amplification and provider cost  | persistent cooldown plus short/daily account, contact and network buckets before one idempotent dispatch        |
| Account/contact enumeration             | uniform public response and coarse error/timing; no contact echo or scope detail                                |
| Contact-swap race                       | verification commit atomically compares current account, field, version and subject digest                      |
| Cross-channel proof confusion           | closed phone/SMS and email/code-or-link discriminated states                                                    |
| Token replay                            | terminal one-time command; exact retry returns the original result only                                         |
| Email scanner/prefetch                  | GET is read-only; only a deliberate POST consumes the link token                                                |
| Concurrent idempotency race             | start/command/resend DB uniqueness and aggregate row lock; same key/different digest fails closed               |
| Clock rollback or untrusted timestamp   | backend transaction-time clock only; reject new commands older than challenge/history                           |
| Crash after reservation                 | persist the encrypted envelope; reconcile, then atomically recheck pending/current-contact/unexpired            |
| Unknown delivery result                 | retain the envelope; `pending/unknown` reconcile again, only authoritative `not_found` permits exact redelivery |
| Logging/provider leakage                | allowlisted audit projection; ciphertext is least-privilege and plaintext/provider details stay transient       |
| Old proof after contact edit            | monotonic contact version; checkout requires `verifiedVersion == contactVersion`                                |
| Auth/rating/payment privilege confusion | separate module/types/tables; no auth proof, rating flag or payment field in contact inputs                     |

## PII-safe audit contract

Allowed audit values are internal event/account/challenge/dispatch/decision IDs,
field, method, allowlisted outcome, operation, contact version and timestamp.

Forbidden in audit, logs, errors and traces:

- phone, email, canonical destination or raw IP;
- plaintext code, email token or link;
- contact/source/verifier/request digests and idempotency key;
- encryption keys, peppers, ciphertext;
- provider name, provider message ID, raw response, exception or request body;
- session credential, authorization header, cookie or Telegram init data.

Provider-specific diagnostics must map to an allowlisted coarse outcome before
leaving the adapter. Audit insertion belongs in the same transaction as the
state transition where applicable.

## Persistence proposal — no SQL in this slice

Use an expand-only, separately reviewed migration in the Selectel PostgreSQL
backend schema. Proposed logical tables:

1. `account_contacts`
   - `(account_id, field)` identity, monotonic `contact_version`;
   - AEAD-encrypted canonical value with algorithm/key version/nonce/tag;
   - separate domain-keyed subject digest and lifecycle timestamps;
   - no plaintext, ordinary hash or synthetic fallback email.
2. `contact_verification_challenges`
   - challenge/account/field/method/contact-version binding;
   - protected subject/verifier digests with key versions;
   - AEAD-encrypted active proof with key version/nonce/tag and an expiry no
     later than the challenge expiry; erase it on every terminal transition;
   - create idempotency key and request digest;
   - policy snapshot, attempts remaining, state and terminal metadata;
   - at most one active challenge per account and field under a transactional
     uniqueness/locking boundary.
3. `contact_verification_commands`
   - unique `(challenge_id, command_id)`, monotonic sequence and request digest;
   - resend idempotency key, rate-limit decision ID and dispatch ID for resend
     reservations, with unique `(challenge_id, resend_idempotency_key)`;
   - protected presented digest only for submit commands;
   - immutable result needed for exact retries; no destination or plaintext.
4. `contact_verification_dispatches`
   - stable internal dispatch ID, challenge ID, method, status
     `reserved/pending/accepted/unavailable/rate_limited/unknown` and
     timestamps;
   - unique link to the start or resend command that reserved it, so an exact
     retry observes the original dispatch and outcome instead of dispatching;
   - TTL-limited AEAD-encrypted delivery envelope containing only the exact
     destination/proof payload needed by the adapter, with key version, nonce,
     tag and `payload_expires_at`; plaintext remains transient after decryption;
   - optional encrypted adapter reconciliation reference, never audit/log data;
   - erase the envelope after a durable non-recoverable delivery outcome or at
     challenge expiry; retain it while status is `reserved/pending/unknown`;
   - `pending/unknown` reconcile under the same dispatch ID. Only `not_found`
     may redeliver the same envelope and dispatch ID; `not_found` is a recovery
     result, not a terminal stored status, and never creates a blind retry;
   - every terminal challenge transition and contact-version change atomically
     invalidates related dispatches and erases all retained envelopes.
5. `contact_verification_rate_buckets`
   - keyed account/contact/network subjects, window start, count and cooldown;
   - atomic multi-scope consume; values are not copied to audit.
6. `contact_verification_audit`
   - append-only allowlisted events described above, with least-privilege read
     grants and no Supabase/public access.

Required transactional invariants:

- start idempotency uniqueness is scoped by `(account_id, field,
idempotency_key)` and binds the immutable request digest;
- resend first resolves `(challenge_id, resend_idempotency_key)` under the
  aggregate lock; exact digest match returns the stored dispatch/outcome,
  mismatch conflicts, and only a missing key may consume buckets and reserve a
  new dispatch in the same transaction;
- start/resend commits the challenge or command, dispatch row and encrypted
  envelope atomically before delivery. Resend uses the current verifier digest
  and encrypted proof; it neither resets attempts/expiry nor rotates the proof;
- a recovered worker calls the PII-free reconciliation port before delivery.
  `pending/unknown` wait, `accepted/unavailable/rate_limited` record the outcome,
  and `not_found` may proceed only after a fresh aggregate/contact lock proves
  `pending`, the current contact version and database time before expiry;
- that guard and the dispatch claim are one transaction immediately before
  provider delivery. Failure invalidates the dispatch and erases its envelope;
  expiry, verification, cancellation, exhaustion, supersession and contact
  update invalidate/erase every related recoverable dispatch in their own lock;
- submit locks the challenge and durable abuse budget before comparing the
  protected proof;
- verified transition succeeds only when the current contact row still has
  the same account, field, version and subject digest;
- contact update invalidates prior eligibility and supersedes any active
  challenge in the same transaction;
- checkout reads phone and email verification for the same authenticated
  account and requires both current versions;
- deletion/anonymization erases encrypted contacts according to a separately
  approved retention policy while retaining only legally approved PII-free
  audit history.

## Separate future gates

1. Review and approve exact SQL, PRECHECK/POSTCHECK and rollback boundary.
2. Select SMS and email providers; review only their official documentation,
   strong dispatch-ID idempotency or authoritative reconciliation semantics,
   unknown-outcome contracts and data-processing terms.
3. Provision secrets outside Git/image/frontend and implement adapters.
4. Wire repositories/controllers/runtime and checkout eligibility.
5. Commit, integrate/push and perform an exact-SHA Selectel test rollout with
   health, business smoke and bounded log review.
6. Production remains a separate direct owner command.

Current deployment status: `not_needed`. The candidate is contracts/tests/docs
only and is deliberately unreachable from runtime; containers, config,
dependencies, database, providers, secrets, server and production are unchanged.
