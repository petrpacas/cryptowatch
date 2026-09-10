export const PRICE_BATCH_SIZE = 250;

export type PriceRow = {
  coin_id: string;
  price_usd: number;
  provider_updated_at: string;
};

export type ProcessedBatch = {
  pricesUpdated: number;
  eventsCreated: number;
};

export type PriceCheckDependencies = {
  listWatchedCoinIds: () => Promise<string[]>;
  fetchPricePayload: (coinIds: string[]) => Promise<unknown>;
  processPriceRows: (
    rows: PriceRow[],
    fetchedAt: string,
  ) => Promise<ProcessedBatch>;
  now?: () => Date;
};

export type PriceCheckResult = {
  watchedCoins: number;
  batches: number;
  successfulBatches: number;
  failedBatches: number;
  pricesUpdated: number;
  eventsCreated: number;
  skipped: boolean;
  failures: string[];
};

export function normalizeCoinIds(values: unknown): string[] {
  if (!Array.isArray(values)) {
    throw new Error("Watched coin query did not return an array");
  }

  return [...new Set(values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const id = value.trim();
    return id ? [id] : [];
  }))].sort();
}

export function splitIntoPriceBatches(
  coinIds: string[],
  batchSize = PRICE_BATCH_SIZE,
): string[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const batches: string[][] = [];
  for (let index = 0; index < coinIds.length; index += batchSize) {
    batches.push(coinIds.slice(index, index + batchSize));
  }
  return batches;
}

export function parseCoinGeckoPrices(
  coinIds: string[],
  payload: unknown,
): PriceRow[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("CoinGecko returned an invalid price payload");
  }

  const response = payload as Record<string, unknown>;
  const rows: PriceRow[] = [];

  for (const coinId of coinIds) {
    const rawPrice = response[coinId];
    if (!rawPrice || typeof rawPrice !== "object" || Array.isArray(rawPrice)) {
      continue;
    }

    const value = rawPrice as Record<string, unknown>;
    const price = value.usd;
    const updatedAt = value.last_updated_at;

    if (
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0 ||
      typeof updatedAt !== "number" ||
      !Number.isInteger(updatedAt) ||
      updatedAt <= 0
    ) {
      continue;
    }

    const providerUpdatedAt = new Date(updatedAt * 1000);
    if (Number.isNaN(providerUpdatedAt.getTime())) continue;

    rows.push({
      coin_id: coinId,
      price_usd: price,
      provider_updated_at: providerUpdatedAt.toISOString(),
    });
  }

  return rows;
}

export async function runPriceCheck(
  dependencies: PriceCheckDependencies,
): Promise<PriceCheckResult> {
  const coinIds = normalizeCoinIds(await dependencies.listWatchedCoinIds());
  const batches = splitIntoPriceBatches(coinIds);
  const result: PriceCheckResult = {
    watchedCoins: coinIds.length,
    batches: batches.length,
    successfulBatches: 0,
    failedBatches: 0,
    pricesUpdated: 0,
    eventsCreated: 0,
    skipped: coinIds.length === 0,
    failures: [],
  };

  for (const [index, batch] of batches.entries()) {
    try {
      const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
      const payload = await dependencies.fetchPricePayload(batch);
      const rows = parseCoinGeckoPrices(batch, payload);
      const processed = rows.length === 0
        ? { pricesUpdated: 0, eventsCreated: 0 }
        : await dependencies.processPriceRows(rows, fetchedAt);

      result.successfulBatches += 1;
      result.pricesUpdated += processed.pricesUpdated;
      result.eventsCreated += processed.eventsCreated;
    } catch (error) {
      result.failedBatches += 1;
      result.failures.push(
        `Batch ${index + 1}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  return result;
}
