# CryptoWatch

Webová aplikace pro sledování cen kryptoměn a jednorázová e-mailová upozornění. Frontend používá Svelte 5 a TypeScript; backend tvoří Supabase Auth, PostgreSQL, Edge Functions, Cron a Queues.

**Demo:** [cryptowatch-demo.netlify.app](https://cryptowatch-demo.netlify.app/)

## Co aplikace umí

- Přihlášení přes Google nebo magic link.
- Vlastní seznam sledovaných měn, nezávislý na alertech, s vyhledáváním v katalogu CoinGecko.
- Poslední ceny v USD a ruční aktualizace nejvýše jednou za minutu na uživatele. Cron se do tohoto limitu nepočítá.
- E-mail přes Resend, když je cena nad nebo pod nastaveným limitem.

Alert se po splnění podmínky vypne a lze jej znovu aktivovat. Rovnost s limitem jej nespustí. Pokud je podmínka splněná už při vytvoření, vyhodnotí se při další kontrole cen.

## Jak to funguje

Data uživatelů odděluje Row Level Security (RLS); katalog a ceny jsou sdílené. Cron spouští tyto Edge Functions:

| Úloha | Interval | Účel |
| --- | --- | --- |
| `check-prices` | každých 10 minut | načte ceny sledovaných měn a vyhodnotí alerty |
| `send-notifications` | každou minutu | zpracuje frontu a odešle e-maily |
| `sync-coins` | denně v 03:17 UTC | obnoví katalog CoinGecko |

Ceny, vypnutí splněných alertů a zařazení upozornění do fronty se uloží v jedné transakci. Odesílání podporuje opakování po dočasné chybě a ochranu proti duplicitám. Cronové funkce vyžadují `WORKER_SECRET`; `refresh-prices` ověřuje uživatelský JWT.

Ceny závisejí na dostupnosti a čerstvosti dat CoinGecko. UI se automaticky neobnovuje; změny z cronu zobrazíš obnovením stránky.

## Lokální spuštění

Požadavky: Node.js 24, npm a běžící Docker.

Pro Edge Functions v editoru nainstaluj také Deno CLI a [doporučená rozšíření](.vscode/extensions.json). Kontroly spouštějí Deno v Dockeru.

```sh
npm ci
cp .env.example .env
cp supabase/functions/.env.example supabase/functions/.env
```

Doplň oba soubory:

| Soubor | Proměnné |
| --- | --- |
| `.env` ([vzor](.env.example)) | Lokální `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, Google OAuth Client ID a Secret |
| `supabase/functions/.env` ([vzor](supabase/functions/.env.example)) | CoinGecko Demo a Resend API klíče, ověřený odesílatel `RESEND_FROM` a `WORKER_SECRET` |

`WORKER_SECRET` vygeneruj pomocí `openssl rand -hex 32`. `SUPABASE_URL` a serverové API klíče dodává Edge Functions [Supabase automaticky](https://supabase.com/docs/guides/functions/secrets). Do Gitu patří pouze vzory; proměnné s prefixem `VITE_` jsou veřejné.

Pro [Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google) vytvoř klienta typu **Web application** s originem `http://localhost:5173` a callbackem `http://127.0.0.1:54321/auth/v1/callback`. Pro lokální běh pouze s magic linkem nastav `[auth.external.google].enabled = false` v `supabase/config.toml`.

Potom spusť:

```sh
npm run supabase:start
npm run supabase:status
```

Z výstupu zkopíruj lokální publishable key do `VITE_SUPABASE_PUBLISHABLE_KEY` v `.env` a pokračuj:

```sh
npx supabase migration up --local
npm run workers:configure
npm run dev
```

Migrace vytvoří cron úlohy. `workers:configure` uloží jejich přístupové údaje do Vaultu a provede první synchronizaci katalogu.

- Aplikace: <http://localhost:5173>
- Supabase Studio: <http://localhost:54323>
- Mailpit pro lokální přihlašovací e-maily: <http://localhost:54324>

**Cenové notifikace i lokálně odesílá skutečný Resend účet.**

Po změně Auth konfigurace nebo tajemství restartuj Supabase přes `npm run supabase:stop` a `npm run supabase:start`; po změně `WORKER_SECRET` zopakuj `npm run workers:configure`. **`npm run db:reset` smaže lokální databázi** a vyžaduje nové `npm run workers:configure`.

## Ověření

S běžící lokální Supabase a aplikovanými migracemi spusť:

```sh
npx playwright install chromium
npm run verify
```

`verify` zahrnuje kontrolu typů, build, UI a a11y testy, kontroly Edge Functions, databázové testy včetně RLS a SQL lint. GitHub Actions spouští stejnou sadu na čerstvé lokální Supabase a navíc ověřuje shodu generovaných databázových typů.

Volitelné integrační kontroly proti lokálním službám:

```sh
npm run app:check
npm run workers:check
npm run email:check -- tvoje@adresa.cz
```

`email:check` zpracovává lokální frontu a odesílá skutečné e-maily; spusť jej s prázdnou frontou. Po změně schématu spusť `npm run db:types`; po změně [e-mailové šablony](supabase/functions/_shared/email-layout.ts) spusť `npm run emails:build`. Generované soubory patří do commitu.

## Nasazení

Připrav vzdálený Supabase projekt `cryptowatch` a Netlify web se známou veřejnou URL. V Resendu ověř odesílací doménu. Do Google OAuth přidej origin webu a callback `https://TVUJ_PROJECT_REF.supabase.co/auth/v1/callback`.

Pokud nasazuješ na jinou URL než demo, uprav také `APP_URL` v [e-mailové šabloně](supabase/functions/_shared/email-layout.ts), aby cenové notifikace odkazovaly na správný web.

### Supabase

Skripty používají stejné Google údaje z `.env` a tajemství z `supabase/functions/.env` jako lokální běh. Cílový projekt určuje `supabase link`:

```sh
npx supabase login
npx supabase link --project-ref TVUJ_PROJECT_REF
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy
npm run workers:configure:remote
npm run auth:configure:remote -- https://TVUJ_WEB.netlify.app
```

`workers:configure:remote` nastaví Vault a synchronizuje katalog. `auth:configure:remote` nastaví Auth URL, Google, Resend SMTP a české šablony pro magic link i první registraci.

### Netlify

Propoj Git repozitář a nastav:

```text
VITE_SUPABASE_URL=https://TVUJ_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=PUBLISHABLE_KEY_VZDALENEHO_PROJEKTU
```

Build a SPA fallback nastavuje `netlify.toml`. Lokální `.env` dál míří na lokální Supabase; do Netlify patří pouze dvě veřejné hodnoty výše. Po jejich změně spusť nový build.

Push do připojené větve nasadí frontend. Změny databáze, Edge Functions a tajemství nasazuj příslušnými příkazy výše. Změna přihlašovacího e-mailu vyžaduje `auth:configure:remote`; změna cenového e-mailu nasazení Edge Functions.
