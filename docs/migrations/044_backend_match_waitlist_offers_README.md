# Migration 044 — waitlist confirmation offers

Status: `unapplied_local_artifact`.

This migration adds durable 15-minute FIFO offers and idempotent accept/decline
commands. It does not enable Telegram delivery or the offer workflow.

Run PRECHECK, take a verified backup, apply the migration once, then run
POSTCHECK. The guarded rollback is permitted only while both new tables are
empty.
