# Migration 032: backend YCLIENTS record webhook signals

## Purpose

This storage-only migration adds a durable, coalescing inbox for YCLIENTS
record webhook signals. It does not connect a YCLIENTS account, read bookings,
write bookings, expose a token, or change the current private-booking flow.

The first runtime slice accepts only `record` events with `create`, `update`, or
`delete` status for one configured company. A callback is an untrusted hint: it
never mutates a booking directly. A later worker must use authenticated
YCLIENTS API reads to obtain and validate the canonical record before updating
backend-owned booking state.

## Privacy boundary

The inbox stores only:

- numeric company and record identifiers;
- the latest event type;
- first/last server receipt timestamps;
- delivery, version, and reconciliation counters.

The webhook `data` object is deliberately discarded. Client names, phones,
comments, service details, visit data, request bodies, tokens, and headers must
not be persisted or logged by this endpoint.

## Delivery model

The primary key is `(company_id, record_id)`. Repeated callbacks update one row,
increment `delivery_count` and `version`, and preserve the original receipt
time. `reconciled_version < version` means that authenticated API reconciliation
is still required. The pending index provides deterministic processing order.

Because YCLIENTS does not document a webhook signature, the public endpoint
also serializes writes per company and refuses new unique rows after a bounded
100,000-row safety limit. Existing record IDs continue to coalesce. The later
reconciliation worker must retire reconciled rows before this limit can be
approached; a capacity refusal is returned as the same safe `503` used for a
storage outage.

YCLIENTS documents that webhook deliveries are not retried and delivery
tracking is unavailable. Therefore webhooks are an acceleration path, not the
only source of correctness. A periodic authenticated reconciliation scan is
still required.

## Runtime boundary

Keep `YCLIENTS_WEBHOOK_ENABLED=false` until migration 032 passes POSTCHECK and
the reviewed backend image is deployed. When enabling it, configure the exact
positive safe-integer `YCLIENTS_COMPANY_ID`. Requests for other companies are
hidden behind `404`; malformed requests return `400`; persistence failures
return `503`; successful durable acceptance returns `204`.

The public endpoint is:

`https://app.prostopdl.ru/api/v1/integrations/yclients/webhook`

No ordinary application bearer token, YCLIENTS User Token, or Partner Bearer
belongs in this public callback URL or request body.

## Files

- `032_backend_yclients_record_webhook_signals_PRECHECK.sql` — read-only baseline.
- `032_backend_yclients_record_webhook_signals.sql` — creates the empty inbox.
- `032_backend_yclients_record_webhook_signals_POSTCHECK.sql` — exact catalog and ACL validation.
- `032_backend_yclients_record_webhook_signals_ROLLBACK.sql` — removes only an unused empty inbox.
- `032_backend_yclients_record_webhook_signals_README.md` — this runbook.

## Test rollout

1. Confirm a clean test checkout at the reviewed commit.
2. Keep the YCLIENTS webhook disabled and stop the backend for the migration window.
3. Create and publish a database backup.
4. Run PRECHECK and save its JSON object and checksum.
5. Apply migration 032 with `ON_ERROR_STOP=1`.
6. Run POSTCHECK and save its JSON object and checksum.
7. Confirm old counts/fingerprints match and the new table is empty.
8. Deploy the reviewed backend with the webhook still disabled and verify health/auth boundaries.
9. Configure the exact test company ID, enable the endpoint, then save the URL in YCLIENTS.
10. Produce one harmless test record change and verify one coalesced inbox row and zero direct booking mutations.

## Rollback

Rollback is allowed only while the inbox is empty. After the first webhook
signal, rollback refuses and a reviewed forward migration must preserve the
history.
