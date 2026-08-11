# TD-034b — Generate invitation contracts

- Status: `planned`
- Priority: P2
- Effort: M (1–2 days)
- Risk: high
- Dependencies: TD-034a
- Primary files: generated contracts and invitation backend/frontend codecs
- Migration: not needed

## TDD plan

Migrate invitations only under the proven generator, using strict/fuzz fixtures
for direction, status, actor identity, cursor, versions and public errors.
Delete each manual invitation codec only after bidirectional parity and
forbidden-field tests pass.

## Acceptance criteria

- Generated artifacts are deterministic, checked in and never manually edited.
- Exact runtime parsing, body limits, mutation request keys and error taxonomy
  are no weaker than before.
- Admin/private fields cannot appear in player contracts.
- Invitation tests retain focused ownership; chat/notification, waitlist,
  lineup and result remain for TD-034c–TD-034f.

## Review evidence

Fresh no-context contract/security review score ≥9; record invitation parity
matrix, all gates, candidate/closure commits and exact rollout.
