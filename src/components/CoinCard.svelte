<script lang="ts">
  import AlertForm from './AlertForm.svelte'
  import type { DashboardController } from '../lib/dashboard.svelte'
  import type { WatchedCoin } from '../lib/models'
  import { formatPrice, formatDate } from '../lib/format'

  let { coin, dashboard }: { coin: WatchedCoin; dashboard: DashboardController } = $props()
  const busy = $derived(Boolean(dashboard.pending))
  const feedback = $derived(
    dashboard.feedback?.scope === 'coin' && dashboard.feedback.watchlistId === coin.watchlistId
      ? dashboard.feedback
      : null,
  )
</script>

<article class="coin-card">
  <header>
    <div class="coin-title">
      <div class="coin-icon large" aria-hidden="true">{coin.symbol.slice(0, 2).toUpperCase()}</div>
      <div>
        <div class="title-line">
          <h3>{coin.name}</h3>
          {#if !coin.isActive}<span class="inactive-badge">Mimo katalog</span>{/if}
        </div>
        <a href={`https://www.coingecko.com/en/coins/${encodeURIComponent(coin.coinId)}`} target="_blank" rel="noreferrer" aria-label={`${coin.name} na CoinGecko, otevře se v nové kartě`}>{coin.symbol.toUpperCase()} · {coin.coinId} ↗</a>
      </div>
    </div>
    <button class="icon-button danger" type="button" disabled={busy} onclick={() => dashboard.removeCoin(coin)} aria-label={`Odebrat ${coin.name} ze sledovaných včetně alertů`} title="Odebrat měnu a její alerty">×</button>
  </header>
  {#if feedback}
    <p class:error={feedback.kind === 'error'} class:success={feedback.kind === 'success'} class="message" role={feedback.kind === 'error' ? 'alert' : 'status'}>
      {feedback.message}
    </p>
  {/if}
  <div class="price-block">
    <span>Poslední cena</span>
    {#if coin.price}
      <strong>{formatPrice(coin.price.priceUsd)}</strong>
      <small>Cena z {formatDate(coin.price.providerUpdatedAt ?? coin.price.fetchedAt)}<br />Načteno {formatDate(coin.price.fetchedAt)}</small>
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
      <AlertForm {alert} coinName={coin.name} {busy}
        onsave={(values) => dashboard.updateAlert(alert, values)}
        ontoggle={() => dashboard.toggleAlert(alert)}
        ondelete={() => dashboard.deleteAlert(alert)} />
    {/each}
    <AlertForm coinName={coin.name} {busy}
      onsave={(values) => dashboard.createAlert(coin, values)} />
  </section>
</article>
