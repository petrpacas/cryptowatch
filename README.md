# CryptoWatch

Výuková aplikace pro sledování kryptoměn a jednorázová cenová upozornění. Stav projektu a všechna přijatá rozhodnutí jsou v [PLAN.md](./PLAN.md).

## Milník 2

Hotová databázová vrstva obsahuje:

- migrovatelné tabulky `coins`, `watchlist`, `alerts`, `prices` a `notification_events`,
- RLS oddělující data uživatelů a omezená oprávnění pro systémové tabulky,
- vyhledávací RPC `search_coins(query)` s maximálně 20 výsledky,
- interní Edge Function `sync-coins` pro celý katalog CoinGecko,
- pgTAP testy schématu, omezení, kaskád a přístupů anonymního i dvou přihlášených uživatelů.

Přihlášení a uživatelské rozhraní watchlistu vzniknou v milníku 3.

## Lokální spuštění

Požadavky: Node.js 20.19+ a Docker Desktop se spuštěným Docker enginem.

```sh
npm install
cp .env.example .env
cp supabase/functions/.env.example supabase/functions/.env
npm run supabase:start
npm run db:reset
npm run dev
```

V prohlížeči pak otevři:

- aplikace: http://localhost:5173
- Supabase Studio: http://localhost:54323
- zachycené lokální e-maily: http://localhost:54324

Aktuální veřejný klíč lokální instance získáš přes `npm run supabase:status` a vložíš jej do `.env`. Lokální stack zastavíš příkazem `npm run supabase:stop`; data zůstanou zachovaná.

Do `supabase/functions/.env` doplň `COINGECKO_DEMO_API_KEY` a vytvoř dlouhý náhodný `WORKER_SECRET`. Synchronizaci katalogu pak v samostatném terminálu spustíš takto:

```sh
npm run functions:serve
curl -X POST \
  -H "x-worker-secret: TVUJ_WORKER_SECRET" \
  http://127.0.0.1:54321/functions/v1/sync-coins
```

Funkce zapíše měny po dávkách. Až po úspěšném zápisu celého výsledku označí chybějící měny jako neaktivní, takže chyba CoinGecko ponechá předchozí katalog použitelný.

## Supabase MCP v Codexu

Lokální MCP endpoint poskytuje běžící Supabase CLI:

```sh
codex mcp add supabase-local --url http://localhost:54321/mcp
codex mcp list
```

Po přidání serveru restartuj aktuální Codex relaci. V terminálovém rozhraní lze stav zobrazit příkazem `/mcp`. Připojení ověříš například dotazem: „Jaké tabulky jsou v lokální Supabase databázi? Použij MCP.“

Stejný read-only dotaz lze ověřit i opakovatelným skriptem:

```sh
npm run mcp:check
```

## Kontroly

```sh
npm run check
npm run build
npm run db:reset
npm run db:test
npm run db:lint
npm run functions:check
npm run functions:test
```

`npm run functions:test` používá oficiální Deno 2.1.4 Docker image, stejnou verzi Deno jako lokální Supabase Edge Runtime. Databázové testy běží v transakci a po dokončení svá testovací data vrátí zpět.

## Konfigurace a tajemství

- `.env` obsahuje pouze veřejné hodnoty pro frontend: Supabase URL a publishable key.
- `supabase/functions/.env` obsahuje pouze vlastní tajemství Edge Functions: CoinGecko, Resend a `WORKER_SECRET`. Supabase do funkcí automaticky přidává `SUPABASE_URL`, databázové URL a API klíče; ručně je sem nekopíruj.
- Kořenový `.env` bude potřeba až pro tajemství odkazovaná přes `env(...)` v `supabase/config.toml`, například Google OAuth v milníku 3. Edge Functions jej automaticky nečtou.
- Do Gitu patří pouze soubory `.env.example` s nefunkčními zástupnými hodnotami.
- `supabase/config.toml` patří do Gitu; skutečná tajemství v něm musí být uvedena jen přes `env(...)`.

Použité návody: [Vite](https://vite.dev/guide/), [lokální Supabase](https://supabase.com/docs/guides/local-development), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [databázové testy](https://supabase.com/docs/guides/local-development/testing/overview), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [CoinGecko `/coins/list`](https://docs.coingecko.com/demo/reference/coins-list) a [OpenAI Docs pro MCP v Codexu](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
