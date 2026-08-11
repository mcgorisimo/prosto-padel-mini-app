# TD-014b — Extract App invitation/notification store

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: medium-high
- Dependencies: TD-014a
- Primary files: `src/App.jsx`, invitation/notification hooks and specs
- Migration: not needed

## Problem and target

App owns invitation and notification loaders, actions, error/loading state and
cross-screen refresh coupling. Move both related account inbox domains into a
single explicit store without taking ownership of match chat.

## TDD plan

- characterize incoming/outgoing/list/read/open and mutation refresh behavior;
- prove stale pages never cross account/session boundaries;
- freeze optimistic/conflict/error outcomes and action call counts;
- extract `{state, actions}` and remove only duplicate App state/refs.

## Acceptance criteria

- Account inbox state has one owner and deterministic reset semantics.
- Match feed/detail updates occur only through explicit callbacks/contracts.
- Accessible UI, backend payloads and request ordering remain unchanged.
- No global state library or hidden singleton is introduced.

## Review/completion evidence

Fresh reviewer checks account isolation and coupling, score ≥9; record tests,
commit/push and frontend rollout health/smoke/logs.
