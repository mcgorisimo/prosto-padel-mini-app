# TD-034a — Generate match feed/detail/mutation contracts

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-034
- Primary files: contract source/generator/artifact, match backend/frontend codecs
- Migration: not needed

## TDD plan

Compare generated match feed/detail/create/join/leave schemas with every existing
wire fixture, exact-key failure and request-key/version error. Add deterministic
generation drift and forbidden internal/PII field checks before replacing any
manual frontend codec.

## Acceptance criteria

- One public contract source owns the migrated match wire schemas.
- Runtime validation stays exact and bounded; generated types alone are not used
  as validation.
- Headers, URLs, retry/idempotency and public error behavior remain unchanged.
- Missing match product operations are not introduced by the contract.

## Review evidence

Fresh reviewer audits wire parity/security/reproducibility, score ≥9; record
generation diff, all gates, commit/push and affected rollouts.
