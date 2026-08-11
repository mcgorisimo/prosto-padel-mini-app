# TD-004b — Split backend session lifecycle Playwright spec

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: medium-high auth risk
- Dependencies: TD-004a
- Primary files: backend session lifecycle spec and auth/profile/admin fixtures
- Migration: not needed

## Plan and acceptance

Split session, profile/photo and admin/search cases by contract while preserving
every title/assertion and secure credential/global cleanup.

- title/assertion inventory parity is exact;
- tests cannot share tokens, local/session storage or mutable window hooks;
- auth fail-closed, PII redaction and request-count assertions remain strict;
- pure imports are clearly classified rather than mislabeled as full UI E2E.

## Review evidence

Fresh auth/test-isolation review score ≥9; record matrix, gates, commits and
deployment impact.
