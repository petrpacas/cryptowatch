create type public.alert_direction as enum ('above', 'below');
create type public.notification_status as enum ('pending', 'sending', 'sent', 'failed');

create table public.coins (
  id text primary key,
  name text not null check (btrim(name) <> ''),
  symbol text not null check (btrim(symbol) <> ''),
  is_active boolean not null default true,
  last_seen_sync_id uuid,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coins_id_not_blank check (btrim(id) <> '')
);

create table public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  coin_id text not null references public.coins (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint watchlist_user_coin_key unique (user_id, coin_id),
  constraint watchlist_id_user_key unique (id, user_id)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  watchlist_id uuid not null,
  direction public.alert_direction not null,
  threshold_usd numeric not null check (threshold_usd > 0),
  is_active boolean not null default true,
  activation_version integer not null default 1 check (activation_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alerts_watchlist_owner_fkey
    foreign key (watchlist_id, user_id)
    references public.watchlist (id, user_id)
    on delete cascade
);

create table public.prices (
  coin_id text primary key references public.coins (id) on delete cascade,
  price_usd numeric not null check (price_usd > 0),
  provider_updated_at timestamptz,
  fetched_at timestamptz not null default now()
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  alert_id uuid references public.alerts (id) on delete set null,
  source_alert_id uuid not null,
  activation_version integer not null check (activation_version > 0),
  coin_id text not null references public.coins (id) on delete restrict,
  coin_name text not null,
  coin_symbol text not null,
  direction public.alert_direction not null,
  threshold_usd numeric not null check (threshold_usd > 0),
  trigger_price_usd numeric not null check (trigger_price_usd > 0),
  recipient_email text not null,
  status public.notification_status not null default 'pending',
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  first_attempt_at timestamptz,
  sent_at timestamptz,
  resend_email_id text,
  last_error text,
  created_at timestamptz not null default now(),
  constraint notification_events_activation_key
    unique (source_alert_id, activation_version)
);

create index coins_name_lower_idx on public.coins (lower(name) text_pattern_ops);
create index coins_symbol_lower_idx on public.coins (lower(symbol) text_pattern_ops);
create index coins_active_idx on public.coins (is_active) where is_active;
create index watchlist_user_id_idx on public.watchlist (user_id);
create index alerts_user_id_idx on public.alerts (user_id);
create index alerts_watchlist_id_idx on public.alerts (watchlist_id);
create index notification_events_user_created_idx
  on public.notification_events (user_id, created_at desc);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

create trigger coins_set_updated_at
before update on public.coins
for each row execute function private.set_updated_at();

create function private.prepare_alert_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.direction is distinct from old.direction
    or new.threshold_usd is distinct from old.threshold_usd
    or (not old.is_active and new.is_active)
  then
    new.activation_version = old.activation_version + 1;
  else
    new.activation_version = old.activation_version;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.prepare_alert_update() from public;

create trigger alerts_prepare_update
before update on public.alerts
for each row execute function private.prepare_alert_update();

create function public.search_coins(search_query text)
returns table (
  id text,
  name text,
  symbol text,
  coingecko_url text,
  is_watched boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select lower(btrim(coalesce(search_query, ''))) as term
  )
  select
    coin.id,
    coin.name,
    coin.symbol,
    'https://www.coingecko.com/en/coins/' || coin.id as coingecko_url,
    exists (
      select 1
      from public.watchlist watched
      where watched.user_id = (select auth.uid())
        and watched.coin_id = coin.id
    ) as is_watched
  from public.coins coin
  cross join input
  where coin.is_active
    and input.term <> ''
    and (
      strpos(lower(coin.id), input.term) > 0
      or strpos(lower(coin.name), input.term) > 0
      or strpos(lower(coin.symbol), input.term) > 0
    )
  order by
    case
      when lower(coin.symbol) = input.term
        or lower(coin.name) = input.term
        or lower(coin.id) = input.term then 0
      when left(lower(coin.symbol), char_length(input.term)) = input.term then 1
      when left(lower(coin.name), char_length(input.term)) = input.term
        or left(lower(coin.id), char_length(input.term)) = input.term then 1
      else 2
    end,
    char_length(coin.name),
    lower(coin.name),
    coin.id
  limit 20;
$$;

comment on function public.search_coins(text) is
  'Searches the active CoinGecko catalog and marks coins watched by the current user.';

create function public.finish_coin_sync(p_sync_run_id uuid)
returns table (active_count bigint, deactivated_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows bigint;
begin
  if p_sync_run_id is null then
    raise exception 'p_sync_run_id must not be null';
  end if;

  update public.coins
  set is_active = false
  where is_active
    and last_seen_sync_id is distinct from p_sync_run_id;

  get diagnostics changed_rows = row_count;

  return query
  select count(*)::bigint, changed_rows
  from public.coins
  where is_active;
end;
$$;

comment on function public.finish_coin_sync(uuid) is
  'Finalizes a successful catalog run by deactivating coins not seen in that run.';

alter table public.coins enable row level security;
alter table public.watchlist enable row level security;
alter table public.alerts enable row level security;
alter table public.prices enable row level security;
alter table public.notification_events enable row level security;

create policy "Authenticated users can read coins"
on public.coins for select to authenticated using (true);

create policy "Authenticated users can read prices"
on public.prices for select to authenticated using (true);

create policy "Users can read their watchlist"
on public.watchlist for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can add active coins to their watchlist"
on public.watchlist for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.coins coin
    where coin.id = coin_id and coin.is_active
  )
);

create policy "Users can remove coins from their watchlist"
on public.watchlist for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their alerts"
on public.alerts for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their alerts"
on public.alerts for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their alerts"
on public.alerts for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their alerts"
on public.alerts for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their notification history"
on public.notification_events for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.coins from anon, authenticated;
revoke all on table public.watchlist from anon, authenticated;
revoke all on table public.alerts from anon, authenticated;
revoke all on table public.prices from anon, authenticated;
revoke all on table public.notification_events from anon, authenticated;

grant select on table public.coins, public.prices to authenticated;
grant select, delete on table public.watchlist to authenticated;
grant insert (user_id, coin_id) on table public.watchlist to authenticated;
grant select, delete on table public.alerts to authenticated;
grant insert (user_id, watchlist_id, direction, threshold_usd, is_active)
  on table public.alerts to authenticated;
grant update (direction, threshold_usd, is_active)
  on table public.alerts to authenticated;
grant select on table public.notification_events to authenticated;

grant all on table public.coins, public.watchlist, public.alerts,
  public.prices, public.notification_events to service_role;
grant usage on type public.alert_direction, public.notification_status
  to authenticated, service_role;

revoke all on function public.search_coins(text) from public, anon;
grant execute on function public.search_coins(text) to authenticated, service_role;
revoke all on function public.finish_coin_sync(uuid) from public, anon, authenticated;
grant execute on function public.finish_coin_sync(uuid) to service_role;
