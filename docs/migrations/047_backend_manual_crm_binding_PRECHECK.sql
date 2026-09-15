-- Read-only catalog preflight. Apply only after separately approved 042/046.
-- Verify the exact expected TEST database and backup before migration 047.
select current_database(), current_user;
select to_regclass('backend_auth.yclients_client_bindings') as bindings_046,
  to_regclass('backend_auth.admin_capability_events') as capability_ledger,
  to_regclass('backend_auth.manual_crm_binding_drafts') as drafts_must_be_absent,
  to_regprocedure('backend_auth.lock_manual_crm_context(uuid,uuid)') as context_must_be_absent;
select attname from pg_catalog.pg_attribute
where attrelid='backend_auth.yclients_client_bindings'::regclass
  and attname in ('evidence_method','admin_actor_id','admin_draft_id') and not attisdropped;
-- All three new columns must be absent. Do not select contact/account data.
select conname, pg_get_constraintdef(oid) from pg_catalog.pg_constraint
where conrelid='backend_auth.yclients_client_bindings'::regclass order by conname;
