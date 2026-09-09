import { createClient } from "npm:@supabase/supabase-js@2";
import { parseCoinCatalog, splitIntoBatches } from "./catalog.ts";

const COINGECKO_COINS_URL =
  "https://api.coingecko.com/api/v3/coins/list?include_platform=false";
const BATCH_SIZE = 500;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getSupabaseSecretKey(): string | undefined {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Fall through to the legacy key used by older local runtimes.
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const workerSecret = Deno.env.get("WORKER_SECRET");
  if (!workerSecret || request.headers.get("x-worker-secret") !== workerSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey = getSupabaseSecretKey();
  const coinGeckoApiKey = Deno.env.get("COINGECKO_DEMO_API_KEY");

  if (!supabaseUrl || !supabaseSecretKey || !coinGeckoApiKey) {
    return jsonResponse({ error: "The function is missing required secrets" }, 500);
  }

  try {
    const response = await fetch(COINGECKO_COINS_URL, {
      headers: {
        accept: "application/json",
        "x-cg-demo-api-key": coinGeckoApiKey,
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`CoinGecko request failed with status ${response.status}`);
    }

    const coins = parseCoinCatalog(await response.json());
    const syncRunId = crypto.randomUUID();
    const syncedAt = new Date().toISOString();
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const batch of splitIntoBatches(coins, BATCH_SIZE)) {
      const rows = batch.map((coin) => ({
        ...coin,
        is_active: true,
        last_seen_sync_id: syncRunId,
        synced_at: syncedAt,
      }));

      const { error } = await supabase
        .from("coins")
        .upsert(rows, { onConflict: "id", defaultToNull: false });

      if (error) throw error;
    }

    const { data, error } = await supabase.rpc("finish_coin_sync", {
      p_sync_run_id: syncRunId,
    });

    if (error) throw error;

    return jsonResponse({
      synced: coins.length,
      active: data?.[0]?.active_count ?? coins.length,
      deactivated: data?.[0]?.deactivated_count ?? 0,
      syncRunId,
    });
  } catch (error) {
    console.error("Catalog synchronization failed", error);
    return jsonResponse(
      {
        error: "Catalog synchronization failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      502,
    );
  }
});
