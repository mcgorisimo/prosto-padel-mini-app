# TD-034f — Generate result contracts

- Status: `planned`
- Priority: P2
- Effort: M (1–2 days)
- Risk: high
- Dependencies: TD-034e
- Primary files: result contract artifacts/backend/frontend codecs
- Migration: not needed

## TDD plan

Generate result read/submit schemas and compare sets/scores/status/version,
eligibility, request key, exact-key/fuzz and public error fixtures. Preserve
runtime validation and remove manual result codecs only after parity.

## Acceptance criteria

- No score/rating/product rule is changed or moved client-side.
- Unknown mutation/version conflict remains distinguishable and no blind retry.
- Internal calculation/audit fields are forbidden from public artifacts.
- Generation is deterministic and domain tests stay focused.

## Review evidence

Fresh reviewer audits score/version/security parity, score ≥9; record gates,
candidate/closure commits and rollout.
