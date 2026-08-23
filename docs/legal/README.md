DRAFT — НЕ ОПУБЛИКОВАНО — НЕ УТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ — ТРЕБУЕТ ЮРИДИЧЕСКОЙ ПРОВЕРКИ

# Юридические документы «Просто Падел»

## Статус комплекта

- Комплект: `D5.3 legal documents v0.2`.
- D5.3 preparation checkpoint: `done`.
- Legal candidate: `draft_not_published_not_legally_approved`.
- D5.3 overall: `not_done`; implementation и publication остаются отдельными
  будущими gates.
- Публикация: `not_published`.
- Финальное утверждение legal documents владельцем: `not_given`.
- Юридическая проверка: `required`.
- Язык: `ru-RU`.
- Runtime/deployment impact: `not_needed` до отдельного code/publication gate.
- Тексты, ранее выведенные в чат, не являются каноническими. Каноническая рабочая версия находится только в файлах этого каталога.

Незакрытые fact buckets сохранены явно:

- `pending_26_aug` — реквизиты ООО и официальные адреса;
- `requires_contract` — Сбербанк/online-ККТ/ОФД, YCLIENTS/YPLACES и
  Selectel entity/region/cross-border facts;
- `pending_owner_later` — support phone/social links, effective versions и
  public legal URLs.

Плейсхолдеры этих групп не скрываются и не заменяются предположениями.

## Документы

| Ключ | Документ | Версия | Статус |
|---|---|---|---|
| `terms` | [TERMS_DRAFT.md](./TERMS_DRAFT.md) | `{{TERMS_VERSION}}` | draft / owner approval pending |
| `privacy` | [PRIVACY_POLICY_DRAFT.md](./PRIVACY_POLICY_DRAFT.md) | `{{PRIVACY_VERSION}}` | draft / fact map pending |
| `cancellation` | [CANCELLATION_POLICY_DRAFT.md](./CANCELLATION_POLICY_DRAFT.md) | `{{CANCELLATION_VERSION}}` | draft / expense method pending |
| `personal_data_processing` | [PERSONAL_DATA_CONSENT_DRAFT.md](./PERSONAL_DATA_CONSENT_DRAFT.md) | `{{PERSONAL_DATA_CONSENT_VERSION}}` | draft / backend evidence key absent |

## Канонические рабочие реестры

| Реестр | Версия | Статус |
|---|---|---|
| [DATA_PROCESSING_MATRIX_DRAFT.md](./DATA_PROCESSING_MATRIX_DRAFT.md) | `data_processing_matrix_draft_v0.1` | code/schema inventory; owner/contract/legal decisions pending |
| [OWNER_INPUT_CHECKLIST.md](./OWNER_INPUT_CHECKLIST.md) | `owner_input_checklist_v0.1` | ООО facts `pending_26_aug`; no credentials requested |

Эти два файла поддерживают подготовку Privacy/Terms/Cancellation/Consent, но не
являются опубликованными политиками. Owner decisions могут уточнять содержание
четырёх drafts; их user-visible versions и effective dates остаются
плейсхолдерами до отдельного approval gate.

Предлагаемый публичный namespace после отдельного publication gate:
`{{PUBLIC_LEGAL_BASE_URL}}`, предположительно `https://prostopdl.ru/legal`.
Каждый current URL должен иметь отдельный неизменяемый versioned URL и архив.

Все четыре current и versioned HTTPS URL обязаны открываться без Telegram,
session или иной авторизации и без редиректа в `AuthGate`. Ссылки на них должны
быть доступны из обоих checkbox в onboarding и из authenticated settings после
входа. Это проверяется отдельным publication smoke; сейчас публичных legal routes
нет.

## Контракт двух checkbox

1. Обязательный: `Принимаю Условия использования и Правила отмены, с Политикой конфиденциальности ознакомлен.`
2. Добровольный: `Даю отдельное согласие на обработку персональных данных для необязательных функций профиля.`

Отдельный обязательный checkbox «мне исполнилось 18 лет» не добавляется.
Условия использования содержат действующую owner-модель использования Сервиса
несовершеннолетними с согласием законного представителя, но ни возраст, ни такое
согласие не объявляются технически проверенными.

Первое действие должно связать аккаунт с точными версиями `terms`, `privacy` и
`cancellation`. Отказ от второго checkbox не блокирует базовый аккаунт, приватное
бронирование или договорно необходимые функции. При выборе второго действия
требуется самостоятельный evidence key `personal_data_processing`; без него
отключаются только перечисленные в Согласии необязательные функции. Текущий D5.1
backend знает только первые три ключа; его `2026-08-01` является test-only policy
и не является версией этих текстов. До отдельного code/schema approval второй
checkbox нельзя сохранять под видом `privacy` или делать обязательным этапом
текущего onboarding.

## Re-consent contract

| Событие | Требуемое действие | История |
|---|---|---|
| Существенная новая версия `terms` | новое явное принятие `terms` до будущих заказов | старые evidence неизменяемы |
| Существенная новая версия `cancellation` | новое явное принятие для будущих заказов; старый заказ хранит свой snapshot | старые evidence неизменяемы |
| Информационное изменение `privacy` без новой consent-based операции | уведомление и доступ к новой версии | ознакомление и архив сохраняются |
| Новая цель/категория/получатель на основании согласия | новая версия `personal_data_processing` и новое добровольное согласие | отзыв/исторические evidence сохраняются |

Completed D5.1 onboarding не переоткрывается и не изменяется. Для уже
завершившего onboarding аккаунта нужен отдельный append-only re-consent lifecycle
до того, как UI или документы будут обещать работающий повторный запрос.

## Подтверждённые решения владельца

- Бренд и рабочее наименование приложения: «Просто Падел».
- Услуги на старте: корт, приватное бронирование, открытые матчи, турниры и тренировки.
- ООО самостоятельно оказывает услуги своего Клуба; сторонние клубы на старте отсутствуют.
- Использование приложения бесплатно; оплачиваются услуги Клуба и мероприятия.
- Работающий `info@prostopdl.ru` используется только для privacy requests и отзыва согласия; support email отсутствует и не обещается.
- Официальный телефон поддержки и официальные социальные сети будут добавлены позднее и пока остаются pending.
- Эквайринг планируется через Сбербанк; точное юридическое лицо и продукт определяются договором.
- В Клубе имеется физическая ККТ АТОЛ 55Ф; online-ККТ и ОФД пока не определены.
- Бронирования интегрированы с YCLIENTS; точная договорная роль и payment field map не подтверждены.
- Гарантированный полный возврат: не позднее чем за 24 полных часа для бронирования/матча/тренировки и за 48 полных часов для турнира.
- После этих сроков применим только индивидуальный расчёт документально подтверждённых расходов конкретного заказа.
- Рекламные рассылки, рекламная аналитика и точная геолокация не входят в MVP.
- Целевой hosting/database контур — Selectel; новые Supabase-контракты запрещены.

Действующая owner-модель: несовершеннолетние могут регистрироваться и использовать
социальные функции с согласия законного представителя; заказ и оплата платных
услуг выполняются совершеннолетним пользователем либо с таким согласием.
Несовершеннолетний может быть Участником матча, тренировки или заказа. Возраст и
согласие представителя не проверяются и не получают статус verified; новые
DOB/document/parental-verification fields запрещены до отдельного решения.

Decision history: прежняя модель «самостоятельный аккаунт и Заказчик только 18+»
имеет статус `superseded_by_owner_2026_08_23` и не является действующей.

Владелец также утвердил целевую видимость отображаемого имени, выбранной
фотографии, уровня/рейтинга и публичной истории матчей всем зарегистрированным
пользователям. Телефон, email, приватные бронирования, платежи и служебные IDs
закрыты. Это product decision, но не готовое правовое основание: broad
authenticated visibility остаётся `publication_blocked` до legal review,
точного field contract, settings и consent evidence.

Retention/deletion policy candidate утверждён владельцем: 3 года неактивности +
уведомление и 30 дней; live PII до 30 дней после deletion request; чаты 1 год,
reported/disputed content 3 года; bookings 3 года; consent evidence 3 года;
обычные logs 1 год, sensitive audit 3 года; requests 3 года; backups максимум
30 дней; payment/fiscal baseline не менее 5 лет после отчётного года. Это не
универсальные законные сроки: category-by-category mapping и statutory minima
остаются на final legal review.

## Решения владельца до candidate v0.3

1. Утвердить точные сведения нового ООО из ЕГРЮЛ, банковские реквизиты и полный адрес Клуба.
2. После заключения договоров указать юридическое лицо и продукт Сбербанка, online-ККТ, ОФД и фактический чековый процесс.
3. Подтвердить юридическое лицо/роль YCLIENTS и точный набор передаваемых данных, включая сведения об оплате.
4. Утвердить официальный телефон, социальные сети и иной работающий support channel; support email сейчас отсутствует.
5. Провести legal review модели несовершеннолетних и evidence согласия представителя без добавления age-verification fields по умолчанию.
6. Провести legal review broad authenticated visibility, retention/deletion categories, statutory minima, anonymization и processor/backup propagation; затем отдельные code/schema/UI gates.
7. Утвердить методику фактических расходов, срок инициирования возврата, effective dates, versions, public URLs и recipient-by-recipient cross-border/Roskomnadzor facts.

Фактический `/players/search` уже доступен всем authenticated пользователям, но
его current fields не совпадают с утверждённым display-name/history contract.
До отдельного legal/code/UI gate нельзя считать текущий privacy acceptance
разрешением широкой видимости или обещать granular control. Подробная публичная
история матчей в текущем search endpoint отсутствует.

## Машинно-находимые плейсхолдеры

Все неизвестные значения записываются двойными фигурными скобками вокруг имени
в формате `UPPER_SNAKE_CASE`. Перед
публикацией поиск `rg -n '\{\{[A-Z0-9_]+\}\}' docs/legal` обязан вернуть пустой
результат. Основные группы:

- company: `{{LEGAL_ENTITY_FULL_NAME}}`, `{{INN}}`, `{{OGRN}}`, адреса и банковские реквизиты;
- document metadata: `{{*_VERSION}}`, `{{*_EFFECTIVE_DATE}}`, `{{PUBLIC_LEGAL_BASE_URL}}`;
- providers: `{{SELECTEL_LEGAL_ENTITY}}`, `{{YCLIENTS_*}}`, `{{SBER_*}}`, `{{ONLINE_KKT_MODEL}}`, `{{OFD_LEGAL_NAME}}`;
- remaining category/runtime retention facts: `{{*_RETENTION_PERIOD}}`,
  `{{SELECTEL_BACKUP_CYCLE_FACTS}}`, `{{SECURITY_MEASURES_FACT_MAP}}`; утверждённые
  owner-policy сроки перечислены выше и не заменяют проверку фактической реализации;
- cross-border: recipient-by-recipient legal entity, country, direction, data, purpose and Roskomnadzor notice status;
- contacts: `{{SUPPORT_PHONE_PENDING}}`, `{{OFFICIAL_SOCIAL_URLS_PENDING}}`, `{{SUPPORT_CHANNELS_AND_HOURS}}`, `{{POSTAL_ADDRESS}}`.

## Официальные первичные источники

- [Федеральный закон № 152-ФЗ «О персональных данных»](https://government.ru/docs/all/98196/)
- [Федеральный закон № 156-ФЗ: отдельное оформление согласия](https://government.ru/docs/all/159592/)
- [Закон РФ «О защите прав потребителей»](https://zpp.rospotrebnadzor.ru/npa/federal/192115)
- [Роспотребнадзор: отказ от услуги и фактически понесённые расходы](https://76.rospotrebnadzor.ru/directions_of_activi/protect/6314/)
- [Telegram Bot Platform Developer Terms](https://telegram.org/tos/bot-developers)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)

Конкурентные документы не являются источниками права и не использовались для
заимствования формулировок.

## Mobile publication readiness

Статус iOS/Android: `not_ready`. До подачи в магазины необходимо отдельно
проверить: активный публичный non-PDF и non-geofenced Privacy URL; совпадение
App Privacy/Data Safety с кодом и всеми SDK/получателями; точные retention и
deletion disclosures; account-deletion contract; подтверждённые договорные меры
защиты у получателей; доступ к документам внутри приложения. Этот checklist не
означает готовность текущего web/TMA проекта к публикации в магазинах.

## Вне текущего slice

Notification settings, account deletion/session revoke, UGC report/block/filter,
moderation queue, D5.4 Admin Backoffice, payment/provider implementation,
schema/migrations, публикация, DNS/TLS, Selectel rollout и production остаются
отдельными этапами.
