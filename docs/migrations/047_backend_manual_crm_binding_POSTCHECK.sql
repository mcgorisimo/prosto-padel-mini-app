-- Read-only catalog checks. No contact or account identifiers are selected.
select current_database(), current_user;
select conname, pg_get_constraintdef(oid) from pg_catalog.pg_constraint
where conrelid in ('backend_auth.yclients_client_bindings'::regclass,
  'backend_auth.manual_crm_binding_drafts'::regclass) order by conname;
select tgname, tgenabled from pg_catalog.pg_trigger
where tgrelid in ('backend_auth.yclients_client_bindings'::regclass,
  'backend_auth.manual_crm_binding_drafts'::regclass) and not tgisinternal order by tgname;
select has_function_privilege('public','backend_auth.lock_manual_crm_context(uuid,uuid)','EXECUTE') as public_must_be_false,
  has_function_privilege('backend_auth_app','backend_auth.lock_manual_crm_context(uuid,uuid)','EXECUTE') as app_context_must_be_true,
  has_table_privilege('backend_auth_app','backend_auth.yclients_client_bindings','UPDATE,DELETE,TRUNCATE') as binding_mutation_must_be_false,
  has_table_privilege('backend_auth_app','backend_auth.manual_crm_binding_drafts','UPDATE,DELETE,TRUNCATE') as draft_broad_mutation_must_be_false,
  has_column_privilege('backend_auth_app','backend_auth.manual_crm_binding_drafts','state','UPDATE') as state_update_must_be_true,
  has_column_privilege('backend_auth_app','backend_auth.manual_crm_binding_drafts','actor_id','UPDATE') as actor_update_must_be_false;
select prosecdef, proconfig from pg_catalog.pg_proc
where oid='backend_auth.lock_manual_crm_context(uuid,uuid)'::regprocedure;
-- prosecdef must be true and search_path fixed to pg_catalog, pg_temp.
select count(*) as drafts_must_be_zero_at_initial_apply from backend_auth.manual_crm_binding_drafts;
