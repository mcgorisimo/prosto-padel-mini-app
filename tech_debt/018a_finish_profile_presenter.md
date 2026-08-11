# TD-018a — Finish profile/settings presenter decomposition

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: medium visual/privacy risk
- Dependencies: TD-018
- Primary files: profile/settings components, extracted hooks/presenters/specs
- Migration: not needed

## Target and TDD

After photo state is isolated, separate profile edit/settings actions from pure
rendering. Characterize required fields, save/version/error states, logout,
admin-only data visibility, viewport/keyboard behavior and account switch.

## Acceptance criteria

- Profile form/session/settings/photo each have explicit ownership.
- PII is never copied to logs, URLs or persistent browser caches unexpectedly.
- Required fields and backend error semantics are unchanged.
- Overlays use the shared primitive; no scroll jump or layout drift remains.

## Review evidence

Fresh reviewer checks privacy, account isolation and mobile UX, score ≥9;
record gates, commit/push and deployed profile smoke.
