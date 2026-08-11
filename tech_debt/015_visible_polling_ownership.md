# TD-015 — Build visibility-aware polling scheduler primitive

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: medium-high
- Dependencies: TD-014c
- Primary files: new scheduler/hook and isolated unit harness
- Migration: not needed

## Evidence and problem

Notifications, chat, waitlist, lineup and result use independent five-second
timers. Before migrating those consumers separately in TD-015a–TD-015e, this
task builds and proves the dependency-injected scheduler only. It may not edit
App or MatchDetails consumer behavior.

## TDD plan

- isolated hidden document produces zero scheduled operation calls;
- transition back to visible produces exactly one immediate operation call;
- a slow request cannot overlap the next tick;
- late response after match/account/action change is ignored;
- unmount clears timer/listeners and aborts/invalidates work;
- first visible refresh preserves current immediate behavior;
- successful steady-state cadence is measured against the existing five-second
  baseline, while failures use bounded exponential backoff with injected jitter;
- same account/match read requests that are semantically identical are safely
  coalesced, but streams with different cursors/ownership are never merged;
- coalescing registry releases ownership on success/error/abort/unmount.

## Target primitive

A framework-light, clock/random/visibility-injectable scheduler with explicit
immediate-load, single-flight, bounded backoff/jitter, safe read coalescing and
cancellation policy. Domain code supplies the fetch operation, coalescing key
and result ownership token; it does not duplicate timer mechanics.

## Acceptance criteria

- Scheduler contract owns timer, backoff, coalescing and visibility lifecycle.
- Fake-timer/property tests prove no overlap, hidden work or synchronized retry
  storm in the isolated harness.
- Current endpoint payloads, UI messages and business rules remain exact.
- No product consumer is migrated; production bundle impact is measured.

## Independent review gate

Reviewer inspects timer races, coalescing leaks and StrictMode-like mount/unmount.
Score ≥9. If the unimported primitive is tree-shaken, deployment is `not_needed`;
otherwise follow the frontend rollout gate.
