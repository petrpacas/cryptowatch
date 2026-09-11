begin;

select plan(33);

select has_extension('pgmq', 'pgmq extension is enabled');
select has_function('public', 'get_watched_coin_ids', array[]::text[], 'watched coin RPC exists');
select has_function(
  'public',
  'process_price_batch',
  array['jsonb', 'timestamp with time zone'],
  'atomic price processing RPC exists'
);
select ok(
  to_regclass('pgmq.q_notification_emails') is not null,
  'notification email queue exists'
);
select ok(
  not has_schema_privilege('authenticated', 'pgmq', 'usage'),
  'authenticated users cannot access the private queue schema'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.process_price_batch(jsonb,timestamp with time zone)',
    'execute'
  ),
  'authenticated users cannot process backend price batches'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.process_price_batch(jsonb,timestamp with time zone)',
    'execute'
  ),
  'service role can process backend price batches'
);

select pgmq.purge_queue('notification_emails');

insert into auth.users (id, email)
values
  ('a4000000-0000-4000-8000-000000000001', 'alice-prices@example.test'),
  ('a4000000-0000-4000-8000-000000000002', 'bob-prices@example.test');

insert into public.coins (id, name, symbol, is_active)
values
  ('test-price-above', 'Test Above', 'tpa', true),
  ('test-price-below', 'Test Below', 'tpb', true),
  ('test-price-equal', 'Test Equal', 'tpe', true),
  ('test-price-stale', 'Test Stale', 'tps', true),
  ('test-price-missing-time', 'Test Missing Time', 'tpm', true),
  ('test-price-invalid', 'Test Invalid', 'tpi', true),
  ('test-price-inactive', 'Test Inactive', 'tpx', false)
on conflict (id) do update
set name = excluded.name,
    symbol = excluded.symbol,
    is_active = excluded.is_active;

insert into public.watchlist (id, user_id, coin_id)
values
  ('a4100000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'test-price-above'),
  ('a4100000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 'test-price-above'),
  ('a4100000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000001', 'test-price-below'),
  ('a4100000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000001', 'test-price-equal'),
  ('a4100000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000001', 'test-price-stale'),
  ('a4100000-0000-4000-8000-000000000006', 'a4000000-0000-4000-8000-000000000001', 'test-price-missing-time'),
  ('a4100000-0000-4000-8000-000000000007', 'a4000000-0000-4000-8000-000000000001', 'test-price-invalid'),
  ('a4100000-0000-4000-8000-000000000008', 'a4000000-0000-4000-8000-000000000001', 'test-price-inactive');

insert into public.alerts (id, user_id, watchlist_id, direction, threshold_usd)
values
  ('a4200000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000001', 'above', 100),
  ('a4200000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000003', 'below', 100),
  ('a4200000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000004', 'above', 100),
  ('a4200000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000005', 'above', 1),
  ('a4200000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000006', 'above', 1),
  ('a4200000-0000-4000-8000-000000000006', 'a4000000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000007', 'above', 1);

select results_eq(
  $$select public.get_watched_coin_ids() @> '["test-price-above", "test-price-below"]'::jsonb$$,
  $$values (true)$$,
  'watched coin RPC returns active watched IDs'
);
select is(
  (select count(*) from jsonb_array_elements_text(public.get_watched_coin_ids()) as id where id = 'test-price-above'),
  1::bigint,
  'a coin watched by two users is returned once'
);
select is(
  (select count(*) from jsonb_array_elements_text(public.get_watched_coin_ids()) as id where id = 'test-price-inactive'),
  0::bigint,
  'inactive catalog coins are not fetched'
);

create temporary table first_batch_result as
select * from public.process_price_batch(
  '[
    {"coin_id":"test-price-above","price_usd":101,"provider_updated_at":"2026-09-10T09:59:00Z"},
    {"coin_id":"test-price-below","price_usd":99,"provider_updated_at":"2026-09-10T09:59:00Z"},
    {"coin_id":"test-price-equal","price_usd":100,"provider_updated_at":"2026-09-10T09:59:00Z"},
    {"coin_id":"test-price-stale","price_usd":2,"provider_updated_at":"2026-09-10T09:43:59Z"},
    {"coin_id":"test-price-missing-time","price_usd":2,"provider_updated_at":null},
    {"coin_id":"test-price-invalid","price_usd":-1,"provider_updated_at":"2026-09-10T09:59:00Z"},
    {"coin_id":"does-not-exist","price_usd":12,"provider_updated_at":"2026-09-10T09:59:00Z"}
  ]'::jsonb,
  '2026-09-10T10:00:00Z'
);

select is((select prices_updated from first_batch_result), 5::bigint, 'only valid catalog prices are stored');
select is((select events_created from first_batch_result), 2::bigint, 'above and below conditions create events');
select is((select count(*) from public.notification_events where source_alert_id::text like 'a4200000%'), 2::bigint, 'two immutable events were persisted');
select is((select count(*) from pgmq.q_notification_emails), 2::bigint, 'each event was added to the queue');
select is(
  (select count(*) from pgmq.q_notification_emails as message join public.notification_events as event on event.id = (message.message ->> 'event_id')::uuid),
  2::bigint,
  'queue messages reference persisted notification events'
);
select is(
  (select trigger_price_usd from public.notification_events where source_alert_id = 'a4200000-0000-4000-8000-000000000001'),
  101::numeric,
  'event snapshots the triggering price'
);
select is(
  (select recipient_email from public.notification_events where source_alert_id = 'a4200000-0000-4000-8000-000000000001'),
  'alice-prices@example.test',
  'event snapshots the recipient email'
);
select is(
  (select count(*) from public.alerts where id in ('a4200000-0000-4000-8000-000000000001', 'a4200000-0000-4000-8000-000000000002') and is_active),
  0::bigint,
  'triggered alerts are deactivated'
);
select is((select is_active from public.alerts where id = 'a4200000-0000-4000-8000-000000000003'), true, 'a price equal to the threshold does not trigger');
select is((select is_active from public.alerts where id = 'a4200000-0000-4000-8000-000000000004'), true, 'a stale provider price does not trigger');
select is((select is_active from public.alerts where id = 'a4200000-0000-4000-8000-000000000005'), true, 'a missing provider timestamp does not trigger');
select is((select is_active from public.alerts where id = 'a4200000-0000-4000-8000-000000000006'), true, 'an invalid price does not trigger');

select is(
  (select events_created from public.process_price_batch(
    '[{"coin_id":"test-price-equal","price_usd":101,"provider_updated_at":"2026-09-10T10:04:00Z"}]'::jsonb,
    '2026-09-10T10:05:00Z'
  )),
  1::bigint,
  'an already satisfied active alert fires on the next check'
);

update public.alerts
set is_active = true
where id = 'a4200000-0000-4000-8000-000000000001';

select is(
  (select activation_version from public.alerts where id = 'a4200000-0000-4000-8000-000000000001'),
  2,
  'reactivation creates a new activation version'
);
select is(
  (select events_created from public.process_price_batch(
    '[{"coin_id":"test-price-above","price_usd":102,"provider_updated_at":"2026-09-10T10:09:00Z"}]'::jsonb,
    '2026-09-10T10:10:00Z'
  )),
  1::bigint,
  'the reactivated alert can create a new event'
);
select is(
  (select count(*) from public.notification_events where source_alert_id = 'a4200000-0000-4000-8000-000000000001'),
  2::bigint,
  'event uniqueness includes the activation version'
);
select is(
  (select events_created from public.process_price_batch(
    '[{"coin_id":"test-price-above","price_usd":103,"provider_updated_at":"2026-09-10T10:10:00Z"}]'::jsonb,
    '2026-09-10T10:11:00Z'
  )),
  0::bigint,
  'a completed activation does not create a duplicate event'
);

update public.alerts
set is_active = true, threshold_usd = 120
where id = 'a4200000-0000-4000-8000-000000000001';

select is(
  (select prices_updated from public.process_price_batch(
    '[{"coin_id":"test-price-above","price_usd":150,"provider_updated_at":"2026-09-10T09:59:00Z"}]'::jsonb,
    '2026-09-10T10:00:00Z'
  )),
  0::bigint,
  'an older fetch cannot overwrite a newer stored price'
);
select is(
  (select price_usd from public.prices where coin_id = 'test-price-above'),
  103::numeric,
  'the newest fetched price remains stored'
);
select is(
  (select is_active from public.alerts where id = 'a4200000-0000-4000-8000-000000000001'),
  true,
  'an ignored older fetch cannot trigger an alert'
);

select throws_ok(
  $$select public.process_price_batch('{}'::jsonb, now())$$,
  'P0001',
  'p_prices must be a JSON array',
  'price processing rejects a non-array payload'
);
select throws_ok(
  $$select public.process_price_batch('[]'::jsonb, null)$$,
  'P0001',
  'p_fetched_at must not be null',
  'price processing requires a fetch timestamp'
);

select is(
  (select count(*) from public.notification_events where status = 'pending' and source_alert_id::text like 'a4200000%'),
  4::bigint,
  'new events remain pending for the email worker'
);

select * from finish();
rollback;
