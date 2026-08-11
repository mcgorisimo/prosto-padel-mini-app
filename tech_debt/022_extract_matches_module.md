# TD-022 — Extract backend `MatchesModule` from `AuthModule`

- Status: `planned`
- Priority: P1
- Effort: M (2–4 days)
- Risk: medium
- Dependencies: TD-009, TD-010, TD-029, TD-030, TD-032
- Primary files: `backend/src/auth/auth.module.ts` (~656 lines), new matches
  module, module specs/AppModule
- Migration: not needed

## Evidence and problem

AuthModule registers/exports auth, profiles/photos/admin and eight match
controllers/services. Its ~1,038-line module spec verifies unrelated domains
together. Domain ownership and DI graph are obscured.

## TDD plan

1. Add `matches.module.spec.ts` proving controller/service/provider singleton
   identities and guard/clock/repository injections.
2. Strengthen AuthModule spec to enumerate only auth/profile responsibilities.
3. Keep an AppModule route smoke for every moved endpoint.
4. Extract match factories/providers/controllers without changing service
   constructors or public exports in the first slice.

## Acceptance criteria

- AuthModule no longer owns match controllers/services.
- MatchesModule imports only required shared auth/database providers; no
  circular module dependency or duplicate singleton.
- Routes, guards, clocks, cache headers and serialized errors unchanged.
- All backend/root gates pass; only backend container needs rollout.

## Independent review gate

Reviewer compiles module graphs, checks singleton identity and accidental
provider export expansion. Score ≥9.
