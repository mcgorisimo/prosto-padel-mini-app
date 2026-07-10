# TASK.md

## Текущая задача
Починить реальный баг отправки сообщения в чате на Supabase.

## Контекст
Интеграционный QA показал:
POST /rest/v1/messages — Load request cancelled.

Вероятная причина:
MatchChat не ждёт завершения onSendMessage.

## Нужно сделать
1. В MatchChat.jsx сделать handleSend async.
2. Добавить sending state.
3. Не отправлять повторно, если sending=true.
4. await onSendMessage(messageText).
5. Очищать input только после успешной отправки.
6. Если ошибка — оставить текст в input.
7. На время sending отключить кнопку.
8. В App.handleSendMessage проверить, что ошибка Supabase пробрасывается наверх.
9. Не менять join, бронь, payment, Supabase-схему.

## Проверка
Запустить:
npm.cmd run test:e2e
npm.cmd run build

Потом коротко проверить реальный сценарий E:
открыть матч → чат → отправить сообщение → reload → сообщение осталось.
