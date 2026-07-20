# Prosto Padel Backend

```powershell
cd C:\Projects\prosto-padel-mini-app\backend
```

## Установка

```powershell
npm.cmd ci
```

## Локальный запуск

```powershell
npm.cmd run start:dev
```

## Проверка

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
```

## PostgreSQL

PostgreSQL-каркас присутствует, но по умолчанию отключён через
`DATABASE_ENABLED=false`. Обычный локальный запуск и health-check не требуют
базы данных. `DATABASE_URL` потребуется только на отдельном будущем этапе.
Сейчас запрещено указывать рабочую базу и запускать SQL.

## Модули и CRM

Backend разделён на независимые NestJS-модули. CRM подключается через интерфейс
`CrmAdapter`; текущий provider — `disabled`. YCLIENTS присутствует только как
неактивная заготовка без запросов и бронирований. Значение
`CRM_PROVIDER=yclients` намеренно запрещено.
