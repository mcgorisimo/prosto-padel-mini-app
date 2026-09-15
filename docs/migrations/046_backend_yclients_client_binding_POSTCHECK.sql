-- Read-only catalog check; no account, contact or CRM identifiers selected.
select current_database(), current_user;
select conname, pg_get_constraintdef(oid) from pg_catalog.pg_constraint
where conrelid='backend_auth.yclients_client_bindings'::regclass order by conname;
select tgname, tgenabled from pg_catalog.pg_trigger
where tgrelid in ('backend_auth.player_profile_details'::regclass,
  'backend_auth.yclients_client_bindings'::regclass) and not tgisinternal order by tgname;
select has_function_privilege('public','backend_auth.read_crm_phone_proof(uuid)','EXECUTE') as public_must_be_false,
  has_function_privilege('backend_auth_app','backend_auth.read_crm_phone_proof(uuid)','EXECUTE') as app_read_must_be_true,
  has_table_privilege('backend_auth_app','backend_auth.yclients_client_bindings','UPDATE,DELETE,TRUNCATE') as mutation_must_be_false;
select count(*) as bindings_must_be_zero_at_initial_apply from backend_auth.yclients_client_bindings;
