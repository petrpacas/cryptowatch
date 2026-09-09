export type CoinGeckoCoin = {
  id: string;
  name: string;
  symbol: string;
};

export function parseCoinCatalog(value: unknown): CoinGeckoCoin[] {
  if (!Array.isArray(value)) {
    throw new Error("CoinGecko returned an invalid catalog payload");
  }

  const uniqueCoins = new Map<string, CoinGeckoCoin>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const symbol = typeof record.symbol === "string" ? record.symbol.trim() : "";

    if (!id || !name || !symbol) continue;

    uniqueCoins.set(id, { id, name, symbol });
  }

  if (uniqueCoins.size === 0) {
    throw new Error("CoinGecko catalog did not contain any valid coins");
  }

  return [...uniqueCoins.values()];
}

export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

