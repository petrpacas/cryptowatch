import { createClient } from "@supabase/supabase-js";
import { createPriceCheckDependencies } from "../_shared/price-runtime.ts";
import {
  getSupabaseSecretKey,
  jsonResponse,
} from "../_shared/supabase.ts";
import {
  isAuthorizedRequest,
  normalizeCoinIds,
  runPriceCheck,
} from "./prices.ts";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const workerSecret = Deno.env.get("WORKER_SECRET");
  if (!isAuthorizedRequest(request, workerSecret)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey = getSupabaseSecretKey();
  const coinGeckoApiKey = Deno.env.get("COINGECKO_DEMO_API_KEY");

  if (!supabaseUrl || !supabaseSecretKey || !coinGeckoApiKey) {
    return jsonResponse({ error: "The function is missing required secrets" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const result = await runPriceCheck(createPriceCheckDependencies(
      supabase,
      coinGeckoApiKey,
      async () => {
        const { data, error } = await supabase.rpc("get_watched_coin_ids");
        if (error) throw error;
        return normalizeCoinIds(data);
      },
    ));

    const status = result.failedBatches > 0 ? 207 : 200;
    return jsonResponse(result, status);
  } catch (error) {
    console.error("Price check failed", error);
    return jsonResponse(
      {
        error: "Price check failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      502,
    );
  }
});
