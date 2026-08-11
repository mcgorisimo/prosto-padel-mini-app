# TD-012 — Decompose Telegram backend login lifecycle and React binding

- Status: `planned`
- Priority: P1
- Effort: M–L (3–5 days)
- Risk: high
- Dependencies: TD-001, TD-011c, TD-011d
- Primary files: `useTelegramBackendLogin.js` (~2,374 lines), `AuthGate.jsx`
- Migration: not needed

## Evidence and problem

The file combines a large pure lifecycle, secure credential storage, request
coordination and roughly forty React callback wrappers. AuthGate copies the
action surface again with long dependency lists. Adding an operation requires
multiple synchronized edits and stable callback identity is fragile.

## TDD characterization

- exact action-key inventory;
- disabled/not-ready action canonical rejection;
- stable callback identities across ordinary renders;
- concurrent same-initData coalescing and identity isolation;
- clear/logout aborts active work and erases credential boundary;
- SecureStorage failure/fallback rules and no credential leakage;
- timer/backoff cleanup on unmount/account switch.

## Target design

Keep the pure lifecycle framework-agnostic. Build one frozen authenticated
action facade declaratively. Let the hook own only React subscription/state and
facade memoization. AuthGate consumes the facade rather than copying each
method.

## Acceptance criteria

- No circular dependency between hook, client and AuthGate.
- Credential remains opaque and never enters React-visible diagnostics.
- All login/session/profile/match behaviors and retries remain exact.
- File sizes fall through real responsibility extraction, not line shuffling.

## Independent review gate

No-context reviewer must stress abort/timer races and stale identity work. Score
≥9 and all root E2E/build plus authenticated test rollout.
