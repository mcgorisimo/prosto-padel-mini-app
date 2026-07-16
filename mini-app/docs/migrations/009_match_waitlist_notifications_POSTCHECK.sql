-- 009_match_waitlist_notifications_POSTCHECK.sql
-- Catalog and behavioral checks. All test writes are removed by final ROLLBACK.

begin;
set local statement_timeout='120s';

create temporary table waitlist_009_behavior(
  test_executed boolean not null default false,
  join_leave_position_ok boolean not null default false,
  duplicate_waiting_blocked boolean not null default false,
  free_slot_wait_blocked boolean not null default false,
  fifo_skip_and_leave_promotion_ok boolean not null default false,
  decline_promotion_ok boolean not null default false,
  cancel_promotion_ok boolean not null default false,
  invitation_notification_ok boolean not null default false,
  promotion_notification_ok boolean not null default false,
  unread_and_read_ok boolean not null default false,
  other_user_access_blocked boolean not null default false,
  existing_data_unchanged boolean not null default false,
  note text
) on commit drop;
insert into waitlist_009_behavior default values;

create temporary table waitlist_009_original_matches on commit drop as
select id,pg_catalog.md5(to_jsonb(m)::text) fingerprint from public.matches m;
create temporary table waitlist_009_original_invitations on commit drop as
select id,pg_catalog.md5(to_jsonb(i)::text) fingerprint from public.match_invitations i;
create temporary table waitlist_009_original_waitlist on commit drop as
select id,pg_catalog.md5(to_jsonb(w)::text) fingerprint from public.match_waitlist w;
create temporary table waitlist_009_original_notifications on commit drop as
select id,read_at,pg_catalog.md5(to_jsonb(n)::text) fingerprint from public.notifications n;

do $$
declare
  v_owner uuid; v_first uuid; v_second uuid; v_participant uuid;
  v_queue_match uuid:=pg_catalog.gen_random_uuid();
  v_leave_match uuid:=pg_catalog.gen_random_uuid();
  v_decline_match uuid:=pg_catalog.gen_random_uuid();
  v_cancel_match uuid:=pg_catalog.gen_random_uuid();
  v_private_match uuid:=pg_catalog.gen_random_uuid();
  v_entry public.match_waitlist; v_invitation public.match_invitations;
  v_notification uuid; v_message text; v_count_before integer; v_count_after integer;
begin
  select id into v_owner from public.profiles order by created_at,id limit 1;
  select id into v_first from public.profiles where id is distinct from v_owner order by created_at,id limit 1;
  select id into v_second from public.profiles where id is distinct from v_owner and id is distinct from v_first order by created_at,id limit 1;
  select id into v_participant from public.profiles where id is distinct from v_owner and id is distinct from v_first and id is distinct from v_second order by created_at,id limit 1;
  if v_participant is null then
    update waitlist_009_behavior set note='Behavioral checks skipped: four existing profiles are required; no profile/user was created.';
    return;
  end if;
  update waitlist_009_behavior set test_executed=true;

  -- Full public match for join/queue-order/duplicate/leave checks.
  insert into public.matches(id,owner_id,date,"dateISO",time,duration,"courtId","courtName","courtType",type,scenario,status,"isPrivate","ratingMin","ratingMax","pricePerPerson","filledSlots",participants)
  values(v_queue_match,v_owner,'10 января',date '2099-01-10','10:00',1.5,'wait009-q-'||v_queue_match::text,'Queue test','panoramic','match','social','upcoming',false,0,6,1000,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_owner::text,'isOrganizer',true,'slotIndex',0),
      pg_catalog.jsonb_build_object('id','q-dummy-1','isOrganizer',false,'slotIndex',1),
      pg_catalog.jsonb_build_object('id','q-dummy-2','isOrganizer',false,'slotIndex',2),
      pg_catalog.jsonb_build_object('id','q-dummy-3','isOrganizer',false,'slotIndex',3)),
    array[v_owner::text,'q-dummy-1','q-dummy-2','q-dummy-3']);

  perform pg_catalog.set_config('request.jwt.claim.sub',v_first::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_first::text,'role','authenticated')::text,true);
  v_entry:=public.join_match_waitlist(v_queue_match);
  update waitlist_009_behavior set join_leave_position_ok=
    exists(select 1 from public.get_my_match_waitlist_position(v_queue_match) q where q.queue_position=1 and q.status='waiting')
    and public.get_match_waitlist_count(v_queue_match)=1;
  -- now() is transaction-stable, so both RPC calls in this rollback-only test
  -- would otherwise receive the same joined_at and be ordered by random UUIDs.
  -- Give the first test row an unambiguous earlier timestamp; this write is
  -- test fixture setup and is removed by the final ROLLBACK.
  update public.match_waitlist
  set joined_at=pg_catalog.clock_timestamp()-interval '1 day'
  where id=v_entry.id;
  begin
    perform public.join_match_waitlist(v_queue_match);
  exception when others then
    get stacked diagnostics v_message=message_text;
    update waitlist_009_behavior set duplicate_waiting_blocked=(v_message='WAITLIST_ALREADY_WAITING');
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',v_second::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_second::text,'role','authenticated')::text,true);
  perform public.join_match_waitlist(v_queue_match);
  update waitlist_009_behavior set join_leave_position_ok=join_leave_position_ok
    and exists(select 1 from public.get_my_match_waitlist_position(v_queue_match) q where q.queue_position=2 and q.status='waiting')
    and public.get_match_waitlist_count(v_queue_match)=2;
  perform pg_catalog.set_config('request.jwt.claim.sub',v_first::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_first::text,'role','authenticated')::text,true);
  perform public.leave_match_waitlist(v_queue_match);
  update waitlist_009_behavior set join_leave_position_ok=join_leave_position_ok
    and public.get_match_waitlist_count(v_queue_match)=1
    and exists(select 1 from public.match_waitlist where match_id=v_queue_match and user_id=v_first and status='left')
    and not exists(select 1 from public.get_my_match_waitlist_position(v_queue_match));
  perform pg_catalog.set_config('request.jwt.claim.sub',v_second::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_second::text,'role','authenticated')::text,true);
  update waitlist_009_behavior set join_leave_position_ok=join_leave_position_ok
    and exists(select 1 from public.get_my_match_waitlist_position(v_queue_match) q where q.queue_position=1 and q.status='waiting');

  -- FIFO: first becomes ineligible through the still-supported legacy path;
  -- leave_match must skip it and promote the second waiting user.
  insert into public.matches(id,owner_id,date,"dateISO",time,duration,"courtId","courtName","courtType",type,scenario,status,"isPrivate","ratingMin","ratingMax","pricePerPerson","filledSlots",participants)
  values(v_leave_match,v_owner,'11 января',date '2099-01-11','10:00',1.5,'wait009-l-'||v_leave_match::text,'Leave promotion','panoramic','match','social','upcoming',false,0,6,1000,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_owner::text,'isOrganizer',true,'slotIndex',0),
      pg_catalog.jsonb_build_object('id',v_participant::text,'isOrganizer',false,'slotIndex',1),
      pg_catalog.jsonb_build_object('id','l-dummy-2','isOrganizer',false,'slotIndex',2),
      pg_catalog.jsonb_build_object('id','l-dummy-3','isOrganizer',false,'slotIndex',3)),
    array[v_owner::text,v_participant::text,'l-dummy-2','l-dummy-3']);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_first::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_first::text,'role','authenticated')::text,true);
  perform public.join_match_waitlist(v_leave_match);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_second::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_second::text,'role','authenticated')::text,true);
  perform public.join_match_waitlist(v_leave_match);
  update public.matches set
    "filledSlots"=pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_owner::text,'isOrganizer',true,'slotIndex',0),
      pg_catalog.jsonb_build_object('id',v_participant::text,'isOrganizer',false,'slotIndex',1),
      pg_catalog.jsonb_build_object('id',v_first::text,'isOrganizer',false,'slotIndex',2),
      pg_catalog.jsonb_build_object('id','l-dummy-3','isOrganizer',false,'slotIndex',3)),
    participants=array[v_owner::text,v_participant::text,v_first::text,'l-dummy-3']
  where id=v_leave_match;
  perform pg_catalog.set_config('request.jwt.claim.sub',v_participant::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_participant::text,'role','authenticated')::text,true);
  perform public.leave_match(v_leave_match);
  update waitlist_009_behavior set fifo_skip_and_leave_promotion_ok=
    exists(select 1 from public.match_waitlist where match_id=v_leave_match and user_id=v_first and status='skipped')
    and exists(select 1 from public.match_waitlist where match_id=v_leave_match and user_id=v_second and status='promoted')
    and exists(select 1 from public.matches where id=v_leave_match and v_second::text=any(participants))
    and not exists(select 1 from public.matches where id=v_leave_match and v_participant::text=any(participants));
  update waitlist_009_behavior set promotion_notification_ok=exists(
    select 1 from public.notifications n where n.recipient_id=v_second and n.type='waitlist_promoted'
      and n.match_id=v_leave_match and n.title='Вы попали в игру' and n.read_at is null);

  -- Invitation decline releases a reserved fourth slot and promotes FIFO.
  insert into public.matches(id,owner_id,date,"dateISO",time,duration,"courtId","courtName","courtType",type,scenario,status,"isPrivate","ratingMin","ratingMax","pricePerPerson","filledSlots",participants)
  values(v_decline_match,v_owner,'12 января',date '2099-01-12','10:00',1.5,'wait009-d-'||v_decline_match::text,'Decline promotion','panoramic','match','social','open',false,0,6,1000,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_owner::text,'isOrganizer',true,'slotIndex',0),
      pg_catalog.jsonb_build_object('id','d-dummy-1','isOrganizer',false,'slotIndex',1),
      pg_catalog.jsonb_build_object('id','d-dummy-2','isOrganizer',false,'slotIndex',2)),
    array[v_owner::text,'d-dummy-1','d-dummy-2']);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_first::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_first::text,'role','authenticated')::text,true);
  begin
    perform public.join_match_waitlist(v_decline_match);
  exception when others then
    get stacked diagnostics v_message=message_text;
    update waitlist_009_behavior set free_slot_wait_blocked=(v_message='WAITLIST_MATCH_HAS_FREE_SLOT');
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',v_owner::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_owner::text,'role','authenticated')::text,true);
  v_invitation:=public.create_match_invitation(v_decline_match,v_participant,3::smallint);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_first::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_first::text,'role','authenticated')::text,true);
  perform public.join_match_waitlist(v_decline_match);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_participant::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_participant::text,'role','authenticated')::text,true);
  perform public.decline_match_invitation(v_invitation.id);
  update waitlist_009_behavior set decline_promotion_ok=
    exists(select 1 from public.match_invitations where id=v_invitation.id and status='declined')
    and exists(select 1 from public.match_waitlist where match_id=v_decline_match and user_id=v_first and status='promoted')
    and exists(select 1 from public.matches where id=v_decline_match and v_first::text=any(participants));

  -- Organizer cancellation has the same release/promotion guarantee.
  insert into public.matches(id,owner_id,date,"dateISO",time,duration,"courtId","courtName","courtType",type,scenario,status,"isPrivate","ratingMin","ratingMax","pricePerPerson","filledSlots",participants)
  values(v_cancel_match,v_owner,'13 января',date '2099-01-13','10:00',1.5,'wait009-c-'||v_cancel_match::text,'Cancel promotion','panoramic','match','social','open',false,0,6,1000,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_owner::text,'isOrganizer',true,'slotIndex',0),
      pg_catalog.jsonb_build_object('id','c-dummy-1','isOrganizer',false,'slotIndex',1),
      pg_catalog.jsonb_build_object('id','c-dummy-2','isOrganizer',false,'slotIndex',2)),
    array[v_owner::text,'c-dummy-1','c-dummy-2']);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_owner::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_owner::text,'role','authenticated')::text,true);
  v_invitation:=public.create_match_invitation(v_cancel_match,v_participant,3::smallint);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_first::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_first::text,'role','authenticated')::text,true);
  perform public.join_match_waitlist(v_cancel_match);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_owner::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_owner::text,'role','authenticated')::text,true);
  perform public.cancel_match_invitation(v_invitation.id);
  update waitlist_009_behavior set cancel_promotion_ok=
    exists(select 1 from public.match_invitations where id=v_invitation.id and status='cancelled')
    and exists(select 1 from public.match_waitlist where match_id=v_cancel_match and user_id=v_first and status='promoted');

  -- Private invitation exposes only the safe notification payload and dedupes by invitation id.
  insert into public.matches(id,owner_id,date,"dateISO",time,duration,"courtId","courtName","courtType",type,scenario,status,"isPrivate","ratingMin","ratingMax","pricePerPerson","filledSlots",participants)
  values(v_private_match,v_owner,'14 января',date '2099-01-14','10:00',1.5,'wait009-p-'||v_private_match::text,'Private invitation','panoramic','private','private','upcoming',true,0,6,1200,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_owner::text,'isOrganizer',true,'slotIndex',0)),array[v_owner::text]);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_owner::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_owner::text,'role','authenticated')::text,true);
  v_invitation:=public.create_match_invitation(v_private_match,v_second,1::smallint);
  select n.id into v_notification from public.notifications n
  where n.recipient_id=v_second and n.invitation_id=v_invitation.id and n.type='match_invitation';
  update waitlist_009_behavior set invitation_notification_ok=v_notification is not null
    and (select count(*)=1 from public.notifications where recipient_id=v_second and dedupe_key='match-invitation:'||v_invitation.id::text)
    and exists(select 1 from public.notifications where id=v_notification
      and not(data ? 'email') and not(data ? 'phone') and data->>'isPrivate'='true');

  perform pg_catalog.set_config('request.jwt.claim.sub',v_second::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_second::text,'role','authenticated')::text,true);
  v_count_before:=public.get_unread_notification_count();
  perform public.mark_notification_read(v_notification);
  v_count_after:=public.get_unread_notification_count();
  perform public.mark_all_notifications_read();
  update waitlist_009_behavior set unread_and_read_ok=v_count_before>0 and v_count_after=v_count_before-1
    and public.get_unread_notification_count()=0
    and exists(select 1 from public.notifications where id=v_notification and read_at is not null);

  perform pg_catalog.set_config('request.jwt.claim.sub',v_first::text,true);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_first::text,'role','authenticated')::text,true);
  begin
    perform public.mark_notification_read(v_notification);
  exception when others then
    get stacked diagnostics v_message=message_text;
    update waitlist_009_behavior set other_user_access_blocked=(v_message='NOTIFICATION_NOT_FOUND_OR_FORBIDDEN')
      and not exists(select 1 from public.get_my_notifications() n where n.notification_id=v_notification);
  end;

  -- mark_all may have touched pre-existing unread rows for this real profile.
  -- Restore their original read_at before the unchanged-data assertion; the
  -- outer ROLLBACK remains the final safety boundary for every test write.
  update public.notifications n
  set read_at=o.read_at
  from waitlist_009_original_notifications o
  where n.id=o.id and n.read_at is distinct from o.read_at;

  update waitlist_009_behavior set existing_data_unchanged=
    not exists(select 1 from waitlist_009_original_matches o left join public.matches x on x.id=o.id where x.id is null or pg_catalog.md5(to_jsonb(x)::text)<>o.fingerprint)
    and not exists(select 1 from waitlist_009_original_invitations o left join public.match_invitations x on x.id=o.id where x.id is null or pg_catalog.md5(to_jsonb(x)::text)<>o.fingerprint)
    and not exists(select 1 from waitlist_009_original_waitlist o left join public.match_waitlist x on x.id=o.id where x.id is null or pg_catalog.md5(to_jsonb(x)::text)<>o.fingerprint)
    and not exists(select 1 from waitlist_009_original_notifications o left join public.notifications x on x.id=o.id where x.id is null or pg_catalog.md5(to_jsonb(x)::text)<>o.fingerprint);
exception when others then
  update waitlist_009_behavior set note=pg_catalog.concat_ws(' | ',note,sqlstate||' '||sqlerrm);
end;
$$;

with tables as (
  select c.relname,c.relrowsecurity,pg_catalog.obj_description(c.oid,'pg_class') description,c.relowner,c.relacl
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in('match_waitlist','notifications') and c.relkind='r'
),
table_acl as (
  select c.relname,coalesce(r.rolname,'PUBLIC') role_name,a.privilege_type
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
  where n.nspname='public' and c.relname in('match_waitlist','notifications')
),
internal_state_table as (
  select c.oid,c.relrowsecurity,c.relforcerowsecurity,c.relowner,c.relacl,
    pg_catalog.obj_description(c.oid,'pg_class') description
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='prosto_padel_internal'
    and c.relname='migration_009_function_state'
    and c.relkind='r'
),
internal_state_acl as (
  select a.grantee,coalesce(r.rolname,'PUBLIC') role_name,a.privilege_type
  from internal_state_table t
  cross join lateral pg_catalog.aclexplode(
    coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
),
internal_state_policies as (
  select pol.polname,pol.polcmd
  from pg_catalog.pg_policy pol
  where pol.polrelid=pg_catalog.to_regclass('prosto_padel_internal.migration_009_function_state')
),
internal_schema as (
  select n.oid,n.nspowner,n.nspacl
  from pg_catalog.pg_namespace n
  where n.nspname='prosto_padel_internal'
),
internal_schema_acl as (
  select a.grantee,coalesce(r.rolname,'PUBLIC') role_name,a.privilege_type
  from internal_schema s
  cross join lateral pg_catalog.aclexplode(
    coalesce(s.nspacl,pg_catalog.acldefault('n',s.nspowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
),
leave_rollback_state as (
  select s.*,
    regexp_replace(lower(s.function_definition),'\s+',' ','g') normalized_previous_definition
  from prosto_padel_internal.migration_009_function_state s
  where s.function_identity='public.leave_match(uuid)'
),
indexes as (
  select c.relname index_name,i.indisunique,pg_catalog.pg_get_indexdef(i.indexrelid) definition,
    pg_catalog.pg_get_expr(i.indpred,i.indrelid) predicate
  from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
  where i.indrelid in(pg_catalog.to_regclass('public.match_waitlist'),pg_catalog.to_regclass('public.notifications'))
),
policies as (
  select pol.polname,pol.polrelid::pg_catalog.regclass table_name,pol.polcmd,
    pg_catalog.pg_get_expr(pol.polqual,pol.polrelid) expression
  from pg_catalog.pg_policy pol
  where pol.polrelid in(pg_catalog.to_regclass('public.match_waitlist'),pg_catalog.to_regclass('public.notifications'))
),
functions as (
  select n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) result_type,p.proargnames,p.proargmodes,
    p.prosecdef,p.proconfig,p.oid,p.proowner,p.proacl,
    pg_catalog.obj_description(p.oid,'pg_proc') description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)),'\s+',' ','g') definition
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and p.proname in('join_match_waitlist','leave_match_waitlist','get_my_match_waitlist_position',
    'get_match_waitlist_count','get_my_notifications','get_unread_notification_count','mark_notification_read',
    'mark_all_notifications_read','remove_match_participant','create_match_invitation','decline_match_invitation',
    'cancel_match_invitation','join_match','leave_match'))
    or(n.nspname='prosto_padel_internal' and p.proname='promote_match_waitlist')
),
function_acl as (
  select f.oid,
    bool_or(a.grantee=0 and a.privilege_type='EXECUTE') public_execute,
    bool_or(r.rolname='anon' and a.privilege_type='EXECUTE') anon_execute,
    bool_or(r.rolname='authenticated' and a.privilege_type='EXECUTE') authenticated_execute
  from functions f
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
  group by f.oid
),
checks as (
  select
    (select count(*)=2 from tables where relrowsecurity and description like 'migration=009_match_waitlist_notifications;%') as tables_rls_ok,
    exists(select 1 from indexes where index_name='match_waitlist_one_waiting_user' and indisunique and lower(predicate) like '%status = ''waiting''%') as waiting_unique_ok,
    exists(select 1 from indexes where index_name='notifications_recipient_dedupe_key' and indisunique) as notification_dedupe_ok,
    exists(select 1 from policies where polname='match_waitlist_select_own' and lower(expression) like '%auth.uid()%')
      and exists(select 1 from policies where polname='notifications_select_own' and lower(expression) like '%auth.uid()%')
      and not exists(select 1 from table_acl where role_name in('PUBLIC','anon','authenticated') and privilege_type in('INSERT','UPDATE','DELETE'))
      and exists(select 1 from table_acl where role_name='authenticated' and privilege_type='SELECT')
      as own_row_policies_ok,
    not exists(select 1 from functions f join function_acl a using(oid)
      where f.nspname='public' and (a.public_execute or a.anon_execute or not a.authenticated_execute))
      and exists(select 1 from functions f join function_acl a using(oid)
        where f.nspname='prosto_padel_internal' and not a.public_execute and not a.anon_execute and not a.authenticated_execute)
      as function_grants_ok,
    exists(select 1 from functions where nspname='public' and proname='join_match_waitlist'
      and identity_arguments='p_match_id uuid' and result_type in('match_waitlist','public.match_waitlist')
      and definition like '%for update%' and definition like '%waitlist_public_match_only%'
      and definition like '%waitlist_pending_invitation%' and definition like '%waitlist_match_has_free_slot%'
      and definition like '%waitlist_rating_outside_range%')
      and exists(select 1 from functions where nspname='public' and proname='leave_match_waitlist'
        and definition like '%w.user_id = v_user_id%' and definition like '%status = ''left''%')
      and exists(select 1 from functions where nspname='public' and proname='get_my_match_waitlist_position'
        and identity_arguments='p_match_id uuid'
        and result_type like '%queue_position bigint%'
        and proargnames=array['p_match_id','waitlist_id','status','queue_position','joined_at']
        and proargmodes=array['i','t','t','t','t']::"char"[]
        and definition like '%as queue_position%'
        and definition like '%r.user_id = v_user_id%')
      and exists(select 1 from functions where nspname='public' and proname='get_match_waitlist_count'
        and definition like '%m.type = ''match''%' and definition like '%isprivate%false%')
      as waitlist_rpcs_ok,
    exists(select 1 from functions where nspname='prosto_padel_internal' and proname='promote_match_waitlist'
      and definition like '%for update%' and definition like '%order by w.joined_at, w.id%'
      and definition like '%status = ''skipped''%' and definition like '%waitlist_promoted%') as promotion_core_ok,
    exists(select 1 from functions where nspname='public' and proname='leave_match'
      and identity_arguments='p_match_id uuid' and result_type in('matches','public.matches')
      and prosecdef
      and coalesce(proconfig @> array['search_path=pg_catalog, public, prosto_padel_internal, pg_temp'],false)
      and definition like '%auth.uid()%'
      and definition like '%for update%'
      and definition like '%v_match.owner_id = v_user_id%'
      and definition like '%organizer slot cannot leave through leave_match%'
      and definition like '%paid participation cannot be left through leave_match%'
      and definition like '%paymentstatus%'
      and definition like '%ispaid%'
      and definition like '%value->>''id'' is distinct from v_user_id::text%'
      and definition like '%value <> v_user_id::text%'
      and definition like '%"filledslots" = v_new_filled_slots%'
      and definition like '%participants = v_new_participants%'
      and definition like '%return v_updated%'
      and definition like '%promote_match_waitlist%')
      and exists(select 1 from functions where nspname='public' and proname='decline_match_invitation' and definition like '%promote_match_waitlist%')
      and exists(select 1 from functions where nspname='public' and proname='cancel_match_invitation' and definition like '%promote_match_waitlist%')
      and exists(select 1 from functions where nspname='public' and proname='remove_match_participant'
        and definition like '%paid_slot_forbidden%' and definition like '%organizer_forbidden%'
        and definition like '%"filledslots"%' and definition like '%participants%'
        and definition like '%promote_match_waitlist%') as release_hooks_ok,
    (select count(*)=1 from leave_rollback_state)
      and exists(select 1 from leave_rollback_state s
        where s.definition_hash=pg_catalog.md5(s.function_definition)
          and coalesce(s.function_config @> array['search_path=public, pg_temp'],false)
          -- pg_get_functiondef() may deparse a search_path-visible composite
          -- return type as either matches or public.matches.
          and (s.normalized_previous_definition like '%returns public.matches%'
            or s.normalized_previous_definition like '%returns matches%')
          and s.normalized_previous_definition like '%security definer%'
          and s.normalized_previous_definition like '%auth.uid()%'
          and s.normalized_previous_definition like '%for update%'
          and s.normalized_previous_definition like '%v_match.owner_id = v_user_id%'
          and s.normalized_previous_definition like '%organizer slot cannot leave through leave_match%'
          and s.normalized_previous_definition like '%paid participation cannot be left through leave_match%'
          and s.normalized_previous_definition like '%paymentstatus%'
          and s.normalized_previous_definition like '%ispaid%'
          and s.normalized_previous_definition like '%slot_value->>''id'' is distinct from v_user_id::text%'
          and s.normalized_previous_definition like '%participant_id <> v_user_id::text%'
          and s.normalized_previous_definition like '%"filledslots" = v_new_filled_slots%'
          and s.normalized_previous_definition like '%participants = v_new_participants%'
          and s.normalized_previous_definition like '%return v_updated%'
          and s.normalized_previous_definition not like '%promote_match_waitlist%')
      and exists(select 1 from functions f join leave_rollback_state s
        on f.nspname='public' and f.proname='leave_match' and f.identity_arguments='p_match_id uuid'
        where f.oid=s.function_oid and f.proowner=s.function_owner
          and f.proacl is not distinct from s.function_acl
          and f.description is not distinct from s.function_description)
      as leave_rollback_state_ok,
    exists(select 1 from functions where nspname='public' and proname='create_match_invitation'
      and identity_arguments='p_match_id uuid, p_invited_user_id uuid, p_slot_index smallint'
      and definition like '%match-invitation:%' and definition like '%invitation_user_waitlisted%') as invitation_hook_ok,
    exists(select 1 from functions where nspname='public' and proname='join_match'
      and identity_arguments='p_match_id uuid' and result_type in('matches','public.matches') and definition like '%user is in the waitlist%')
      and exists(select 1 from functions where nspname='public' and proname='leave_match'
        and identity_arguments='p_match_id uuid' and result_type in('matches','public.matches')) as legacy_rpc_signatures_ok,
    pg_catalog.has_table_privilege('authenticated','public.matches','UPDATE') as current_frontend_compatible,
    (select count(*)=1 from internal_state_table)
      and exists(select 1 from internal_state_table t
        where t.relrowsecurity
          and not t.relforcerowsecurity
          and t.description like 'migration=009_match_waitlist_notifications;%'
          and pg_catalog.has_table_privilege(t.relowner,t.oid,'SELECT')
          and pg_catalog.has_table_privilege(t.relowner,t.oid,'INSERT')
          and pg_catalog.has_table_privilege(t.relowner,t.oid,'DELETE'))
      and not exists(select 1 from internal_state_policies)
      and not exists(select 1 from internal_state_acl
        where (grantee=0 or role_name in('anon','authenticated'))
          and privilege_type in('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
      and not exists(
        select 1
        from (values ('anon'),('authenticated')) client_roles(role_name)
        cross join (values
          ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
          ('TRUNCATE'),('REFERENCES'),('TRIGGER')
        ) checked_privileges(privilege_name)
        where pg_catalog.has_table_privilege(
          client_roles.role_name,
          'prosto_padel_internal.migration_009_function_state',
          checked_privileges.privilege_name
        )
      )
      as internal_state_table_private,
    (select count(*)=1 from internal_schema)
      and not exists(select 1 from internal_schema_acl
        where (grantee=0 or role_name in('anon','authenticated'))
          and privilege_type in('USAGE','CREATE'))
      and not pg_catalog.has_schema_privilege('anon','prosto_padel_internal','USAGE')
      and not pg_catalog.has_schema_privilege('anon','prosto_padel_internal','CREATE')
      and not pg_catalog.has_schema_privilege('authenticated','prosto_padel_internal','USAGE')
      and not pg_catalog.has_schema_privilege('authenticated','prosto_padel_internal','CREATE')
      as internal_schema_hidden,
    coalesce((select test_executed from waitlist_009_behavior),false) behavioral_test_executed,
    coalesce((select join_leave_position_ok from waitlist_009_behavior),false) join_leave_position_ok,
    coalesce((select duplicate_waiting_blocked from waitlist_009_behavior),false) duplicate_waiting_blocked,
    coalesce((select free_slot_wait_blocked from waitlist_009_behavior),false) free_slot_wait_blocked,
    coalesce((select fifo_skip_and_leave_promotion_ok from waitlist_009_behavior),false) fifo_skip_and_leave_promotion_ok,
    coalesce((select decline_promotion_ok from waitlist_009_behavior),false) decline_promotion_ok,
    coalesce((select cancel_promotion_ok from waitlist_009_behavior),false) cancel_promotion_ok,
    coalesce((select invitation_notification_ok from waitlist_009_behavior),false) invitation_notification_ok,
    coalesce((select promotion_notification_ok from waitlist_009_behavior),false) promotion_notification_ok,
    coalesce((select unread_and_read_ok from waitlist_009_behavior),false) unread_and_read_ok,
    coalesce((select other_user_access_blocked from waitlist_009_behavior),false) other_user_access_blocked,
    coalesce((select existing_data_unchanged from waitlist_009_behavior),false) existing_data_unchanged
)
select pg_catalog.jsonb_build_object('postcheck',pg_catalog.jsonb_build_object(
  'tables',(select pg_catalog.jsonb_agg(to_jsonb(tables)) from tables),
  'internal_state_table',(select to_jsonb(internal_state_table) from internal_state_table),
  'functions',(select pg_catalog.jsonb_agg(to_jsonb(functions) order by nspname,proname,identity_arguments) from functions),
  'leave_rollback_state',(select to_jsonb(leave_rollback_state) - 'function_definition' from leave_rollback_state),
  'behavior',(select to_jsonb(waitlist_009_behavior) from waitlist_009_behavior),
  'checks',(select to_jsonb(checks) from checks),
  'postcheck_ok',(select tables_rls_ok and waiting_unique_ok and notification_dedupe_ok and own_row_policies_ok and function_grants_ok and waitlist_rpcs_ok
    and promotion_core_ok and release_hooks_ok and leave_rollback_state_ok and invitation_hook_ok and legacy_rpc_signatures_ok
    and current_frontend_compatible and internal_state_table_private and internal_schema_hidden
    and behavioral_test_executed
    and join_leave_position_ok and duplicate_waiting_blocked and free_slot_wait_blocked and fifo_skip_and_leave_promotion_ok
    and decline_promotion_ok and cancel_promotion_ok and invitation_notification_ok
    and promotion_notification_ok and unread_and_read_ok and other_user_access_blocked
    and existing_data_unchanged from checks)
)) as match_waitlist_notifications_postcheck;

rollback;
