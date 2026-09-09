# CryptoWatch

Výuková aplikace pro sledování kryptoměn a jednorázová cenová upozornění. Stav projektu a všechna přijatá rozhodnutí jsou v [PLAN.md](./PLAN.md).

## Milník 1

Hotový základ obsahuje:

- Svelte 5, TypeScript a Vite,
- lokální Supabase projekt `cryptowatch`,
- bezpečné vzory konfigurace bez skutečných tajemství,
- lokální Supabase MCP server registrovaný v Codexu.

Databázové tabulky, katalog měn a přihlášení vzniknou v následujících milnících.

## Lokální spuštění

Požadavky: Node.js 20.19+ a Docker Desktop se spuštěným Docker enginem.

```sh
npm install
cp .env.example .env.local
npm run supabase:start
npm run dev
```

V prohlížeči pak otevři:

- aplikace: http://localhost:5173
- Supabase Studio: http://localhost:54323
- zachycené lokální e-maily: http://localhost:54324

Aktuální veřejný klíč lokální instance získáš přes `npm run supabase:status` a vložíš jej do `.env.local`. Lokální stack zastavíš příkazem `npm run supabase:stop`; data zůstanou zachovaná.

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
```

## Konfigurace a tajemství

- `.env.local` obsahuje hodnoty pro lokální frontend a Git jej ignoruje.
- `supabase/.env` bude později obsahovat tajemství Edge Functions a Git jej ignoruje.
- Do Gitu patří pouze soubory `.env.example` s nefunkčními zástupnými hodnotami.
- `supabase/config.toml` patří do Gitu; skutečná tajemství v něm musí být uvedena jen přes `env(...)`.

Použité návody: [Vite](https://vite.dev/guide/), [lokální Supabase](https://supabase.com/docs/guides/local-development) a [OpenAI Docs pro MCP v Codexu](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
