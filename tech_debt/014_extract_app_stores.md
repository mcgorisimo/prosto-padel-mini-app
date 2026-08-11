# TD-014 — Extract App match feed/account/detail store

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-013
- Primary file: `src/App.jsx` (~3,277 lines)
- Migration: not needed

## Evidence and problem

App currently owns dozens of states/refs and loaders. This task extracts only
public/account match feeds, selected match detail and their request ownership.
Reservations, invitations/notifications and chat are separate TD-014a–014c
tasks so one review/commit cannot hide several domain migrations.

## Target boundary

- one hook/controller exposing immutable `{state, actions}`;
- backend facade, clock/abort ownership and account identity are injected;
- public feed, account feed and selected match detail stay internally distinct;
- App retains reservation/invitation/notification/chat state until later tasks.

## TDD plan

- stale request after account/match switch is ignored;
- foreground retry preserves previous truthful data as currently specified;
- private reservations never enter public feed;
- current refresh caps and request order remain exact;
- logout clears all account-scoped state;
- error/loading states are domain-local and do not reset unrelated screens.

## Acceptance criteria

- No duplicated match feed/detail state remains in App after this slice moves.
- App becomes smaller without changing unrelated domain ownership yet.
- API calls/count/order and accessible UI remain unchanged.
- No whole-file rewrite and no new global state dependency.

## Independent review gate

Reviewer checks stale-response/account isolation and hidden coupling. Score ≥9,
root gates and frontend deployment.
