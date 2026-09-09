begin;

select plan(29);

select has_table('public', 'coins', 'coins table exists');
select has_table('public', 'watchlist', 'watchlist table exists');
select has_table('public', 'alerts', 'alerts table exists');
select has_table('public', 'prices', 'prices table exists');
select has_table('public', 'notification_events', 'notification_events table exists');

select ok((select relrowsecurity from pg_class where oid = 'public.coins'::regclass), 'coins has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.watchlist'::regclass), 'watchlist has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.alerts'::regclass), 'alerts has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.prices'::regclass), 'prices has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.notification_events'::regclass), 'notification_events has RLS enabled');

select has_function('public', 'search_coins', array['text'], 'search_coins RPC exists');
select has_function('public', 'finish_coin_sync', array['uuid'], 'finish_coin_sync RPC exists');
select has_type('public', 'alert_direction', 'alert_direction enum exists');
select has_type('public', 'notification_status', 'notification_status enum exists');

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ada@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.test');

update public.coins set is_active = false;

insert into public.coins (id, name, symbol, is_active)
values
  ('cardano', 'Cardano', 'ada', true),
  ('another-ada', 'Ada Token', 'ada', true),
  ('bitcoin', 'Bitcoin', 'btc', false),
  ('chainlink', 'Chainlink', 'link', true)
on conflict (id) do update
set name = excluded.name,
    symbol = excluded.symbol,
    is_active = excluded.is_active;

insert into public.coins (id, name, symbol, is_active)
select 'query-coin-' || number, 'Query Coin ' || number, 'q' || number, true
from generate_series(1, 25) as number
on conflict (id) do update
set name = excluded.name,
    symbol = excluded.symbol,
    is_active = excluded.is_active;

insert into public.watchlist (id, user_id, coin_id)
values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cardano'),
  ('11111111-1111-4111-8111-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'chainlink');

insert into public.alerts (id, user_id, watchlist_id, direction, threshold_usd)
values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'above',
  2
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',
  true
);

select results_eq(
  $$select id, is_watched from public.search_coins('ADA')$$,
  $$values ('cardano'::text, true), ('another-ada'::text, false)$$,
  'symbol search handles duplicates and exact matches first'
);

select results_eq(
  $$select id from public.search_coins('card')$$,
  $$values ('cardano'::text)$$,
  'name search is case insensitive'
);

select results_eq(
  $$select id from public.search_coins('ANOTHER-ADA')$$,
  $$values ('another-ada'::text)$$,
  'CoinGecko id search is case insensitive'
);

select is((select count(*) from public.search_coins('   ')), 0::bigint, 'blank query returns no rows');
select is((select count(*) from public.search_coins('bitcoin')), 0::bigint, 'inactive coins are excluded');
select is((select count(*) from public.search_coins('query coin')), 20::bigint, 'search is limited to 20 rows');

select throws_ok(
  $$insert into public.watchlist (user_id, coin_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cardano')$$,
  '23505',
  null,
  'a coin cannot be added to one watchlist twice'
);

select throws_ok(
  $$insert into public.alerts (user_id, watchlist_id, direction, threshold_usd) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'above', 0)$$,
  '23514',
  null,
  'alert threshold must be positive'
);

select throws_ok(
  $$insert into public.alerts (user_id, watchlist_id, direction, threshold_usd) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-222222222222', 'above', 10)$$,
  '23503',
  null,
  'an alert must reference a watchlist row owned by the same user'
);

update public.alerts
set threshold_usd = 3
where id = '22222222-2222-4222-8222-222222222222';

select is(
  (select activation_version from public.alerts where id = '22222222-2222-4222-8222-222222222222'),
  2,
  'changing an alert condition increments its activation version'
);

reset role;

insert into public.notification_events (
  id,
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
  '33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  2,
  'cardano',
  'Cardano',
  'ada',
  'above',
  3,
  3.25,
  'ada@example.test'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',
  true
);

delete from public.watchlist
where id = '11111111-1111-4111-8111-111111111111';

reset role;

select is(
  (select count(*) from public.alerts where id = '22222222-2222-4222-8222-222222222222'),
  0::bigint,
  'deleting a watchlist row cascades to its alerts'
);
select is(
  (select count(*) from public.notification_events where id = '33333333-3333-4333-8333-333333333333'),
  1::bigint,
  'notification history survives alert deletion'
);
select is(
  (select alert_id is null from public.notification_events where id = '33333333-3333-4333-8333-333333333333'),
  true,
  'persisted notification history releases the deleted alert reference'
);

update public.coins
set last_seen_sync_id = '44444444-4444-4444-8444-444444444444', is_active = true
where id = 'cardano';
update public.coins
set last_seen_sync_id = '55555555-5555-4555-8555-555555555555', is_active = true
where id = 'another-ada';

select is(
  (select deactivated_count from public.finish_coin_sync('44444444-4444-4444-8444-444444444444')),
  27::bigint,
  'finishing a successful sync deactivates unseen active coins'
);
select results_eq(
  $$select id, is_active from public.coins where id in ('cardano', 'another-ada') order by id$$,
  $$values ('another-ada'::text, false), ('cardano'::text, true)$$,
  'the current sync remains active while older rows become inactive'
);

select * from finish();
rollback;
