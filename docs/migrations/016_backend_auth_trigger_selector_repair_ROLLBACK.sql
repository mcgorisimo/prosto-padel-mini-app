-- 016_backend_auth_trigger_selector_repair_ROLLBACK.sql
-- Safe fail-forward rollback: restore the same canonical safe definitions from migration 015.
-- The known-broken shared CASE selectors are deliberately never restored.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local role backend_auth_owner;

create or replace function backend_auth.assert_player_profile_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account_id uuid;
  v_role text;
  v_has_profile boolean;
begin
  if tg_table_name = 'accounts' then
    if tg_op = 'DELETE' then
      v_account_id := old.id;
    else
      v_account_id := new.id;
    end if;
  elsif tg_table_name = 'player_profiles' then
    if tg_op = 'DELETE' then
      v_account_id := old.account_id;
    else
      v_account_id := new.account_id;
    end if;
  else
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_PLAYER_PROFILE_TRIGGER_TABLE_INVALID';
  end if;

  select a.role into v_role
  from backend_auth.accounts a
  where a.id = v_account_id
  for update;

  if not found then
    return null;
  end if;

  select exists (
    select 1 from backend_auth.player_profiles p where p.account_id = v_account_id
  ) into v_has_profile;

  if (v_role = 'player') is distinct from v_has_profile then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_PLAYER_PROFILE_INCONSISTENT';
  end if;
  return null;
end;
$$;

create or replace function backend_auth.assert_external_identity_aliases()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_identity_id uuid;
begin
  if tg_table_name = 'external_identities' then
    if tg_op = 'DELETE' then
      v_identity_id := old.id;
    else
      v_identity_id := new.id;
    end if;
  elsif tg_table_name = 'external_identity_lookup_digests' then
    if tg_op = 'DELETE' then
      v_identity_id := old.identity_id;
    else
      v_identity_id := new.identity_id;
    end if;
  else
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_IDENTITY_ALIAS_TRIGGER_TABLE_INVALID';
  end if;

  perform 1 from backend_auth.external_identities i
  where i.id = v_identity_id
  for update;

  if not found then
    return null;
  end if;

  if not exists (
    select 1 from backend_auth.external_identity_lookup_digests d
    where d.identity_id = v_identity_id
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_IDENTITY_ALIAS_REQUIRED';
  end if;
  return null;
end;
$$;

create or replace function backend_auth.assert_session_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_family_id uuid;
  v_family backend_auth.auth_session_families%rowtype;
  v_credential_count bigint;
  v_min_generation bigint;
  v_max_generation bigint;
  v_last_command backend_auth.auth_session_commands%rowtype;
  v_previous_command backend_auth.auth_session_commands%rowtype;
begin
  if tg_table_name = 'auth_session_families' then
    if tg_op = 'DELETE' then
      v_family_id := old.id;
    else
      v_family_id := new.id;
    end if;
  elsif tg_table_name = 'auth_session_credentials' then
    if tg_op = 'DELETE' then
      v_family_id := old.family_id;
    else
      v_family_id := new.family_id;
    end if;
  elsif tg_table_name = 'auth_session_commands' then
    if tg_op = 'DELETE' then
      v_family_id := old.family_id;
    else
      v_family_id := new.family_id;
    end if;
  else
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_SESSION_TRIGGER_TABLE_INVALID';
  end if;

  select f.* into v_family
  from backend_auth.auth_session_families f
  where f.id = v_family_id
  for update;

  if not found then
    return null;
  end if;

  if not exists (
    select 1 from backend_auth.auth_session_credentials c
    where c.family_id = v_family.id
      and c.generation = v_family.current_credential_generation
      and c.consumed_at is null
      and c.consumed_by_command_id is null
      and c.issued_at >= v_family.created_at
      and c.issued_at < v_family.expires_at
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_CURRENT_CREDENTIAL_INVALID';
  end if;

  select pg_catalog.count(*), pg_catalog.min(c.generation), pg_catalog.max(c.generation)
  into v_credential_count, v_min_generation, v_max_generation
  from backend_auth.auth_session_credentials c
  where c.family_id = v_family.id;

  if v_credential_count <> v_family.current_credential_generation
     or v_min_generation <> 1
     or v_max_generation <> v_family.current_credential_generation then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_CREDENTIAL_SEQUENCE_INVALID';
  end if;

  if exists (
    select 1
    from backend_auth.auth_session_credentials c
    left join backend_auth.auth_session_credentials p
      on p.family_id = c.family_id and p.generation = c.generation - 1
    where c.family_id = v_family.id
      and (
        c.issued_at < v_family.created_at
        or c.issued_at >= v_family.expires_at
        or (c.generation = 1 and c.issued_at < v_family.created_at)
        or (c.generation > 1 and (
          p.generation is null
          or p.consumed_at is null
          or p.consumed_at is distinct from c.issued_at
        ))
        or (c.generation < v_family.current_credential_generation and (
          c.consumed_at is null
          or c.consumed_at >= v_family.expires_at
          or c.consumed_by_command_id is null
        ))
        or (c.generation = v_family.current_credential_generation
          and (c.consumed_at is not null or c.consumed_by_command_id is not null))
      )
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_CREDENTIAL_HISTORY_INVALID';
  end if;

  if exists (
    select 1
    from (
      select c.applied_at,
             pg_catalog.lag(c.applied_at) over (order by c.command_sequence) as previous_at
      from backend_auth.auth_session_commands c
      where c.family_id = v_family.id
    ) ordered
    where ordered.applied_at < v_family.created_at
       or (ordered.previous_at is not null and ordered.applied_at < ordered.previous_at)
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_COMMAND_TIME_ORDER_INVALID';
  end if;

  if (
    select pg_catalog.count(*)
    from backend_auth.auth_session_commands c
    where c.family_id = v_family.id and c.result_type = 'credential_rotated'
  ) <> v_family.current_credential_generation - 1 then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_ROTATION_COUNT_INVALID';
  end if;

  if exists (
    select 1
    from backend_auth.auth_session_commands c
    where c.family_id = v_family.id
      and c.result_type = 'credential_rotated'
      and (
        c.command_type <> 'rotate_credential'
        or c.applied_at >= v_family.expires_at
        -- Successful rotations must replay the generation chain in command
        -- sequence order. Reuse commands are deliberately excluded.
        or c.presented_generation <> (
          select pg_catalog.count(*)
          from backend_auth.auth_session_commands ordered_rotation
          where ordered_rotation.family_id = c.family_id
            and ordered_rotation.result_type = 'credential_rotated'
            and ordered_rotation.command_sequence <= c.command_sequence
        )
        or c.next_generation <> c.presented_generation + 1
        or not exists (
          select 1 from backend_auth.auth_session_credentials old_credential
          where old_credential.family_id = c.family_id
            and old_credential.generation = c.presented_generation
            and old_credential.digest = c.presented_digest
            and old_credential.consumed_at = c.applied_at
            and old_credential.consumed_by_command_id = c.command_id
        )
        or not exists (
          select 1 from backend_auth.auth_session_credentials next_credential
          where next_credential.family_id = c.family_id
            and next_credential.generation = c.next_generation
            and next_credential.digest = c.next_digest
            and next_credential.issued_at = c.applied_at
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_ROTATION_INCONSISTENT';
  end if;

  if exists (
    select 1
    from backend_auth.auth_session_commands c
    where c.family_id = v_family.id
      and c.result_type = 'reuse_detected'
      and not exists (
        select 1 from backend_auth.auth_session_credentials consumed
        where consumed.family_id = c.family_id
          and consumed.generation = c.presented_generation
          and consumed.digest = c.presented_digest
          and consumed.consumed_at is not null
          and consumed.consumed_at <= c.applied_at
      )
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_REUSE_SOURCE_INVALID';
  end if;

  select c.* into v_last_command
  from backend_auth.auth_session_commands c
  where c.family_id = v_family.id
  order by c.command_sequence desc
  limit 1;

  if v_family.status = 'active' then
    if exists (
      select 1 from backend_auth.auth_session_commands c
      where c.family_id = v_family.id and c.result_type <> 'credential_rotated'
    ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_ACTIVE_HISTORY_INVALID';
    end if;
  elsif v_family.status = 'revoked' then
    if v_last_command.result_type is distinct from 'session_revoked'
       or v_last_command.command_id is distinct from v_family.terminal_command_id
       or v_last_command.applied_at is distinct from v_family.terminal_at
       or v_last_command.reason is distinct from v_family.terminal_reason
       or exists (
         select 1 from backend_auth.auth_session_commands c
         where c.family_id = v_family.id
           and c.command_sequence < v_last_command.command_sequence
           and c.result_type <> 'credential_rotated'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_REVOCATION_INVALID';
    end if;
  elsif v_family.status = 'expired' then
    if v_last_command.result_type is distinct from 'session_expired'
       or v_last_command.command_id is distinct from v_family.terminal_command_id
       or v_last_command.applied_at is distinct from v_family.terminal_at
       or exists (
         select 1 from backend_auth.auth_session_commands c
         where c.family_id = v_family.id
           and c.command_sequence < v_last_command.command_sequence
           and c.result_type <> 'credential_rotated'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_EXPIRATION_INVALID';
    end if;
  else
    if v_last_command.result_type is distinct from 'reuse_detected'
       or v_last_command.command_id is distinct from v_family.terminal_command_id
       or v_last_command.applied_at is distinct from v_family.terminal_at
       or v_last_command.presented_generation is distinct from v_family.terminal_reuse_generation
       or v_last_command.presented_digest is distinct from v_family.terminal_reuse_digest
       or exists (
         select 1 from backend_auth.auth_session_commands c
         where c.family_id = v_family.id
           and c.command_sequence < v_last_command.command_sequence
           and c.result_type not in ('credential_rotated', 'session_revoked')
       )
       or (
         select pg_catalog.count(*) from backend_auth.auth_session_commands c
         where c.family_id = v_family.id and c.result_type = 'session_revoked'
       ) > 1 then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_REUSE_INVALID';
    end if;

    select c.* into v_previous_command
    from backend_auth.auth_session_commands c
    where c.family_id = v_family.id
      and c.command_sequence < v_last_command.command_sequence
    order by c.command_sequence desc
    limit 1;

    if exists (
      select 1 from backend_auth.auth_session_commands c
      where c.family_id = v_family.id and c.result_type = 'session_revoked'
    ) and v_previous_command.result_type is distinct from 'session_revoked' then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_SESSION_REVOKED_REUSE_ORDER_INVALID';
    end if;
  end if;
  return null;
end;
$$;

create or replace function backend_auth.assert_otp_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_challenge_id uuid;
  v_challenge backend_auth.otp_challenges%rowtype;
  v_last backend_auth.otp_commands%rowtype;
  v_incorrect_count bigint;
begin
  if tg_table_name = 'otp_challenges' then
    if tg_op = 'DELETE' then
      v_challenge_id := old.id;
    else
      v_challenge_id := new.id;
    end if;
  elsif tg_table_name = 'otp_commands' then
    if tg_op = 'DELETE' then
      v_challenge_id := old.challenge_id;
    else
      v_challenge_id := new.challenge_id;
    end if;
  else
    raise exception using errcode = '55000', message = 'BACKEND_AUTH_OTP_TRIGGER_TABLE_INVALID';
  end if;

  select c.* into v_challenge
  from backend_auth.otp_challenges c
  where c.id = v_challenge_id
  for update;
  if not found then
    return null;
  end if;

  if exists (
    select 1 from (
      select c.applied_at,
             pg_catalog.lag(c.applied_at) over (order by c.command_sequence) as previous_at
      from backend_auth.otp_commands c where c.challenge_id = v_challenge.id
    ) ordered
    where ordered.applied_at < v_challenge.created_at
       or (ordered.previous_at is not null and ordered.applied_at < ordered.previous_at)
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_COMMAND_TIME_ORDER_INVALID';
  end if;

  if exists (
    select 1 from backend_auth.otp_commands c
    where c.challenge_id = v_challenge.id
      and (
        (c.result_type = 'incorrect_code' and (
          c.presented_digest = v_challenge.verifier_digest
          or c.applied_at >= v_challenge.expires_at
          or c.result_attempts_remaining <> v_challenge.max_attempts - (
            select pg_catalog.count(*) from backend_auth.otp_commands prior
            where prior.challenge_id = c.challenge_id
              and prior.result_type = 'incorrect_code'
              and prior.command_sequence <= c.command_sequence
          )
        ))
        or (c.result_type = 'otp_verified' and (
          c.presented_digest <> v_challenge.verifier_digest
          or c.applied_at >= v_challenge.expires_at
        ))
        or (c.result_type = 'otp_attempts_exhausted' and (
          c.presented_digest = v_challenge.verifier_digest
          or c.applied_at >= v_challenge.expires_at
          or (
            select pg_catalog.count(*) from backend_auth.otp_commands prior
            where prior.challenge_id = c.challenge_id
              and prior.result_type = 'incorrect_code'
              and prior.command_sequence < c.command_sequence
          ) <> v_challenge.max_attempts - 1
        ))
        or (c.result_type = 'otp_cancelled' and c.applied_at >= v_challenge.expires_at)
        or (c.result_type = 'otp_expired' and c.applied_at < v_challenge.expires_at)
      )
  ) then
    raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_COMMAND_RESULT_INVALID';
  end if;

  select pg_catalog.count(*) into v_incorrect_count
  from backend_auth.otp_commands c
  where c.challenge_id = v_challenge.id and c.result_type = 'incorrect_code';

  select c.* into v_last
  from backend_auth.otp_commands c
  where c.challenge_id = v_challenge.id
  order by c.command_sequence desc
  limit 1;

  if v_challenge.status = 'pending' then
    if v_challenge.attempts_remaining <> v_challenge.max_attempts - v_incorrect_count
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_PENDING_HISTORY_INVALID';
    end if;
  elsif v_challenge.status = 'verified' then
    if v_last.result_type is distinct from 'otp_verified'
       or v_last.command_id is distinct from v_challenge.terminal_command_id
       or v_last.applied_at is distinct from v_challenge.terminal_at
       or v_challenge.attempts_remaining <> v_challenge.max_attempts - v_incorrect_count
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id
           and c.command_sequence < v_last.command_sequence
           and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_VERIFIED_HISTORY_INVALID';
    end if;
  elsif v_challenge.status = 'attempts_exhausted' then
    if v_last.result_type is distinct from 'otp_attempts_exhausted'
       or v_last.command_id is distinct from v_challenge.terminal_command_id
       or v_last.applied_at is distinct from v_challenge.terminal_at
       or v_challenge.attempts_remaining <> 0
       or v_incorrect_count <> v_challenge.max_attempts - 1
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id
           and c.command_sequence < v_last.command_sequence
           and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_EXHAUSTED_HISTORY_INVALID';
    end if;
  elsif v_challenge.status = 'expired' then
    if v_last.result_type is distinct from 'otp_expired'
       or v_last.command_id is distinct from v_challenge.terminal_command_id
       or v_last.applied_at is distinct from v_challenge.terminal_at
       or v_challenge.attempts_remaining <> v_challenge.max_attempts - v_incorrect_count
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id
           and c.command_sequence < v_last.command_sequence
           and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_EXPIRED_HISTORY_INVALID';
    end if;
  else
    if v_last.result_type is distinct from 'otp_cancelled'
       or v_last.command_id is distinct from v_challenge.terminal_command_id
       or v_last.applied_at is distinct from v_challenge.terminal_at
       or v_last.reason is distinct from v_challenge.terminal_reason
       or v_challenge.attempts_remaining <> v_challenge.max_attempts - v_incorrect_count
       or exists (
         select 1 from backend_auth.otp_commands c
         where c.challenge_id = v_challenge.id
           and c.command_sequence < v_last.command_sequence
           and c.result_type <> 'incorrect_code'
       ) then
      raise exception using errcode = '23514', message = 'BACKEND_AUTH_OTP_CANCELLED_HISTORY_INVALID';
    end if;
  end if;
  return null;
end;
$$;

do $comments$
declare
  v_function pg_catalog.regprocedure;
begin
  for v_function in
    select p.oid::pg_catalog.regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'backend_auth'
      and p.proname = any (array[
        'assert_player_profile_consistency',
        'assert_external_identity_aliases',
        'assert_session_consistency',
        'assert_otp_consistency'
      ]::text[])
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    order by p.proname
  loop
    execute pg_catalog.format(
      'comment on function %s is %L',
      v_function,
      '015_backend_auth_foundation:'
        || pg_catalog.md5(pg_catalog.pg_get_functiondef(v_function::oid))
    );
  end loop;
end;
$comments$;

reset role;
commit;
