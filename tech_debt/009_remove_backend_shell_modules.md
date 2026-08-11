# TD-009 — Remove inert backend shell modules and CRM placeholders

- Status: `planned`
- Priority: P2
- Effort: S–M (1–2 days)
- Risk: low
- Dependencies: TD-003
- Primary files: `app.module.ts`, `events/*`, unused YCLIENTS module/adapter,
  CRM tokens/disabled adapter, module boundary E2E
- Migration: not needed

## Evidence and problem

`AccountsModule` and the outbox shell are empty; `EventsModule` only imports the
empty outbox. `YclientsModule`/`YclientsAdapter` are not wired. `CRM_ADAPTER`
always resolves to `DisabledCrmAdapter` and its only meaningful consumer is a
test of the placeholder, while real YCLIENTS clients are wired separately.

## TDD plan

1. Replace placeholder assertions with a real `IntegrationsModule` wiring test:
   runtime YCLIENTS clients share exactly one limiter and remain disabled when
   config says disabled.
2. Prove AppModule routes/health and provider singletons before deletion.
3. Remove one inert module/token at a time and run typecheck/unit/E2E/build.
4. Keep legacy config input accepted if current deployed env still supplies it;
   remove config only with separate compatibility proof.

## Acceptance criteria

- No empty runtime module or never-consumed CRM token remains.
- Real integrations and all endpoints resolve identically.
- No configuration, SQL, provider call or public contract changes.

## Exclusions

Do not remove roadmap ports solely because no provider is wired; do not touch
infrastructure Compose/env in this task.

## Independent review gate

Reviewer independently confirms the import/DI graph and no hidden provider
consumer. Score ≥9, no P0/P1.
