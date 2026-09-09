# CryptoWatch: aktualizovaný plán přípravy a vývoje

## 1. Výsledek a rozsah

Vytvoříme malé funkční demo ve **Svelte 5 + TypeScript + Vite**, s backendem v Supabase a frontendem na Netlify. **Supabase projekt se bude jmenovat `cryptowatch`.**

Aplikace nabídne:

- Přihlášení magic linkem a Googlem, odhlášení a zachování přihlášení po obnovení stránky.
- **Vyhledávání libovolných aktivních kryptoměn dostupných v katalogu CoinGecko** podle názvu nebo symbolu.
- Vlastní seznam sledovaných měn, do kterého lze měny přidávat a odebírat. Sledování měny nevyžaduje vytvoření alertu.
- Zobrazení poslední ceny v USD a času její aktualizace.
- Cenové alerty pro sledované měny: podmínka nad/pod, cenový limit, úprava, vypnutí a opětovné zapnutí.
- Jednorázové upozornění: při prvním splnění podmínky vznikne e-mail a alert se deaktivuje.
- **Odebrání měny smaže také všechny její alerty daného uživatele. Historie upozornění zůstane zachovaná.**

Výchozí rozsah je jednoduché responzivní UI v češtině. Grafy, portfolio a vyhledávání tokenů mimo katalog CoinGecko jsou mimo první verzi.

## 2. Co připravíš ty

Node 24, npm, Git, Homebrew a Codex už máš. Složka projektu je zatím prázdná.

| Co | Příprava |
|---|---|
| **Docker** | Nainstalovat a spustit Docker Desktop pro Apple Silicon. |
| **GitHub** | Připravit účet a přihlášení. Model založí soukromý repozitář `cryptowatch`. |
| **Supabase** | Vytvořit Free projekt **`cryptowatch`** v evropském regionu. Uložit databázové heslo do správce hesel. |
| **Resend** | Účet, API klíč a ověřená odesílací subdoména, například `mail.tvojedomena.cz`. Přidat DNS záznamy podle Resend. |
| **Google Cloud** | Projekt, OAuth klient typu „Web application“, Client ID a Client Secret. Pro testování připravit svůj a kamarádův účet. |
| **CoinGecko** | Účet a Demo API klíč. |
| **Netlify** | Free účet propojený s GitHubem. Pro web stačí přidělená adresa `*.netlify.app`. |

Pro začátek stačí běžící Docker; účty a DNS můžeš připravovat během lokálního vývoje. Model zajistí projektové závislosti, Supabase CLI, Deno pro testy a konfiguraci projektu. [Lokální Supabase](https://supabase.com/docs/guides/local-development)

Při nastavování přihlášení rozlišit:

- **Google OAuth callback:** lokálně `http://127.0.0.1:54321/auth/v1/callback`, v cloudu callback z nastavení Supabase.
- **Návrat do aplikace:** `http://localhost:5173/` a finální Netlify URL, povolené v Supabase Auth. [Google přihlášení](https://supabase.com/docs/guides/auth/social-login/auth-google)

Přihlašovací e-maily zajistí Supabase Auth přes **Resend SMTP**. Cenová upozornění odešlou Edge Functions přes **Resend API**. [Nastavení SMTP](https://resend.com/docs/send-with-supabase-smtp)

Tajemství budou v ignorovaných lokálních konfiguracích a nastavení služeb. Frontend dostane pouze Supabase URL a veřejný klíč.

## 3. Technický návrh

### Vyhledávání a sledované měny

Katalog kryptoměn bude uložený v Supabase. Interní Edge Function `sync-coins` jej načte z CoinGecko `/coins/list` při prvním zprovoznění a potom jednou denně. Endpoint vrací celý katalog v jedné odpovědi. [Katalog CoinGecko](https://docs.coingecko.com/demo/reference/coins-list)

Vyhledávání bude používat databázovou funkci `search_coins(query)`, dostupnou přihlášeným uživatelům:

- Hledat v názvu, symbolu a CoinGecko ID bez rozlišení velikosti písmen.
- Spouštět po 300 ms od posledního psaní; prázdný dotaz nevyhledává.
- Vrátit nejvýše 20 výsledků, přednostně přesné shody a potom shody podle začátku názvu.
- Zobrazit název, symbol a odkaz na CoinGecko; již sledované měny označit jako přidané.
- Pro identifikaci všude používat **CoinGecko ID**, které rozlišuje i měny se stejným symbolem.

Každý uživatel může mít jednu měnu ve sledovaných pouze jednou. Po přidání se zobrazí uložená cena; pokud ještě není dostupná, UI ukáže „Čeká na první cenu“. První načtení proběhne při následující pravidelné kontrole.

Při neúspěšné synchronizaci katalogu zůstane předchozí katalog dostupný. Měny, které zmizí z úspěšně načteného katalogu, se označí jako neaktivní. Existující sledování zůstane viditelné s informací o nedostupnosti.

### Databáze a oprávnění

| Tabulka | Účel |
|---|---|
| `coins` | Sdílený katalog: CoinGecko ID, název, symbol a aktivita v katalogu. |
| `watchlist` | Sledované měny uživatele; unikátní dvojice `user_id` a `coin_id`. |
| `alerts` | Vlastník, sledovaná měna, směr, kladný limit, aktivita a verze aktivace. |
| `prices` | Poslední cena v USD a čas dat od poskytovatele pro jednotlivé měny. |
| `notification_events` | Událost pro konkrétní aktivaci, neměnný obsah e-mailu, stav a pokusy o odeslání. |

Alert musí odkazovat na měnu ve watchlistu stejného uživatele. Odstranění položky watchlistu kaskádově odstraní její alerty; události zůstanou uchované nezávisle na existenci alertu.

RLS nastaví:

- Uživatel spravuje pouze svůj watchlist a své alerty.
- Uživatel čte pouze svou historii upozornění.
- Přihlášení uživatelé mohou číst katalog a ceny.
- Katalog, ceny, systémové stavy a frontu mění pouze backend.
- Kontroly vlastníka platí také při vkládání a změně řádků. [RLS v Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)

### Kontrola cen a upozornění

`check-prices` poběží každých **10 minut**:

1. Zjistí všechny unikátní aktivní měny sledované alespoň jedním uživatelem.
2. Načte jejich ceny přes `/simple/price` v dávkách maximálně **250 CoinGecko ID**. Stejnou měnu načítá společně pro všechny uživatele.
3. Uloží platné ceny a vyhodnotí aktivní alerty.
4. V jedné databázové transakci zamkne vyhovující alert, vytvoří událost, vloží zprávu do `pgmq` a deaktivuje alert.

Pokud nikdo nic nesleduje, cenové API se nevolá. Chyba jedné dávky nebrání zpracování ostatních. [Hromadné načítání cen](https://docs.coingecko.com/demo/reference/simple-price)

Podmínky jsou striktně `>` a `<`. Rovnost alert nespustí. Podmínka splněná už při vytvoření vyvolá upozornění při následující kontrole. Chybějící, neplatná nebo více než 15 minut stará cena alert nespustí.

Unikátní kombinace alertu a verze aktivace zabrání duplicitním událostem při souběhu kontrol. Nové uložení pravidla nebo opětovné zapnutí vytvoří novou aktivaci. Již vytvořené události se dokončí podle původního obsahu i po změně nebo odstranění alertu.

Při jedné dávce sledovaných měn jde za 31 dní o **4 464 cenových požadavků plus přibližně 31 synchronizací katalogu**. Další dávky spotřebu zvyšují. Rozpočtovým předpokladem je malé demo pro několik uživatelů; Demo tarif má 10 000 volání měsíčně. UI uvede CoinGecko jako zdroj dat s odkazem. [CoinGecko tarif](https://www.coingecko.com/en/api/pricing)

### Fronta, cron a zabezpečení

`send-notifications` poběží každou **minutu**:

- Přečte nejvýše pět zpráv s dvouminutovým skrytím před dalšími konzumenty.
- Odešle e-mail na ověřenou adresu vlastníka ze Supabase Auth.
- Použije neměnný obsah a stabilní Resend idempotency key odvozený z ID události.
- Zprávu potvrdí až po zaznamenání úspěchu. Již zpracovanou událost znovu neposílá.
- Přechodné chyby opakuje maximálně pětkrát a pouze během 23 hodin od prvního pokusu. Poté událost označí k ruční kontrole. Resend uchovává idempotency keys 24 hodin. [Deduplikace Resend](https://resend.com/docs/dashboard/emails/idempotency-keys)

Použijeme `pg_cron`, `pg_net` a `pgmq`. Všechny tři Edge Functions přijímají interní POST s ověřeným `WORKER_SECRET`. Při vypnutém gateway JWT ověřování musí vlastní kontrola tajemství proběhnout před jakoukoli prací.

Cron čte tajemství a adresy z Vaultu. Lokální adresy musí být dostupné z Docker kontejneru, například přes `host.docker.internal`. [Plánování funkcí](https://supabase.com/docs/guides/functions/schedule-functions), [lokální adresování](https://supabase.com/docs/guides/database/webhooks)

Schéma, oprávnění a databázové funkce budou v migracích. Opakovatelný instalační krok doplní konfiguraci prostředí, provede první synchronizaci katalogu a aktivuje cron.

## 4. Milníky a ověření

| Milník | Výstup | Podmínka dokončení |
|---|---|---|
| **1. Základ a MCP** | Svelte projekt, Git, lokální Supabase, vzory konfigurací a MCP. | Web i Supabase běží; model přes MCP vypíše tabulky. |
| **2. Databáze a katalog** | Migrace, RLS, synchronizace katalogu a vyhledávání. | Databázi lze obnovit z migrací; vyhledávání najde měny mimo původní BTC/ETH/SOL. |
| **3. Přihlášení a watchlist** | Oba způsoby přihlášení, přidávání a odebírání měn, správa alertů. | Seznam přežije obnovení stránky; dva uživatelé mají oddělená data. |
| **4. Ceny a fronta** | Hromadné načítání cen, vyhodnocení a atomické vytvoření upozornění. | Souběžné kontroly vytvoří pro jednu aktivaci právě jednu událost. |
| **5. E-maily a cron** | Resend, opakování po chybě, deduplikace a plánování. | Dorazí skutečný e-mail; opakovaný pokus neodešle druhý. |
| **6. Nasazení a předání** | Supabase `cryptowatch`, Netlify a README. | Celý scénář projde na veřejné URL a projekt lze zprovoznit podle dokumentace. |

Po spuštění lokální Supabase připojit Codex:

```sh
codex mcp add supabase-local --url http://localhost:54321/mcp
```

Ověřit skutečný dotaz přes MCP. Změny schématu vždy zachovat také v migracích. [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Povinné testy a scénáře:

- Vyhledání podle názvu a symbolu, rozlišení dvou měn se stejným symbolem, prázdný výsledek a selhání synchronizace.
- Přidání měny bez alertu, zabránění duplicitě a zachování watchlistu po obnovení stránky.
- Odebrání měny odstraní její alerty pouze danému uživateli a zachová historii.
- RLS pro anonymního uživatele a dva účty, včetně pokusu podvrhnout vlastníka.
- Cena pod, na a nad hranicí; chybějící a zastaralá data; více cenových dávek; opětovná aktivace.
- Souběh kontrol a pád workeru po přijetí e-mailu Resendem, ale před zápisem výsledku.
- Odmítnutí interních funkcí bez správného tajemství.
- `svelte-check`, produkční build, databázové testy a Deno testy backendové logiky.
- Ruční ověření obou přihlášení, přidání vyhledané měny a skutečné notifikace na Netlify.

Netlify nastavíme na `npm run build` a publikování `dist`. Produkční nasazení dělej po dokončených milnících; aktuální Free tarif má 300 kreditů měsíčně a produkční deploy spotřebuje 15. [Vite na Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/), [Netlify kredity](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)

## 5. Předávání levnějšímu modelu

Předávej mu **jeden milník na zadání**. Začni tímto promptem a přilož celý plán:

> Vytváříme CryptoWatch podle přiloženého plánu. Supabase projekt se jmenuje cryptowatch. Znám základy webu a učím se Svelte a Supabase.
>
> Ulož plán do PLAN.md a implementuj milník 1. Dodrž stanovenou architekturu a rozsah. Sledované měny budou samostatný uživatelský seznam s vyhledáváním v katalogu CoinGecko.
>
> Ověřuj aktuální rozhraní v oficiální dokumentaci. Tajemství ukládej do příslušných konfigurací; v Gitu budou pouze jejich vzory.
>
> Po dokončení spusť příslušné kontroly, vytvoř smysluplný commit a napiš: co funguje, jak to ověřit, co musím doplnit osobně a co se mám z tohoto kroku naučit. Další milník bude samostatné zadání.

Silnějšímu modelu dej zkontrolovat **RLS, kaskádové mazání, databázové transakce a deduplikaci e-mailů**, potom finální změny před předáním.

Po každém milníku si výsledek sám vyzkoušej. README bude obsahovat postup zprovoznění, konfiguraci služeb, schéma toku dat, testování a postup předvedení kamarádovi.
