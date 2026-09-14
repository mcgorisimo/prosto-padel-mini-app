# Migration 045 — Telegram bot update receipts

Stores at most 1,024 exact update receipts per internal bot namespace. It contains no
Telegram update body, chat/user identifier, command text, username, name or bot
token. The receipts make the TEST-only `/start` destination synchronization
idempotent across retries, restarts and concurrent requests. A replay may
receive the same neutral webhook reply again because Telegram does not report
the outcome of a Bot API method returned in the webhook HTTP response.

The webhook must be registered separately with `max_connections=1`,
`allowed_updates=["message"]` and a secret header. Registration is a provider
mutation and is not performed by this migration.

Run PRECHECK, apply and POSTCHECK with the exact `expected_database` variable.
Do not apply the rollback automatically after a failed rollout.
