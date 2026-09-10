# CryptoWatch

Výuková aplikace pro sledování kryptoměn a jednorázová cenová upozornění. Stav projektu a všechna přijatá rozhodnutí jsou v [PLAN.md](./PLAN.md).

## Milník 5

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
- interní Edge Function `send-notifications`, která odesílá e-maily přes Resend,
- nejvýše pět pokusů během 23 hodin, dvouminutové skrytí převzaté zprávy a pokračování po chybě jednoho e-mailu,
- stabilní Resend idempotency key podle ID události, který brání duplicitě i při pádu po přijetí e-mailu poskytovatelem,
- cron pro ceny každých 10 minut, e-maily každou minutu a katalog jednou denně.

## Lokální spuštění

Požadavky: Node.js 20.19+, Docker Desktop se spuštěným Docker enginem a pro diagnostiku Edge Functions ve VS Code také Deno 2.9.6.

```sh
npm install
cp .env.example .env
cp supabase/functions/.env.example supabase/functions/.env
npm run supabase:start
npm run db:reset
npm run workers:configure
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

Do `supabase/functions/.env` doplň `COINGECKO_DEMO_API_KEY`, `RESEND_API_KEY`, ověřeného odesílatele `RESEND_FROM` a vytvoř dlouhý náhodný `WORKER_SECRET`. Interní funkce `sync-coins`, `check-prices` a `send-notifications` jako první kontrolují hlavičku `x-worker-secret`. Funkce `refresh-prices` místo toho ověřuje JWT přihlášeného uživatele a načte jen jeho watchlist. Secret key Supabase ani `WORKER_SECRET` se do prohlížeče neposílají.

Po změně `supabase/functions/.env` restartuj lokální Supabase. `npm run workers:configure` bezpečně uloží URL funkcí a `WORKER_SECRET` do lokálního Supabase Vaultu a provede první synchronizaci CoinGecko katalogu. Příkaz je opakovatelný: existující Vault hodnoty aktualizuje a cron úlohy už vznikly z migrace.

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

`pgmq` schéma není vystavené přes Data API a přihlášený uživatel do něj nemá přístup. Zprávy čte jen interní `send-notifications` přes tři `security definer` databázové funkce dostupné výhradně roli `service_role`.

### E-maily, opakování a cron

`send-notifications` každou minutu převezme nejvýše pět zpráv a na dvě minuty je skryje ostatním konzumentům. Před odesláním atomicky zvýší `delivery_attempts`. Úspěšnou zprávu označí jako `sent`, uloží ID od Resendu a přesune ji do archivu fronty. Chyby `429`, `5xx`, síťové chyby a souběžný požadavek se stejným idempotency key zkusí znovu; ostatní chyby ukončí hned. Pátý neúspěšný pokus nebo 23 hodin od prvního pokusu nastaví stav `failed` pro ruční kontrolu.

Každý požadavek na Resend používá `cryptowatch/notification/<event-id>`. Obsah e-mailu vzniká pouze z neměnného snapshotu události, takže další pokus odešle stejný obsah se stejným klíčem. Resend tento klíč drží 24 hodin; kratší 23hodinové okno ponechává časovou rezervu.

Naplánované databázové úlohy zobrazíš v Supabase Studio v části Cron nebo SQL dotazem:

```sql
select jobname, schedule, command
from cron.job
where jobname like 'cryptowatch-%'
order by jobname;
```

Lokální cron používá adresu `host.docker.internal`, protože požadavek vzniká uvnitř databázového kontejneru. Ceny se kontrolují po 10 minutách kvůli limitu CoinGecko; minutový odesílač už externí cenové API nevolá a pouze rychle vybírá hotové zprávy z fronty. Katalog se synchronizuje denně v 03:17.

Skutečný testovací e-mail pošli až na adresu, kterou smíš použít:

```sh
npm run email:check -- tvoje@adresa.cz
```

Skript vytvoří izolovanou událost, zavolá worker dvakrát, ověří jediný databázový pokus a testovací data uklidí. Doručení zkontroluj v inboxu a v Resend dashboardu. Pro tento test musí lokální Supabase běžet s platnými hodnotami `RESEND_API_KEY`, `RESEND_FROM` a `WORKER_SECRET`.

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

Pro běžnou statickou a automatickou kontrolu stačí:

```sh
npm run verify
```

Obnova schématu a integrační scénáře jsou záměrně oddělené, protože mění lokální data nebo volají externí CoinGecko/Resend:

```sh
npm run db:reset
npm run workers:configure
npm run app:check
npm run workers:check
npm run email:check -- tvoje@adresa.cz
```

Kontroly funkcí používají oficiální Deno 2.9.6 Docker image, stejnou verzi jako doporučené lokální CLI pro editor. Databázové testy běží v transakci a po dokončení svá testovací data vrátí zpět.

`npm run app:check` nyní sdružuje dříve oddělené a z velké části duplicitní kontroly milníku 3 a ručního refreshu. Přes veřejný Supabase klient ověří magic link, vyhledávání, watchlist, správu alertu, kaskádové smazání, CORS, odmítnutí anonymního refreshu a načtení ceny přihlášeného uživatele.

`npm run workers:check` ověří souběžné cenové kontroly. Databázové pgTAP testy pokrývají RLS, cenové hranice, frontu, atomické převzetí e-mailu, retry limit, časové okno a cron. Deno testy ověřují parsování poskytovatelů, dávkování, tvorbu e-mailu, klasifikaci chyb a pád po přijetí e-mailu Resendem. Tyto vrstvy mají rozdílný účel, proto zůstávají oddělené; počet samostatných Node integračních souborů se snížil ze tří na dva.

Pro správnou kontrolu TypeScriptu v Edge Functions nainstaluj [Deno CLI](https://docs.deno.com/runtime/getting_started/installation/) (`brew install deno` na macOS) a doporučené rozšíření **Deno** ve VS Code. Po prvním otevření projektu případně spusť „Developer: Reload Window“. Soubor `supabase/functions/deno.json` definuje všechny externí importy; frontend nadále kontroluje TypeScript přes Svelte a lokální verzi z `node_modules`.

## Konfigurace a tajemství

- `.env` obsahuje veřejné hodnoty frontendu a lokální Google OAuth konfiguraci. Vite zpřístupní prohlížeči pouze proměnné začínající `VITE_`; Google Client Secret zůstane dostupný jen Supabase CLI.
- `supabase/functions/.env` obsahuje pouze vlastní tajemství Edge Functions: CoinGecko, Resend a `WORKER_SECRET`. Supabase do funkcí automaticky přidává `SUPABASE_URL`, databázové URL a API klíče; ručně je sem nekopíruj.
- Edge Functions kořenový `.env` automaticky nečtou.
- Do Gitu patří pouze soubory `.env.example` s nefunkčními zástupnými hodnotami.
- `supabase/config.toml` patří do Gitu; skutečná tajemství v něm musí být uvedena jen přes `env(...)`.

Použité návody: [Vite](https://vite.dev/guide/), [lokální Supabase](https://supabase.com/docs/guides/local-development), [magic link](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [Google přihlášení](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [databázové testy](https://supabase.com/docs/guides/local-development/testing/overview), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [konfigurace funkcí](https://supabase.com/docs/guides/functions/function-configuration), [plánování Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase Vault](https://supabase.com/docs/guides/database/vault), [Supabase Queues/pgmq](https://supabase.com/docs/guides/queues/pgmq), [Resend API](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [CoinGecko `/coins/list`](https://docs.coingecko.com/demo/reference/coins-list) a [CoinGecko `/simple/price`](https://docs.coingecko.com/reference/simple-price).
