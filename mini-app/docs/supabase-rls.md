# Supabase RLS: join open matches

В правильном Supabase-проекте поле `participants` в таблице `public.matches` имеет тип `text[]`.

Policy `players_can_join_open_public_matches` нужна, чтобы authenticated игрок мог присоединиться к открытому публичному матчу.
Join разрешен для статусов `open`, `upcoming`, `searching`.

Без этой policy `PATCH /rest/v1/matches` может возвращать `204`, но реально обновлять `0` строк: Supabase RLS отфильтровывает update второго пользователя без явной ошибки.

```sql
create policy "players_can_join_open_public_matches"
on public.matches
for update
to authenticated
using (
  type = 'match'
  and coalesce("isPrivate", false) = false
  and status in ('open', 'upcoming', 'searching')
)
with check (
  type = 'match'
  and coalesce("isPrivate", false) = false
  and status in ('open', 'upcoming', 'searching')
  and auth.uid()::text = any(participants)
);
```
