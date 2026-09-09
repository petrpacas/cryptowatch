# CryptoWatch

Výuková aplikace pro sledování kryptoměn a jednorázová cenová upozornění. Stav projektu a všechna přijatá rozhodnutí jsou v [PLAN.md](./PLAN.md).

## Milník 3

Hotová aplikace nyní obsahuje:

- přihlášení magic linkem a Googlem, odhlášení a obnovení uložené relace,
- vyhledávání katalogu CoinGecko po 300 ms podle názvu, symbolu nebo ID,
- přidávání a odebírání libovolných měn z vlastního watchlistu,
- zobrazení poslední ceny nebo stavu „Čeká na první cenu“,
- vytváření, úpravu, vypnutí, opětovné zapnutí a mazání cenových alertů,
- RLS oddělující watchlist, alerty a historii jednotlivých uživatelů.

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

### Přihlášení

Magic link se při lokálním vývoji neposílá na internet. Otevři `http://localhost:54324`, vyber zprávu a klikni na přihlašovací odkaz.

Pro Google přihlášení vytvoř v Google Auth Platform OAuth klienta typu **Web application** a nastav:

- Authorized JavaScript origin: `http://localhost:5173`
- Authorized redirect URI: `http://127.0.0.1:54321/auth/v1/callback`

Client ID a Client Secret vlož do kořenového `.env` jako `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` a `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`. Potom spusť `npm run supabase:stop` a `npm run supabase:start`, protože změna Auth konfigurace vyžaduje restart lokálního stacku.

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
npm run milestone3:check
```

`npm run functions:test` používá oficiální Deno 2.1.4 Docker image, stejnou verzi Deno jako lokální Supabase Edge Runtime. Databázové testy běží v transakci a po dokončení svá testovací data vrátí zpět.

`npm run milestone3:check` provede celý lokální scénář přes veřejný Supabase klient: zachytí magic link v Mailpitu, přihlásí testovacího uživatele, vyhledá Dogecoin, přidá jej do watchlistu, vytvoří a upraví alert a nakonec aplikační data uklidí.

## Konfigurace a tajemství

- `.env` obsahuje veřejné hodnoty frontendu a lokální Google OAuth konfiguraci. Vite zpřístupní prohlížeči pouze proměnné začínající `VITE_`; Google Client Secret zůstane dostupný jen Supabase CLI.
- `supabase/functions/.env` obsahuje pouze vlastní tajemství Edge Functions: CoinGecko, Resend a `WORKER_SECRET`. Supabase do funkcí automaticky přidává `SUPABASE_URL`, databázové URL a API klíče; ručně je sem nekopíruj.
- Edge Functions kořenový `.env` automaticky nečtou.
- Do Gitu patří pouze soubory `.env.example` s nefunkčními zástupnými hodnotami.
- `supabase/config.toml` patří do Gitu; skutečná tajemství v něm musí být uvedena jen přes `env(...)`.

Použité návody: [Vite](https://vite.dev/guide/), [lokální Supabase](https://supabase.com/docs/guides/local-development), [magic link](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [Google přihlášení](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [databázové testy](https://supabase.com/docs/guides/local-development/testing/overview), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets) a [CoinGecko `/coins/list`](https://docs.coingecko.com/demo/reference/coins-list).
