<script lang="ts">
  import { tick } from 'svelte'
  import type { AppClient } from '../lib/supabase'
  import type { SearchResult, WatchedCoin } from '../lib/models'
  import { errorMessage } from '../lib/errors'

  let { client, watchlist, busy, notice, operationError, onadd }: {
    client: AppClient
    watchlist: WatchedCoin[]
    busy: boolean
    notice: string
    operationError: string
    onadd: (coin: SearchResult) => Promise<boolean>
  } = $props()
  let searchQuery = $state('')
  let matches = $state<SearchResult[]>([])
  let searchBusy = $state(false)
  let searchError = $state('')
  let addingId = $state('')
  let searchInput: HTMLInputElement
  const searchResults = $derived(matches.map((coin) => ({
    ...coin, is_watched: watchlist.some((watched) => watched.coinId === coin.id),
  })))

  $effect(() => {
    const query = searchQuery.trim()
    const controller = new AbortController()
    matches = []
    searchError = ''
    searchBusy = Boolean(query)
    const timer = query ? setTimeout(async () => {
      try {
        const { data, error } = await client.rpc('search_coins', { search_query: query }).abortSignal(controller.signal)
        if (controller.signal.aborted) return
        if (error) throw error
        matches = data ?? []
      } catch (error) {
        if (!controller.signal.aborted) searchError = errorMessage(error, 'Vyhledávání se nepodařilo.')
      } finally {
        if (!controller.signal.aborted) searchBusy = false
      }
    }, 300) : undefined
    return () => { clearTimeout(timer); controller.abort() }
  })

  async function addCoin(coin: SearchResult) {
    if (busy || addingId || coin.is_watched) return
    addingId = coin.id
    try {
      if (await onadd(coin)) {
        searchQuery = ''
        await tick()
        searchInput?.focus()
      }
    } finally {
      addingId = ''
    }
  }
</script>

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
      oninput={(event) => { searchQuery = event.currentTarget.value }}
      onkeydown={(event) => { if (event.key === 'Escape') searchQuery = '' }}
    />
    {#if searchBusy}<div class="spinner small" aria-hidden="true"></div>{/if}
  </div>
  <p id="search-help" class="field-help">Začni psát, výsledky se zobrazí automaticky.</p>
  <p class="sr-only" aria-live="polite">
    {searchBusy ? 'Vyhledávám.' : searchQuery.trim() ? `Nalezeno výsledků: ${searchResults.length}.` : ''}
  </p>
  {#if notice}<p class="message success" role="status">{notice}</p>{/if}
  {#if operationError}<p class="message error" role="alert">{operationError}</p>{/if}
  {#if searchError}<p class="message error" role="alert">{searchError}</p>{/if}
  {#if searchQuery.trim() && !searchBusy && !searchError}
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
              <button class:watched={coin.is_watched} class="add-button" type="button" disabled={coin.is_watched || busy} onclick={() => addCoin(coin)}>
                {coin.is_watched ? 'Přidáno' : addingId === coin.id ? 'Přidávám…' : 'Přidat'}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
