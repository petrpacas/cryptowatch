<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type { User } from '@supabase/supabase-js'
  import CoinSearch from './CoinSearch.svelte'
  import CoinCard from './CoinCard.svelte'
  import { createDashboard } from '../lib/dashboard.svelte'
  import type { AppClient } from '../lib/supabase'

  let { client, user }: { client: AppClient; user: User } = $props()
  // App keys this component by user ID, so the controller lives for exactly one session owner.
  const dashboard = untrack(() => createDashboard(client, user.id))
  const watchlist = $derived(dashboard.watchlist)
  const loadingDashboard = $derived(dashboard.loading)
  const refreshingPrices = $derived(dashboard.pending === 'refresh-prices')
  const feedback = $derived(dashboard.feedback)
  const watchlistFeedback = $derived(
    feedback?.scope === 'watchlist' ||
    (feedback?.scope === 'coin' && !watchlist.some((coin) => coin.watchlistId === feedback.watchlistId))
      ? feedback
      : null,
  )
  const alertCount = $derived(watchlist.reduce((total, coin) => total + coin.alerts.length, 0))
  const activeAlertCount = $derived(watchlist.reduce((total, coin) => total + coin.alerts.filter((alert) => alert.isActive).length, 0))

  onMount(() => {
    void dashboard.load()
    return dashboard.dispose
  })
</script>

<a class="skip-link" href="#dashboard-title">Přejít na obsah</a>
<header class="app-header">
  <nav aria-label="Hlavní navigace">
    <a class="brand" href="/" aria-label="CryptoWatch – domů">
      <span class="brand-mark" aria-hidden="true">C</span>
      <span>CryptoWatch</span>
    </a>
    <div class="account">
      <span class="account-email">{user.email}</span>
      <button class="secondary-button compact" type="button" disabled={Boolean(dashboard.pending)} onclick={dashboard.signOut}>Odhlásit</button>
    </div>
  </nav>
</header>
{#if feedback?.scope === 'account'}
  <div class="header-feedback">
    <p class:error={feedback.kind === 'error'} class:success={feedback.kind === 'success'} class="message" role={feedback.kind === 'error' ? 'alert' : 'status'}>
      {feedback.message}
    </p>
  </div>
{/if}
<main class="dashboard">
  <section class="dashboard-heading" aria-labelledby="dashboard-title">
    <div>
      <p class="eyebrow">Přehled</p>
      <h1 id="dashboard-title" tabindex="-1">Moje sledování</h1>
      <p class="intro">Přidej měny, které tě zajímají, a nastav jejich cenové hranice.</p>
    </div>
    <dl class="stats">
      <div><dt>Sledované měny</dt><dd>{watchlist.length}</dd></div>
      <div><dt>Aktivní alerty</dt><dd>{activeAlertCount}<small>&nbsp;/&nbsp;{alertCount}</small></dd></div>
    </dl>
  </section>
  <CoinSearch
    {client}
    {watchlist}
    busy={Boolean(dashboard.pending)}
    notice={feedback?.scope === 'catalog' && feedback.kind === 'success' ? feedback.message : ''}
    operationError={feedback?.scope === 'catalog' && feedback.kind === 'error' ? feedback.message : ''}
    onadd={dashboard.addCoin}
  />
  <section class="watchlist-section" aria-labelledby="watchlist-heading">
    <div class="panel-heading watchlist-heading">
      <div>
        <p class="section-kicker">Watchlist</p>
        <h2 id="watchlist-heading">Sledované měny</h2>
      </div>
      <button class="refresh-button" type="button" disabled={Boolean(dashboard.pending) || loadingDashboard || watchlist.length === 0} onclick={dashboard.refreshPrices}>
        <span class:spinning={refreshingPrices} aria-hidden="true">↻</span>
        {refreshingPrices ? 'Aktualizuji ceny…' : 'Aktualizovat ceny'}
      </button>
    </div>
    {#if watchlistFeedback && !(watchlistFeedback.kind === 'error' && watchlist.length === 0)}
      <p class:error={watchlistFeedback.kind === 'error'} class:success={watchlistFeedback.kind === 'success'} class="message" role={watchlistFeedback.kind === 'error' ? 'alert' : 'status'}>
        {watchlistFeedback.message}
      </p>
    {/if}
    {#if loadingDashboard && watchlist.length === 0}
      <div class="empty-state" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>Načítám tvůj seznam…</p>
      </div>
    {:else if watchlistFeedback?.kind === 'error' && watchlist.length === 0}
      <div class="empty-state">
        <h3>Seznam se nepodařilo načíst</h3>
        <p class="message error" role="alert">{watchlistFeedback.message}</p>
        <button class="secondary-button" type="button" onclick={() => dashboard.load()}>Zkusit znovu</button>
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
          <CoinCard {coin} {dashboard} />
        {/each}
      </div>
    {/if}
  </section>
</main>
<footer>
  <a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">Cenová data poskytuje CoinGecko ↗</a>
  <span>CryptoWatch</span>
</footer>
