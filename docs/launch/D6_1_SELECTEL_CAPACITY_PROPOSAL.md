# D6.1 Selectel capacity proposal

## Status and scope

- Status: read-only proposal; no Selectel resource, server, database, DNS,
  secret, runtime or provider change is authorized by this document.
- Evidence date: 2026-08-26 (Europe/Moscow).
- Baseline: repository `0fe9cfde914703cb7c61fe8589f98f0bbdcde60c`;
  Selectel test application release
  `f55ba9318c92b97c6fa5e0b0defcdd752fab56cb`; server checkout and nginx
  configuration `21063f7c4737f57eee6c3589877a5f2c2ced8a1a`.
- Product load means **300–400 registered users**, not 400 permanently
  concurrent sessions. The contention case remains 10–20 simultaneous claims
  for one slot.
- Prices below are reference monthly estimates from Selectel's public price
  list on the evidence date, including 22% VAT. They are not a quote.

## Read-only inventory of the current Selectel test contour

| Area | Observed state | Capacity/readiness consequence |
| --- | --- | --- |
| Compute | One VM, 2 vCPU, 4,105,068,544 bytes RAM (3.82 GiB), no swap | Adequate for the current idle test stack; one host is a single point of failure |
| Disk | 64 GiB virtual disk; root filesystem 62.95 GiB, 11.70 GiB used, 48.67 GiB free, 20% used | Space is currently sufficient, but application, PostgreSQL, metrics and logs share it |
| Runtime | 10 running Compose services: nginx, frontend, backend, PostgreSQL, Grafana, Prometheus, Alertmanager, Loki, Vector and node-exporter | All roles and state are colocated; no container CPU/RAM limits or reservations are declared |
| Health | Nine configured healthchecks were healthy; node-exporter has no healthcheck; all restart counts were zero | This is a point-in-time health observation, not a load or failover result |
| Exposure | Public TCP 80/443 and SSH 22; nginx on loopback 8080; Grafana on loopback 3001; PostgreSQL/metrics not published from the host | Public database exposure was not found; there is no cloud load balancer |
| PostgreSQL | Local PostgreSQL 14.23 container; 15.3 MiB database; `max_connections=100`, `shared_buffers=128MB`, `work_mem=4MB`, SSL off | It is not Managed PostgreSQL, is colocated with the app, and has no database TLS/private-cloud failover contract |
| Connections | Backend constructs `pg.Pool` only from `DATABASE_URL`; no explicit pool maximum, acquire/statement/idle timeout or pool metrics | Production connection budget is implicit and can multiply with processes/replicas |
| Liveness/readiness | `/health` is a static process response and does not check database readiness | It is suitable only as liveness; a load balancer must not treat it as proven DB-backed readiness |
| Backup/restore | Local `pg_dump`/manifest harness exists; latest regular backup observed from 2026-08-06 and audit copies through 2026-08-10; files remain on the same VM | Useful mocked/local harness, but not off-host backup, Managed PostgreSQL PITR, or a current isolated restore drill |
| Observability | Local Prometheus (15 d/2 GB), Loki (14 d), Grafana and Alertmanager; Alertmanager has no external notification receiver | Local visibility exists, but the observability stack is another single-host stateful workload and alerts cannot yet leave the VM |
| TLS | `app.prostopdl.ru`, Let's Encrypt, valid through 2026-10-22 | Current edge TLS is valid; renewal and expiry alerting remain operational controls |

The resource snapshot was idle: every container was below 1% CPU and the
largest observed memory users were Grafana (157.5 MiB), Loki (99.27 MiB),
Prometheus (86.16 MiB) and backend (59.8 MiB). It must not be extrapolated into
a production capacity claim.

## Gaps that all future configurations must close

1. Put Managed PostgreSQL on a private subnet with no public database IP. Use
   CA-validated TLS (`verify-full` equivalent) and DNS endpoints rather than a
   pinned node address.
2. Use PgBouncer transaction pooling on port 5433 with an explicit application
   pool budget. Current source has no session advisory locks, `LISTEN/NOTIFY`,
   named prepared statements or temporary-table dependency, but compatibility
   still needs a focused regression before any runtime change.
3. Keep the current static endpoint as liveness and add a separate bounded,
   database-backed readiness endpoint before attaching application nodes to a
   load balancer.
4. Separate app, database and observability failure domains. Declare container
   or service CPU/RAM limits and disk alerts from measured peaks.
5. Combine Managed PostgreSQL automatic backup/PITR with an encrypted logical
   copy outside the cluster. Prove recovery by restoring into a new isolated
   endpoint; never overwrite or stop the source database for a drill.
6. Route alerts externally and keep logs PII-safe. Selectel Logs and the alert
   transport are quote/configuration items and are not silently assumed here.

## Common sizing and acceptance assumptions

- Synthetic data only until a separately approved DB/provider gate.
- The application pool limit is **per process**; the budget is
  `instances × processes × pool max`. A process-count change must recalculate
  the budget.
- Do not increase PostgreSQL `max_connections` from its managed default without
  evidence. Reserve at least 20 connections in test, 25 in budget production
  and 30 in HA production for platform, administration and maintenance.
- Alert when database server connections exceed 70% of the agreed budget or
  the pooler wait queue remains non-zero.
- Focused local/mocked load acceptance for the budget profile: 400 synthetic
  accounts; 40 concurrent sessions at 10–15 requests/s for 30 minutes; 80 at
  30 requests/s for 5 minutes; and 20 simultaneous claims for one slot.
  Acceptance: zero double-booking, zero pool-exhaustion/acquire timeouts, HTTP
  errors below 1%, p95 reads below 500 ms and p95 writes below 800 ms.
- These are engineering acceptance targets, not contractual SLOs. A shared
  Selectel test load run requires its own exact approval.

## Official price basis

| Unit | Reference price/month |
| --- | ---: |
| Cloud VM vCPU, 2.25 GHz | 735.19 RUB/core |
| Cloud VM RAM, 2133–2933 MHz | 267.34 RUB/GiB |
| Basic network SSD | 10.09 RUB/GiB |
| Managed DB standard vCPU | 1,024.63 RUB/core |
| Managed DB standard RAM | 342.10 RUB/GiB |
| Managed DB standard local disk | 22.11 RUB/GiB |
| Basic non-redundant load balancer | 1,398.30 RUB |
| Basic redundant load balancer | 2,607.89 RUB |
| Advanced redundant load balancer | 4,339.05 RUB |
| Cloud router | 200.00 RUB |
| One public/floating IPv4 planning line | 189.57 RUB |
| S3 Vault storage | 1.43 RUB/GiB |

The estimate excludes traffic above the included cloud allowance, S3
operations, separately billed automatic-backup storage if applicable, Selectel
Logs, external alert delivery, domain registration and engineering/support.
Before any order, the exact region, pool, SKU availability and address billing
must be rechecked in the Selectel calculator/control panel.

## Configuration 1 — minimum paid test

Purpose: functional integration and smoke testing at the lowest sensible paid
footprint. It is deliberately non-HA and is not a production option.

| Component | Concrete configuration | Estimate/month |
| --- | --- | ---: |
| App + local observability VM | 2 vCPU, 4 GiB RAM, 64 GiB basic SSD | 3,185.50 RUB |
| Managed PostgreSQL | 1 node: 2 vCPU, 4 GiB RAM, 30 GiB local disk | 4,080.96 RUB |
| Load balancer | Basic, non-redundant | 1,398.30 RUB |
| Network | Cloud router + one IPv4 planning line | 389.57 RUB |
| Logical backup archive | 20 GiB S3 Vault | 28.60 RUB |
| **Core subtotal** |  | **9,082.93 RUB** |
| **Planning envelope** | Variability and omitted metered items | **10,000–12,000 RUB** |

- Database: private subnet, no public IP, CA-validated TLS, DNS master endpoint,
  PgBouncer transaction port 5433, `pool_size=8`; one backend process with
  explicit client pool `max=6`.
- Backup: Managed PostgreSQL automatic backup/PITR plus weekly encrypted logical
  export, retained within the 20 GiB planning cap. Restore only to a new
  isolated test endpoint under a separate DB/provider-write gate.
- Expected use: 300–400 registered synthetic/test accounts, about 20 concurrent
  sessions and 5 requests/s nominal, up to 40 and 10 requests/s briefly.
  Slot contention remains mocked/local until separately approved.
- Failure property: the VM, database node and basic load balancer each remain a
  single point of failure.

## Configuration 2 — budget production

Purpose: recommended launch baseline for 300–400 registered users after the
local harness and controlled Selectel test acceptance pass.

| Component | Concrete configuration | Estimate/month |
| --- | --- | ---: |
| Application nodes | 2 × (2 vCPU, 4 GiB RAM, 40 GiB basic SSD) | 5,886.68 RUB |
| Observability node | 2 vCPU, 4 GiB RAM, 100 GiB basic SSD | 3,548.74 RUB |
| Managed PostgreSQL | 2 nodes × (2 vCPU, 4 GiB RAM, 40 GiB local disk) | 8,604.12 RUB |
| Load balancer | Basic, redundant | 2,607.89 RUB |
| Network | Cloud router + one IPv4 planning line | 389.57 RUB |
| Logical backup archive | 50 GiB S3 Vault | 71.50 RUB |
| **Core subtotal** |  | **21,108.50 RUB** |
| **Planning envelope** | Variability and omitted metered items | **24,000–28,000 RUB** |

- Application nodes: stateless and placed on distinct failure domains where
  the selected pool supports it. LB health uses readiness, never liveness only.
- Database: one master plus one replica, private subnet/security groups,
  CA-validated TLS, DNS master discovery, PgBouncer transaction port 5433 with
  `pool_size=12`; two backend processes each `max=6` (12 clients total).
- Backup: built-in seven-day PITR plus daily encrypted logical export with a
  30-day policy bounded initially by the 50 GiB cap. The cap must be revised
  from measured compressed dump growth.
- Expected use: 40 concurrent sessions at 10–15 requests/s sustained, 80 at
  30 requests/s for a five-minute peak, including 20 simultaneous slot claims.
- Failure property: one application node may fail without losing the service;
  the two-node DB has managed failover, while the single observability node can
  lose monitoring history/visibility without taking down the application.

## Configuration 3 — fault-tolerant production

Purpose: stronger availability and approximately 3× launch traffic headroom.
Use a Selectel pool/region that supports Multi-AZ Managed PostgreSQL (official
release notes identify ru-6 support); verify availability before ordering.

| Component | Concrete configuration | Estimate/month |
| --- | --- | ---: |
| Application nodes | 3 × (4 vCPU, 8 GiB RAM, 60 GiB basic SSD) | 17,054.64 RUB |
| Observability nodes | 2 × (2 vCPU, 4 GiB RAM, 100 GiB basic SSD) | 7,097.48 RUB |
| Managed PostgreSQL | 3 Multi-AZ nodes × (4 vCPU, 8 GiB RAM, 100 GiB local disk) | 27,138.96 RUB |
| Load balancer | Advanced, redundant | 4,339.05 RUB |
| Network | Cloud router + one IPv4 planning line | 389.57 RUB |
| Logical backup archive | 200 GiB S3 Vault | 286.00 RUB |
| **Core subtotal** |  | **56,305.70 RUB** |
| **Planning envelope** | Logs, traffic, variability and omitted metered items | **65,000–75,000 RUB** |

- Application: three stateless nodes across available failure domains; the
  loss of one node must still meet the budget-production load profile.
- Database: three Multi-AZ nodes, private subnet/security groups,
  CA-validated TLS, DNS master discovery, PgBouncer transaction port 5433 with
  `pool_size=24`; three backend processes each `max=8` (24 clients total).
- Backup: built-in seven-day PITR, daily encrypted logical archive and a
  quarterly isolated restore drill. Recovery targets must be measured by that
  drill; this proposal does not invent an RTO/RPO result.
- Expected use: 80 concurrent sessions at 30 requests/s sustained and 150 at
  60 requests/s for a five-minute peak, plus the 20-claim contention test.
- Observability caveat: the repository's current single-instance Loki
  filesystem configuration (`replication_factor=1`) cannot simply be copied to
  two nodes and called HA. That later slice needs an independently reviewed
  storage/replication design or Selectel Logs; the quote is not in this total.

## Decision matrix

| Option | Monthly core | 300–400-user fit | Main limitation | Decision use |
| --- | ---: | --- | --- | --- |
| Minimum paid test | 9,082.93 RUB | Functional test only | Multiple single points of failure; no production SLO | Replace the colocated test DB after local regressions |
| Budget production | 21,108.50 RUB | Recommended launch baseline | Monitoring remains a single failure domain | Preferred initial production proposal |
| Fault-tolerant production | 56,305.70 RUB | Launch plus ~3× traffic headroom | Higher cost; observability HA requires redesign | Choose when availability/headroom justify the premium |

No configuration is ready to provision yet. The next D6 slices must first add
and independently review local/mockable connection-budget, readiness,
backup/restore-runbook and load/fault acceptance without infrastructure writes.

## Sources

- [Selectel public prices](https://selectel.ru/prices/)
- [Managed PostgreSQL](https://selectel.ru/services/cloud/managed-databases/postgresql/)
- [Managed PostgreSQL automatic backups and PITR](https://docs.selectel.ru/en/managed-databases/postgresql/backups/)
- [Managed PostgreSQL network access control](https://docs.selectel.ru/en/managed-databases/postgresql/network-access-control/)
- [Connect to Managed PostgreSQL](https://docs.selectel.ru/en/managed-databases/postgresql/connect-to-cluster/)
- [PgBouncer connection pooler](https://docs.selectel.ru/en/managed-databases/postgresql/connection-pooler/)
- [Create a Managed PostgreSQL cluster](https://docs.selectel.ru/en/managed-databases/postgresql/create-cluster/)
- [Managed PostgreSQL fault tolerance](https://docs.selectel.ru/en/managed-databases/postgresql/cluster-fault-tolerance/)
- [Managed PostgreSQL monitoring](https://docs.selectel.ru/en/managed-databases/postgresql/monitoring/)
- [Managed database release notes](https://docs.selectel.ru/en/managed-databases/release-notes/)
- [Cloud load balancer](https://selectel.ru/services/cloud/load-balancer/)
- [Cloud load balancer billing](https://docs.selectel.ru/load-balancer/about/payment/)
