-- PostgreSQL numeric considers NaN greater than finite numbers: > 0 alone is insufficient.
alter table public.alerts add constraint alerts_threshold_finite
  check (threshold_usd < 'Infinity'::numeric);
alter table public.prices add constraint prices_price_finite
  check (price_usd < 'Infinity'::numeric);
alter table public.notification_events add constraint notification_events_prices_finite
  check (threshold_usd < 'Infinity'::numeric and trigger_price_usd < 'Infinity'::numeric);

-- Shared across Edge Function instances; clients cannot reset their own cooldown.
create table private.price_refresh_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null
);
revoke all on private.price_refresh_requests from public, anon, authenticated;

create function public.claim_price_refresh(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed integer;
begin
  if p_user_id is null then
    raise exception 'A user ID is required';
  end if;

  insert into private.price_refresh_requests as previous (user_id, requested_at)
  values (p_user_id, clock_timestamp())
  on conflict (user_id) do update
    set requested_at = excluded.requested_at
    where previous.requested_at <= excluded.requested_at - interval '60 seconds';
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;

revoke all on function public.claim_price_refresh(uuid) from public, anon, authenticated;
grant execute on function public.claim_price_refresh(uuid) to service_role;
comment on function public.claim_price_refresh(uuid) is
  'Atomically allows one manual price refresh per user per minute; invoked only after JWT verification.';
