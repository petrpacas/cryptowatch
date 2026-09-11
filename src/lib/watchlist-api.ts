import { FunctionsHttpError } from '@supabase/supabase-js'
import type { AppClient } from './supabase'
import type { AlertValues, WatchedCoin } from './models'
import type { PriceCheckResult } from '../../supabase/functions/check-prices/prices'

export function createWatchlistApi(client: AppClient, userId: string) {
  return {
    async load(signal: AbortSignal): Promise<WatchedCoin[]> {
      const [watched, alerts] = await Promise.all([
        client.from('watchlist').select(
          'id, coin_id, coins!watchlist_coin_id_fkey(id, name, symbol, is_active, prices(price_usd, provider_updated_at, fetched_at))',
        ).eq('user_id', userId).order('created_at').abortSignal(signal),
        client.from('alerts').select('id, watchlist_id, direction, threshold_usd, is_active')
          .eq('user_id', userId).order('created_at').abortSignal(signal),
      ])
      if (watched.error) throw watched.error
      if (alerts.error) throw alerts.error
      return watched.data.flatMap((row) => {
        const coin = row.coins
        if (!coin) return []
        const price = coin.prices
        return [{
          watchlistId: row.id,
          coinId: row.coin_id,
          name: coin.name,
          symbol: coin.symbol,
          isActive: coin.is_active,
          price: price ? {
            priceUsd: Number(price.price_usd),
            providerUpdatedAt: price.provider_updated_at,
            fetchedAt: price.fetched_at,
          } : null,
          alerts: alerts.data.filter((alert) => alert.watchlist_id === row.id).map((alert) => ({
            id: alert.id,
            watchlistId: alert.watchlist_id,
            direction: alert.direction,
            thresholdUsd: Number(alert.threshold_usd),
            isActive: alert.is_active,
          })),
        }]
      })
    },
    async addCoin(coinId: string) {
      const { error } = await client.from('watchlist').insert({ user_id: userId, coin_id: coinId })
      if (error) throw error
    },
    async removeCoin(watchlistId: string) {
      const { error } = await client.from('watchlist').delete().eq('id', watchlistId)
      if (error) throw error
    },
    async createAlert(watchlistId: string, values: AlertValues) {
      const { error } = await client.from('alerts').insert({
        user_id: userId, watchlist_id: watchlistId,
        direction: values.direction, threshold_usd: values.thresholdUsd,
      })
      if (error) throw error
    },
    async updateAlert(id: string, values: AlertValues) {
      const { error } = await client.from('alerts').update({
        direction: values.direction, threshold_usd: values.thresholdUsd,
      }).eq('id', id)
      if (error) throw error
    },
    async setAlertActive(id: string, isActive: boolean) {
      const { error } = await client.from('alerts').update({ is_active: isActive }).eq('id', id)
      if (error) throw error
    },
    async deleteAlert(id: string) {
      const { error } = await client.from('alerts').delete().eq('id', id)
      if (error) throw error
    },
    async refreshPrices(): Promise<PriceCheckResult> {
      // invoke uses the client's current JWT, including token refreshes.
      const { data, error } = await client.functions.invoke<PriceCheckResult>('refresh-prices', { body: {} })
      if (error instanceof FunctionsHttpError && error.context.status === 429) {
        throw new Error('Ceny lze ručně aktualizovat jednou za minutu. Zkus to prosím za chvíli.')
      }
      if (error) throw new Error('Ceny se nepodařilo aktualizovat. Zkus to prosím za chvíli.')
      if (!data) throw new Error('Server nevrátil výsledek aktualizace.')
      return data
    },
  }
}
