# TD-015a — Migrate notification polling to shared scheduler

- Status: `planned`
- Priority: P1
- Effort: M (1–2 days)
- Risk: medium
- Dependencies: TD-014b, TD-015
- Primary files: notification store/App composition and focused specs
- Migration: not needed

## TDD plan

Measure current visible request cadence/budget. Add hidden-tab, one resume load,
slow request single-flight, account-switch stale result, error backoff/jitter and
unmount cleanup regressions. Then replace only notification timer ownership.

## Acceptance criteria

- Hidden TMA sends zero periodic notification requests.
- One account-scoped stream exists, with no overlap or synchronized failure loop.
- Endpoint, payload, immediate first load, data/error UI and read actions exact.
- Other streams retain existing mechanics until their own tasks.

## Review evidence

Fresh no-context concurrency review score ≥9; record budget before/after, all
gates, candidate/closure commits and exact frontend rollout.
