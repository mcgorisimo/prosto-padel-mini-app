# TD-007 — Remove legacy match feed/realtime runtime

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-006
- Primary files: `App.jsx`, `backendMatchAdapter.js`, feed E2E specs
- Migration: not needed

## Evidence and problem

Production is backend-only, yet `App.jsx` still compiles Supabase feed/realtime
and source-selection branches. Tests mutate that boundary to preserve an
impossible dual-runtime feed mode. This task removes only feed/realtime source
selection; later numbered tasks remove the other domains.

## Required characterization matrix

- public/account feed and exact match detail through backend bearer contracts;
- foreground refresh and stale-response behavior;
- private booking absent from public feed;
- zero Supabase network calls and no facade fallback on backend rejection.

## TDD/deletion plan

1. Add a regression proving a backend feed rejection cannot activate a legacy
   read or subscription.
2. Remove feed source mode, Supabase feed loader and realtime subscription.
3. Remove only newly orphaned feed normalization/test scaffolding after an
   exact import/reference proof.
4. Keep invitations, chat, waitlist, lineup, results and mutations untouched;
   TD-007a–TD-007c own those boundaries.

## Acceptance criteria

- `rg` finds no Supabase feed/read/realtime operation under tracked runtime.
- Production bundle has no legacy feed endpoint or realtime-subscription marker.
  Complete Supabase facade/import marker absence belongs to TD-007c because the
  intervening domain tasks intentionally still compile that facade.
- Backend feed/detail payloads, error mapping and UI behavior are unchanged.
- Missing backend product operations stay unavailable; they are not recreated
  locally.

## Non-goals/invariants

No match cancel, owner participant removal, private/public conversion, backend
training or app booking cancel/reschedule. Do not touch payment legacy fields.

## Review/completion evidence

No-context reviewer audits the feed/realtime diff against endpoint coverage and
scores ≥9. Record tests, exact bundle search, rollout and logs.
