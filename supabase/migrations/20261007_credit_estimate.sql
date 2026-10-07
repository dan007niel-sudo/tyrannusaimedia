-- Conservative credit estimate for Tyrannus AI Media.
-- Apply manually in the existing Supabase project. The app uses the service
-- role key server-side; browser roles get no direct table/function access.

create table if not exists public.credit_estimate_config (
  id boolean primary key default true check (id),
  confirmed_balance_usd numeric(12, 4) not null check (confirmed_balance_usd >= 0),
  warning_threshold_usd numeric(12, 4) not null check (warning_threshold_usd >= 0),
  brainstorm_allowance_usd numeric(12, 4) not null check (brainstorm_allowance_usd > 0),
  image_1k_allowance_usd numeric(12, 4) not null check (image_1k_allowance_usd > 0),
  image_2k_allowance_usd numeric(12, 4) not null check (image_2k_allowance_usd > 0),
  image_4k_allowance_usd numeric(12, 4) not null check (image_4k_allowance_usd > 0),
  edit_allowance_usd numeric(12, 4) not null check (edit_allowance_usd > 0),
  stale_after_hours integer not null default 72 check (stale_after_hours between 1 and 720),
  confirmed_at timestamptz not null,
  provider_depleted_at timestamptz,
  uncertain_since timestamptz,
  uncertainty_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_usage_events (
  id uuid primary key default gen_random_uuid(),
  operation text not null check (operation in ('brainstorm', 'image', 'edit')),
  image_size text check (image_size is null or image_size in ('1K', '2K', '4K')),
  allowance_usd numeric(12, 4),
  attempted_at timestamptz not null default now()
);

create table if not exists public.credit_usage_settlements (
  reservation_id uuid primary key references public.credit_usage_events(id),
  outcome text not null check (outcome in ('succeeded', 'failed', 'uncertain', 'admin_reconciled')),
  settled_at timestamptz not null default now()
);

create index if not exists credit_usage_events_attempted_at_idx
  on public.credit_usage_events (attempted_at);

create or replace function public.reject_credit_usage_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'credit usage events are append-only';
end;
$$;

drop trigger if exists credit_usage_events_append_only on public.credit_usage_events;
create trigger credit_usage_events_append_only
before update or delete on public.credit_usage_events
for each row execute function public.reject_credit_usage_event_mutation();

drop trigger if exists credit_usage_settlements_append_only on public.credit_usage_settlements;
create trigger credit_usage_settlements_append_only
before update or delete on public.credit_usage_settlements
for each row execute function public.reject_credit_usage_event_mutation();

alter table public.credit_estimate_config enable row level security;
alter table public.credit_usage_events enable row level security;
alter table public.credit_usage_settlements enable row level security;
revoke all on public.credit_estimate_config from anon, authenticated;
revoke all on public.credit_usage_events from anon, authenticated;
revoke all on public.credit_usage_settlements from anon, authenticated;
grant select on public.credit_estimate_config to service_role;

create or replace function public.get_credit_estimate()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.credit_estimate_config%rowtype;
  used numeric(12, 4);
  uncertain bigint;
  estimate numeric(12, 4);
  stale boolean;
begin
  select * into cfg from public.credit_estimate_config where id = true;
  if not found then
    return jsonb_build_object(
      'state', 'unconfigured', 'estimatedReserveUsd', null,
      'warningThresholdUsd', null, 'lastConfirmedAt', null,
      'staleAfterHours', null, 'reason', 'not_configured'
    );
  end if;

  select coalesce(sum(allowance_usd), 0), count(*) filter (where allowance_usd is null)
    into used, uncertain
    from public.credit_usage_events
    where attempted_at >= cfg.confirmed_at;

  estimate := greatest(cfg.confirmed_balance_usd - used, 0);
  stale := now() > cfg.confirmed_at + make_interval(hours => cfg.stale_after_hours);

  return jsonb_build_object(
    'state', case
      when cfg.provider_depleted_at is not null and cfg.provider_depleted_at >= cfg.confirmed_at then 'depleted'
      when cfg.uncertain_since is not null and cfg.uncertain_since >= cfg.confirmed_at then 'unknown'
      when uncertain > 0 then 'unknown'
      when stale then 'stale'
      when estimate <= cfg.warning_threshold_usd then 'warning'
      else 'estimated'
    end,
    'estimatedReserveUsd', case when uncertain > 0 or (cfg.uncertain_since is not null and cfg.uncertain_since >= cfg.confirmed_at) then null else estimate end,
    'warningThresholdUsd', cfg.warning_threshold_usd,
    'lastConfirmedAt', cfg.confirmed_at,
    'staleAfterHours', cfg.stale_after_hours,
    'reason', case
      when cfg.uncertain_since is not null and cfg.uncertain_since >= cfg.confirmed_at then coalesce(cfg.uncertainty_reason, 'incomplete_usage_ledger')
      when uncertain > 0 then 'incomplete_usage_ledger'
      else null
    end
  );
end;
$$;

create or replace function public.reserve_credit_usage(
  p_operation text,
  p_image_size text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.credit_estimate_config%rowtype;
  allowance numeric(12, 4);
  event_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('tyrannus_credit_estimate'));
  if p_operation not in ('brainstorm', 'image', 'edit') then
    raise exception 'unsupported credit operation';
  end if;
  if p_operation = 'image' and p_image_size not in ('1K', '2K', '4K') then
    raise exception 'unsupported image size';
  end if;

  select * into cfg from public.credit_estimate_config where id = true for update;
  if found then
    allowance := case
      when p_operation = 'brainstorm' then cfg.brainstorm_allowance_usd
      when p_operation = 'edit' then cfg.edit_allowance_usd
      when p_image_size = '1K' then cfg.image_1k_allowance_usd
      when p_image_size = '2K' then cfg.image_2k_allowance_usd
      when p_image_size = '4K' then cfg.image_4k_allowance_usd
      else null
    end;
  end if;

  insert into public.credit_usage_events(operation, image_size, allowance_usd)
  values (p_operation, p_image_size, allowance)
  returning id into event_id;
  return jsonb_build_object('reservationId', event_id);
end;
$$;

create or replace function public.finish_credit_usage(
  p_reservation_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome not in ('succeeded', 'failed', 'uncertain') then
    raise exception 'unsupported credit settlement outcome';
  end if;
  perform pg_advisory_xact_lock(hashtext('tyrannus_credit_estimate'));
  insert into public.credit_usage_settlements(reservation_id, outcome)
  values (p_reservation_id, p_outcome)
  on conflict (reservation_id) do nothing;
end;
$$;

create or replace function public.confirm_credit_estimate(
  p_confirmed_balance_usd numeric,
  p_warning_threshold_usd numeric,
  p_brainstorm_allowance_usd numeric,
  p_image_1k_allowance_usd numeric,
  p_image_2k_allowance_usd numeric,
  p_image_4k_allowance_usd numeric,
  p_edit_allowance_usd numeric,
  p_stale_after_hours integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  boundary timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('tyrannus_credit_estimate'));
  boundary := clock_timestamp();

  -- A manual balance is meaningful only when no provider call can still be
  -- charged after the confirmation boundary. Recent unfinished reservations
  -- mean a real call is likely still running, so the admin retries later.
  if exists (
    select 1
    from public.credit_usage_events event
    left join public.credit_usage_settlements settlement on settlement.reservation_id = event.id
    where settlement.reservation_id is null
      and event.attempted_at > boundary - interval '15 minutes'
  ) then
    raise exception using message = 'credit_calls_in_flight', errcode = '55P03';
  end if;

  -- An unfinished reservation older than the longest request window is a
  -- crashed/abandoned call. The admin's current provider balance reconciles it
  -- explicitly, so close it before establishing the new boundary.
  insert into public.credit_usage_settlements(reservation_id, outcome, settled_at)
  select event.id, 'admin_reconciled', boundary
  from public.credit_usage_events event
  left join public.credit_usage_settlements settlement on settlement.reservation_id = event.id
  where settlement.reservation_id is null
  on conflict (reservation_id) do nothing;

  insert into public.credit_estimate_config(
    id, confirmed_balance_usd, warning_threshold_usd,
    brainstorm_allowance_usd, image_1k_allowance_usd,
    image_2k_allowance_usd, image_4k_allowance_usd,
    edit_allowance_usd, stale_after_hours, confirmed_at,
    provider_depleted_at, uncertain_since, uncertainty_reason, updated_at
  ) values (
    true, p_confirmed_balance_usd, p_warning_threshold_usd,
    p_brainstorm_allowance_usd, p_image_1k_allowance_usd,
    p_image_2k_allowance_usd, p_image_4k_allowance_usd,
    p_edit_allowance_usd, p_stale_after_hours, boundary,
    null, null, null, boundary
  )
  on conflict (id) do update set
    confirmed_balance_usd = excluded.confirmed_balance_usd,
    warning_threshold_usd = excluded.warning_threshold_usd,
    brainstorm_allowance_usd = excluded.brainstorm_allowance_usd,
    image_1k_allowance_usd = excluded.image_1k_allowance_usd,
    image_2k_allowance_usd = excluded.image_2k_allowance_usd,
    image_4k_allowance_usd = excluded.image_4k_allowance_usd,
    edit_allowance_usd = excluded.edit_allowance_usd,
    stale_after_hours = excluded.stale_after_hours,
    confirmed_at = boundary,
    provider_depleted_at = null,
    uncertain_since = null,
    uncertainty_reason = null,
    updated_at = boundary;
end;
$$;

create or replace function public.mark_credit_estimate_uncertain(p_reason text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.credit_estimate_config
  set uncertain_since = coalesce(uncertain_since, now()),
      uncertainty_reason = coalesce(nullif(p_reason, ''), 'incomplete_usage_ledger'),
      updated_at = now()
  where id = true;
$$;

-- A success only clears a depleted marker when its request started after that
-- marker. This prevents a parallel success from the same depleted batch from
-- racing a later 402 and falsely declaring recovery.
create or replace function public.mark_credit_provider_success(p_started_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.credit_estimate_config
  set provider_depleted_at = null, updated_at = now()
  where id = true
    and provider_depleted_at is not null
    and provider_depleted_at < p_started_at;
$$;

create or replace function public.mark_credit_provider_depleted(p_observed_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.credit_estimate_config
  set provider_depleted_at = greatest(coalesce(provider_depleted_at, p_observed_at), p_observed_at),
      updated_at = now()
  where id = true;
$$;

revoke all on function public.get_credit_estimate() from public, anon, authenticated;
revoke all on function public.reserve_credit_usage(text, text) from public, anon, authenticated;
revoke all on function public.finish_credit_usage(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_credit_estimate(numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer) from public, anon, authenticated;
revoke all on function public.mark_credit_estimate_uncertain(text) from public, anon, authenticated;
revoke all on function public.mark_credit_provider_success(timestamptz) from public, anon, authenticated;
revoke all on function public.mark_credit_provider_depleted(timestamptz) from public, anon, authenticated;
grant execute on function public.get_credit_estimate() to service_role;
grant execute on function public.reserve_credit_usage(text, text) to service_role;
grant execute on function public.finish_credit_usage(uuid, text) to service_role;
grant execute on function public.confirm_credit_estimate(numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer) to service_role;
grant execute on function public.mark_credit_estimate_uncertain(text) to service_role;
grant execute on function public.mark_credit_provider_success(timestamptz) to service_role;
grant execute on function public.mark_credit_provider_depleted(timestamptz) to service_role;
