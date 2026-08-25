# Observability runbook — Selectel test

## Scope and topology

The test contour implements one operational chain:

```text
containers --GELF/UDP--> Vector --> Loki --> Grafana
backend /metrics ---------> Prometheus --> Grafana
host/node-exporter --------^       |
                                    +--> Alertmanager
```

- Vector is the only centralized log collector. Its API and Prometheus
  exporter are internal.
- Loki keeps container logs for 14 days on a named volume.
- Prometheus keeps metrics for 15 days with a 2 GB size cap.
- Grafana is the only operator UI. It binds to server loopback on port `3001`.
- Alertmanager groups and stores alert state. Grafana reads firing-rule state
  from Prometheus. External delivery is deliberately disabled until an
  owner-approved recipient and transport secret exist.
- The backend metrics route is reachable only from the internal observability
  network. Nginx returns `404` for public `/api/v1/metrics`.

No Docker socket is mounted. Container logging uses non-blocking GELF delivery
with a bounded local cache, so collector failure must not stop the application.
The Vector container itself retains bounded Docker-local logs to avoid a
logging loop.

## Operator access

Create an SSH tunnel from the operator workstation:

```text
ssh -L 3001:127.0.0.1:3001 root@135.106.155.112
```

Then open `http://127.0.0.1:3001`. Use `GRAFANA_ADMIN_USER` and the password
stored in the server file referenced by `GRAFANA_ADMIN_PASSWORD_FILE_HOST`.
Never publish port `3001` on `0.0.0.0` and never commit the password file.

The provisioned dashboard is `Prosto Padel / Prosto Padel · Test overview`.
It contains backend availability, HTTP 5xx, p95 latency, disk capacity, active
alerts, request rate, bounded domain outcomes and the centralized log stream.

## Common investigations

Use these Loki queries in Grafana Explore:

```text
{environment="test", service=~".*backend.*"} | json
{environment="test", event="domain_operation_completed", domain="auth"} | json
{environment="test", service=~".*backend.*"} | json | statusCode >= 500
```

Use these Prometheus queries:

```text
up
sum by (route, outcome) (rate(prosto_padel_http_requests_total[5m]))
histogram_quantile(0.95, sum by (le) (rate(prosto_padel_http_request_duration_milliseconds_bucket[5m])))
sum by (domain, action, outcome, reason) (increase(prosto_padel_domain_operations_total[15m]))
```

Application IDs, chat text, Telegram proofs, bearer tokens, contacts and
provider payloads must never be metric labels. If a forbidden value is found,
stop exporting the affected stream, preserve only the minimum incident
evidence, rotate any exposed credential and fix the allowlist before restart.

In the pinned no-egress Grafana image, one startup record from the exact logger
`plugin.angulardetectorsprovider.dynamic` may report a failed request to the
exact public path `https://grafana.com/api/plugins/angular_patterns`. Grafana's
plugin and analytics update settings must still be verified as disabled. This
known upstream air-gap record alone is not an operational failure; do not mute
the logger, and treat every other `error` or `fatal` record normally.

## Alert rules

- `ProstoPadelBackendDown`: backend scrape absent for 2 minutes.
- `ProstoPadelObservabilityTargetDown`: an internal observability target absent
  for 5 minutes.
- `ProstoPadelBackendHttp5xx`: at least one 5xx in 5 minutes.
- `ProstoPadelBackendP95LatencyHigh`: p95 over 1000 ms for 5 minutes.
- `ProstoPadelDomainDependencyFailure`: bounded internal/dependency domain
  failure observed.
- `ProstoPadelAuthRejectionsSpike`: at least 10 rejected auth operations in
  10 minutes.
- `ProstoPadelHostDiskSpaceLow`: root filesystem below 15% free for 10 minutes.
- `ProstoPadelHostMemoryLow`: available host memory below 10% for 10 minutes.

Until an external receiver is configured, firing alerts appear in Grafana and
Alertmanager but do not send email, SMS or Telegram messages. This is an
explicit incomplete delivery gate, not a silent success.

## Rollout gate

1. Require a clean Selectel test checkout at the exact candidate commit.
2. Determine the Grafana UID/GID from the exact pinned image. Create the
   Grafana password as a regular non-symlink server file outside the repository,
   owned by that UID/GID with mode `600`; put only its value in the file.
3. Set only its path in `GRAFANA_ADMIN_PASSWORD_FILE_HOST` in `.env.test`.
4. Run merged Compose `config --quiet` with exact `APP_RELEASE`.
5. Pull the six pinned observability images.
6. Start Loki and Vector first. Confirm both remain running and Vector's Loki
   sink health check succeeds.
7. Recreate PostgreSQL, backend, frontend and nginx to activate the GELF
   logging driver. This briefly restarts the test contour.
8. Start node-exporter, Alertmanager, Prometheus and Grafana.
9. Require all containers healthy/running with restart count `0`, then verify:
   backend internal/public health `200`; public metrics `404`; Prometheus
   targets up; Prometheus/Loki datasource health; log arrival from all application
   services; one safe alert-rule evaluation; and the existing no-write business
   smoke.

Do not deploy this stack to production without a separate direct command,
capacity sizing, an externally durable log destination and a tested external
alert receiver.

## Degraded operation and rollback

If Loki or Vector fails, the application should continue through the
non-blocking driver and bounded cache. Restore the collector promptly because
old cache entries can be evicted. If Prometheus, Grafana or Alertmanager fails,
application traffic is unaffected but visibility is degraded.

Rollback must use the previous exact repository commit and its Compose files.
Recreate application containers to restore their previous logging driver;
changing Compose files alone does not change an existing container. Do not
delete `loki_data`, `prometheus_data`, `alertmanager_data` or `grafana_data`
during rollback. Named-volume deletion is a separate destructive operation.

## Selectel managed follow-up

Selectel Logs can receive a second Vector sink after `logs.writer` S3-compatible
credentials and endpoint/bucket values are created. That is the preferred
off-host durability follow-up; credentials must be mounted from server files,
not stored in Git. Selectel availability checks can provide an independent
outside-in health alert after an owner selects its contact and notification
channel.
