-- 035_backend_player_onboarding_foundation.sql
-- Adds backend-owned, resumable onboarding persistence on top of the exact
-- a3c2fe0c2b03f3e4f18b30001c7ceb780969fdf8 schema baseline.
-- Storage only: this migration does not connect Nest/runtime or verify contacts.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_relation record;
  v_details_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
  v_immutable_function oid := pg_catalog.to_regprocedure(
    'backend_auth.reject_immutable_mutation()'
  )::oid;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required role boundary is unavailable';
  end if;

  if pg_catalog.has_database_privilege(
       'backend_auth_app',
       pg_catalog.current_database(),
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: application CREATE privileges are unsafe';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_auth', 'player_profiles', '015_backend_auth_foundation'),
      (
        'backend_auth',
        'player_profile_details',
        '018_backend_auth_player_profile_editable_fields'
      ),
      (
        'backend_auth',
        'player_rating_states',
        '019_backend_auth_player_rating_state'
      )
    ) expected(schema_name, relation_name, migration_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = v_relation.schema_name
        and relation.relname = v_relation.relation_name
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_relation.migration_name || ':'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: %.% differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if v_immutable_function is null
     or pg_catalog.obj_description(
       v_immutable_function,
       'pg_proc'
     ) is distinct from
       '015_backend_auth_foundation:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_immutable_function)
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: immutable guard differs from migration 015';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_details_oid
      and attribute.attname = 'normalized_email'
      and not attribute.attisdropped
  )
     or exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_details_oid
         and constraint_row.conname =
           'player_profile_details_normalized_email_check'
     )
     or pg_catalog.to_regclass(
       'backend_auth.player_onboarding_states'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.account_consent_acceptances'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.guard_player_onboarding_state_transition()'
     ) is not null then
    raise exception 'MIGRATION_CONFLICT: migration 035 target already exists';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create function backend_auth.is_onboarding_survey_answer_codes(
  value pg_catalog.jsonb
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select case
    when pg_catalog.jsonb_typeof(value) <> 'object' then false
    else
      pg_catalog.pg_column_size(value) <= 4096
      and (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(value)
      ) <= 16
      and not exists (
        select 1
        from pg_catalog.jsonb_each(value) answer(
          question_code,
          answer_value
        )
        where answer.question_code !~ '^[a-z][a-z0-9_]{0,63}$'
           or pg_catalog.jsonb_typeof(answer.answer_value) <> 'string'
           or answer.answer_value #>> '{}'::pg_catalog.text[]
             !~ '^[a-z][a-z0-9_]{0,63}$'
      )
  end
$function$;

alter table backend_auth.player_profile_details
  add column normalized_email text,
  add constraint player_profile_details_normalized_email_check check (
    normalized_email is null
    or (
      pg_catalog.char_length(normalized_email) between 3 and 320
      and pg_catalog.btrim(normalized_email) = normalized_email
      and pg_catalog.lower(normalized_email) = normalized_email
      and normalized_email !~ '[[:space:][:cntrl:]]'
      and normalized_email ~
        '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$'
    )
  );

create table backend_auth.player_onboarding_states (
  account_id uuid not null,
  flow_version text not null,
  status text not null default 'in_progress'::text,
  current_step text not null,
  survey_version text not null,
  survey_answers jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  completed_at bigint,
  constraint player_onboarding_states_pkey primary key (account_id),
  constraint player_onboarding_states_account_id_fkey
    foreign key (account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint player_onboarding_states_code_check check (
    flow_version ~ '^[a-z][a-z0-9_.-]{0,63}$'
    and survey_version ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  constraint player_onboarding_states_status_check check (
    status = any (array['in_progress', 'completed']::text[])
  ),
  constraint player_onboarding_states_step_check check (
    current_step = any (array[
      'profile',
      'contacts',
      'consents',
      'level_survey',
      'completed'
    ]::text[])
  ),
  constraint player_onboarding_states_survey_answers_check check (
    backend_auth.is_onboarding_survey_answer_codes(survey_answers)
  ),
  constraint player_onboarding_states_revision_check check (
    revision between 1 and 9007199254740991
  ),
  constraint player_onboarding_states_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
    and (
      completed_at is null
      or completed_at between created_at and updated_at
    )
  ),
  constraint player_onboarding_states_shape_check check (
    (
      status = 'in_progress'
      and current_step <> 'completed'
      and completed_at is null
    )
    or (
      status = 'completed'
      and current_step = 'completed'
      and completed_at is not null
    )
  )
);

create table backend_auth.account_consent_acceptances (
  account_id uuid not null,
  consent_kind text not null,
  document_version text not null,
  flow_version text not null,
  accepted_at bigint not null,
  constraint account_consent_acceptances_pkey primary key (
    account_id,
    consent_kind,
    document_version
  ),
  constraint account_consent_acceptances_account_id_fkey
    foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint account_consent_acceptances_kind_check check (
    consent_kind = any (array[
      'terms',
      'privacy',
      'cancellation'
    ]::text[])
  ),
  constraint account_consent_acceptances_version_check check (
    document_version ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'
    and flow_version ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  constraint account_consent_acceptances_time_check check (
    accepted_at between 0 and 9007199254740991
  )
);

create function backend_auth.guard_player_onboarding_state_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_old_step smallint;
  v_new_step smallint;
  v_contacts_ready boolean;
  v_consent_kind_count bigint;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'in_progress'
       or new.current_step <> 'profile'
       or new.survey_answers <> '{}'::pg_catalog.jsonb
       or new.revision <> 1
       or new.created_at <> new.updated_at
       or new.completed_at is not null then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_INSERT_INVALID';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_PLAYER_ONBOARDING_STATE_IMMUTABLE';
  end if;

  if new.account_id is distinct from old.account_id
     or new.flow_version is distinct from old.flow_version
     or new.survey_version is distinct from old.survey_version
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_PLAYER_ONBOARDING_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'completed' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_PLAYER_ONBOARDING_COMPLETED_IMMUTABLE';
  end if;

  if new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '40001',
      message = 'BACKEND_PLAYER_ONBOARDING_REVISION_CONFLICT';
  end if;

  v_old_step := pg_catalog.array_position(
    array[
      'profile',
      'contacts',
      'consents',
      'level_survey',
      'completed'
    ]::text[],
    old.current_step
  );
  v_new_step := pg_catalog.array_position(
    array[
      'profile',
      'contacts',
      'consents',
      'level_survey',
      'completed'
    ]::text[],
    new.current_step
  );

  if v_new_step < v_old_step or v_new_step > v_old_step + 1 then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_PLAYER_ONBOARDING_STEP_INVALID';
  end if;

  if new.status = 'completed' then
    if old.current_step <> 'level_survey'
       or new.current_step <> 'completed'
       or new.survey_answers = '{}'::pg_catalog.jsonb then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_COMPLETION_INVALID';
    end if;

    select exists (
      select 1
      from backend_auth.player_profile_details details
      where details.account_id = new.account_id
        and pg_catalog.btrim(details.first_name) <> ''
        and details.phone is not null
        and details.normalized_email is not null
    ) into v_contacts_ready;

    if not v_contacts_ready then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_CONTACTS_REQUIRED';
    end if;

    select pg_catalog.count(distinct acceptance.consent_kind)
      into v_consent_kind_count
    from backend_auth.account_consent_acceptances acceptance
    where acceptance.account_id = new.account_id
      and acceptance.flow_version = new.flow_version
      and acceptance.accepted_at between new.created_at and new.completed_at;

    if v_consent_kind_count <> 3 then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_CONSENTS_REQUIRED';
    end if;
  end if;

  return new;
end;
$function$;

create trigger player_onboarding_states_transition_guard
before insert or update or delete
on backend_auth.player_onboarding_states
for each row execute function
  backend_auth.guard_player_onboarding_state_transition();

create trigger account_consent_acceptances_immutable_guard
before update or delete
on backend_auth.account_consent_acceptances
for each row execute function backend_auth.reject_immutable_mutation();

revoke all on table
  backend_auth.player_onboarding_states,
  backend_auth.account_consent_acceptances
from public, backend_auth_app;

grant select on table
  backend_auth.player_onboarding_states,
  backend_auth.account_consent_acceptances
to backend_auth_app;

grant insert (
  account_id,
  flow_version,
  current_step,
  survey_version,
  created_at,
  updated_at
) on backend_auth.player_onboarding_states to backend_auth_app;

grant update (
  status,
  current_step,
  survey_answers,
  revision,
  updated_at,
  completed_at
) on backend_auth.player_onboarding_states to backend_auth_app;

grant insert (
  account_id,
  consent_kind,
  document_version,
  flow_version,
  accepted_at
) on backend_auth.account_consent_acceptances to backend_auth_app;

grant update (
  normalized_email
) on backend_auth.player_profile_details to backend_auth_app;

revoke all on function
  backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb),
  backend_auth.guard_player_onboarding_state_transition()
from public, backend_auth_app;

do $comments$
declare
  v_function pg_catalog.regprocedure;
  v_relation pg_catalog.regclass;
begin
  foreach v_relation in array array[
    'backend_auth.player_profile_details'::pg_catalog.regclass,
    'backend_auth.player_onboarding_states'::pg_catalog.regclass,
    'backend_auth.account_consent_acceptances'::pg_catalog.regclass
  ] loop
    execute pg_catalog.format(
      'comment on table %s is %L',
      v_relation,
      '035_backend_player_onboarding_foundation:'
        || backend_auth.relation_fingerprint(v_relation)
    );
  end loop;

  foreach v_function in array array[
    'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'::pg_catalog.regprocedure,
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure
  ] loop
    execute pg_catalog.format(
      'comment on function %s is %L',
      v_function,
      '035_backend_player_onboarding_foundation:'
        || pg_catalog.md5(
          pg_catalog.pg_get_functiondef(v_function::oid)
        )
    );
  end loop;
end;
$comments$;

do $assertions$
declare
  v_details_oid oid :=
    'backend_auth.player_profile_details'::pg_catalog.regclass;
  v_state_oid oid :=
    'backend_auth.player_onboarding_states'::pg_catalog.regclass;
  v_acceptance_oid oid :=
    'backend_auth.account_consent_acceptances'::pg_catalog.regclass;
begin
  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_details_oid
        and attribute.attnum > 0
        and not attribute.attisdropped) <> 11
     or (select pg_catalog.count(*)
         from pg_catalog.pg_attribute attribute
         where attribute.attrelid = v_state_oid
           and attribute.attnum > 0
           and not attribute.attisdropped) <> 10
     or (select pg_catalog.count(*)
         from pg_catalog.pg_attribute attribute
         where attribute.attrelid = v_acceptance_oid
           and attribute.attnum > 0
           and not attribute.attisdropped) <> 5 then
    raise exception 'MIGRATION_ASSERTION_FAILED: onboarding column set differs';
  end if;

  if exists (select 1 from backend_auth.player_onboarding_states)
     or exists (select 1 from backend_auth.account_consent_acceptances)
     or exists (
       select 1
       from backend_auth.player_profile_details
       where normalized_email is not null
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 035 must start empty';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_state_oid,
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_acceptance_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_state_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_acceptance_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_details_oid,
       'normalized_email',
       'UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: onboarding ACL boundary differs';
  end if;

  if pg_catalog.obj_description(v_details_oid, 'pg_class') is distinct from
       '035_backend_player_onboarding_foundation:'
         || backend_auth.relation_fingerprint(
           v_details_oid::pg_catalog.regclass
         )
     or pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '035_backend_player_onboarding_foundation:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         )
     or pg_catalog.obj_description(v_acceptance_oid, 'pg_class') is distinct from
       '035_backend_player_onboarding_foundation:'
         || backend_auth.relation_fingerprint(
           v_acceptance_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: onboarding fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '035_backend_player_onboarding_foundation applied; runtime remains disconnected'
  as result;
