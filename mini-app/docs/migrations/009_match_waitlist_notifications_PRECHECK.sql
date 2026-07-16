-- 009_match_waitlist_notifications_PRECHECK.sql
-- Read-only catalog/data report. It does not create objects or change rows.

with required_match_columns(column_name, expected_type) as (
  values
    ('id','uuid'), ('owner_id','uuid'), ('dateISO','date'), ('time','text'),
    ('status','text'), ('type','text'), ('isPrivate','boolean'),
    ('ratingMin','integer'), ('ratingMax','integer'), ('pricePerPerson','numeric'),
    ('courtId','text'), ('courtName','text'), ('filledSlots','jsonb'), ('participants','text[]')
),
match_columns as (
  select a.attname column_name, pg_catalog.format_type(a.atttypid,a.atttypmod) actual_type
  from pg_catalog.pg_attribute a
  where a.attrelid=pg_catalog.to_regclass('public.matches') and a.attnum>0 and not a.attisdropped
),
match_column_checks as (
  select r.*, c.actual_type, c.actual_type=r.expected_type as type_ok
  from required_match_columns r left join match_columns c using(column_name)
),
invitation_columns as (
  select a.attname column_name, pg_catalog.format_type(a.atttypid,a.atttypmod) data_type, a.attnotnull
  from pg_catalog.pg_attribute a
  where a.attrelid=pg_catalog.to_regclass('public.match_invitations') and a.attnum>0 and not a.attisdropped
),
internal_state_conflicts as (
  select c.oid,c.relkind,c.relrowsecurity,c.relacl,n.nspname,c.relname,
    pg_catalog.obj_description(c.oid,'pg_class') description
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='prosto_padel_internal'
    and c.relname='migration_009_function_state'
),
expected_009_rpc_contracts as (
  select
    'public.get_my_match_waitlist_position(uuid)'::text rpc_signature,
    array['waitlist_id','status','queue_position','joined_at']::text[] output_columns
),
function_catalog as (
  select p.oid,p.proowner,p.proacl,n.nspname schema_name, p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) result_type,
    p.prorettype result_type_oid,p.proretset returns_set,
    p.prosecdef security_definer, p.proconfig,
    pg_catalog.obj_description(p.oid,'pg_proc') description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)),'\s+',' ','g') normalized_definition
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and p.proname in (
    'join_match','leave_match','create_match_invitation','get_incoming_match_invitations',
    'accept_match_invitation','decline_match_invitation','cancel_match_invitation',
    'join_match_waitlist','leave_match_waitlist','get_my_match_waitlist_position',
    'get_match_waitlist_count','get_my_notifications','get_unread_notification_count',
    'mark_notification_read','mark_all_notifications_read','remove_match_participant'
  )) or n.nspname='prosto_padel_internal'
),
leave_target as (
  select * from function_catalog
  where oid=pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
),
function_acl as (
  select f.schema_name,f.proname,f.identity_arguments,
    coalesce(r.rolname,'PUBLIC') role_name,a.privilege_type
  from function_catalog f
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
  where a.grantee=0 or r.rolname in('anon','authenticated')
),
leave_acl_checks as (
  select
    not coalesce(bool_or(role_name='PUBLIC' and privilege_type='EXECUTE'),false) public_execute_revoked,
    not coalesce(bool_or(role_name='anon' and privilege_type='EXECUTE'),false) anon_execute_revoked,
    coalesce(bool_or(role_name='authenticated' and privilege_type='EXECUTE'),false) authenticated_execute_granted
  from function_acl
  where schema_name='public' and proname='leave_match' and identity_arguments='p_match_id uuid'
),
leave_compatibility as (
  select
    exists(select 1 from leave_target where identity_arguments='p_match_id uuid'
      and not returns_set and result_type_oid=pg_catalog.to_regtype('public.matches')::oid)
      as signature_and_return_type_ok,
    exists(select 1 from leave_target where security_definer
      and coalesce(proconfig @> array['search_path=public, pg_temp'],false))
      as security_and_path_ok,
    exists(select 1 from leave_target where normalized_definition like '%auth.uid()%'
      and normalized_definition like '%for update%') as auth_and_lock_ok,
    exists(select 1 from leave_target
      where normalized_definition like '%v_match.owner_id = v_user_id%'
        and normalized_definition like '%organizer cannot leave own match through leave_match%'
        and normalized_definition like '%organizer slot cannot leave through leave_match%')
      as organizer_protection_ok,
    exists(select 1 from leave_target
      where normalized_definition like '%paid participation cannot be left through leave_match%'
        and normalized_definition like '%paymentstatus%'
        and normalized_definition like '%ispaid%') as paid_slot_protection_ok,
    exists(select 1 from leave_target
      where normalized_definition like '%slot_value->>''id'' is distinct from v_user_id::text%'
        and normalized_definition like '%participant_id <> v_user_id::text%'
        and normalized_definition like '%"filledslots" = v_new_filled_slots%'
        and normalized_definition like '%participants = v_new_participants%')
      as removes_current_user_from_both_fields_ok,
    exists(select 1 from leave_target where normalized_definition like '%return v_updated%')
      as returns_updated_match_ok,
    (select public_execute_revoked and anon_execute_revoked and authenticated_execute_granted
      from leave_acl_checks) as grants_ok,
    not exists(select 1 from function_catalog where schema_name='public' and proname='leave_match'
      and oid is distinct from pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid)
      as no_extra_overloads
),
matches_policies as (
  select pol.polname,
    case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
      when 'd' then 'DELETE' when '*' then 'ALL' end command,
    pg_catalog.pg_get_expr(pol.polqual,pol.polrelid) using_expression,
    pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid) with_check_expression
  from pg_catalog.pg_policy pol where pol.polrelid=pg_catalog.to_regclass('public.matches')
),
invitation_policies as (
  select pol.polname, pol.polcmd,
    pg_catalog.pg_get_expr(pol.polqual,pol.polrelid) using_expression
  from pg_catalog.pg_policy pol where pol.polrelid=pg_catalog.to_regclass('public.match_invitations')
),
matches_acl as (
  select coalesce(r.rolname,'PUBLIC') role_name,a.privilege_type
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
  where c.oid=pg_catalog.to_regclass('public.matches') and (a.grantee=0 or r.rolname in ('anon','authenticated'))
),
invitation_acl as (
  select coalesce(r.rolname,'PUBLIC') role_name,a.privilege_type
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
  where c.oid=pg_catalog.to_regclass('public.match_invitations') and (a.grantee=0 or r.rolname in ('anon','authenticated'))
),
slot_rows as (
  select m.id match_id,s.value,s.ord,
    case when coalesce(s.value->>'slotIndex','')~'^[0-3]$'
      then (s.value->>'slotIndex')::integer else (s.ord-1)::integer end logical_slot_index
  from public.matches m
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(m."filledSlots")='array' then m."filledSlots" else '[]'::jsonb end
  ) with ordinality s(value,ord)
),
data_findings as (
  select
    (select count(*) from public.matches) match_count,
    (select count(*) from public.match_invitations) invitation_count,
    (select count(*) from public.match_invitations where status='pending') pending_invitation_count,
    (select count(*) from public.matches where pg_catalog.jsonb_typeof("filledSlots") is distinct from 'array') non_array_slots,
    (select count(*) from public.matches where pg_catalog.jsonb_typeof("filledSlots")='array' and pg_catalog.jsonb_array_length("filledSlots")>4) overfull_matches,
    (select count(*) from slot_rows where value ? 'slotIndex' and coalesce(value->>'slotIndex','') !~ '^[0-3]$') invalid_explicit_slot_indexes,
    (select count(*) from (select match_id,logical_slot_index from slot_rows group by match_id,logical_slot_index having count(*)>1)d) duplicate_logical_slots,
    (select count(*) from (select match_id,value->>'id' player_id from slot_rows where nullif(value->>'id','') is not null group by match_id,value->>'id' having count(*)>1)d) duplicate_player_slots,
    (select count(*) from public.matches m where pg_catalog.jsonb_typeof(m."filledSlots")='array'
      and pg_catalog.jsonb_array_length(m."filledSlots")+(select count(*) from public.match_invitations i where i.match_id=m.id and i.status='pending')>4) over_reserved_matches,
    (select count(*) from public.match_invitations i join public.matches m on m.id=i.match_id
      where i.status='pending' and (i.invited_user_id::text=any(coalesce(m.participants,array[]::text[]))
        or exists(select 1 from slot_rows s where s.match_id=m.id and (s.value->>'id'=i.invited_user_id::text or s.logical_slot_index=i.slot_index)))) pending_invitation_conflicts,
    (select count(*) from public.match_invitations where status not in ('pending','accepted','declined','cancelled')) invalid_invitation_statuses,
    (select count(*) from public.match_invitations where slot_index not between 0 and 3) invalid_invitation_slots
),
checks as (
  select
    pg_catalog.to_regclass('public.matches') is not null as matches_exists,
    pg_catalog.to_regclass('public.profiles') is not null as profiles_exists,
    pg_catalog.to_regclass('public.match_invitations') is not null
      and coalesce(pg_catalog.obj_description(pg_catalog.to_regclass('public.match_invitations'),'pg_class'),'') like 'migration=008_match_invitations_stage1;%'
      as migration_008_table_installed,
    not exists(select 1 from match_column_checks where actual_type is null or not type_ok) as matches_shape_ok,
    (select count(*)=8 from invitation_columns)
      and exists(select 1 from invitation_columns where column_name='match_id' and data_type='uuid' and attnotnull)
      and exists(select 1 from invitation_columns where column_name='invited_user_id' and data_type='uuid' and attnotnull)
      and exists(select 1 from invitation_columns where column_name='slot_index' and data_type='smallint' and attnotnull)
      and exists(select 1 from invitation_columns where column_name='status' and data_type='text' and attnotnull)
      as invitations_shape_ok,
    exists(select 1 from function_catalog where schema_name='public' and proname='join_match'
      and identity_arguments='p_match_id uuid' and result_type in ('matches','public.matches')
      and description like 'migration=008_match_invitations_stage1;%') as join_008_installed,
    (select signature_and_return_type_ok and security_and_path_ok and auth_and_lock_ok
      and organizer_protection_ok and paid_slot_protection_ok
      and removes_current_user_from_both_fields_ok and returns_updated_match_ok
      and grants_ok and no_extra_overloads from leave_compatibility)
      as leave_compatible_installed,
    (select count(*)=5 from function_catalog where schema_name='public' and proname in (
      'create_match_invitation','get_incoming_match_invitations','accept_match_invitation',
      'decline_match_invitation','cancel_match_invitation'
    ) and description like 'migration=008_match_invitations_stage1;%') as invitation_rpcs_008_installed,
    pg_catalog.to_regprocedure('auth.uid()') is not null
      and exists(select 1 from pg_catalog.pg_roles where rolname='authenticated')
      and exists(select 1 from pg_catalog.pg_roles where rolname='anon') as supabase_adapter_available,
    pg_catalog.to_regclass('public.match_waitlist') is null
      and pg_catalog.to_regclass('public.notifications') is null
      and not exists(select 1 from pg_catalog.pg_namespace where nspname='prosto_padel_internal')
      and not exists(select 1 from function_catalog where proname in (
        'join_match_waitlist','leave_match_waitlist','get_my_match_waitlist_position',
        'get_match_waitlist_count','get_my_notifications','get_unread_notification_count',
        'mark_notification_read','mark_all_notifications_read','remove_match_participant'
      )) as no_009_conflicts,
    not exists(select 1 from internal_state_conflicts)
      as no_conflicting_internal_state_table,
    not exists(select 1 from function_catalog
      where schema_name='public' and proname='get_my_match_waitlist_position')
      as queue_position_contract_available,
    (select non_array_slots=0 and overfull_matches=0 and invalid_explicit_slot_indexes=0
      and duplicate_logical_slots=0 and duplicate_player_slots=0 and over_reserved_matches=0
      and pending_invitation_conflicts=0 and invalid_invitation_statuses=0 and invalid_invitation_slots=0
      from data_findings)
      as existing_data_compatible,
    pg_catalog.has_table_privilege('authenticated','public.matches','UPDATE') as legacy_direct_update_present
)
select pg_catalog.jsonb_build_object(
  'precheck',pg_catalog.jsonb_build_object(
    'checks',(select to_jsonb(checks) from checks),
    'match_columns',(select pg_catalog.jsonb_agg(to_jsonb(match_column_checks) order by column_name) from match_column_checks),
    'invitation_columns',(select pg_catalog.jsonb_agg(to_jsonb(invitation_columns) order by column_name) from invitation_columns),
    'internal_state_conflicts',coalesce((select pg_catalog.jsonb_agg(to_jsonb(internal_state_conflicts)) from internal_state_conflicts),'[]'::jsonb),
    'expected_009_rpc_contracts',(select pg_catalog.jsonb_agg(to_jsonb(expected_009_rpc_contracts)) from expected_009_rpc_contracts),
    'known_functions',coalesce((select pg_catalog.jsonb_agg(to_jsonb(function_catalog) order by schema_name,proname,identity_arguments) from function_catalog),'[]'::jsonb),
    'function_grants',coalesce((select pg_catalog.jsonb_agg(to_jsonb(function_acl) order by schema_name,proname,identity_arguments,role_name) from function_acl),'[]'::jsonb),
    'leave_compatibility',(select to_jsonb(leave_compatibility) from leave_compatibility),
    'matches_policies',coalesce((select pg_catalog.jsonb_agg(to_jsonb(matches_policies)) from matches_policies),'[]'::jsonb),
    'invitation_policies',coalesce((select pg_catalog.jsonb_agg(to_jsonb(invitation_policies)) from invitation_policies),'[]'::jsonb),
    'matches_grants',coalesce((select pg_catalog.jsonb_agg(to_jsonb(matches_acl)) from matches_acl),'[]'::jsonb),
    'invitation_grants',coalesce((select pg_catalog.jsonb_agg(to_jsonb(invitation_acl)) from invitation_acl),'[]'::jsonb),
    'data',(select to_jsonb(data_findings) from data_findings),
    'precheck_ok',(select matches_exists and profiles_exists and migration_008_table_installed
      and matches_shape_ok and invitations_shape_ok and join_008_installed and leave_compatible_installed
      and invitation_rpcs_008_installed and supabase_adapter_available and no_009_conflicts
      and no_conflicting_internal_state_table and queue_position_contract_available
      and existing_data_compatible
      and legacy_direct_update_present from checks)
  )
) as match_waitlist_notifications_precheck;
