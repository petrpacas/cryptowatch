export function getApiKey(
  currentVariable: string,
  legacyVariable: string,
): string | undefined {
  const currentKeys = Deno.env.get(currentVariable);

  if (currentKeys) {
    try {
      const parsed = JSON.parse(currentKeys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Local runtimes using legacy keys do not provide the JSON dictionary.
    }
  }

  return Deno.env.get(legacyVariable);
}

export function getSupabaseSecretKey(): string | undefined {
  return getApiKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
}

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}
