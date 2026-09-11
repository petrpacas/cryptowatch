import { createClient } from "@supabase/supabase-js";
import { createPriceCheckDependencies } from "../_shared/price-runtime.ts";
import {
  corsHeaders,
  getSupabaseSecretKey,
  jsonResponse,
} from "../_shared/supabase.ts";
import { normalizeCoinIds, runPriceCheck } from "../check-prices/prices.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getSupabaseSecretKey();
  const coinGeckoApiKey = Deno.env.get("COINGECKO_DEMO_API_KEY");

  if (!supabaseUrl || !secretKey || !coinGeckoApiKey) {
    return jsonResponse(
      { error: "The function is missing required configuration" },
      500,
      corsHeaders,
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
  }

  const token = authorization.slice("Bearer ".length);
  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(
    token,
  );

  if (userError || !userData.user) {
    console.error("Manual refresh authentication failed", userError?.message);
    return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
  }

  try {
    const { data: allowed, error: claimError } = await supabaseAdmin.rpc(
      "claim_price_refresh", { p_user_id: userData.user.id },
    );
    if (claimError) throw claimError;
    if (!allowed) {
      return jsonResponse(
        { error: "Ceny lze ručně aktualizovat jednou za minutu. Zkus to prosím za chvíli." },
        429,
        { ...corsHeaders, "retry-after": "60" },
      );
    }
    const result = await runPriceCheck(createPriceCheckDependencies(
      supabaseAdmin,
      coinGeckoApiKey,
      async () => {
        const { data, error } = await supabaseAdmin
          .from("watchlist")
          .select("coin_id, coins!inner(is_active)")
          .eq("user_id", userData.user.id)
          .eq("coins.is_active", true);
        if (error) throw error;
        return normalizeCoinIds(data?.map((row) => row.coin_id) ?? []);
      },
    ));

    return jsonResponse(result, result.failedBatches > 0 ? 207 : 200, corsHeaders);
  } catch (error) {
    console.error("Manual price refresh failed", error);
    return jsonResponse(
      {
        error: "Manual price refresh failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      502,
      corsHeaders,
    );
  }
});
