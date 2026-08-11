# TD-006 — Remove Supabase-era profile/auth frontend boundary

- Status: `planned`
- Priority: P1
- Effort: M (2–4 days)
- Risk: high
- Dependencies: TD-002–TD-005
- Primary files: `AuthGate.jsx`, `App.jsx`, `profileApi.js`, profile/settings UI
- Migration: not needed

## Evidence and problem

`AuthGate` hard-codes `backendProfileRequired = true` and refuses to render App
without an authenticated backend profile. Nevertheless App accepts mode flags,
keeps a second `profile` state and imports a fail-closed Supabase profile API.
`PersonalInfoScreen`, player search and older settings can still reference
`profileApi.js`. Standalone email/password auth screens are already orphaned.

## TDD characterization

- Backend login/profile ready is the only path to App.
- Backend profile failure never falls back to Telegram metadata or legacy data.
- Profile read/update/photo/admin/player-search keep exact bearer requests and
  strict responses.
- Catch-all routes for `*.supabase.co`, `/auth/v1` and `/rest/v1` remain zero.
- Logout clears backend credential/profile and cannot invoke Supabase auth.

## Implementation slices

1. Make App require backend profile/actions by construction; remove the legacy
   profile mode from selectors and props.
2. Route all live profile/search/settings consumers through the existing
   backend action facade.
3. Delete unused `profileApi.js` code and legacy profile merge/normalization.
4. Remove profile-related methods from `supabaseClient` only after zero imports.

## Acceptance criteria

- No live source imports legacy profile/auth APIs.
- One backend-owned profile object is the source of truth.
- Existing accessible UI and error copy remain stable.
- No PII, auth, admin or rating contract changes.

## Non-goals

Standalone auth, phone/email verification, account deletion and compliance are
product work, not implemented here.

## Review/completion evidence

Reviewer must audit fail-closed auth and metadata leakage. Record RED, all
gates, score ≥9, commit/push and frontend-only deployment gate.
