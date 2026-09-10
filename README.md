# CryptoWatch

Výuková aplikace pro sledování kryptoměn a jednorázová cenová upozornění. Stav projektu a všechna přijatá rozhodnutí jsou v [PLAN.md](./PLAN.md).

## Milník 4

Hotová aplikace nyní obsahuje:

- přihlášení magic linkem a Googlem, odhlášení a obnovení uložené relace,
- vyhledávání katalogu CoinGecko po 300 ms podle názvu, symbolu nebo ID,
- přidávání a odebírání libovolných měn z vlastního watchlistu,
- zobrazení poslední ceny nebo stavu „Čeká na první cenu“,
- ruční obnovení cen právě přihlášeného uživatele,
- vytváření, úpravu, vypnutí, opětovné zapnutí a mazání cenových alertů,
- RLS oddělující watchlist, alerty a historii jednotlivých uživatelů,
- interní Edge Function `check-prices`, která sdílí jedno načtení ceny mezi všemi uživateli,
- dávkování nejvýše 250 CoinGecko ID a pokračování po chybě samostatné dávky,
- atomické vytvoření neměnné události, zprávy v `pgmq` a deaktivaci alertu.

E-maily a pravidelné spouštění přes cron přibudou v milníku 5. Fronta v tomto kroku zprávy pouze bezpečně uchovává.

## Lokální spuštění

Požadavky: Node.js 20.19+, Docker Desktop se spuštěným Docker enginem a pro diagnostiku Edge Functions ve VS Code také Deno 2.9.6.

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

Do `supabase/functions/.env` doplň `COINGECKO_DEMO_API_KEY` a vytvoř dlouhý náhodný `WORKER_SECRET`. Interní funkce `sync-coins` a `check-prices` jako první kontrolují hlavičku `x-worker-secret`. Funkce `refresh-prices` místo toho ověřuje JWT přihlášeného uživatele a načte jen jeho watchlist. Secret key Supabase ani `WORKER_SECRET` se do prohlížeče neposílají.

Funkce můžeš v samostatném terminálu spustit takto:

```sh
npm run functions:serve
```

Synchronizaci katalogu vyvoláš:

```sh
curl -X POST \
  -H "x-worker-secret: TVUJ_WORKER_SECRET" \
  http://127.0.0.1:54321/functions/v1/sync-coins
```

Funkce zapíše měny po dávkách. Až po úspěšném zápisu celého výsledku označí chybějící měny jako neaktivní, takže chyba CoinGecko ponechá předchozí katalog použitelný.

### Kontrola cen a fronta

`check-prices` nejprve zjistí unikátní aktivní měny ve všech watchlistech. Pokud není sledovaná žádná měna, CoinGecko vůbec nevolá. Jinak pošle jednu nebo více dávek do `/simple/price` a každou úspěšnou dávku předá databázové funkci `process_price_batch`:

```sh
curl -X POST \
  -H "x-worker-secret: TVUJ_WORKER_SECRET" \
  http://127.0.0.1:54321/functions/v1/check-prices
```

Databázová funkce v jedné transakci uloží cenu a zamkne vyhovující alerty. Čerstvá cena musí být striktně nad nebo pod limitem; rovnost ani poskytovatelem neaktualizovaná cena starší než 15 minut alert nespustí. Pro každou verzi aktivace vznikne nejvýše jedna událost a právě jedna zpráva `{"event_id":"…"}` ve frontě `notification_emails`.

Frontu si můžeš prohlédnout v Supabase Studio nebo v SQL editoru:

```sql
select msg_id, enqueued_at, message
from pgmq.q_notification_emails
order by msg_id;
```

`pgmq` schéma není vystavené přes Data API a přihlášený uživatel do něj nemá přístup. Zprávy bude číst až interní `send-notifications` v milníku 5.

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
npm run functions:lint
npm run functions:test
npm run milestone3:check
npm run milestone4:check
npm run manual-refresh:check
```

Kontroly funkcí používají oficiální Deno 2.9.6 Docker image, stejnou verzi jako doporučené lokální CLI pro editor. Databázové testy běží v transakci a po dokončení svá testovací data vrátí zpět.

`npm run milestone3:check` provede celý lokální scénář přes veřejný Supabase klient: zachytí magic link v Mailpitu, přihlásí testovacího uživatele, vyhledá Dogecoin, přidá jej do watchlistu, vytvoří a upraví alert a nakonec aplikační data uklidí.

`npm run milestone4:check` vloží do lokální databáze izolovaný alert a spustí dvě cenové kontroly současně. Ověří, že souběh vytvořil právě jednu událost, jednu queue zprávu a alert deaktivoval; testovací data následně uklidí. Databázové pgTAP testy navíc pokrývají ceny pod, přesně na a nad hranicí, chybějící a zastaralý čas poskytovatele, starší běh workeru a novou verzi po reaktivaci.

`npm run manual-refresh:check` ověří CORS, odmítnutí anonymního požadavku a celý ruční refresh s platnou uživatelskou relací. Test používá samostatného lokálního uživatele a svůj watchlist po dokončení uklidí.

Pro správnou kontrolu TypeScriptu v Edge Functions nainstaluj [Deno CLI](https://docs.deno.com/runtime/getting_started/installation/) (`brew install deno` na macOS) a doporučené rozšíření **Deno** ve VS Code. Po prvním otevření projektu případně spusť „Developer: Reload Window“. Soubor `supabase/functions/deno.json` definuje všechny externí importy; frontend nadále kontroluje TypeScript přes Svelte a lokální verzi z `node_modules`.

## Konfigurace a tajemství

- `.env` obsahuje veřejné hodnoty frontendu a lokální Google OAuth konfiguraci. Vite zpřístupní prohlížeči pouze proměnné začínající `VITE_`; Google Client Secret zůstane dostupný jen Supabase CLI.
- `supabase/functions/.env` obsahuje pouze vlastní tajemství Edge Functions: CoinGecko, Resend a `WORKER_SECRET`. Supabase do funkcí automaticky přidává `SUPABASE_URL`, databázové URL a API klíče; ručně je sem nekopíruj.
- Edge Functions kořenový `.env` automaticky nečtou.
- Do Gitu patří pouze soubory `.env.example` s nefunkčními zástupnými hodnotami.
- `supabase/config.toml` patří do Gitu; skutečná tajemství v něm musí být uvedena jen přes `env(...)`.

Použité návody: [Vite](https://vite.dev/guide/), [lokální Supabase](https://supabase.com/docs/guides/local-development), [magic link](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [Google přihlášení](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [databázové testy](https://supabase.com/docs/guides/local-development/testing/overview), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [konfigurace funkcí](https://supabase.com/docs/guides/functions/function-configuration), [Supabase Queues/pgmq](https://supabase.com/docs/guides/queues/pgmq), [CoinGecko `/coins/list`](https://docs.coingecko.com/demo/reference/coins-list) a [CoinGecko `/simple/price`](https://docs.coingecko.com/reference/simple-price).
