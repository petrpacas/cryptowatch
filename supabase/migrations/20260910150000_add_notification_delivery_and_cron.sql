create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create index notification_events_delivery_idx
  on public.notification_events (status, created_at)
  where status in ('pending', 'sending');

create function public.claim_notification_deliveries(
  p_limit integer default 5,
  p_visibility_seconds integer default 120,
  p_now timestamptz default now()
)
returns table (
  message_id bigint,
  event_id uuid,
  recipient_email text,
  coin_name text,
  coin_symbol text,
  direction public.alert_direction,
  threshold_usd text,
  trigger_price_usd text,
  delivery_attempt integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued_message pgmq.message_record;
  queued_event public.notification_events%rowtype;
  parsed_event_id uuid;
begin
  if p_now is null then
    raise exception 'p_now must not be null';
  end if;

  for queued_message in
    select *
    from pgmq.read(
      'notification_emails',
      greatest(1, least(coalesce(p_visibility_seconds, 120), 3600)),
      greatest(1, least(coalesce(p_limit, 5), 5))
    )
  loop
    parsed_event_id := null;

    begin
      parsed_event_id := (queued_message.message ->> 'event_id')::uuid;
    exception when invalid_text_representation then
      parsed_event_id := null;
    end;

    if parsed_event_id is null then
      perform pgmq.archive('notification_emails', queued_message.msg_id);
      continue;
    end if;

    select *
    into queued_event
    from public.notification_events
    where id = parsed_event_id
    for update;

    if not found then
      perform pgmq.archive('notification_emails', queued_message.msg_id);
      continue;
    end if;

    if queued_event.status in ('sent', 'failed') then
      perform pgmq.archive('notification_emails', queued_message.msg_id);
      continue;
    end if;

    if queued_event.delivery_attempts >= 5
      or (
        queued_event.first_attempt_at is not null
        and queued_event.first_attempt_at <= p_now - interval '23 hours'
      )
    then
      update public.notification_events
      set status = 'failed',
          last_error = coalesce(
            last_error,
            'Retry window or maximum delivery attempts exhausted'
          )
      where id = queued_event.id;

      perform pgmq.archive('notification_emails', queued_message.msg_id);
      continue;
    end if;

    update public.notification_events
    set status = 'sending',
        delivery_attempts = delivery_attempts + 1,
        first_attempt_at = coalesce(first_attempt_at, p_now)
    where id = queued_event.id
    returning
      queued_message.msg_id,
      id,
      public.notification_events.recipient_email,
      public.notification_events.coin_name,
      public.notification_events.coin_symbol,
      public.notification_events.direction,
      public.notification_events.threshold_usd::text,
      public.notification_events.trigger_price_usd::text,
      public.notification_events.delivery_attempts
    into
      message_id,
      event_id,
      recipient_email,
      coin_name,
      coin_symbol,
      direction,
      threshold_usd,
      trigger_price_usd,
      delivery_attempt;

    return next;
  end loop;
end;
$$;

comment on function public.claim_notification_deliveries(integer, integer, timestamptz) is
  'Claims up to five queued emails, expires exhausted events, and returns immutable delivery payloads.';

create function public.complete_notification_delivery(
  p_event_id uuid,
  p_message_id bigint,
  p_resend_email_id text,
  p_sent_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  archived boolean;
begin
  if p_event_id is null or p_message_id is null
    or p_resend_email_id is null or btrim(p_resend_email_id) = ''
    or p_sent_at is null
  then
    raise exception 'A delivery result must include its event, message, provider ID, and timestamp';
  end if;

  if not exists (
    select 1
    from pgmq.q_notification_emails
    where msg_id = p_message_id
      and message ->> 'event_id' = p_event_id::text
  ) then
    return false;
  end if;

  update public.notification_events
  set status = 'sent',
      sent_at = coalesce(sent_at, p_sent_at),
      resend_email_id = coalesce(resend_email_id, p_resend_email_id),
      last_error = null
  where id = p_event_id
    and status in ('pending', 'sending', 'sent');

  if not found then
    return false;
  end if;

  select pgmq.archive('notification_emails', p_message_id) into archived;
  return coalesce(archived, false);
end;
$$;

comment on function public.complete_notification_delivery(uuid, bigint, text, timestamptz) is
  'Marks a Resend delivery successful and archives its queue message.';

create function public.fail_notification_delivery(
  p_event_id uuid,
  p_message_id bigint,
  p_error text,
  p_retryable boolean,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_event public.notification_events%rowtype;
  next_status public.notification_status;
begin
  if p_event_id is null or p_message_id is null or p_now is null then
    raise exception 'A delivery failure must include its event, message, and timestamp';
  end if;

  select *
  into delivery_event
  from public.notification_events
  where id = p_event_id
  for update;

  if not found then
    perform pgmq.archive('notification_emails', p_message_id);
    return 'missing';
  end if;

  if delivery_event.status = 'sent' then
    perform pgmq.archive('notification_emails', p_message_id);
    return 'sent';
  end if;

  next_status := case
    when coalesce(p_retryable, false)
      and delivery_event.delivery_attempts < 5
      and delivery_event.first_attempt_at > p_now - interval '23 hours'
      then 'pending'::public.notification_status
    else 'failed'::public.notification_status
  end;

  update public.notification_events
  set status = next_status,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'Unknown delivery error'), 2000)
  where id = p_event_id;

  if next_status = 'failed' then
    perform pgmq.archive('notification_emails', p_message_id);
  end if;

  return next_status::text;
end;
$$;

comment on function public.fail_notification_delivery(uuid, bigint, text, boolean, timestamptz) is
  'Records a delivery error, leaving retryable work queued only within the retry budget.';

revoke all on function public.claim_notification_deliveries(integer, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid, bigint, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fail_notification_delivery(uuid, bigint, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer, integer, timestamptz)
  to service_role;
grant execute on function public.complete_notification_delivery(uuid, bigint, text, timestamptz)
  to service_role;
grant execute on function public.fail_notification_delivery(uuid, bigint, text, boolean, timestamptz)
  to service_role;

create function private.configure_cryptowatch_workers(
  p_functions_url text,
  p_worker_secret text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  functions_url_id uuid;
  worker_secret_id uuid;
begin
  if p_functions_url is null or btrim(p_functions_url) = ''
    or p_worker_secret is null or char_length(p_worker_secret) < 24
  then
    raise exception 'A functions URL and worker secret of at least 24 characters are required';
  end if;

  select id into functions_url_id
  from vault.decrypted_secrets
  where name = 'cryptowatch_functions_url';

  if functions_url_id is null then
    perform vault.create_secret(
      rtrim(p_functions_url, '/'),
      'cryptowatch_functions_url',
      'Base URL used by CryptoWatch cron jobs'
    );
  else
    perform vault.update_secret(
      functions_url_id,
      rtrim(p_functions_url, '/'),
      'cryptowatch_functions_url',
      'Base URL used by CryptoWatch cron jobs'
    );
  end if;

  select id into worker_secret_id
  from vault.decrypted_secrets
  where name = 'cryptowatch_worker_secret';

  if worker_secret_id is null then
    perform vault.create_secret(
      p_worker_secret,
      'cryptowatch_worker_secret',
      'Shared secret used only by CryptoWatch internal workers'
    );
  else
    perform vault.update_secret(
      worker_secret_id,
      p_worker_secret,
      'cryptowatch_worker_secret',
      'Shared secret used only by CryptoWatch internal workers'
    );
  end if;
end;
$$;

revoke all on function private.configure_cryptowatch_workers(text, text) from public;

create function private.invoke_cryptowatch_worker(p_function_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  functions_url text;
  worker_secret text;
  request_id bigint;
begin
  if p_function_name not in ('sync-coins', 'check-prices', 'send-notifications') then
    raise exception 'Unknown CryptoWatch worker';
  end if;

  select decrypted_secret into functions_url
  from vault.decrypted_secrets
  where name = 'cryptowatch_functions_url';

  select decrypted_secret into worker_secret
  from vault.decrypted_secrets
  where name = 'cryptowatch_worker_secret';

  if functions_url is null or worker_secret is null then
    raise warning 'CryptoWatch worker Vault secrets are not configured';
    return null;
  end if;

  select net.http_post(
    url := functions_url || '/' || p_function_name,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-worker-secret', worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_cryptowatch_worker(text) from public;

select cron.schedule(
  'cryptowatch-check-prices',
  '*/10 * * * *',
  $$select private.invoke_cryptowatch_worker('check-prices');$$
);

select cron.schedule(
  'cryptowatch-send-notifications',
  '* * * * *',
  $$select private.invoke_cryptowatch_worker('send-notifications');$$
);

select cron.schedule(
  'cryptowatch-sync-coins',
  '17 3 * * *',
  $$select private.invoke_cryptowatch_worker('sync-coins');$$
);
