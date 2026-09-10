import { createClient } from '@supabase/supabase-js'

process.loadEnvFile?.('.env')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const email = 'manual-refresh@example.test'
const mailpitUrl = 'http://127.0.0.1:54324'

if (!supabaseUrl || !publishableKey) {
  throw new Error('Chybí VITE_SUPABASE_URL nebo VITE_SUPABASE_PUBLISHABLE_KEY v .env.')
}

const supabase = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function getLatestMagicLink() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const listResponse = await fetch(`${mailpitUrl}/api/v1/messages`)
    const list = await listResponse.json()
    const message = list.messages?.find((item) =>
      item.To?.some((recipient) => recipient.Address === email),
    )

    if (message) {
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`)
      const detail = await detailResponse.json()
      const content = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`
      const match = content.match(/https?:\/\/[^"'<>\s]+\/auth\/v1\/verify\?[^"'<>\s]+/)
      if (match) return match[0].replaceAll('&amp;', '&')
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error('Mailpit neobsahuje nový magic link.')
}

async function signIn() {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: 'http://localhost:5173/', shouldCreateUser: true },
  })
  if (error) throw error

  const verifyResponse = await fetch(await getLatestMagicLink(), { redirect: 'manual' })
  const location = verifyResponse.headers.get('location')
  assert(location, 'Magic link nevrátil přihlašovací redirect.')

  const fragment = new URLSearchParams(new URL(location).hash.slice(1))
  const accessToken = fragment.get('access_token')
  const refreshToken = fragment.get('refresh_token')
  assert(accessToken && refreshToken, 'Přihlašovací redirect neobsahuje tokeny.')

  const { data, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (sessionError) throw sessionError
  assert(data.session, 'Testovací uživatel se nepřihlásil.')
  return data.session
}

async function run() {
  const preflight = await fetch(`${supabaseUrl}/functions/v1/refresh-prices`, {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:5173' },
  })
  assert(preflight.status === 204, 'CORS preflight nevrátil 204.')
  assert(
    preflight.headers.get('access-control-allow-origin') === '*',
    'CORS preflight nevrátil očekávanou hlavičku.',
  )

  const unauthenticated = await fetch(`${supabaseUrl}/functions/v1/refresh-prices`, {
    method: 'POST',
    headers: { apikey: publishableKey },
  })
  assert(unauthenticated.status === 401, 'Funkce bez uživatelské relace nevrátila 401.')

  let watchedId

  try {
    const session = await signIn()
    const { data: searchResults, error: searchError } = await supabase.rpc('search_coins', {
      search_query: 'bitcoin',
    })
    if (searchError) throw searchError
    assert(searchResults?.[0]?.id === 'bitcoin', 'Bitcoin není dostupný v katalogu.')

    await supabase.from('watchlist').delete().eq('coin_id', 'bitcoin')
    const { data: watched, error: watchError } = await supabase
      .from('watchlist')
      .insert({ user_id: session.user.id, coin_id: 'bitcoin' })
      .select('id')
      .single()
    if (watchError) throw watchError
    watchedId = watched.id

    const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/refresh-prices`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
    const data = await refreshResponse.json()
    assert(refreshResponse.ok, `refresh-prices selhalo: ${JSON.stringify(data)}`)

    assert(data.watchedCoins === 1, 'Funkce nenačetla právě jednu sledovanou měnu uživatele.')
    assert(data.pricesUpdated === 1, 'Funkce neaktualizovala cenu Bitcoinu.')

    const { data: loaded, error: loadError } = await supabase
      .from('watchlist')
      .select('coins!watchlist_coin_id_fkey(prices(price_usd, provider_updated_at))')
      .eq('id', watched.id)
      .single()
    if (loadError) throw loadError

    const coin = Array.isArray(loaded.coins) ? loaded.coins[0] : loaded.coins
    const price = Array.isArray(coin?.prices) ? coin.prices[0] : coin?.prices
    assert(Number(price?.price_usd) > 0, 'Watchlist po refreshi neobsahuje platnou cenu.')

    console.log('Autentizovaný ruční refresh načetl a uložil aktuální cenu Bitcoinu: OK')
  } finally {
    if (watchedId) await supabase.from('watchlist').delete().eq('id', watchedId)
    await supabase.auth.signOut({ scope: 'local' })
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
