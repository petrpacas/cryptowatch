export type Price = { priceUsd: number; providerUpdatedAt: string | null; fetchedAt: string }
export type AlertValues = { direction: 'above' | 'below'; thresholdUsd: number }
export type Alert = AlertValues & { id: string; watchlistId: string; isActive: boolean }
export type WatchedCoin = {
  watchlistId: string
  coinId: string
  name: string
  symbol: string
  isActive: boolean
  price: Price | null
  alerts: Alert[]
}
export type SearchResult = { id: string; name: string; symbol: string; coingecko_url: string; is_watched: boolean }

export function parseAlertValues(data: FormData): AlertValues {
  const direction = data.get('direction')
  const thresholdUsd = Number(data.get('threshold'))
  if ((direction !== 'above' && direction !== 'below') || !Number.isFinite(thresholdUsd) || thresholdUsd <= 0) {
    throw new Error('Zadej kladnou konečnou cenu a vyber směr alertu.')
  }
  return { direction, thresholdUsd }
}
