# TD-034d — Generate waitlist contracts

- Status: `planned`
- Priority: P2
- Effort: M (1–2 days)
- Risk: high
- Dependencies: TD-034c
- Primary files: waitlist contract artifacts/backend/frontend codecs
- Migration: not needed

## TDD plan

Compare generated waitlist list/join/leave/promotion-view schemas to strict wire
fixtures for participant identity, FIFO position, capacity/version conflicts,
exact keys and public errors. Delete manual codecs only after parity/fuzz proof.

## Acceptance criteria

- Backend remains the only waitlist/FIFO authority.
- Versions, request keys, bounds and public errors stay exact.
- No offer-confirmation or new product state is introduced.
- Generated output is deterministic and free of internal fields.

## Review evidence

Fresh reviewer score ≥9; record wire/fuzz matrix, gates, commits and rollout.
