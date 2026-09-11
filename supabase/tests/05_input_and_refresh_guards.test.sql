begin;
select plan(9);

insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-000000000001', 'guards-one@example.test'),
  ('c1000000-0000-4000-8000-000000000002', 'guards-two@example.test');
insert into public.coins (id, name, symbol) values ('test-guards', 'Guard Coin', 'guard');
insert into public.watchlist (id, user_id, coin_id) values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'test-guards');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.alerts (user_id, watchlist_id, direction, threshold_usd)
    values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'below', 'NaN')$$,
  '23514', null, 'NaN cannot bypass positive threshold validation'
);
select throws_ok(
  $$insert into public.alerts (user_id, watchlist_id, direction, threshold_usd)
    values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'below', 'Infinity')$$,
  '23514', null, 'infinite thresholds are rejected'
);
select throws_ok(
  $$select public.claim_price_refresh('c1000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'clients cannot claim refresh slots directly'
);
select throws_ok(
  $$delete from private.price_refresh_requests$$,
  '42501', null, 'clients cannot clear cooldowns'
);
reset role;

select ok(not has_function_privilege('anon', 'public.claim_price_refresh(uuid)', 'execute'), 'anonymous clients cannot claim refresh slots');
set local role service_role;
select ok(public.claim_price_refresh('c1000000-0000-4000-8000-000000000001'), 'first refresh is allowed');
select ok(not public.claim_price_refresh('c1000000-0000-4000-8000-000000000001'), 'immediate repeat is denied');
select ok(public.claim_price_refresh('c1000000-0000-4000-8000-000000000002'), 'cooldown belongs to one user');
reset role;
update private.price_refresh_requests set requested_at = now() - interval '61 seconds';
set local role service_role;
select ok(public.claim_price_refresh('c1000000-0000-4000-8000-000000000001'), 'refresh is allowed after cooldown');
reset role;
select * from finish();
rollback;
