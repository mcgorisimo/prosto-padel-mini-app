# Migration 044 — waitlist confirmation offers

Status: `applied_verified_selectel_test` at runtime source commit
`af3728ceb2fb57331bf2614523859db25dca3cd8`; both relations were empty at
POSTCHECK. Production remains unapplied.

This migration adds durable 15-minute FIFO offers and idempotent accept/decline
commands. It does not enable Telegram delivery or the offer workflow.

Run PRECHECK, take a verified backup, apply the migration once, then run
POSTCHECK. The guarded rollback is permitted only while both new tables are
empty.
