# Migration 043 — Telegram notification intents

Status: `unapplied_local_artifact`.

This additive migration introduces per-recipient Telegram delivery intents,
category overrides that remain subordinate to the existing master boolean, a
database-backed conservative send budget, and leases for bounded exact-record
YCLIENTS reads. It does not send provider requests and does not enable either
runtime worker.

Apply only after a reviewed backup/precheck gate and only to the dedicated test
database. Run `PRECHECK`, apply with `expected_database`, then run `POSTCHECK`.
The rollback refuses to run after any intent has been created.
