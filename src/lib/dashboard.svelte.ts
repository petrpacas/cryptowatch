import type { AppClient } from './supabase'
import type { Alert, AlertValues, SearchResult, WatchedCoin } from './models'
import { errorMessage } from './errors'
import { createWatchlistApi } from './watchlist-api'

export type DashboardFeedback = {
  scope: 'catalog' | 'watchlist' | 'coin' | 'account'
  kind: 'success' | 'error'
  message: string
  watchlistId?: string
}

// Each mounted dashboard owns one controller; it cannot write into another user's state.
export function createDashboard(client: AppClient, userId: string) {
  const api = createWatchlistApi(client, userId)
  let watchlist = $state<WatchedCoin[]>([])
  let loading = $state(true)
  let pending = $state('')
  let feedback = $state<DashboardFeedback | null>(null)
  let disposed = false
  let loadRequest: AbortController | undefined

  function showError(
    cause: unknown,
    fallback = 'Operace se nepodařila.',
    scope: DashboardFeedback['scope'] = 'watchlist',
    watchlistId?: string,
  ) {
    if (disposed) return
    feedback = { scope, kind: 'error', message: errorMessage(cause, fallback), watchlistId }
  }

  async function load() {
    loadRequest?.abort()
    const request = new AbortController()
    loadRequest = request
    loading = true
    feedback = null
    try {
      const next = await api.load(request.signal)
      if (disposed || request.signal.aborted) return false
      watchlist = next
      return true
    } catch (cause) {
      if (!request.signal.aborted) showError(cause, 'Sledované měny se nepodařilo načíst.')
      return false
    } finally {
      if (!disposed && loadRequest === request) loading = false
    }
  }

  async function mutate(
    key: string,
    operation: () => Promise<unknown>,
    message: string,
    scope: DashboardFeedback['scope'] = 'watchlist',
    watchlistId?: string,
  ) {
    if (disposed || pending) return false
    pending = key
    feedback = null
    try {
      await operation()
      if (disposed) return false
      if (await load() && message) feedback = { scope, kind: 'success', message, watchlistId }
      // The mutation succeeded even if reloading failed; do not encourage duplicate inserts.
      return true
    } catch (cause) {
      showError(cause, 'Operace se nepodařila.', scope, watchlistId)
      return false
    } finally {
      if (!disposed) pending = ''
    }
  }

  return {
    get watchlist() { return watchlist },
    get loading() { return loading },
    get pending() { return pending },
    get feedback() { return feedback },
    load,
    showError,
    dispose() { disposed = true; loadRequest?.abort() },
    addCoin: (coin: SearchResult) => mutate(
      `add:${coin.id}`,
      () => api.addCoin(coin.id),
      `${coin.name} je nyní ve sledovaných.`,
      'catalog',
    ),
    removeCoin(coin: WatchedCoin) {
      if (!window.confirm(`Odebrat ${coin.name}? Smažou se také všechny alerty pro tuto měnu.`)) return
      return mutate(
        `remove:${coin.watchlistId}`,
        () => api.removeCoin(coin.watchlistId),
        `${coin.name} byla odebrána.`,
        'coin',
        coin.watchlistId,
      )
    },
    createAlert: (coin: WatchedCoin, values: AlertValues) => mutate(
      'create-alert',
      () => api.createAlert(coin.watchlistId, values),
      `Alert pro ${coin.name} byl vytvořen.`,
      'coin',
      coin.watchlistId,
    ),
    updateAlert: (alert: Alert, values: AlertValues) => mutate(
      'save-alert',
      () => api.updateAlert(alert.id, values),
      'Alert byl uložen.',
      'coin',
      alert.watchlistId,
    ),
    toggleAlert: (alert: Alert) => mutate(
      'toggle-alert',
      () => api.setAlertActive(alert.id, !alert.isActive),
      alert.isActive ? 'Alert byl vypnut.' : 'Alert byl znovu aktivován.',
      'coin',
      alert.watchlistId,
    ),
    deleteAlert: (alert: Alert) => mutate(
      'delete-alert',
      () => api.deleteAlert(alert.id),
      'Alert byl smazán.',
      'coin',
      alert.watchlistId,
    ),
    async refreshPrices() {
      let message = ''
      const success = await mutate('refresh-prices', async () => {
        const result = await api.refreshPrices()
        message = result.failedBatches > 0
          ? 'Některé ceny se nepodařilo aktualizovat. Zkus to prosím za chvíli.'
          : `Aktualizované ceny: ${result.pricesUpdated}.`
        if (result.failedBatches > 0) {
          await load()
          throw new Error(message)
        }
      }, '')
      if (success && !disposed && feedback?.kind !== 'error') {
        feedback = { scope: 'watchlist', kind: 'success', message }
      }
    },
    async signOut() {
      if (pending) return
      pending = 'sign-out'
      feedback = null
      try {
        const { error } = await client.auth.signOut({ scope: 'local' })
        if (error) throw error
      } catch (cause) {
        showError(cause, 'Odhlášení se nepodařilo.', 'account')
      } finally {
        if (!disposed) pending = ''
      }
    },
  }
}

export type DashboardController = ReturnType<typeof createDashboard>
