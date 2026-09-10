import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
process.loadEnvFile?.('.env')
process.loadEnvFile?.('supabase/functions/.env')

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

function sqlLiteral(value) {
  if (value.includes('\0')) throw new Error('Hodnota nesmí obsahovat nulový znak.')
  return `'${value.replaceAll("'", "''")}'`
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

async function runEmailSmoke(recipientEmail) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const workerSecret = process.env.WORKER_SECRET
  if (!supabaseUrl || !workerSecret) {
    throw new Error('Chybí VITE_SUPABASE_URL v .env nebo WORKER_SECRET v supabase/functions/.env.')
  }
  if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) {
    throw new Error('Za --email zadej platnou adresu příjemce.')
  }

  const suffix = crypto.randomUUID()
  const smokeUserId = crypto.randomUUID()
  const eventId = crypto.randomUUID()
  const sourceAlertId = crypto.randomUUID()
  const smokeCoinId = `m5-email-${suffix}`

  async function cleanupEmailSmoke() {
    await sql(`
      delete from pgmq.q_notification_emails
      where message ->> 'event_id' = ${sqlLiteral(eventId)};
      delete from pgmq.a_notification_emails
      where message ->> 'event_id' = ${sqlLiteral(eventId)};
      delete from auth.users where id = ${sqlLiteral(smokeUserId)}::uuid;
      delete from public.coins where id = ${sqlLiteral(smokeCoinId)};
    `)
  }

  try {
    await sql(`
      insert into auth.users (id, email)
      values (${sqlLiteral(smokeUserId)}::uuid, ${sqlLiteral(recipientEmail)});
      insert into public.coins (id, name, symbol)
      values (${sqlLiteral(smokeCoinId)}, 'CryptoWatch Email Test', 'cwet');
      insert into public.notification_events (
        id, user_id, source_alert_id, activation_version, coin_id, coin_name,
        coin_symbol, direction, threshold_usd, trigger_price_usd, recipient_email
      ) values (
        ${sqlLiteral(eventId)}::uuid,
        ${sqlLiteral(smokeUserId)}::uuid,
        ${sqlLiteral(sourceAlertId)}::uuid,
        1,
        ${sqlLiteral(smokeCoinId)},
        'CryptoWatch Email Test',
        'cwet',
        'above',
        100,
        101,
        ${sqlLiteral(recipientEmail)}
      );
      select pgmq.send(
        'notification_emails',
        jsonb_build_object('event_id', ${sqlLiteral(eventId)})
      );
    `)

    const invoke = () => fetch(`${supabaseUrl}/functions/v1/send-notifications`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': workerSecret,
      },
      body: '{}',
    })

    const firstResponse = await invoke()
    const first = await firstResponse.json()
    assert(firstResponse.ok, `send-notifications selhalo: ${JSON.stringify(first)}`)
    assert(first.sent === 1, 'Worker nepotvrdil odeslání testovacího e-mailu.')

    const secondResponse = await invoke()
    const second = await secondResponse.json()
    assert(secondResponse.ok, `Opakované send-notifications selhalo: ${JSON.stringify(second)}`)
    assert(second.claimed === 0, 'Opakované spuštění znovu převzalo hotovou událost.')

    const state = JSON.parse(await sql(`
      select json_build_object(
        'status', status,
        'attempts', delivery_attempts,
        'provider_id', resend_email_id,
        'active_messages', (
          select count(*) from pgmq.q_notification_emails
          where message ->> 'event_id' = ${sqlLiteral(eventId)}
        )
      )
      from public.notification_events
      where id = ${sqlLiteral(eventId)}::uuid;
    `))
    assert(state.status === 'sent', 'Událost po odeslání není ve stavu sent.')
    assert(Number(state.attempts) === 1, 'Událost nemá právě jeden pokus o doručení.')
    assert(state.provider_id, 'Události chybí ID e-mailu od Resendu.')
    assert(Number(state.active_messages) === 0, 'Dokončená zpráva zůstala v aktivní frontě.')

    console.log(`Resend přijal jeden testovací e-mail pro ${recipientEmail}; opakované spuštění nic neodeslalo: OK`)
  } finally {
    await cleanupEmailSmoke()
  }
}

try {
  const emailIndex = process.argv.indexOf('--email')
  if (emailIndex >= 0) {
    await runEmailSmoke(process.argv[emailIndex + 1] ?? '')
  } else {
    await run()
  }
} finally {
  if (!process.argv.includes('--email')) await cleanup()
}
