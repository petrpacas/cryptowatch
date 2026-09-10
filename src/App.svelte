<script lang="ts">
  import { onMount } from 'svelte'
  import type { Session, SupabaseClient } from '@supabase/supabase-js'
  import { getSupabaseClient, getSupabaseConfig } from './lib/supabase'

  type Price = { priceUsd: number; providerUpdatedAt: string | null; fetchedAt: string }
  type Alert = {
    id: string
    watchlistId: string
    direction: 'above' | 'below'
    thresholdUsd: number
    isActive: boolean
  }
  type WatchedCoin = {
    watchlistId: string
    coinId: string
    name: string
    symbol: string
    isActive: boolean
    price: Price | null
    alerts: Alert[]
  }
  type SearchResult = {
    id: string
    name: string
    symbol: string
    coingecko_url: string
    is_watched: boolean
  }
  type RawPrice = { price_usd: number; provider_updated_at: string | null; fetched_at: string }
  type RawCoin = {
    id: string
    name: string
    symbol: string
    is_active: boolean
    prices: RawPrice | RawPrice[] | null
  }
  type RawWatchlistRow = { id: string; coin_id: string; coins: RawCoin | RawCoin[] | null }
  type RawAlert = {
    id: string
    watchlist_id: string
    direction: 'above' | 'below'
    threshold_usd: number
    is_active: boolean
  }
  type PriceCheckResponse = {
    watchedCoins: number
    failedBatches: number
    pricesUpdated: number
    eventsCreated: number
    failures: string[]
  }

  let supabase = $state<SupabaseClient | null>(null)
  let session = $state<Session | null>(null)
  let authReady = $state(false)
  let configError = $state('')
  let email = $state('')
  let authBusy = $state(false)
  let magicLinkSent = $state(false)
  let loadingDashboard = $state(false)
  let refreshingPrices = $state(false)
  let watchlist = $state<WatchedCoin[]>([])
  let searchQuery = $state('')
  let searchResults = $state<SearchResult[]>([])
  let searchBusy = $state(false)
  let actionKey = $state('')
  let notice = $state('')
  let errorMessage = $state('')
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchRequest = 0
  let searchInput = $state<HTMLInputElement>()

  const alertCount = $derived(watchlist.reduce((total, coin) => total + coin.alerts.length, 0))
  const activeAlertCount = $derived(
    watchlist.reduce(
      (total, coin) => total + coin.alerts.filter((alert) => alert.isActive).length,
      0,
    ),
  )

  onMount(() => {
    let disposed = false
    try {
      supabase = getSupabaseClient()
    } catch (error) {
      configError = error instanceof Error ? error.message : 'Nepodařilo se načíst konfiguraci.'
      authReady = true
      return
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (disposed) return
      const previousUserId = session?.user.id
      session = nextSession
      authReady = true

      if (!nextSession) clearDashboard()
      else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || previousUserId !== nextSession.user.id) {
        void loadDashboard()
      }
    })

    return () => {
      disposed = true
      subscription.unsubscribe()
      if (searchTimer) clearTimeout(searchTimer)
    }
  })

  function clearDashboard() {
    watchlist = []
    searchQuery = ''
    searchResults = []
    notice = ''
    errorMessage = ''
  }

  function showError(error: unknown, fallback: string) {
    errorMessage = error instanceof Error ? error.message : fallback
    notice = ''
  }

  function showNotice(message: string) {
    notice = message
    errorMessage = ''
  }

  async function sendMagicLink() {
    if (!supabase || !email.trim()) return
    authBusy = true
    errorMessage = ''
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: true },
    })
    authBusy = false
    if (error) return showError(error, 'Magic link se nepodařilo odeslat.')
    magicLinkSent = true
  }

  async function signInWithGoogle() {
    if (!supabase) return
    authBusy = true
    errorMessage = ''
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    })
    if (error) {
      authBusy = false
      showError(error, 'Google přihlášení se nepodařilo spustit.')
    }
  }

  async function signOut() {
    if (!supabase) return
    actionKey = 'sign-out'
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    actionKey = ''
    if (error) showError(error, 'Odhlášení se nepodařilo.')
  }

  async function loadDashboard() {
    if (!supabase || !session) return
    loadingDashboard = true
    errorMessage = ''
    const [watchlistResponse, alertsResponse] = await Promise.all([
      supabase.from('watchlist').select(
        'id, coin_id, coins!watchlist_coin_id_fkey(id, name, symbol, is_active, prices(price_usd, provider_updated_at, fetched_at))',
      ).order('created_at', { ascending: true }),
      supabase.from('alerts').select(
        'id, watchlist_id, direction, threshold_usd, is_active',
      ).order('created_at', { ascending: true }),
    ])
    loadingDashboard = false
    if (watchlistResponse.error || alertsResponse.error) {
      return showError(watchlistResponse.error ?? alertsResponse.error, 'Sledované měny se nepodařilo načíst.')
    }

    const alertRows = (alertsResponse.data ?? []) as unknown as RawAlert[]
    watchlist = ((watchlistResponse.data ?? []) as unknown as RawWatchlistRow[])
      .map((row) => {
        const coin = Array.isArray(row.coins) ? row.coins[0] : row.coins
        if (!coin) return null
        const rawPrice = Array.isArray(coin.prices) ? coin.prices[0] : coin.prices
        return {
          watchlistId: row.id,
          coinId: row.coin_id,
          name: coin.name,
          symbol: coin.symbol,
          isActive: coin.is_active,
          price: rawPrice ? {
            priceUsd: Number(rawPrice.price_usd),
            providerUpdatedAt: rawPrice.provider_updated_at,
            fetchedAt: rawPrice.fetched_at,
          } : null,
          alerts: alertRows.filter((alert) => alert.watchlist_id === row.id).map((alert) => ({
            id: alert.id,
            watchlistId: alert.watchlist_id,
            direction: alert.direction,
            thresholdUsd: Number(alert.threshold_usd),
            isActive: alert.is_active,
          })),
        } satisfies WatchedCoin
      })
      .filter((coin): coin is WatchedCoin => coin !== null)
  }

  function scheduleSearch(value: string) {
    searchQuery = value
    if (searchTimer) clearTimeout(searchTimer)
    const request = ++searchRequest
    if (!value.trim()) {
      searchResults = []
      searchBusy = false
      return
    }
    searchBusy = true
    searchTimer = setTimeout(() => void searchCoins(value.trim(), request), 300)
  }

  function clearSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    searchRequest += 1
    searchQuery = ''
    searchResults = []
    searchBusy = false
    requestAnimationFrame(() => searchInput?.focus())
  }

  async function searchCoins(query: string, request: number) {
    if (!supabase || !session) return
    const { data, error } = await supabase.rpc('search_coins', { search_query: query })
    if (request !== searchRequest) return
    searchBusy = false
    if (error) return showError(error, 'Vyhledávání se nepodařilo.')
    searchResults = (data ?? []) as SearchResult[]
  }

  async function refreshSearch() {
    const query = searchQuery.trim()
    if (!query) return
    const request = ++searchRequest
    searchBusy = true
    await searchCoins(query, request)
  }

  async function addCoin(coin: SearchResult) {
    if (!supabase || !session || coin.is_watched) return
    actionKey = `add:${coin.id}`
    const { error } = await supabase.from('watchlist').insert({ user_id: session.user.id, coin_id: coin.id })
    actionKey = ''
    if (error) return showError(error, 'Měnu se nepodařilo přidat.')
    showNotice(`${coin.name} je nyní ve sledovaných.`)
    clearSearch()
    await loadDashboard()
  }

  async function refreshPrices() {
    if (!supabase || !session || watchlist.length === 0) return
    refreshingPrices = true
    errorMessage = ''

    const { url, publishableKey } = getSupabaseConfig()
    let data: PriceCheckResponse | null = null

    try {
      const response = await fetch(`${url}/functions/v1/refresh-prices`, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body: '{}',
      })
      const body = await response.json() as PriceCheckResponse & { error?: string; detail?: string }
      if (!response.ok) throw new Error(body.detail ?? body.error ?? 'Edge Function vrátila chybu.')
      data = body
    } catch (error) {
      refreshingPrices = false
      return showError(error, 'Ceny se nepodařilo aktualizovat.')
    }

    refreshingPrices = false
    if (!data) return showError(null, 'Ceny se nepodařilo aktualizovat.')

    await loadDashboard()

    if (data.failedBatches > 0) {
      return showError(
        new Error(data.failures.join(' ')),
        'Některé ceny se nepodařilo aktualizovat.',
      )
    }

    const eventNote = data.eventsCreated > 0
      ? ` Spuštěné alerty: ${data.eventsCreated}.`
      : ''
    showNotice(`Aktualizované ceny: ${data.pricesUpdated}.${eventNote}`)
  }

  async function removeCoin(coin: WatchedCoin) {
    if (!supabase || !window.confirm(`Odebrat ${coin.name}? Smažou se také všechny alerty pro tuto měnu.`)) return
    actionKey = `remove:${coin.watchlistId}`
    const { error } = await supabase.from('watchlist').delete().eq('id', coin.watchlistId)
    actionKey = ''
    if (error) return showError(error, 'Měnu se nepodařilo odebrat.')
    showNotice(`${coin.name} byla odebrána.`)
    await Promise.all([loadDashboard(), refreshSearch()])
  }

  function parseAlertForm(form: HTMLFormElement) {
    const data = new FormData(form)
    const direction = data.get('direction')
    const thresholdUsd = Number(data.get('threshold'))
    if ((direction !== 'above' && direction !== 'below') || thresholdUsd <= 0) {
      throw new Error('Zadej kladnou cenu a vyber směr alertu.')
    }
    return { direction, thresholdUsd }
  }

  async function createAlert(event: SubmitEvent, coin: WatchedCoin) {
    event.preventDefault()
    if (!supabase || !session) return
    const form = event.currentTarget as HTMLFormElement
    let values: ReturnType<typeof parseAlertForm>
    try { values = parseAlertForm(form) } catch (error) { return showError(error, 'Alert není platný.') }
    actionKey = `create-alert:${coin.watchlistId}`
    const { error } = await supabase.from('alerts').insert({
      user_id: session.user.id,
      watchlist_id: coin.watchlistId,
      direction: values.direction,
      threshold_usd: values.thresholdUsd,
    })
    actionKey = ''
    if (error) return showError(error, 'Alert se nepodařilo vytvořit.')
    form.reset()
    showNotice(`Alert pro ${coin.name} byl vytvořen.`)
    await loadDashboard()
  }

  async function updateAlert(event: SubmitEvent, alert: Alert) {
    event.preventDefault()
    if (!supabase) return
    let values: ReturnType<typeof parseAlertForm>
    try { values = parseAlertForm(event.currentTarget as HTMLFormElement) } catch (error) { return showError(error, 'Alert není platný.') }
    actionKey = `save-alert:${alert.id}`
    const { error } = await supabase.from('alerts').update({
      direction: values.direction,
      threshold_usd: values.thresholdUsd,
    }).eq('id', alert.id)
    actionKey = ''
    if (error) return showError(error, 'Alert se nepodařilo uložit.')
    showNotice('Alert byl uložen a má novou verzi aktivace.')
    await loadDashboard()
  }

  async function toggleAlert(alert: Alert) {
    if (!supabase) return
    actionKey = `toggle-alert:${alert.id}`
    const { error } = await supabase.from('alerts').update({ is_active: !alert.isActive }).eq('id', alert.id)
    actionKey = ''
    if (error) return showError(error, 'Stav alertu se nepodařilo změnit.')
    showNotice(alert.isActive ? 'Alert byl vypnut.' : 'Alert byl znovu aktivován.')
    await loadDashboard()
  }

  async function deleteAlert(alert: Alert) {
    if (!supabase) return
    actionKey = `delete-alert:${alert.id}`
    const { error } = await supabase.from('alerts').delete().eq('id', alert.id)
    actionKey = ''
    if (error) return showError(error, 'Alert se nepodařilo smazat.')
    showNotice('Alert byl smazán.')
    await loadDashboard()
  }

  function formatPrice(value: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: value >= 1 ? 2 : 4,
      maximumFractionDigits: value >= 1 ? 2 : 8,
    }).format(value)
  }

  function formatDate(value: string) {
    return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  }
</script>

<svelte:head>
  <title>{session ? 'Moje sledování' : 'Přihlášení'} · CryptoWatch</title>
  <meta name="description" content="Sleduj ceny kryptoměn a nastav si vlastní jednorázová upozornění." />
</svelte:head>

{#if !authReady}
  <main class="centered-state">
    <div class="spinner" aria-hidden="true"></div>
    <p role="status">Obnovuji relaci…</p>
  </main>
{:else if configError}
  <main class="centered-state">
    <span class="brand-mark" aria-hidden="true">C</span>
    <h1>Chybí konfigurace</h1>
    <p>{configError}</p>
    <code>cp .env.example .env</code>
  </main>
{:else if !session}
  <main class="auth-layout">
    <section class="auth-intro">
      <a class="brand" href="/" aria-label="CryptoWatch – domů">
        <span class="brand-mark" aria-hidden="true">C</span>
        <span>CryptoWatch</span>
      </a>
      <div>
        <p class="eyebrow">Tvůj osobní watchlist</p>
        <h1>Trh se hýbe.<br /><span>Ty nemusíš čekat.</span></h1>
        <p class="intro">Vyber si kryptoměny z katalogu CoinGecko a nastav cenu, při které tě CryptoWatch upozorní.</p>
      </div>
      <p class="data-credit">Cenová data poskytuje CoinGecko</p>
    </section>
    <section class="auth-card" aria-labelledby="login-heading">
      <div>
        <p class="section-kicker">Bez hesla</p>
        <h2 id="login-heading">Přihlášení</h2>
        <p class="muted">Pošleme ti bezpečný přihlašovací odkaz na e-mail.</p>
      </div>
      {#if magicLinkSent}
        <div class="success-panel" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Zkontroluj e-mail</strong>
            <p>Odkaz jsme poslali na {email}. V lokálním vývoji jej najdeš v Mailpitu.</p>
          </div>
        </div>
        <button class="text-button" type="button" onclick={() => (magicLinkSent = false)}>Použít jiný e-mail</button>
      {:else}
        <form class="auth-form" onsubmit={(event) => { event.preventDefault(); void sendMagicLink() }}>
          <label for="email">E-mail</label>
          <input id="email" type="email" autocomplete="email" placeholder="ty@example.com" required bind:value={email} />
          <button class="primary-button" type="submit" disabled={authBusy}>{authBusy ? 'Odesílám…' : 'Poslat magic link'}</button>
        </form>
        <div class="divider"><span>nebo</span></div>
        <button class="google-button" type="button" disabled={authBusy} onclick={signInWithGoogle}>
          <span class="google-mark" aria-hidden="true">G</span>
          Pokračovat přes Google
        </button>
      {/if}
      {#if errorMessage}<p class="message error" role="alert">{errorMessage}</p>{/if}
      <p class="auth-note">Lokální e-maily otevřeš na <a href="http://localhost:54324" target="_blank" rel="noreferrer">localhost:54324</a>.</p>
    </section>
  </main>
{:else}
  <header class="app-header">
    <nav aria-label="Hlavní navigace">
      <a class="brand" href="/" aria-label="CryptoWatch – domů">
        <span class="brand-mark" aria-hidden="true">C</span>
        <span>CryptoWatch</span>
      </a>
      <div class="account">
        <span class="account-email">{session.user.email}</span>
        <button class="secondary-button compact" type="button" disabled={actionKey === 'sign-out'} onclick={signOut}>Odhlásit</button>
      </div>
    </nav>
  </header>
  <main class="dashboard">
    <section class="dashboard-heading" aria-labelledby="dashboard-title">
      <div>
        <p class="eyebrow">Přehled</p>
        <h1 id="dashboard-title">Moje sledování</h1>
        <p class="intro">Přidej měny, které tě zajímají, a nastav jejich cenové hranice.</p>
      </div>
      <dl class="stats">
        <div><dt>Sledované měny</dt><dd>{watchlist.length}</dd></div>
        <div><dt>Aktivní alerty</dt><dd>{activeAlertCount}<small> / {alertCount}</small></dd></div>
      </dl>
    </section>
    {#if notice}<p class="message success" role="status">{notice}</p>{/if}
    {#if errorMessage}<p class="message error" role="alert">{errorMessage}</p>{/if}
    <section class="search-panel" aria-labelledby="search-heading">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">Katalog CoinGecko</p>
          <h2 id="search-heading">Přidat kryptoměnu</h2>
        </div>
        <span class="result-limit">Nejvýše 20 výsledků</span>
      </div>
      <label class="sr-only" for="coin-search">Hledat kryptoměnu</label>
      <div class="search-box">
        <span aria-hidden="true">⌕</span>
        <input
          id="coin-search"
          bind:this={searchInput}
          type="search"
          value={searchQuery}
          placeholder="Název, symbol nebo CoinGecko ID"
          aria-describedby="search-help"
          autocomplete="off"
          oninput={(event) => scheduleSearch(event.currentTarget.value)}
        />
        {#if searchBusy}<div class="spinner small" aria-hidden="true"></div>{/if}
      </div>
      <p id="search-help" class="field-help">Začni psát, výsledky se zobrazí automaticky.</p>
      <p class="sr-only" aria-live="polite">
        {searchBusy ? 'Vyhledávám.' : searchQuery.trim() ? `Nalezeno výsledků: ${searchResults.length}.` : ''}
      </p>
      {#if searchQuery.trim() && !searchBusy}
        <div id="coin-search-results" class="search-results">
          {#if searchResults.length === 0}
            <p class="empty-inline">Pro „{searchQuery.trim()}“ jsme nic nenašli.</p>
          {:else}
            <ul>
              {#each searchResults as coin (coin.id)}
                <li class="search-result">
                  <div class="coin-icon" aria-hidden="true">{coin.symbol.slice(0, 2).toUpperCase()}</div>
                  <div class="search-result-name">
                    <strong>{coin.name}</strong>
                    <p><span>{coin.symbol.toUpperCase()}</span> · {coin.id}</p>
                  </div>
                  <a class="external-link" href={coin.coingecko_url} target="_blank" rel="noreferrer" aria-label={`${coin.name} na CoinGecko, otevře se v nové kartě`}>Detail ↗</a>
                  <button class:watched={coin.is_watched} class="add-button" type="button" disabled={coin.is_watched || actionKey === `add:${coin.id}`} onclick={() => addCoin(coin)}>
                    {coin.is_watched ? 'Přidáno' : actionKey === `add:${coin.id}` ? 'Přidávám…' : 'Přidat'}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </section>
    <section class="watchlist-section" aria-labelledby="watchlist-heading">
      <div class="panel-heading watchlist-heading">
        <div>
          <p class="section-kicker">Watchlist</p>
          <h2 id="watchlist-heading">Sledované měny</h2>
        </div>
        <button class="refresh-button" type="button" disabled={refreshingPrices || loadingDashboard || watchlist.length === 0} onclick={refreshPrices}>
          <span aria-hidden="true">↻</span>
          {refreshingPrices ? 'Aktualizuji ceny…' : 'Aktualizovat ceny'}
        </button>
      </div>
      {#if loadingDashboard && watchlist.length === 0}
        <div class="empty-state" aria-live="polite">
          <div class="spinner" aria-hidden="true"></div>
          <p>Načítám tvůj seznam…</p>
        </div>
      {:else if watchlist.length === 0}
        <div class="empty-state">
          <span aria-hidden="true">◇</span>
          <h3>Zatím nic nesleduješ</h3>
          <p>Vyhledej první měnu nahoře. Alert můžeš přidat až potom, ale nemusíš.</p>
        </div>
      {:else}
        <div class="watchlist-grid">
          {#each watchlist as coin (coin.watchlistId)}
            <article class="coin-card">
              <header>
                <div class="coin-title">
                  <div class="coin-icon large" aria-hidden="true">{coin.symbol.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div class="title-line">
                      <h3>{coin.name}</h3>
                      {#if !coin.isActive}<span class="inactive-badge">Mimo katalog</span>{/if}
                    </div>
                    <a href={`https://www.coingecko.com/en/coins/${coin.coinId}`} target="_blank" rel="noreferrer" aria-label={`${coin.name} na CoinGecko, otevře se v nové kartě`}>{coin.symbol.toUpperCase()} · {coin.coinId} ↗</a>
                  </div>
                </div>
                <button class="icon-button danger" type="button" disabled={actionKey === `remove:${coin.watchlistId}`} onclick={() => removeCoin(coin)} aria-label={`Odebrat ${coin.name} ze sledovaných včetně alertů`} title="Odebrat měnu a její alerty">×</button>
              </header>
              <div class="price-block">
                <span>Poslední cena</span>
                {#if coin.price}
                  <strong>{formatPrice(coin.price.priceUsd)}</strong>
                  <small>Aktualizováno {formatDate(coin.price.providerUpdatedAt ?? coin.price.fetchedAt)}</small>
                {:else}
                  <strong class="waiting">Čeká na první cenu</strong>
                  <small>Použij tlačítko „Aktualizovat ceny“.</small>
                {/if}
              </div>
              <section class="alerts" aria-labelledby={`alerts-${coin.watchlistId}`}>
                <div class="alerts-heading">
                  <h4 id={`alerts-${coin.watchlistId}`}>Alerty</h4>
                  <span aria-label={`Počet alertů: ${coin.alerts.length}`}>{coin.alerts.length}</span>
                </div>
                {#each coin.alerts as alert (alert.id)}
                  <form class:disabled-alert={!alert.isActive} class="alert-row" onsubmit={(event) => updateAlert(event, alert)}>
                    <div class="alert-status">
                      <span class:active={alert.isActive} class="status-dot" aria-hidden="true"></span>
                      <span>{alert.isActive ? 'Aktivní' : 'Vypnutý'}</span>
                    </div>
                    <label class="control-field">
                      <span>Podmínka</span>
                      <select name="direction" value={alert.direction}>
                        <option value="above">Cena je nad</option>
                        <option value="below">Cena je pod</option>
                      </select>
                    </label>
                    <label class="control-field">
                      <span>Hranice v USD</span>
                      <span class="price-input"><span class="currency" aria-hidden="true">$</span><input name="threshold" type="number" min="0.00000001" step="any" value={alert.thresholdUsd} required /></span>
                    </label>
                    <div class="alert-actions">
                      <button class="mini-button" type="submit" disabled={actionKey === `save-alert:${alert.id}`}>Uložit</button>
                      <button class="mini-button" type="button" disabled={actionKey === `toggle-alert:${alert.id}`} onclick={() => toggleAlert(alert)}>{alert.isActive ? 'Vypnout' : 'Zapnout'}</button>
                      <button class="icon-button" type="button" disabled={actionKey === `delete-alert:${alert.id}`} onclick={() => deleteAlert(alert)} aria-label={`Smazat alert pro ${coin.name}`}>×</button>
                    </div>
                  </form>
                {/each}
                <form class="new-alert" onsubmit={(event) => createAlert(event, coin)}>
                  <label class="control-field">
                    <span>Nová podmínka</span>
                    <select name="direction">
                      <option value="above">Cena stoupne nad</option>
                      <option value="below">Cena klesne pod</option>
                    </select>
                  </label>
                  <label class="control-field">
                    <span>Hranice v USD</span>
                    <span class="price-input"><span class="currency" aria-hidden="true">$</span><input name="threshold" type="number" min="0.00000001" step="any" placeholder="0.00" required /></span>
                  </label>
                  <button class="secondary-button" type="submit" disabled={actionKey === `create-alert:${coin.watchlistId}`}>Přidat alert</button>
                </form>
              </section>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </main>
  <footer>
    <a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">Cenová data poskytuje CoinGecko ↗</a>
    <span>CryptoWatch</span>
  </footer>
{/if}
