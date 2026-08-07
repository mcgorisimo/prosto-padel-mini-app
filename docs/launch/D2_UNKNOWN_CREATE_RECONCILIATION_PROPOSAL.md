# D2 unknown-create reconciliation boundary

Status: `proposal_required`; no SQL is prepared or approved.

## Proven boundary

Migration 033 permits a confirmed reservation/create operation only with the
complete YCLIENTS binding: appointment ID, record ID and AEAD-encrypted record
hash. A lost/uncertain create response does not provide those values. The
confirmed bounded admin-list contract can identify at most one candidate by
owner-scoped operation `api_id` plus the exact service/resource/datetime
effect, but provider uniqueness is undocumented and the confirmed safe list
contract does not provide the complete appointment/hash binding.

The runtime therefore atomically claims at most one narrow, provider-wide
rate-limited read-only candidate scan, records that claim before dispatch and
keeps the reservation
`unknown/held`. It never repeats POST and exposes the persisted owner-scoped
reservation/request-key recovery handle for refresh and administrator
attention. A candidate is not promoted to confirmed and 0 or multiple rows are
not treated as rejection.

## Operational attention gate

Before Selectel rollout, the operator runbook must include a bounded,
read-only lookup over the existing migration-033 unknown index. It selects at
most 50 oldest non-terminal create operations with their internal reservation
and operation IDs, owner account ID, status, provider-attempt timestamps,
reconciliation attempt count and last reconciliation timestamp. It must not
select the encrypted client snapshot, ciphertext metadata, provider record
hash, contact data or tokens. Access is restricted to the existing database
operator role and the output is handled as a security artifact; running the
lookup still requires the rollout/operator approval.

The approved runbook may execute only this shape inside a read-only transaction
with a bounded statement timeout (the operator records counts/IDs, never row
snapshots containing other columns):

```sql
SELECT r.reservation_id,
       o.operation_id,
       o.owner_account_id,
       r.status AS reservation_status,
       o.status AS operation_status,
       o.provider_attempt_started_at,
       o.provider_attempt_finished_at,
       o.reconciliation_attempts,
       o.last_reconciliation_at
FROM backend_reservation.reservation_operations AS o
JOIN backend_reservation.court_reservations AS r
  ON r.reservation_id = o.reservation_id
 AND r.owner_account_id = o.owner_account_id
WHERE o.operation_type = 'create'
  AND (
    o.status = 'unknown'
    OR (
      o.status = 'pending'
      AND o.created_at <=
        floor(extract(epoch FROM clock_timestamp()))::bigint - 120
    )
  )
ORDER BY coalesce(o.unknown_at, o.created_at) ASC, o.operation_id ASC
LIMIT 50;
```

An operation with `reconciliation_attempts >= 1` remains held and is present in
that lookup, but another owner refresh cannot dispatch a second candidate scan.
A stale pending operation is also visible even if no owner refresh has yet
classified it: absent `provider_attempt_started_at` proves no write dispatch and
permits rejection/release; a present stale attempt is first moved to
`unknown/held`, then may claim the single read-only scan.
There is no automatic polling, provider write or notification fallback. A
dedicated club-admin queue/API is a later separately approved surface.

## Approval needed for terminal recovery

Choose one before implementing a terminal automatic reconciliation:

1. Obtain a documented YCLIENTS read contract that returns and proves the full
   create binding for an unambiguous candidate; or
2. Approve an expand-only migration for a separate provisional reconciliation
   candidate/evidence state that does not pretend to be a confirmed provider
   binding. Its promotion rules still require a separately approved proof
   contract.

Until then, no SQL, provider retry, synthesized appointment ID/hash or slot
release is allowed. This boundary does not block ordinary create/get/admin
read-only refresh, but the operational lookup is a rollout gate and a
post-write crash or lost create response remains an explicit admin-attention
state.
