import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PriceCheckDependencies,
  PriceRow,
} from "../check-prices/prices.ts";

const COINGECKO_PRICES_URL =
  "https://api.coingecko.com/api/v3/simple/price";

export function createPriceCheckDependencies(
  supabaseAdmin: SupabaseClient,
  coinGeckoApiKey: string,
  listWatchedCoinIds: () => Promise<string[]>,
): PriceCheckDependencies {
  return {
    listWatchedCoinIds,

    async fetchPricePayload(coinIds) {
      const query = new URLSearchParams({
        ids: coinIds.join(","),
        vs_currencies: "usd",
        include_last_updated_at: "true",
        precision: "full",
      });
      const response = await fetch(`${COINGECKO_PRICES_URL}?${query}`, {
        headers: {
          accept: "application/json",
          "x-cg-demo-api-key": coinGeckoApiKey,
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        throw new Error(
          `CoinGecko request failed with status ${response.status}`,
        );
      }

      return response.json();
    },

    async processPriceRows(rows: PriceRow[], fetchedAt: string) {
      const { data, error } = await supabaseAdmin.rpc("process_price_batch", {
        p_prices: rows,
        p_fetched_at: fetchedAt,
      });
      if (error) throw error;

      const summary = data?.[0];
      return {
        pricesUpdated: Number(summary?.prices_updated ?? 0),
        eventsCreated: Number(summary?.events_created ?? 0),
      };
    },
  };
}
