begin;

select plan(33);

select has_extension('pg_cron', 'pg_cron extension is enabled');
select has_extension('pg_net', 'pg_net extension is enabled');
select has_function(
  'public',
  'claim_notification_deliveries',
  array['integer', 'integer', 'timestamp with time zone'],
  'queue claim RPC exists'
);
select has_function(
  'public',
  'complete_notification_delivery',
  array['uuid', 'bigint', 'text', 'timestamp with time zone'],
  'delivery completion RPC exists'
);
select has_function(
  'public',
  'fail_notification_delivery',
  array['uuid', 'bigint', 'text', 'boolean', 'timestamp with time zone'],
  'delivery failure RPC exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.claim_notification_deliveries(integer,integer,timestamp with time zone)',
    'execute'
  ),
  'anonymous users cannot claim notification deliveries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_notification_deliveries(integer,integer,timestamp with time zone)',
    'execute'
  ),
  'authenticated users cannot claim notification deliveries'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_notification_deliveries(integer,integer,timestamp with time zone)',
    'execute'
  ),
  'service role can claim notification deliveries'
);
select is(
  (select count(*) from cron.job where jobname like 'cryptowatch-%'),
  3::bigint,
  'all three worker jobs are scheduled'
);
select is(
  (select schedule from cron.job where jobname = 'cryptowatch-check-prices'),
  '*/10 * * * *',
  'price checks run every ten minutes'
);
select is(
  (select schedule from cron.job where jobname = 'cryptowatch-send-notifications'),
  '* * * * *',
  'notification delivery runs every minute'
);
select is(
  (select schedule from cron.job where jobname = 'cryptowatch-sync-coins'),
  '17 3 * * *',
  'catalog synchronization runs daily'
);

select pgmq.purge_queue('notification_emails');

insert into auth.users (id, email)
values ('a5000000-0000-4000-8000-000000000001', 'delivery@example.test');

insert into public.coins (id, name, symbol)
values ('test-email-delivery', 'Test Delivery', 'ted');

insert into public.notification_events (
  id, user_id, source_alert_id, activation_version, coin_id, coin_name,
  coin_symbol, direction, threshold_usd, trigger_price_usd, recipient_email
)
values
  (
    'a5100000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    'a5200000-0000-4000-8000-000000000001',
    1, 'test-email-delivery', 'Test Delivery', 'ted', 'above', 10, 11,
    'delivery@example.test'
  ),
  (
    'a5100000-0000-4000-8000-000000000002',
    'a5000000-0000-4000-8000-000000000001',
    'a5200000-0000-4000-8000-000000000002',
    1, 'test-email-delivery', 'Test Delivery', 'ted', 'below', 10, 9,
    'delivery@example.test'
  ),
  (
    'a5100000-0000-4000-8000-000000000003',
    'a5000000-0000-4000-8000-000000000001',
    'a5200000-0000-4000-8000-000000000003',
    1, 'test-email-delivery', 'Test Delivery', 'ted', 'above', 10, 11,
    'delivery@example.test'
  ),
  (
    'a5100000-0000-4000-8000-000000000004',
    'a5000000-0000-4000-8000-000000000001',
    'a5200000-0000-4000-8000-000000000004',
    1, 'test-email-delivery', 'Test Delivery', 'ted', 'above', 10, 11,
    'delivery@example.test'
  ),
  (
    'a5100000-0000-4000-8000-000000000005',
    'a5000000-0000-4000-8000-000000000001',
    'a5200000-0000-4000-8000-000000000005',
    1, 'test-email-delivery', 'Test Delivery', 'ted', 'above', 10, 11,
    'delivery@example.test'
  );

create temporary table first_message as
select pgmq.send(
  'notification_emails',
  '{"event_id":"a5100000-0000-4000-8000-000000000001"}'::jsonb
) as message_id;

create temporary table first_claim as
select * from public.claim_notification_deliveries(
  1,
  120,
  '2026-09-10T12:00:00Z'
);

select is(
  (select event_id from first_claim),
  'a5100000-0000-4000-8000-000000000001'::uuid,
  'claim returns the immutable event payload'
);
select is(
  (select status from public.notification_events where id = 'a5100000-0000-4000-8000-000000000001'),
  'sending'::public.notification_status,
  'claim marks the event as sending'
);
select is(
  (select delivery_attempts from public.notification_events where id = 'a5100000-0000-4000-8000-000000000001'),
  1,
  'claim increments the delivery attempt'
);
select is(
  public.fail_notification_delivery(
    'a5100000-0000-4000-8000-000000000001',
    (select message_id from first_message),
    'temporary outage',
    true,
    '2026-09-10T12:01:00Z'
  ),
  'pending',
  'a transient failure remains pending'
);
select results_eq(
  $$select status::text, last_error from public.notification_events where id = 'a5100000-0000-4000-8000-000000000001'$$,
  $$values ('pending', 'temporary outage')$$,
  'retry state and error are persisted'
);

update pgmq.q_notification_emails
set vt = now() - interval '1 second'
where msg_id = (select message_id from first_message);

create temporary table second_claim as
select * from public.claim_notification_deliveries(
  1,
  120,
  '2026-09-10T12:02:00Z'
);

select is(
  (select delivery_attempt from second_claim),
  2,
  'a visible retry increments the attempt again'
);
select ok(
  public.complete_notification_delivery(
    'a5100000-0000-4000-8000-000000000001',
    (select message_id from first_message),
    'resend-email-one',
    '2026-09-10T12:02:05Z'
  ),
  'a successful delivery is completed'
);
select results_eq(
  $$select status::text, resend_email_id from public.notification_events where id = 'a5100000-0000-4000-8000-000000000001'$$,
  $$values ('sent', 'resend-email-one')$$,
  'provider ID and sent state are persisted'
);
select is(
  (select count(*) from pgmq.q_notification_emails where msg_id = (select message_id from first_message)),
  0::bigint,
  'completed message leaves the active queue'
);
select is(
  (select count(*) from pgmq.a_notification_emails where msg_id = (select message_id from first_message)),
  1::bigint,
  'completed message is archived'
);

create temporary table permanent_message as
select pgmq.send(
  'notification_emails',
  '{"event_id":"a5100000-0000-4000-8000-000000000002"}'::jsonb
) as message_id;
select * from public.claim_notification_deliveries(1, 120, '2026-09-10T12:03:00Z');
select is(
  public.fail_notification_delivery(
    'a5100000-0000-4000-8000-000000000002',
    (select message_id from permanent_message),
    'invalid sender',
    false,
    '2026-09-10T12:03:01Z'
  ),
  'failed',
  'a permanent provider error fails immediately'
);
select is(
  (select status from public.notification_events where id = 'a5100000-0000-4000-8000-000000000002'),
  'failed'::public.notification_status,
  'permanent failure is stored on the event'
);
select is(
  (select count(*) from pgmq.q_notification_emails where msg_id = (select message_id from permanent_message)),
  0::bigint,
  'permanently failed message is archived'
);

update public.notification_events
set delivery_attempts = 4,
    first_attempt_at = '2026-09-10T11:00:00Z'
where id = 'a5100000-0000-4000-8000-000000000003';
create temporary table last_attempt_message as
select pgmq.send(
  'notification_emails',
  '{"event_id":"a5100000-0000-4000-8000-000000000003"}'::jsonb
) as message_id;
create temporary table last_attempt_claim as
select * from public.claim_notification_deliveries(1, 120, '2026-09-10T12:04:00Z');
select is(
  (select delivery_attempt from last_attempt_claim),
  5,
  'the fifth delivery attempt can be claimed'
);
select is(
  public.fail_notification_delivery(
    'a5100000-0000-4000-8000-000000000003',
    (select message_id from last_attempt_message),
    'still unavailable',
    true,
    '2026-09-10T12:04:01Z'
  ),
  'failed',
  'the fifth failed attempt exhausts the retry budget'
);

update public.notification_events
set delivery_attempts = 1,
    first_attempt_at = '2026-09-09T12:00:00Z'
where id = 'a5100000-0000-4000-8000-000000000004';
select pgmq.send(
  'notification_emails',
  '{"event_id":"a5100000-0000-4000-8000-000000000004"}'::jsonb
);
select is(
  (select count(*) from public.claim_notification_deliveries(1, 120, '2026-09-10T12:00:01Z')),
  0::bigint,
  'an event outside the 23-hour retry window is not returned'
);
select is(
  (select status from public.notification_events where id = 'a5100000-0000-4000-8000-000000000004'),
  'failed'::public.notification_status,
  'an expired retry window marks the event failed'
);

select pgmq.send('notification_emails', '{"event_id":"not-a-uuid"}'::jsonb);
select is(
  (select count(*) from public.claim_notification_deliveries(1, 120, '2026-09-10T12:05:00Z')),
  0::bigint,
  'a malformed queue message is not returned'
);
select is(
  (select count(*) from pgmq.q_notification_emails where message ->> 'event_id' = 'not-a-uuid'),
  0::bigint,
  'a malformed queue message is archived'
);

update public.notification_events
set status = 'sent', sent_at = '2026-09-10T12:00:00Z'
where id = 'a5100000-0000-4000-8000-000000000005';
select pgmq.send(
  'notification_emails',
  '{"event_id":"a5100000-0000-4000-8000-000000000005"}'::jsonb
);
select is(
  (select count(*) from public.claim_notification_deliveries(1, 120, '2026-09-10T12:06:00Z')),
  0::bigint,
  'an already sent event is not returned again'
);
select is(
  (select count(*) from pgmq.q_notification_emails where message ->> 'event_id' = 'a5100000-0000-4000-8000-000000000005'),
  0::bigint,
  'an already sent event has its leftover queue message archived'
);

select * from finish();
rollback;
