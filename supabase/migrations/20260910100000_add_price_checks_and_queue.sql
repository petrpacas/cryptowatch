create extension if not exists pgmq;

do $$
begin
  if to_regclass('pgmq.q_notification_emails') is null then
    perform pgmq.create('notification_emails');
  end if;
end;
$$;

revoke all on schema pgmq from public, anon, authenticated;

create index alerts_active_watchlist_idx
  on public.alerts (watchlist_id)
  where is_active;

create function public.get_watched_coin_ids()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(watched.coin_id order by watched.coin_id), '[]'::jsonb)
  from (
    select distinct watchlist.coin_id
    from public.watchlist
    join public.coins on coins.id = watchlist.coin_id
    where coins.is_active
  ) as watched;
$$;

comment on function public.get_watched_coin_ids() is
  'Returns each active watched CoinGecko ID once for the internal price worker.';

create function public.process_price_batch(
  p_prices jsonb,
  p_fetched_at timestamptz
)
returns table (prices_updated bigint, events_created bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  price_count bigint := 0;
  event_count bigint := 0;
  matched_alert record;
  inserted_event_id uuid;
begin
  if jsonb_typeof(p_prices) is distinct from 'array' then
    raise exception 'p_prices must be a JSON array';
  end if;

  if p_fetched_at is null then
    raise exception 'p_fetched_at must not be null';
  end if;

  with parsed_prices as (
    select distinct on (incoming.coin_id)
      incoming.coin_id,
      incoming.price_usd,
      incoming.provider_updated_at
    from jsonb_to_recordset(p_prices) as incoming(
      coin_id text,
      price_usd numeric,
      provider_updated_at timestamptz
    )
    where incoming.coin_id is not null
      and btrim(incoming.coin_id) <> ''
      and incoming.price_usd > 0
    order by incoming.coin_id, incoming.provider_updated_at desc nulls last
  )
  insert into public.prices as stored_price (
    coin_id,
    price_usd,
    provider_updated_at,
    fetched_at
  )
  select
    parsed_price.coin_id,
    parsed_price.price_usd,
    parsed_price.provider_updated_at,
    p_fetched_at
  from parsed_prices as parsed_price
  join public.coins as coin on coin.id = parsed_price.coin_id
  on conflict (coin_id) do update
  set price_usd = excluded.price_usd,
      provider_updated_at = excluded.provider_updated_at,
      fetched_at = excluded.fetched_at
  where stored_price.fetched_at <= excluded.fetched_at;

  get diagnostics price_count = row_count;

  for matched_alert in
    with parsed_prices as (
      select distinct on (incoming.coin_id)
        incoming.coin_id,
        incoming.price_usd,
        incoming.provider_updated_at
      from jsonb_to_recordset(p_prices) as incoming(
        coin_id text,
        price_usd numeric,
        provider_updated_at timestamptz
      )
      where incoming.coin_id is not null
        and btrim(incoming.coin_id) <> ''
        and incoming.price_usd > 0
      order by incoming.coin_id, incoming.provider_updated_at desc nulls last
    )
    select
      alert.id,
      alert.user_id,
      alert.activation_version,
      alert.direction,
      alert.threshold_usd,
      watchlist.coin_id,
      coin.name as coin_name,
      coin.symbol as coin_symbol,
      parsed_price.price_usd,
      app_user.email as recipient_email
    from public.alerts as alert
    join public.watchlist as watchlist on watchlist.id = alert.watchlist_id
    join parsed_prices as parsed_price on parsed_price.coin_id = watchlist.coin_id
    join public.prices as stored_price
      on stored_price.coin_id = parsed_price.coin_id
      and stored_price.price_usd = parsed_price.price_usd
      and stored_price.provider_updated_at is not distinct from parsed_price.provider_updated_at
      and stored_price.fetched_at = p_fetched_at
    join public.coins as coin on coin.id = watchlist.coin_id
    join auth.users as app_user on app_user.id = alert.user_id
    where alert.is_active
      and parsed_price.provider_updated_at is not null
      and parsed_price.provider_updated_at >= p_fetched_at - interval '15 minutes'
      and app_user.email is not null
      and btrim(app_user.email) <> ''
      and (
        (alert.direction = 'above' and parsed_price.price_usd > alert.threshold_usd)
        or (alert.direction = 'below' and parsed_price.price_usd < alert.threshold_usd)
      )
    order by alert.id
    for update of alert skip locked
  loop
    inserted_event_id := null;

    insert into public.notification_events (
      user_id,
      alert_id,
      source_alert_id,
      activation_version,
      coin_id,
      coin_name,
      coin_symbol,
      direction,
      threshold_usd,
      trigger_price_usd,
      recipient_email
    )
    values (
      matched_alert.user_id,
      matched_alert.id,
      matched_alert.id,
      matched_alert.activation_version,
      matched_alert.coin_id,
      matched_alert.coin_name,
      matched_alert.coin_symbol,
      matched_alert.direction,
      matched_alert.threshold_usd,
      matched_alert.price_usd,
      matched_alert.recipient_email
    )
    on conflict (source_alert_id, activation_version) do nothing
    returning id into inserted_event_id;

    if inserted_event_id is not null then
      perform pgmq.send(
        'notification_emails',
        jsonb_build_object('event_id', inserted_event_id)
      );

      event_count := event_count + 1;
    end if;

    update public.alerts
    set is_active = false
    where id = matched_alert.id
      and activation_version = matched_alert.activation_version;
  end loop;

  return query select price_count, event_count;
end;
$$;

comment on function public.process_price_batch(jsonb, timestamptz) is
  'Atomically stores a fetched price batch, creates one event per alert activation, enqueues it, and deactivates fired alerts.';

revoke all on function public.get_watched_coin_ids() from public, anon, authenticated;
revoke all on function public.process_price_batch(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.get_watched_coin_ids() to service_role;
grant execute on function public.process_price_batch(jsonb, timestamptz) to service_role;
