# TD-034e — Generate lineup contracts

- Status: `planned`
- Priority: P2
- Effort: M (1–2 days)
- Risk: high
- Dependencies: TD-034d
- Primary files: lineup contract artifacts/backend/frontend codecs
- Migration: not needed

## TDD plan

Generate lineup read/mutation schemas and compare participant, team/slot,
version, authorization and conflict fixtures, including exact-key/fuzz failures.
Delete manual codecs only after runtime parity proof.

## Acceptance criteria

- Generated schemas cannot accept non-participant or client-controlled identity.
- Version/request-key/body/error semantics are exact.
- No domain rule changes and no result schema changes in this task.
- Artifacts are deterministic and never hand-edited.

## Review evidence

Fresh contract/domain review score ≥9; record parity, all gates, commits and
exact backend/frontend rollout.
