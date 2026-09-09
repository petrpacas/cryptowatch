import { createClient } from '@supabase/supabase-js'

process.loadEnvFile?.('.env')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const email = 'milestone3@example.test'
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

async function signInThroughMagicLink() {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: 'http://localhost:5173/', shouldCreateUser: true },
  })
  if (error) throw error

  const verifyResponse = await fetch(await getLatestMagicLink(), { redirect: 'manual' })
  const redirectLocation = verifyResponse.headers.get('location')
  assert(redirectLocation, 'Ověření magic linku nevrátilo redirect s relací.')

  const fragment = new URLSearchParams(new URL(redirectLocation).hash.slice(1))
  const accessToken = fragment.get('access_token')
  const refreshToken = fragment.get('refresh_token')
  assert(accessToken && refreshToken, 'Redirect neobsahuje access a refresh token.')

  const { data, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (sessionError) throw sessionError
  assert(data.user?.email === email, 'Magic link přihlásil jiného uživatele.')
  return data.user
}

async function run() {
  const user = await signInThroughMagicLink()

  const { data: searchResults, error: searchError } = await supabase.rpc('search_coins', {
    search_query: 'dogecoin',
  })
  if (searchError) throw searchError
  assert(searchResults?.[0]?.id === 'dogecoin', 'Vyhledávání nevrátilo Dogecoin jako první.')

  await supabase.from('watchlist').delete().eq('coin_id', 'dogecoin')
  const { data: watched, error: watchError } = await supabase
    .from('watchlist')
    .insert({ user_id: user.id, coin_id: 'dogecoin' })
    .select('id')
    .single()
  if (watchError) throw watchError

  const { data: loadedWatchlist, error: loadError } = await supabase
    .from('watchlist')
    .select('id, coins!watchlist_coin_id_fkey(id, name, symbol, is_active, prices(price_usd, provider_updated_at, fetched_at))')
    .eq('id', watched.id)
    .single()
  if (loadError) throw loadError
  assert(loadedWatchlist.coins?.name === 'Dogecoin', 'Watchlist nevrátil připojená data měny.')

  const { data: alert, error: alertError } = await supabase
    .from('alerts')
    .insert({
      user_id: user.id,
      watchlist_id: watched.id,
      direction: 'above',
      threshold_usd: 1,
    })
    .select('id, activation_version')
    .single()
  if (alertError) throw alertError

  const { data: updatedAlert, error: updateError } = await supabase
    .from('alerts')
    .update({ threshold_usd: 2, is_active: false })
    .eq('id', alert.id)
    .select('activation_version, is_active')
    .single()
  if (updateError) throw updateError
  assert(updatedAlert.activation_version === 2 && !updatedAlert.is_active, 'Úprava alertu neproběhla správně.')

  const { data: reactivatedAlert, error: reactivateError } = await supabase
    .from('alerts')
    .update({ is_active: true })
    .eq('id', alert.id)
    .select('activation_version, is_active')
    .single()
  if (reactivateError) throw reactivateError
  assert(
    reactivatedAlert.activation_version === 3 && reactivatedAlert.is_active,
    'Opětovná aktivace nevytvořila novou verzi alertu.',
  )

  const { error: deleteError } = await supabase.from('watchlist').delete().eq('id', watched.id)
  if (deleteError) throw deleteError
  const { count, error: cascadeError } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('id', alert.id)
  if (cascadeError) throw cascadeError
  assert(count === 0, 'Smazání watchlistu neodstranilo jeho alert.')

  await supabase.auth.signOut({ scope: 'local' })
  console.log('Magic link, vyhledávání, watchlist, správa alertu a kaskádové smazání: OK')
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
