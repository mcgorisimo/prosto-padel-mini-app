# TD-034 — Generated profile/session contract foundation

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-011c, TD-031–TD-032
- Primary files: backend DTO/contract source, generated artifact, frontend client
- Migration: not needed

## Evidence and problem

Frontend manually validates backend response schemas while backend separately
defines types/parsers. This task chooses and proves the deterministic contract
pipeline for session/profile only. Match, social and booking domains follow in
TD-034a–TD-034g.

## Design gate

Choose one checked-in/generated contract source (OpenAPI or an equally strict
schema) compatible with Nest/Fastify and exact runtime validation. Generation
must be deterministic, reviewable and not expose internal/PII fields. Do not
replace strict runtime validation with compile-time types alone.

## Incremental TDD plan

1. Compare generated session/profile schemas against existing wire fixtures.
2. Add generation-drift check and forbidden internal-field assertion.
3. Generate a small typed frontend client/codec behind existing facade.
4. Delete session/profile manual schemas only after parity/fuzz tests.
5. Document the exact extension pattern for later numbered domain tasks.

## Acceptance criteria

- One source defines session/profile public fields/status/error schemas.
- Generated artifacts are deterministic and never edited manually.
- Runtime exact-key/body bounds/security remain at least as strict.
- Frontend facade behavior/headers/retry policy unchanged.

## Independent review gate

Reviewer compares session/profile wire fixtures, security exposure and generator
reproducibility. Score ≥9, all gates and affected container rollouts.
