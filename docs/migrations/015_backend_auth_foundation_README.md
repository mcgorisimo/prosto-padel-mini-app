# 015 — Backend auth foundation

## Цель и границы

Миграция создаёт изолированную PostgreSQL-схему `backend_auth` для persistence уже утверждённых backend auth/accounts state machines этапов 06–07.5. Она не подключает runtime repositories, не меняет `DatabaseModule`, frontend или Supabase Auth и не создаёт роли, логины, accounts, пользователей, `club_admin`, тестовые данные, ключи либо секреты.

Используется только стандартный PostgreSQL: без extensions, Supabase schemas, `auth.uid()` и Supabase roles. Backend явно передаёт UUID и Unix epoch seconds. PostgreSQL `bigint` должен читаться адаптером `pg` как строка и только затем проходить TypeScript runtime validation.

## Объекты

В схеме ровно 14 таблиц:

1. `accounts` — account aggregate, роль, lifecycle status и storage timestamps.
2. `player_profiles` — минимальный профиль только с `account_id`.
3. `external_identities` — immutable historical owner/provider/namespace и linked lifecycle.
4. `external_identity_lookup_digests` — append-only HMAC-SHA-256 aliases.
5. `authentication_operations` — provider-neutral operation и inline terminal command/result.
6. `telegram_proof_consumptions` — append-only replay consumption.
7. `auth_session_families` — существующий `SessionId`, одна credential chain.
8. `auth_session_credentials` — generations и защищённые credential digests.
9. `auth_session_commands` — ordered persistence records rotate/revoke/expire.
10. `fresh_authentication_evidence` — immutable fresh-auth evidence.
11. `reauthentication_grants` — scoped grant и inline terminal command/result.
12. `otp_challenges` — OTP aggregate с verifier digest и attempts.
13. `otp_commands` — ordered submit/cancel/expire persistence records.
14. `security_audit_events` — PII-free append-only audit, не источник hydration.

Отдельных `auth_sessions`, operation/grant command tables, key/pepper/secret tables, legacy profiles, audit archives и product-domain tables нет.

## TypeScript → PostgreSQL

- Все внутренние branded IDs отображаются в `uuid`; UUID генерирует backend, DB default отсутствует.
- `UnixEpochSeconds` и `AggregateCommandSequence` отображаются в `bigint` с диапазоном JavaScript safe integer. Domain timestamps не имеют `now()` default.
- Подтверждённые 32-byte digests хранятся в `bytea` с проверкой длины. Обычные bounded opaque strings остаются `text` с CHECK.
- States, intents, variants, reasons и outcomes — `text` с закрытыми CHECK, без PostgreSQL enum.
- Authoritative state и command history нормализованы; JSON/JSONB не используются.
- Только `accounts.created_at`, `accounts.updated_at`, alias `created_at` и audit `event_order` являются согласованной persistence metadata. `event_order` — storage order, а не domain time.

Начальные defaults ограничены значениями `player`, `active`, `pending`, `active`, `active`, `pending` соответственно для account role/status, operation, family, grant и OTP challenge. UUID, timestamps, expiry, attempts, generations, digests и bindings всегда задаёт backend. Nullable terminal/result columns при создании остаются `NULL`.

## Identity и secret boundary

Canonical Telegram subject, телефон, raw initData, OTP, session credential, lookup/credential/verifier digest в audit, idempotency key в audit, ciphertext в audit, имя, username, photo URL, pepper и encryption key не сохраняются в открытом виде. Миграция не содержит реальные ключи и не создаёт key storage.

`ExternalIdentityKey` сохраняет transient вариант `canonical_subject` для trusted provider adapters, но этот вариант не пересекает persistence boundary. До создания persisted authentication operation или OTP challenge orchestration обязана вычислить HMAC alias и передать state machine вариант `lookup_digest`; после hydration retry проходит ту же canonicalization/HMAC-нормализацию. Adapter fail closed отклоняет попытку persist state с canonical subject. Благодаря этому equality reducer до и после reload сравнивает одинаковый discriminator, а plaintext subject/destination не попадает в PostgreSQL.

Поиск identity использует `(provider, namespace, digest)` для конкретного HMAC alias. PostgreSQL не может доказать, что HMAC, вычисленные разными pepper versions, относятся к одному canonical subject. Repository обязан:

1. Вычислить aliases для всех одновременно принимаемых pepper versions до lock-bearing transaction.
2. Искать aliases в canonical order.
3. После определения owner заблокировать найденные historical identity rows в глобальном порядке и повторить canonical authoritative lookup aliases.
4. Добавлять все новые aliases только к одной historical identity.
5. Не удалять старые aliases автоматически.
6. Отклонять ситуацию, когда разные versions разрешились в разные identities.

`external_identities.account_id`, provider и namespace неизменяемы. Unlink сохраняет historical reservation. Unlinked identity всегда non-primary; linked identity может быть primary или non-primary; partial unique index допускает не более одной linked primary на account, но наличие primary не обязательно. Обычная демоция разрешена. При unlink/delete текущей primary consistency trigger требует уже назначенную replacement primary.

Deferred active-account trigger сам блокирует затронутые accounts в UUID order и отдельным statement после возможного ожидания пересчитывает linked identities. Поэтому при `READ COMMITTED` active account с нулём способов входа не фиксируется даже при ошибочном repository path. Repository всё равно обязан брать account lock раньше identity locks; нарушение порядка может завершиться deadlock abort.

## Proof, operation и session family

Proof discriminator в `authentication_operations` допускает ровно одну форму: Telegram fingerprint или OTP challenge UUID. Telegram consumption/OTP challenge имеют unique inward `operation_id`; outward FK operation deferred, inward FK immediate. Deferred mutual-binding triggers проверяют обе стороны при commit.

Family создаётся только из completed operation. Для `existing_account` operation resolution account совпадает с family account. Для `new_account_required` operation identity digest должен разрешаться через alias historical identity создаваемого account. Pending, blocked, conflict, failed и expired operation family не создают. Unique operation binding допускает не более одной family.

Разрешены две идемпотентные signup-транзакции: A создаёт account + profile + первую identity + aliases; B создаёт family + credential generation 1. Промежуточный active account без session credential допустим: login method уже есть, session не выдана, а retry B находит account и operation и завершается под locks/UNIQUE.

## Credentials и command histories

Credential имеет PK `(family_id, generation)` и UNIQUE `(family_id, digest)`. Глобального digest index/UNIQUE нет: `family_id` берётся из `SessionCommand.sessionId`, а `SessionCredentialReference` содержит generation и digest. Partial unique допускает одну unconsumed credential; deferred current-generation FK доказывает существование, consistency trigger — что generation действительно текущая и unconsumed.

При `credential_rotated` command, old credential consumption, next credential row и family current generation согласуются в одной транзакции. Deferred consistency trigger воспроизводит успешные rotations строго по `command_sequence`: каждая presented generation/digest обязана быть current на своём шаге, next generation/digest — существующей следующей credential, а итоговая current generation — последней успешной rotation. `applied_at`, UUID и физический порядок строк не используются как источник порядка. При `reuse_detected` old credential уже consumed; next reference остаётся только в command record для exact retry, новая credential row не создаётся и unconditional FK на неё отсутствует. Поддержаны `active → reuse_detected` и `revoked → reuse_detected`.

Session/OTP command tables имеют PK по aggregate + command ID и UNIQUE по aggregate + positive command sequence. Sequence назначает repository только под parent row lock. UNIQUE предотвращает duplicate; gap выявляет fail-closed TypeScript hydration. Records хранят защищённые references/digests, но не plaintext credential или OTP. Exact retry возвращает сохранённый result; тот же command ID с другим request binding либо новый command ID с consumed reference распознаётся state machine как conflict/reuse.

Same-aggregate composite FK не допускают terminal/consuming command другого aggregate. Command row вставляется до parent/credential terminal update. Все FK используют `ON UPDATE NO ACTION` и `ON DELETE NO ACTION`; только operation→Telegram, operation→OTP и family→current credential являются `DEFERRABLE INITIALLY DEFERRED`.

## Audit

`security_audit_events` соответствует закрытым event-specific constructors. Metadata представлена плоскими typed колонками и event-specific CHECK. `operation_id` имеет FK, когда operation существует; `attempted_operation_id` сохраняет тот же безопасный UUID без FK, когда отказ возник до создания operation. Оба одновременно не заполняются. `correlation_id`, произвольный JSON и дополнительные reason columns отсутствуют.

Audit имеет backend UUID `event_id` и отдельный identity `event_order`. Application role может только SELECT и INSERT разрешённых колонок без `event_order`. UPDATE/DELETE/TRUNCATE запрещены ACL и triggers. Audit FK не имеют destructive referential actions. Audit не используется для aggregate hydration.

## Constraints, indexes и triggers

PK/UNIQUE являются последним арбитром для competing creates, historical identity aliases, proof/idempotency reuse, one-family-per-operation и command exact retry. Partial indexes обеспечивают one linked primary, one unconsumed credential и active-grant lookups. Non-unique indexes оставлены только для подтверждённых lookups/locks: account identities, pending operations, account families, active grants, pending OTP и четыре audit access paths. Отдельные child-FK indexes для immutable evidence/grant bindings отложены до появления подтверждённого query/delete workload.

Constraint/transition triggers проверяют player-profile role, alias presence, active account login method, primary unlink replacement, proof cycles, operation eligibility for family, session/credential/command consistency, evidence/grant bindings, OTP history и immutable/append-only boundaries. Trigger functions используют invoker security, schema-qualified relations и фиксированный `search_path`; `SECURITY DEFINER` не используется.

## Ownership и ACL

Роли provisioned инфраструктурой заранее и миграцией не создаются:

- `backend_auth_owner`: NOLOGIN, владелец schema/tables/indexes/identity sequence/functions/triggers, используется migration process.
- `backend_auth_app`: LOGIN, не владеет объектами, имеет schema USAGE, table SELECT и точечные column-level INSERT/UPDATE.

Application role не получает CREATE, DDL, REFERENCES, TRIGGER, DELETE или TRUNCATE. Она не может INSERT/UPDATE `accounts.role`, INSERT aggregate status, менять immutable bindings, aliases или command rows. Defaults позволяют создать только initial `player`/active/pending rows; BEFORE guards дополнительно отклоняют terminal initial state. Для audit sequence выдан только USAGE. PUBLIC не имеет schema/table/sequence/function access.

Миграция не изменяет default ACL `backend_auth_owner` и поэтому не влияет на будущие objects этого owner внутри или вне `backend_auth`. PRECHECK и POSTCHECK fail closed, если существующий default ACL выдаёт `backend_auth_app` доступ к будущим objects. Для каждого конкретного schema/table/sequence/function объекта 015 используются только явные REVOKE/GRANT; `PUBLIC EXECUTE` и прямой EXECUTE application role отзываются у каждой функции 015 отдельно.

Trigger EXECUTE проверяется при создании triggers; application role не получает прямой EXECUTE на trigger functions. Для invoker `SELECT ... FOR UPDATE` ей достаточно table SELECT и точечного UPDATE хотя бы одной разрешённой mutable state column родительского aggregate.

## Глобальный порядок блокировок

В одной транзакции locks всегда берутся в следующем порядке; несколько UUID/generations внутри уровня сортируются canonical ascending:

1. Authentication operation.
2. Telegram proof consumption как authoritative read после operation lock либо mutable OTP challenge row lock; append-only consumption не требует UPDATE privilege.
3. Accounts.
4. Session families.
5. Reauthentication grants.
6. External identities.
7. Lookup digest aliases в canonical order: authoritative reread под locks найденных identity owners; immutable alias rows не требуют UPDATE privilege, а отсутствующую row блокировать нельзя.
8. Session credentials по generation.
9. Existing command rows для exact retry: plain authoritative read после parent lock; immutable command rows не требуют отдельного row lock или UPDATE privilege.
10. Новые child rows.
11. Security audit последним.

Предварительный alias/digest lookup только определяет parent ID; authoritative lookup повторяется после parent locks. Отсутствующие строки не блокируются: UNIQUE остаётся конечным арбитром, проигравшая транзакция откатывается целиком. External provider calls, crypto/HMAC computation и OTP delivery выполняются вне lock-bearing transaction.

## 17 transaction boundaries

1. **Новый player account:** вне транзакции HMAC aliases; затем account → identity candidates/authoritative alias reread; INSERT account/profile/identity/aliases/audit. PK/global alias UNIQUE и deferred profile/login-method/alias triggers — арбитры.
2. **Resolve по identity:** предварительный alias lookup; затем найденный account → identities → aliases, authoritative reread. Несовместимые multi-version results дают conflict; никаких ownership updates.
3. **Link identity:** account → identities → aliases; INSERT либо relink historical identity только того же owner; partial primary/global alias UNIQUE и immutable binding guard — арбитры.
4. **Unlink identity:** account → все linked identities по UUID; при primary сначала demote old/assign replacement, затем unlink target; deferred primary и self-locking linked-count triggers — арбитры.
5. **Telegram proof consumption + operation:** proof verification вне транзакции; operation UUID подготовлен; INSERT operation, затем consumption, audit; fingerprint/idempotency/operation UNIQUE, deferred outward FK и mutual trigger — арбитры.
6. **Terminal operation:** operation lock, proof/challenge lock, при account resolution account/identity/alias locks; inline terminal update и audit. Immutable binding/terminal guard и resolution CHECK — арбитры; exact retry читает terminal state.
7. **Family + credential 1:** operation → account → при new-account identity/aliases; INSERT family, credential generation 1, audit. Completed-operation trigger, operation UNIQUE, deferred current credential FK/consistency — арбитры.
8. **Rotate credential:** family → presented credential → existing command; INSERT command и next credential, consume old, update family, audit. Command PK/sequence UNIQUE, family digest/generation UNIQUE и consistency trigger — арбитры.
9. **Reuse старой credential:** family → consumed credential → existing command; INSERT reuse command, terminal family update, audit; next row не вставляется. Same-family terminal FK/consistency и command keys — арбитры.
10. **Revoke/expire family:** family → existing command; INSERT terminal command, update family, audit. Composite terminal FK, terminal CHECK/guard и command keys — арбитры.
11. **Fresh evidence:** account → family; INSERT immutable evidence и audit. Composite account/family FK and consistency trigger — арбитры.
12. **Scoped grant:** account → family → evidence; INSERT grant/audit. Evidence composite FK and account/family/evidence window trigger — арбитры.
13. **Consume/revoke/expire grant + protected action:** account → family → grant → identities → aliases as required by action; perform protected mutations, inline grant terminal update, audit last. Grant terminal guard and domain constraints are arbiters; all commit or rollback together.
14. **Create OTP challenge:** external delivery preparation outside transaction; INSERT operation with pre-generated challenge UUID, then challenge, audit. Operation/challenge UNIQUE, deferred outward FK and mutual trigger are arbiters. Deliver only under an idempotent post-commit workflow.
15. **Submit OTP + optional operation completion:** operation → challenge → existing command; INSERT submit command, update attempts/terminal state and operation when verified, audit. Command keys, protected digest checks, OTP/proof consistency triggers — arbiters; early retry returns stored attemptsRemaining.
16. **Cancel/expire OTP:** operation when also completed/failed, then challenge → existing command; INSERT command, update challenge/operation, audit. Composite terminal FK, CHECK/guards and command keys — arbiters.
17. **Rejection/security audit without business mutation:** lock any existing referenced aggregate using the same order, then INSERT audit. Attempted operation UUID uses the no-FK projection only when aggregate creation never committed. Audit CHECK/ACL/append-only triggers are arbiters.

## Ручное применение

SQL не применяется автоматически. Первый запуск допускается только вручную в российском test-контуре:

1. Выполнить `015_backend_auth_foundation_PRECHECK.sql`; он заканчивается `ROLLBACK` и ничего не меняет.
2. Независимо review всех пяти файлов и сохранить output PRECHECK.
3. Выполнить `015_backend_auth_foundation.sql` один раз от migration principal, который может `SET ROLE backend_auth_owner`.
4. Сразу выполнить `015_backend_auth_foundation_POSTCHECK.sql`; он read-only и заканчивается `ROLLBACK`.
5. Не подключать application runtime, пока POSTCHECK и двухсессионные concurrency tests не приняты.

Если клиент потерял ответ после commit, main migration повторно не запускают вслепую. Сначала запускают POSTCHECK: независимые catalog inventories колонок, constraints/FK, indexes, functions, triggers, identity sequence, owners и ACL вместе с дополнительными fingerprints подтверждают committed success; отсутствие schema означает rollback; частичное/изменённое состояние требует ручной остановки и независимого review.

После появления российского test-контура обязательны двухсессионные tests: competing account creation, cross-account historical identity claim, Telegram replay, OTP double submit, grant double consume, two families per operation, old credential reuse, concurrent unlink последних login methods и deadlock-retry paths.

## Rollback

Rollback допустим только до появления любой auth/audit строки. Он не восстанавливает внешний login/provider state. Он не удаляет provisioned roles и не затрагивает другие migrations.

Требуется отдельная transaction-local и transaction-ID-bound confirmation в той же psql session:

```text
BEGIN;
SELECT set_config(
  'backend_auth.rollback_015_confirm',
  'DROP_EMPTY_BACKEND_AUTH_015:' || txid_current()::text,
  true
);
\ir 015_backend_auth_foundation_ROLLBACK.sql
```

Rollback после предварительной проверки confirmation и точного существования 14 таблиц получает `ACCESS EXCLUSIVE` locks на все таблицы в зафиксированном child-first порядке. Locks удерживаются до завершения внешней rollback-транзакции и не позволяют конкурентному INSERT/UPDATE/DELETE/TRUNCATE попасть между проверкой и удалением. Уже под locks rollback повторно проверяет owner, точный набор объектов, fingerprints всех tables/functions/identity sequence и пустоту каждой таблицы, включая audit, до первого destructive statement. После этого он явно удаляет triggers/functions/cyclic constraints и tables child-first, без `CASCADE`; schema удаляется последней. Любая строка, изменённый fingerprint, лишняя dependency, неверный owner или отсутствующая confirmation прерывают всю транзакцию fail closed.
