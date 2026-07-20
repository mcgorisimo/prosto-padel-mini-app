-- 008_match_invitations_stage1_POSTCHECK.sql
-- Catalog verification plus rollback-only behavioral checks.
-- All test rows and simulated JWT claims are removed by the final ROLLBACK.

begin;

set local statement_timeout = '90s';

create temporary table invitation_008_behavior (
  test_executed boolean not null default false,
  private_invitation_created boolean not null default false,
  private_safe_summary_ok boolean not null default false,
  pending_did_not_join boolean not null default false,
  duplicate_player_blocked boolean not null default false,
  duplicate_slot_blocked boolean not null default false,
  wrong_user_accept_blocked boolean not null default false,
  wrong_user_decline_blocked boolean not null default false,
  wrong_user_cancel_blocked boolean not null default false,
  accepted_atomically boolean not null default false,
  declined_released boolean not null default false,
  cancelled_released boolean not null default false,
  full_match_blocked boolean not null default false,
  join_preserved_reservation boolean not null default false,
  existing_data_unchanged boolean not null default false,
  note text
) on commit drop;

insert into invitation_008_behavior default values;

create temporary table invitation_008_original_matches on commit drop as
select m.id, pg_catalog.md5(to_jsonb(m)::text) as fingerprint
from public.matches m;

create temporary table invitation_008_original_invitations on commit drop as
select i.id, pg_catalog.md5(to_jsonb(i)::text) as fingerprint
from public.match_invitations i;

do $$
declare
  v_owner_id uuid;
  v_invited_id uuid;
  v_other_id uuid;
  v_private_match_id uuid := pg_catalog.gen_random_uuid();
  v_public_match_id uuid := pg_catalog.gen_random_uuid();
  v_invitation public.match_invitations;
  v_second_invitation public.match_invitations;
  v_joined public.matches;
  v_message text;
  v_private_court text := 'inv008-private-' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8);
  v_public_court text := 'inv008-public-' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8);
begin
  select p.id into v_owner_id
  from public.profiles p
  order by p.created_at, p.id
  limit 1;

  select p.id into v_invited_id
  from public.profiles p
  where p.id is distinct from v_owner_id
  order by p.created_at, p.id
  limit 1;

  select p.id into v_other_id
  from public.profiles p
  where p.id is distinct from v_owner_id
    and p.id is distinct from v_invited_id
  order by p.created_at, p.id
  limit 1;

  if v_owner_id is null or v_invited_id is null or v_other_id is null then
    update invitation_008_behavior
    set note = 'Behavioral checks skipped: at least three existing profiles are required. No profile or user row was created.';
    return;
  end if;

  insert into public.matches (
    id,
    owner_id,
    date,
    "dateISO",
    time,
    duration,
    "courtId",
    "courtName",
    "courtType",
    type,
    scenario,
    status,
    "isPrivate",
    "ratingMin",
    "ratingMax",
    "pricePerPerson",
    "filledSlots",
    participants
  ) values (
    v_private_match_id,
    v_owner_id,
    '1 января',
    date '2099-01-01',
    '10:00',
    1.5,
    v_private_court,
    'Invitation postcheck private court',
    'panoramic',
    'private',
    'private',
    'upcoming',
    true,
    0,
    6,
    1500,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_owner_id::text,
        'firstName', 'Postcheck owner',
        'isOrganizer', true,
        'slotIndex', 0
      )
    ),
    array[v_owner_id::text]
  );

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner_id::text, 'role', 'authenticated')::text,
    true
  );

  update invitation_008_behavior set test_executed = true;

  begin
    v_invitation := public.create_match_invitation(v_private_match_id, v_invited_id, 1::smallint);
    update invitation_008_behavior
    set private_invitation_created = v_invitation.status = 'pending'
      and v_invitation.slot_index = 1;
  exception
    when others then
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Private invitation creation failed: ' || sqlstate || ' ' || sqlerrm);
  end;

  if (select private_invitation_created from invitation_008_behavior) then
    update invitation_008_behavior
    set pending_did_not_join = exists (
      select 1
      from public.matches m
      where m.id = v_private_match_id
        and m.participants = array[v_owner_id::text]
        and pg_catalog.jsonb_array_length(m."filledSlots") = 1
        and not (v_invited_id::text = any(m.participants))
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(m."filledSlots") slots(slot_value)
          where slots.slot_value->>'id' = v_invited_id::text
        )
    );

    begin
      perform public.create_match_invitation(v_private_match_id, v_invited_id, 2::smallint);
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Duplicate pending invitation unexpectedly succeeded.');
    exception
      when others then
        get stacked diagnostics v_message = message_text;
        update invitation_008_behavior
        set duplicate_player_blocked = v_message = 'INVITATION_ALREADY_PENDING',
            note = case
              when v_message = 'INVITATION_ALREADY_PENDING' then note
              else concat_ws(' | ', note, 'Unexpected duplicate-player error: ' || sqlstate || ' ' || v_message)
            end;
    end;

    begin
      perform public.create_match_invitation(v_private_match_id, v_other_id, 1::smallint);
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Duplicate slot reservation unexpectedly succeeded.');
    exception
      when others then
        get stacked diagnostics v_message = message_text;
        update invitation_008_behavior
        set duplicate_slot_blocked = v_message = 'INVITATION_SLOT_RESERVED',
            note = case
              when v_message = 'INVITATION_SLOT_RESERVED' then note
              else concat_ws(' | ', note, 'Unexpected duplicate-slot error: ' || sqlstate || ' ' || v_message)
            end;
    end;

    begin
      perform public.accept_match_invitation(v_invitation.id);
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Organizer unexpectedly accepted another user invitation.');
    exception
      when others then
        get stacked diagnostics v_message = message_text;
        update invitation_008_behavior
        set wrong_user_accept_blocked = v_message = 'INVITATION_RESPONSE_FORBIDDEN',
            note = case
              when v_message = 'INVITATION_RESPONSE_FORBIDDEN' then note
              else concat_ws(' | ', note, 'Unexpected wrong-user accept error: ' || sqlstate || ' ' || v_message)
            end;
    end;
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_invited_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_invited_id::text, 'role', 'authenticated')::text,
    true
  );

  update invitation_008_behavior
  set private_safe_summary_ok = exists (
    select 1
    from public.get_incoming_match_invitations() incoming
    where incoming.invitation_id = v_invitation.id
      and incoming.match_id = v_private_match_id
      and incoming.organizer_id = v_owner_id
      and incoming.date_iso = date '2099-01-01'
      and incoming.start_time = '10:00'
      and incoming.court_id = v_private_court
      and incoming.match_type = 'private'
      and incoming.is_private
      and incoming.rating_min = 0
      and incoming.rating_max = 6
      and incoming.price_per_person = 1500
  );

  if (select private_invitation_created from invitation_008_behavior) then
    begin
      perform public.accept_match_invitation(v_invitation.id);
      update invitation_008_behavior
      set accepted_atomically = exists (
        select 1
        from public.match_invitations i
        join public.matches m on m.id = i.match_id
        where i.id = v_invitation.id
          and i.status = 'accepted'
          and i.responded_at is not null
          and m.status = 'upcoming'
          and v_invited_id::text = any(m.participants)
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements(m."filledSlots") slots(slot_value)
            where slots.slot_value->>'id' = v_invited_id::text
              and slots.slot_value->>'slotIndex' = '1'
          )
      );
    exception
      when others then
        update invitation_008_behavior
        set note = concat_ws(' | ', note, 'Invitation acceptance failed: ' || sqlstate || ' ' || sqlerrm);
    end;
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner_id::text, 'role', 'authenticated')::text,
    true
  );

  begin
    v_second_invitation := public.create_match_invitation(v_private_match_id, v_other_id, 2::smallint);

    begin
      perform public.decline_match_invitation(v_second_invitation.id);
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Organizer unexpectedly declined another user invitation.');
    exception
      when others then
        get stacked diagnostics v_message = message_text;
        update invitation_008_behavior
        set wrong_user_decline_blocked = v_message = 'INVITATION_RESPONSE_FORBIDDEN',
            note = case
              when v_message = 'INVITATION_RESPONSE_FORBIDDEN' then note
              else concat_ws(' | ', note, 'Unexpected wrong-user decline error: ' || sqlstate || ' ' || v_message)
            end;
    end;

    perform pg_catalog.set_config('request.jwt.claim.sub', v_other_id::text, true);
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object('sub', v_other_id::text, 'role', 'authenticated')::text,
      true
    );
    perform public.decline_match_invitation(v_second_invitation.id);

    update invitation_008_behavior
    set declined_released = exists (
      select 1
      from public.match_invitations i
      join public.matches m on m.id = i.match_id
      where i.id = v_second_invitation.id
        and i.status = 'declined'
        and i.responded_at is not null
        and not (v_other_id::text = any(m.participants))
        and not exists (
          select 1
          from public.match_invitations pending
          where pending.match_id = v_private_match_id
            and pending.slot_index = 2
            and pending.status = 'pending'
        )
    );
  exception
    when others then
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Decline flow failed: ' || sqlstate || ' ' || sqlerrm);
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner_id::text, 'role', 'authenticated')::text,
    true
  );

  begin
    v_second_invitation := public.create_match_invitation(v_private_match_id, v_other_id, 2::smallint);

    perform pg_catalog.set_config('request.jwt.claim.sub', v_other_id::text, true);
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object('sub', v_other_id::text, 'role', 'authenticated')::text,
      true
    );

    begin
      perform public.cancel_match_invitation(v_second_invitation.id);
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Invited user unexpectedly cancelled the organizer invitation.');
    exception
      when others then
        get stacked diagnostics v_message = message_text;
        update invitation_008_behavior
        set wrong_user_cancel_blocked = v_message = 'INVITATION_CANCEL_FORBIDDEN',
            note = case
              when v_message = 'INVITATION_CANCEL_FORBIDDEN' then note
              else concat_ws(' | ', note, 'Unexpected wrong-user cancel error: ' || sqlstate || ' ' || v_message)
            end;
    end;

    perform pg_catalog.set_config('request.jwt.claim.sub', v_owner_id::text, true);
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object('sub', v_owner_id::text, 'role', 'authenticated')::text,
      true
    );
    perform public.cancel_match_invitation(v_second_invitation.id);

    update invitation_008_behavior
    set cancelled_released = exists (
      select 1
      from public.match_invitations i
      where i.id = v_second_invitation.id
        and i.status = 'cancelled'
        and i.responded_at is not null
        and not exists (
          select 1
          from public.match_invitations pending
          where pending.match_id = v_private_match_id
            and pending.slot_index = 2
            and pending.status = 'pending'
        )
    );
  exception
    when others then
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Cancel flow failed: ' || sqlstate || ' ' || sqlerrm);
  end;

  update public.matches
  set
    "filledSlots" = pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id', v_owner_id::text, 'isOrganizer', true, 'slotIndex', 0),
      pg_catalog.jsonb_build_object('id', v_invited_id::text, 'isOrganizer', false, 'slotIndex', 1),
      pg_catalog.jsonb_build_object('id', 'postcheck-dummy-2', 'isOrganizer', false, 'slotIndex', 2),
      pg_catalog.jsonb_build_object('id', 'postcheck-dummy-3', 'isOrganizer', false, 'slotIndex', 3)
    ),
    participants = array[v_owner_id::text, v_invited_id::text, 'postcheck-dummy-2', 'postcheck-dummy-3']
  where id = v_private_match_id;

  begin
    perform public.create_match_invitation(v_private_match_id, v_other_id, 2::smallint);
    update invitation_008_behavior
    set note = concat_ws(' | ', note, 'Invitation into a full match unexpectedly succeeded.');
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      update invitation_008_behavior
      set full_match_blocked = v_message = 'INVITATION_MATCH_FULL',
          note = case
            when v_message = 'INVITATION_MATCH_FULL' then note
            else concat_ws(' | ', note, 'Unexpected full-match error: ' || sqlstate || ' ' || v_message)
          end;
  end;

  insert into public.matches (
    id,
    owner_id,
    date,
    "dateISO",
    time,
    duration,
    "courtId",
    "courtName",
    "courtType",
    type,
    scenario,
    status,
    "isPrivate",
    "ratingMin",
    "ratingMax",
    "pricePerPerson",
    "filledSlots",
    participants
  ) values (
    v_public_match_id,
    v_owner_id,
    '2 января',
    date '2099-01-02',
    '12:00',
    1.5,
    v_public_court,
    'Invitation postcheck public court',
    'panoramic',
    'match',
    'social',
    'open',
    false,
    0,
    6,
    1500,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_owner_id::text,
        'firstName', 'Postcheck owner',
        'isOrganizer', true,
        'slotIndex', 0
      )
    ),
    array[v_owner_id::text]
  );

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner_id::text, 'role', 'authenticated')::text,
    true
  );
  v_invitation := public.create_match_invitation(v_public_match_id, v_invited_id, 1::smallint);

  perform pg_catalog.set_config('request.jwt.claim.sub', v_other_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_other_id::text, 'role', 'authenticated')::text,
    true
  );

  begin
    v_joined := public.join_match(v_public_match_id);
    update invitation_008_behavior
    set join_preserved_reservation = v_other_id::text = any(v_joined.participants)
      and not (v_invited_id::text = any(v_joined.participants))
      and exists (
        select 1
        from public.match_invitations i
        where i.id = v_invitation.id
          and i.status = 'pending'
          and i.slot_index = 1
      )
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_joined."filledSlots") slots(slot_value)
        where slots.slot_value->>'id' = v_other_id::text
          and slots.slot_value->>'slotIndex' = '2'
      );
  exception
    when others then
      update invitation_008_behavior
      set note = concat_ws(' | ', note, 'Reservation-aware join_match failed: ' || sqlstate || ' ' || sqlerrm);
  end;

  update invitation_008_behavior
  set existing_data_unchanged =
    not exists (
      select 1
      from invitation_008_original_matches original
      left join public.matches current_match on current_match.id = original.id
      where current_match.id is null
        or pg_catalog.md5(to_jsonb(current_match)::text) <> original.fingerprint
    )
    and not exists (
      select 1
      from invitation_008_original_invitations original
      left join public.match_invitations current_invitation on current_invitation.id = original.id
      where current_invitation.id is null
        or pg_catalog.md5(to_jsonb(current_invitation)::text) <> original.fingerprint
    );
end;
$$;

with invitation_table as (
  select
    c.oid,
    c.relrowsecurity as rls_enabled,
    pg_catalog.obj_description(c.oid, 'pg_class') as description,
    c.relowner,
    c.relacl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'match_invitations'
    and c.relkind = 'r'
),
table_columns as (
  select
    a.attname as column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
    a.attnotnull as not_null
  from pg_catalog.pg_attribute a
  where a.attrelid = pg_catalog.to_regclass('public.match_invitations')
    and a.attnum > 0
    and not a.attisdropped
),
table_constraints as (
  select
    c.conname as constraint_name,
    c.contype,
    pg_catalog.pg_get_constraintdef(c.oid, true) as definition
  from pg_catalog.pg_constraint c
  where c.conrelid = pg_catalog.to_regclass('public.match_invitations')
),
table_indexes as (
  select
    c.relname as index_name,
    i.indisunique,
    pg_catalog.pg_get_indexdef(i.indexrelid) as definition,
    pg_catalog.pg_get_expr(i.indpred, i.indrelid) as predicate
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  where i.indrelid = pg_catalog.to_regclass('public.match_invitations')
),
table_policies as (
  select
    pol.polname,
    pol.polcmd,
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_expression
  from pg_catalog.pg_policy pol
  where pol.polrelid = pg_catalog.to_regclass('public.match_invitations')
),
table_acl as (
  select
    a.grantee,
    r.rolname,
    a.privilege_type
  from invitation_table t
  cross join lateral pg_catalog.aclexplode(
    coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
function_catalog as (
  select
    p.oid,
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prorettype as result_type_oid,
    p.proretset,
    p.prosecdef,
    p.proconfig,
    p.proowner,
    p.proacl,
    pg_catalog.obj_description(p.oid, 'pg_proc') as description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g') as normalized_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'create_match_invitation',
      'get_incoming_match_invitations',
      'accept_match_invitation',
      'decline_match_invitation',
      'cancel_match_invitation',
      'join_match'
    )
),
function_acl as (
  select
    f.oid,
    bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
    bool_or(r.rolname = 'anon' and a.privilege_type = 'EXECUTE') as anon_execute,
    bool_or(r.rolname = 'authenticated' and a.privilege_type = 'EXECUTE') as authenticated_execute
  from function_catalog f
  cross join lateral pg_catalog.aclexplode(
    coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  group by f.oid
),
checks as (
  select
    exists (select 1 from invitation_table) as table_exists,
    exists (
      select 1 from invitation_table
      where rls_enabled
        and description like 'migration=008_match_invitations_stage1;%'
    ) as table_rls_and_marker_ok,
    (select count(*) from table_columns) = 8
      and exists (select 1 from table_columns where column_name = 'id' and data_type = 'uuid' and not_null)
      and exists (select 1 from table_columns where column_name = 'match_id' and data_type = 'uuid' and not_null)
      and exists (select 1 from table_columns where column_name = 'invited_by' and data_type = 'uuid' and not_null)
      and exists (select 1 from table_columns where column_name = 'invited_user_id' and data_type = 'uuid' and not_null)
      and exists (select 1 from table_columns where column_name = 'slot_index' and data_type = 'smallint' and not_null)
      and exists (select 1 from table_columns where column_name = 'status' and data_type = 'text' and not_null)
      and exists (select 1 from table_columns where column_name = 'created_at' and data_type = 'timestamp with time zone' and not_null)
      and exists (select 1 from table_columns where column_name = 'responded_at' and data_type = 'timestamp with time zone')
      as table_shape_ok,
    exists (select 1 from table_constraints where constraint_name = 'match_invitations_match_fkey' and contype = 'f')
      and exists (select 1 from table_constraints where constraint_name = 'match_invitations_invited_by_fkey' and contype = 'f')
      and exists (select 1 from table_constraints where constraint_name = 'match_invitations_invited_user_fkey' and contype = 'f')
      and exists (select 1 from table_constraints where constraint_name = 'match_invitations_status_check' and contype = 'c')
      and exists (select 1 from table_constraints where constraint_name = 'match_invitations_slot_index_check' and contype = 'c')
      and exists (select 1 from table_constraints where constraint_name = 'match_invitations_response_time_check' and contype = 'c')
      as constraints_ok,
    exists (
      select 1 from table_indexes
      where index_name = 'match_invitations_one_pending_player'
        and indisunique
        and lower(coalesce(predicate, '')) like '%status = ''pending''%'
    )
      and exists (
        select 1 from table_indexes
        where index_name = 'match_invitations_one_pending_slot'
          and indisunique
          and lower(coalesce(predicate, '')) like '%status = ''pending''%'
      ) as reservation_indexes_ok,
    exists (select 1 from table_policies where polname = 'match_invitations_select_related' and polcmd = 'r')
      and not exists (
        select 1 from table_acl
        where (grantee = 0 or rolname = 'anon')
          and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      )
      and exists (
        select 1 from table_acl
        where rolname = 'authenticated' and privilege_type = 'SELECT'
      )
      and not exists (
        select 1 from table_acl
        where rolname = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      ) as rls_and_table_grants_ok,
    exists (
      select 1 from function_catalog f join function_acl a using (oid)
      where f.proname = 'create_match_invitation'
        and f.identity_arguments = 'p_match_id uuid, p_invited_user_id uuid, p_slot_index smallint'
        and f.result_type in ('match_invitations', 'public.match_invitations')
        and f.prosecdef
        and coalesce(f.proconfig @> array['search_path=pg_catalog, public, pg_temp'], false)
        and not a.public_execute and not a.anon_execute and a.authenticated_execute
        and f.normalized_definition like '%for update%'
        and f.normalized_definition like '%invitation_already_pending%'
        and f.normalized_definition like '%invitation_slot_reserved%'
    ) as create_rpc_ok,
    exists (
      select 1 from function_catalog f join function_acl a using (oid)
      where f.proname = 'get_incoming_match_invitations'
        and f.identity_arguments = ''
        and f.prosecdef
        and not a.public_execute and not a.anon_execute and a.authenticated_execute
        and f.normalized_definition like '%i.invited_user_id = v_user_id%'
        and f.normalized_definition not like '%email%'
        and f.normalized_definition not like '%phone%'
    ) as incoming_rpc_safe_ok,
    exists (
      select 1 from function_catalog f join function_acl a using (oid)
      where f.proname = 'accept_match_invitation'
        and f.identity_arguments = 'p_invitation_id uuid'
        and f.result_type in ('matches', 'public.matches')
        and f.prosecdef
        and not a.public_execute and not a.anon_execute and a.authenticated_execute
        and f.normalized_definition like '%for update%'
        and f.normalized_definition like '%invited_user_id <> v_user_id%'
        and f.normalized_definition like '%update public.matches%'
        and f.normalized_definition like '%status = ''accepted''%'
    ) as accept_rpc_ok,
    exists (
      select 1 from function_catalog f join function_acl a using (oid)
      where f.proname = 'decline_match_invitation'
        and f.identity_arguments = 'p_invitation_id uuid'
        and f.result_type in ('match_invitations', 'public.match_invitations')
        and f.prosecdef
        and not a.public_execute and not a.anon_execute and a.authenticated_execute
        and f.normalized_definition like '%for update%'
        and f.normalized_definition like '%invited_user_id <> v_user_id%'
        and f.normalized_definition like '%status = ''declined''%'
    )
      and exists (
        select 1 from function_catalog f join function_acl a using (oid)
        where f.proname = 'cancel_match_invitation'
          and f.identity_arguments = 'p_invitation_id uuid'
          and f.result_type in ('match_invitations', 'public.match_invitations')
          and f.prosecdef
          and not a.public_execute and not a.anon_execute and a.authenticated_execute
          and f.normalized_definition like '%for update%'
          and f.normalized_definition like '%v_match.owner_id <> v_user_id and not v_is_admin%'
          and f.normalized_definition like '%status = ''cancelled''%'
      ) as decline_cancel_rpcs_ok,
    exists (
      select 1 from function_catalog f join function_acl a using (oid)
      where f.proname = 'join_match'
        and f.identity_arguments = 'p_match_id uuid'
        and f.result_type in ('matches', 'public.matches')
        and f.prosecdef
        and not a.public_execute and not a.anon_execute and a.authenticated_execute
        and f.normalized_definition like '%for update%'
        and f.normalized_definition like '%public.match_invitations%'
        and f.normalized_definition like '%i.status = ''pending''%'
        and f.normalized_definition like '%return v_updated%'
        and f.description like 'migration=008_match_invitations_stage1;%rollback=restore_003;%'
    ) as join_match_compatibility_ok,
    not exists (
      select 1
      from function_catalog f
      where (f.proname = 'create_match_invitation' and f.identity_arguments <> 'p_match_id uuid, p_invited_user_id uuid, p_slot_index smallint')
         or (f.proname = 'get_incoming_match_invitations' and f.identity_arguments <> '')
         or (f.proname in ('accept_match_invitation', 'decline_match_invitation', 'cancel_match_invitation') and f.identity_arguments <> 'p_invitation_id uuid')
         or (f.proname = 'join_match' and f.identity_arguments <> 'p_match_id uuid')
    ) as no_extra_overloads,
    pg_catalog.has_table_privilege('authenticated', 'public.matches', 'UPDATE')
      as legacy_direct_update_still_available,
    coalesce((select test_executed from invitation_008_behavior), false) as behavioral_test_executed,
    coalesce((select private_invitation_created from invitation_008_behavior), false) as private_invitation_created,
    coalesce((select private_safe_summary_ok from invitation_008_behavior), false) as private_safe_summary_ok,
    coalesce((select pending_did_not_join from invitation_008_behavior), false) as pending_did_not_join,
    coalesce((select duplicate_player_blocked from invitation_008_behavior), false) as duplicate_player_blocked,
    coalesce((select duplicate_slot_blocked from invitation_008_behavior), false) as duplicate_slot_blocked,
    coalesce((select wrong_user_accept_blocked from invitation_008_behavior), false) as wrong_user_accept_blocked,
    coalesce((select wrong_user_decline_blocked from invitation_008_behavior), false) as wrong_user_decline_blocked,
    coalesce((select wrong_user_cancel_blocked from invitation_008_behavior), false) as wrong_user_cancel_blocked,
    coalesce((select accepted_atomically from invitation_008_behavior), false) as accepted_atomically,
    coalesce((select declined_released from invitation_008_behavior), false) as declined_released,
    coalesce((select cancelled_released from invitation_008_behavior), false) as cancelled_released,
    coalesce((select full_match_blocked from invitation_008_behavior), false) as full_match_blocked,
    coalesce((select join_preserved_reservation from invitation_008_behavior), false) as join_preserved_reservation,
    coalesce((select existing_data_unchanged from invitation_008_behavior), false) as existing_data_unchanged
)
select pg_catalog.jsonb_build_object(
  'postcheck', pg_catalog.jsonb_build_object(
    'table', coalesce((select pg_catalog.jsonb_agg(to_jsonb(invitation_table)) from invitation_table), '[]'::jsonb),
    'functions', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', proname,
            'identity_arguments', identity_arguments,
            'result_type', result_type,
            'security_definer', prosecdef,
            'fixed_search_path', proconfig,
            'description', description
          ) order by proname, identity_arguments
        )
        from function_catalog
      ),
      '[]'::jsonb
    ),
    'behavior', (select to_jsonb(invitation_008_behavior) from invitation_008_behavior),
    'checks', (select to_jsonb(checks) from checks),
    'postcheck_ok', (
      select table_exists
        and table_rls_and_marker_ok
        and table_shape_ok
        and constraints_ok
        and reservation_indexes_ok
        and rls_and_table_grants_ok
        and create_rpc_ok
        and incoming_rpc_safe_ok
        and accept_rpc_ok
        and decline_cancel_rpcs_ok
        and join_match_compatibility_ok
        and no_extra_overloads
        and legacy_direct_update_still_available
        and behavioral_test_executed
        and private_invitation_created
        and private_safe_summary_ok
        and pending_did_not_join
        and duplicate_player_blocked
        and duplicate_slot_blocked
        and wrong_user_accept_blocked
        and wrong_user_decline_blocked
        and wrong_user_cancel_blocked
        and accepted_atomically
        and declined_released
        and cancelled_released
        and full_match_blocked
        and join_preserved_reservation
        and existing_data_unchanged
      from checks
    )
  )
) as match_invitations_stage1_postcheck;

rollback;
