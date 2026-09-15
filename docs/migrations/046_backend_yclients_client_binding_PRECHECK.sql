-- Read-only preflight. Run only under a separately approved migration gate.
select current_database(), current_user;
select to_regclass('backend_auth.account_contacts') as contacts_042,
  to_regclass('backend_auth.contact_verification_challenges') as challenges_042,
  to_regclass('backend_auth.player_profile_details') as profiles,
  to_regclass('backend_auth.yclients_client_bindings') as binding_must_be_absent;
select attname from pg_catalog.pg_attribute
where attrelid='backend_auth.player_profile_details'::regclass
  and attname in ('crm_phone_revision','crm_phone_changed_at') and not attisdropped;
-- Both new columns must be absent. Do not select profile/contact values.
