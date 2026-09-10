begin;

select plan(23);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.test');

update public.coins set is_active = false;

insert into public.coins (id, name, symbol, is_active)
values
  ('bitcoin', 'Bitcoin', 'btc', true),
  ('ethereum', 'Ethereum', 'eth', true),
  ('inactive-coin', 'Inactive Coin', 'old', false)
on conflict (id) do update
set name = excluded.name,
    symbol = excluded.symbol,
    is_active = excluded.is_active;

insert into public.prices (coin_id, price_usd)
values ('bitcoin', 100000)
on conflict (coin_id) do update set price_usd = excluded.price_usd;

insert into public.watchlist (id, user_id, coin_id)
values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bitcoin'),
  ('11111111-1111-4111-8111-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ethereum');

insert into public.alerts (id, user_id, watchlist_id, direction, threshold_usd)
values
  ('22222222-2222-4222-8222-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'above', 110000),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-222222222222', 'below', 2000);

insert into public.notification_events (
  user_id, alert_id, source_alert_id, activation_version, coin_id,
  coin_name, coin_symbol, direction, threshold_usd, trigger_price_usd,
  recipient_email
)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-111111111111', '22222222-2222-4222-8222-111111111111', 1, 'bitcoin', 'Bitcoin', 'btc', 'above', 110000, 111000, 'alice@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 1, 'ethereum', 'Ethereum', 'eth', 'below', 2000, 1900, 'bob@example.test');

set local role anon;
select throws_ok(
  $$select count(*) from public.coins$$,
  '42501',
  null,
  'anonymous users cannot read the catalog'
);
select ok(
  not has_function_privilege('anon', 'public.search_coins(text)', 'execute'),
  'anonymous users cannot call catalog search'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.coins where id in ('bitcoin', 'ethereum', 'inactive-coin')),
  3::bigint,
  'authenticated users can read coins'
);
select is(
  (select count(*) from public.prices where coin_id = 'bitcoin'),
  1::bigint,
  'authenticated users can read prices'
);
select is((select count(*) from public.watchlist), 1::bigint, 'a user sees only their watchlist');
select is((select count(*) from public.alerts), 1::bigint, 'a user sees only their alerts');
select is((select count(*) from public.notification_events), 1::bigint, 'a user sees only their notification history');

select lives_ok(
  $$insert into public.watchlist (user_id, coin_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ethereum')$$,
  'a user can add an active coin to their own watchlist'
);
select throws_ok(
  $$insert into public.watchlist (user_id, coin_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bitcoin')$$,
  '42501',
  null,
  'a user cannot spoof watchlist ownership'
);
select throws_ok(
  $$insert into public.watchlist (user_id, coin_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inactive-coin')$$,
  '42501',
  null,
  'a user cannot add an inactive catalog entry'
);
select throws_ok(
  $$insert into public.alerts (user_id, watchlist_id, direction, threshold_usd) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-222222222222', 'above', 10)$$,
  '23503',
  null,
  'ownership is checked across alerts and watchlist rows'
);
select throws_ok(
  $$update public.coins set name = 'Changed' where id = 'bitcoin'$$,
  '42501',
  null,
  'authenticated users cannot write catalog rows'
);
select throws_ok(
  $$insert into public.notification_events (user_id, source_alert_id, activation_version, coin_id, coin_name, coin_symbol, direction, threshold_usd, trigger_price_usd, recipient_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(), 1, 'bitcoin', 'Bitcoin', 'btc', 'above', 1, 2, 'alice@example.test')$$,
  '42501',
  null,
  'authenticated users cannot create notification events'
);
select lives_ok(
  $$delete from public.watchlist where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$,
  'attempting to delete another user watchlist row is safely filtered'
);
select throws_ok(
  $$update public.alerts set activation_version = 99 where id = '22222222-2222-4222-8222-111111111111'$$,
  '42501',
  null,
  'a user cannot overwrite the activation version'
);
select lives_ok(
  $$update public.alerts set threshold_usd = 120000 where id = '22222222-2222-4222-8222-111111111111'$$,
  'a user can update their own alert condition'
);
select is(
  (select activation_version from public.alerts where id = '22222222-2222-4222-8222-111111111111'),
  2,
  'the database advances activation version after an allowed update'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',
  true
);
select is((select count(*) from public.watchlist), 1::bigint, 'the second user sees only their watchlist');
select is((select count(*) from public.alerts), 1::bigint, 'the second user sees only their alerts');
select is((select count(*) from public.notification_events), 1::bigint, 'the second user sees only their notification history');

reset role;
select ok(
  has_function_privilege('service_role', 'public.finish_coin_sync(uuid)', 'execute'),
  'service role can finalize catalog synchronization'
);
select ok(
  not has_function_privilege('authenticated', 'public.finish_coin_sync(uuid)', 'execute'),
  'authenticated users cannot finalize catalog synchronization'
);
select ok(
  not has_table_privilege('authenticated', 'public.prices', 'insert'),
  'authenticated users cannot insert prices'
);

select * from finish();
rollback;
