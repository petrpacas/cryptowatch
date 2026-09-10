import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const container = 'supabase_db_cryptowatch'
const userId = 'b4000000-0000-4000-8000-000000000001'
const watchlistId = 'b4100000-0000-4000-8000-000000000001'
const alertId = 'b4200000-0000-4000-8000-000000000001'
const coinId = 'm4-concurrent'
const fetchedAt = '2026-09-10T12:00:00Z'
const pricePayload = JSON.stringify([
  {
    coin_id: coinId,
    price_usd: 11,
    provider_updated_at: '2026-09-10T11:59:00Z',
  },
])

async function sql(statement) {
  const { stdout } = await execFile('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-t',
    '-A',
    '-c',
    statement,
  ])
  return stdout.trim()
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function cleanup() {
  await sql(`
    select pgmq.purge_queue('notification_emails');
    delete from auth.users where id = '${userId}';
    delete from public.coins where id = '${coinId}';
  `)
}

async function run() {
  await cleanup()
  await sql(`
    insert into auth.users (id, email)
    values ('${userId}', 'concurrent@example.test');

    insert into public.coins (id, name, symbol)
    values ('${coinId}', 'Concurrent Coin', 'm4c');

    insert into public.watchlist (id, user_id, coin_id)
    values ('${watchlistId}', '${userId}', '${coinId}');

    insert into public.alerts (
      id, user_id, watchlist_id, direction, threshold_usd
    ) values (
      '${alertId}', '${userId}', '${watchlistId}', 'above', 10
    );
  `)

  const invocation = `
    select row_to_json(result)
    from public.process_price_batch(
      '${pricePayload}'::jsonb,
      '${fetchedAt}'::timestamptz
    ) as result;
  `
  const results = await Promise.all([sql(invocation), sql(invocation)])
  const summaries = results.map((result) => JSON.parse(result))
  const createdByWorkers = summaries.reduce(
    (total, result) => total + Number(result.events_created),
    0,
  )

  const state = JSON.parse(await sql(`
    select json_build_object(
      'events', (
        select count(*)
        from public.notification_events
        where source_alert_id = '${alertId}'
      ),
      'queue_messages', (
        select count(*)
        from pgmq.q_notification_emails
        where message ->> 'event_id' in (
          select id::text
          from public.notification_events
          where source_alert_id = '${alertId}'
        )
      ),
      'alert_active', (
        select is_active from public.alerts where id = '${alertId}'
      )
    );
  `))

  assert(createdByWorkers === 1, 'Souběžné workery dohromady nevytvořily právě jednu událost.')
  assert(Number(state.events) === 1, 'Databáze neobsahuje právě jednu událost aktivace.')
  assert(Number(state.queue_messages) === 1, 'Fronta neobsahuje právě jednu zprávu události.')
  assert(state.alert_active === false, 'Spuštěný alert nebyl deaktivován.')

  console.log('Dvě souběžné kontroly vytvořily jednu událost, jednu zprávu a deaktivovaly alert: OK')
}

try {
  await run()
} finally {
  await cleanup()
}
