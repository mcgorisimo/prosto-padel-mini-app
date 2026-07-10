# Dynamo Padel Bot

Цифровой консьерж для клуба «Динамо Падел» на базе Telegram.

## Развертывание на Railway

1.  Сделайте форк этого репозитория.
2.  Создайте новый проект на Railway и подключите его к вашему форку.
3.  Добавьте следующие переменные окружения во вкладке `Variables` в настройках проекта Railway:

    ```
    # Claude AI
    ANTHROPIC_API_KEY=...
    CLAUDE_MODEL=claude-3-sonnet-20240229

    # Telegram
    TELEGRAM_BOT_TOKEN=...
    TELEGRAM_ADMIN_CHAT_ID=...

    # YClients
    YCLIENTS_API_TOKEN=...
    YCLIENTS_PARTNER_TOKEN=...
    YCLIENTS_COMPANY_ID=...

    # Deployment
    # Railway предоставит публичный URL. Скопируйте его сюда.
    # Пример: https://my-bot-production.up.railway.app
    WEBHOOK_URL=...

    # Node environment
    NODE_ENV=production
    ```
4.  Railway автоматически обнаружит `Procfile` и запустит приложение. Переменная `PORT` также устанавливается платформой автоматически.
5.  После первого успешного деплоя приложение само зарегистрирует webhook в Telegram. Вы можете проверить статус в логах.