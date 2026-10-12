# WasFix Pro

AI-gestuurde wasmachine diagnose + onderdelen platform. Beoogd adres: https://wasfix.nl (nog niet live; het draaiboek staat in [BLOCKED.md](BLOCKED.md)).

## Stack
- Next.js 15 (App Router) + TypeScript (strict)
- Tailwind CSS + custom shadcn/ui componenten + dark design system (`wasfix-design.css`)
- Prisma + PostgreSQL (Supabase in productie, lokaal Postgres of Docker)
- Google Gemini 2.0 Flash met keyword-fallback als er geen key is
- Clerk (auth); lokaal werkt alles zonder Clerk in demo-modus (alleen buiten productie)
- Stripe (iDEAL / kaart, abonnementen + eenmalige orders; alleen Nederland, zie `DECISIONS.md`)
- Resend (transactionele e-mails)
- Upstash Redis (rate limiting, optioneel) · Zustand (cart state)

## Quick start (zonder externe services)

Vereist Node 22.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Zonder `DATABASE_URL` en zonder Clerk-sleutels draait alles op de statische
catalogus in `src/data/*.json`, en is elke bezoeker de demo-beheerder, zodat je dashboard en `/admin` kunt zien.
Er wordt niets opgeslagen. (Nagegaan: deze twee commando's starten de site en `/`, `/onderdelen`,
`/foutcodes/Bosch-E18` en `/admin` antwoorden 200.) De getallen over de omvang van de catalogus berekent de
site zelf met `catalogStats()`; vertrouw op de pagina, niet op een getal in een document.

## Quick start (met database)

```bash
# Postgres via Docker (of een Supabase-verbindingsstring)
docker run -d --name wasfix-pg -e POSTGRES_PASSWORD=wasfix -e POSTGRES_DB=wasfix -p 5432:5432 postgres:16
export DATABASE_URL=postgresql://postgres:wasfix@localhost:5432/wasfix

npm run db:setup    # migraties toepassen + catalogus seeden (herhaalbaar)
npm run db:smoke    # CRUD- en relatiecontroles
npm run dev
```

Op een lokale database maakt de seed vier demo-accounts: `jdahoe@hotmail.nl` (ADMIN, in demo-modus is elke
bezoeker dit account), `demo@wasfixpro.nl` (ADMIN), `monteur@wasfixpro.nl` en `klant@wasfixpro.nl`. **Op een
database die niet op deze machine staat (of met `NODE_ENV=production`) maakt de seed geen enkel account**
en zet ze de voorraad van elk onderdeel op 0; zie [BLOCKED.md](BLOCKED.md) voor het eerste beheerdersaccount.

Omgevingsvariabelen: kopieer `.env.example` naar `.env.local`; elke variabele staat daar met uitleg.

## Scripts

| Script | Doel |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (`build` draait eerst `prisma generate`) |
| `npm run typecheck` / `lint` | CI-controles |
| `npm run db:setup` | migraties toepassen + seeden |
| `npm run db:migrate:deploy` / `db:migrate:status` | migraties toepassen / tonen, via `DIRECT_URL` als die is gezet (`scripts/migrate.ts`) |
| `npm run db:seed` | alleen seeden (productiemodus op een externe database: geen gebruikers, voorraad 0) |
| `npm run db:migrate` | nieuwe migratie maken tijdens ontwikkeling (`prisma migrate dev`) |
| `npm run db:smoke` · `money:smoke` | database- en geldcontroles (`scripts/qa-db.ts`, `scripts/qa-money.ts`) |
| `npm run smoke` | HTTP-controle tegen `BASE_URL` (standaard localhost:3000) |
| `npm run preflight` | controle vóór en na de livegang, zie [BLOCKED.md](BLOCKED.md) stap 10 |
| `npm run qa:csp` · `qa:platform` · `qa:preflight` | controles van de Content-Security-Policy, het platform en het preflight-script |
| `npm run qa:theme` · `qa:seo` · `qa:indexnow` | thema (licht standaard, schakelaar, contrast in beide thema's), SEO (de site gelezen zoals een zoekmachine) en de IndexNow-tooling; `qa:theme` en `qa:seo` hebben een productieserver nodig (`QA_BASE_URL`), zie Thema, SEO en Indexeren |
| `npm run seo:submit` · `seo:submit:live` | IndexNow: droogloop (leest de sitemap, verstuurt niets) of echte indiening; zie Indexeren |
| `npx tsx scripts/make-admin.ts <e-mail>` | een e-mailadres beheerder maken (gebruikt `DIRECT_URL`, anders `DATABASE_URL`) |
| `npm run db:studio` | Prisma Studio |

De overige `scripts/qa-*.ts` (orders, notify, checkout, stripe, plans, admin, diagnose, storefront) draait CI;
de aanroep per script staat in `.github/workflows/ci.yml`. Scripts die modules met `server-only` laden
draaien met `npx tsx --conditions=react-server`; `qa-admin` en `qa-plans` draaien juist zonder die vlag.

## Verdienmodel

Prijzen, plangrenzen, btw-tarief en bedrijfsgegevens staan op één plek:
`src/lib/plans.ts`. De prijspagina, de homepage, de upgradepagina, Stripe en de
entitlement-checks lezen daaruit, zodat ze niet uit elkaar kunnen lopen.

- **Gratis**: 3 AI-diagnoses per maand, gemeten per account en anders per
  bezoeker. Premium gidsen tonen de eerste twee stappen.
- **Particulier €4,99**, **Monteur Pro €29**, **Bedrijf €199** — alle drie
  direct af te sluiten, met 14 dagen proefperiode.
- **Onderdelen**: catalogusprijzen zijn inclusief 21% btw. Elke betaalde
  bestelling krijgt een doorlopend genummerde factuur met btw-specificatie op
  `/bestelling/[id]/factuur`. Een annulering of terugbetaling van een gefactureerde bestelling geeft een
  creditnota uit een eigen reeks (CN-JJJJ-NNNNN); een factuur wordt nooit gewijzigd of verwijderd.
- **Marge**: elk onderdeel heeft een inkoopprijs met een bron (`costSource`: `ESTIMATE` of `QUOTE`). Elk
  margecijfer in `/admin/economie` telt alleen offerteprijzen en noemt de rest "schatting". De inkoopprijzen die
  bij de catalogus horen zijn schattingen; zie [MONETIZATION.md](MONETIZATION.md) voor wat dat betekent.

**Monteurs factureren hun eigen klanten.** Vul de bedrijfsgegevens in op
`/monteur/instellingen` en elke werkorder met een bedrag wordt een factuur met
btw-specificatie, in de eigen doorlopende nummerreeks van die monteur. WasFix
staat er niet op — de monteur is de verkoper.

**Claims komen uit de data.** Elk getal over de omvang van de catalogus wordt
berekend met `catalogStats()` in `src/lib/catalog-stats.ts`, zodat een
marketingclaim niet kan afwijken van wat er werkelijk in staat.

Zie `MONETIZATION.md` voor de unit-economics en wat er commercieel nog moet
gebeuren.

## Modes

> **Demo-modus bestaat alleen buiten productie.** `getCurrentUser()` gaf in demo-modus iedereen het
> superadmin-account; met `NODE_ENV=production` stond `/admin` daarmee open voor elke bezoeker. Nu is demo-modus
> in productie altijd uit, ook als `DEMO_MODE=true` is gezet; zonder Clerk is daar niemand ingelogd en zijn
> dashboard, monteur en admin afgeschermd.

| | Lokaal, zonder Clerk (demo) | Productie |
|---|---|---|
| Auth | Iedereen is de demo-beheerder | Clerk (`/inloggen`, `/registreren`); middleware beschermt dashboard, admin, monteur en API |
| Beheerder | n.v.t. | `ADMIN_EMAILS` (alleen een door Clerk bevestigd adres) of `scripts/make-admin.ts` |
| Betalen | Zonder Stripe-sleutels: bankoverschrijving | iDEAL en kaart via Stripe (alleen met `STRIPE_SECRET_KEY` én `STRIPE_WEBHOOK_SECRET`), of bankoverschrijving |
| AI | Trefwoorden-terugval tenzij `GEMINI_API_KEY` (de terugval zegt dat) | idem |
| E-mail | Geen verzending tenzij `RESEND_API_KEY` | idem |
| Data | Statische catalogus, of persistent met `DATABASE_URL` | De database is verplicht |

Elke koppeling gaat aan zodra zijn variabele bestaat; `.env.example` noemt ze allemaal.

## Thema

**Licht is de standaard en is er altijd; donker is een schakelaar** (besluit D22 in [DECISIONS.md](DECISIONS.md)).
Een eerste bezoek zonder opgeslagen keuze is licht, ook als het besturingssysteem donker is: `defaultTheme="light"`
in `src/app/layout.tsx`. "Systeem" (volg het apparaat) is een derde, bewuste keuze. De schakelaar is
`src/components/theme-toggle.tsx` (Licht, Donker, Systeem; toetsenbord, 44 px, focusring) en staat in de kop van
elke pagina, in het mobiele menu, in de balk onderaan op een telefoon, in de voet en op `/inloggen` en
`/registreren`. De keuze staat in `localStorage` onder de sleutel `theme` (functioneel, geen toestemming nodig;
`/cookies` noemt hem), wordt door een inline script van `next-themes` vóór de eerste paint op `<html>` gezet
(geen flits) en blijft staan bij herladen en navigeren. Facturen, creditfacturen, pakbonnen en de sticker
printen altijd wit met donkere inkt, ook in donker: de donkere tokens gelden niet voor print.

**Een component themen: tokens, geen hex.** Kleuren komen uit `src/app/globals.css` (HSL-tripels per thema,
beide sets door `scripts/qa-theme.ts` op WCAG-contrast gemeten) en worden gebruikt via Tailwind (`bg-card`,
`text-muted-foreground`, `border-input`, statuskleuren `text-success`, `bg-warning/10`, `text-destructive`,
`bg-overlay`, `bg-code`) of `hsl(var(--token))`. De redesign-pagina's (`.wasfix-design`, `wasfix-design.css`) hebben
een eigen licht en donker palet met variabelen (`--surf-1`, `--text`, `--acc`, ...) en kanalen voor doorzichtige
mengsels (`rgb(var(--acc-rgb) / 0.08)`). Een kleurliteraal in een component is bijna altijd een fout; de
uitzonderingen (de logo's op `/pers`, de printsticker, de standalone foutpagina) staan met reden in de bron. 3D en
grafieken lezen de tokens (`src/components/3d/use-scene-palette.ts`, `hsl(var(--primary))` in recharts).
`<meta name="theme-color">` volgt de gekozen stand zodra de pagina geladen is, ook na elke navigatie binnen de site
(Next zet bij elke route-wissel de waarden van de server terug; een waarnemer op `<head>` zet de gekozen kleur weer
neer); vóór hydratatie en zonder JavaScript volgt de browserbalk de voorkeur van het apparaat (dat kan een
class-gebaseerde schakelaar niet anders). Op tabletbreedte (640 tot 1180 px) past de kop binnen het scherm: de
marketingkop staat in één regel en schakelt onder 1120 px naar het menu, de navigatie van de redesign-pagina's zet haar
links tussen 768 en 940 px op een tweede regel onder de kop (onder 768 px is de balk onderaan de navigatie); `scripts/qa-theme.ts` meet
dat op 640, 768, 900, 960, 1024, 1100 en 1180 px, licht en donker, en dat de andere pagina's vanuit de kop bereikbaar
blijven. Op een telefoon (320 tot 480 px) blijft het geopende menu binnen de marges: de kleurkeuze staat onder het
woord "Thema" en gebruikt de hele breedte, en onder 400 px verdwijnen de pictogrammen van de drie keuzes (de woorden
blijven); de test meet het geopende menu, de voetschakelaars en het paneel van de balk onderaan.
Formuliervelden hebben een rand van minstens 3:1 tegen hun ondergrond (`--field-line` in het redesign-palet,
`--input` in de app-tokens); alleen de zoek- en chatvelden in een eigen balk (`.chat-input`, `.code-search`) hebben
geen eigen rand en steunen op die balk en op hun knop. Elk veld toont een focusring (geen inline `outline: none`; de test
focust elk veld en meet het).

**Wat de schakelaar niet mag breken.** Een opgeslagen thema dat de app zelf nooit schrijft (`" dark"`, `"dark light"`: een
handmatig bewerkte of beschadigde waarde) wordt vóór het laden verwijderd door een klein inline script boven de provider in
`src/app/layout.tsx` (`STORED_THEME_GUARD_SCRIPT`, `src/components/theme-colors.ts`): `next-themes` zet de ruwe tekst met
`classList.add()` op `<html>`, en dat gooit bij een spatie, waarna elke pagina "Er is iets misgegaan" zei, bij elke
volgende keer opnieuw. Een browser die webopslag weigert (sitegegevens geblokkeerd) laat de site licht en bruikbaar: de
exit-intent-aanbieding (`ExitIntentModal`) toont zich dan niet in plaats van te crashen. Beide worden door onderdeel `k`
van `scripts/qa-theme.ts` gemeten.

Controle: `npm run qa:theme` (`npx tsx scripts/qa-theme.ts`) draait zonder server de token-, palet- en bedradingscontroles; met
`QA_BASE_URL` (een productieserver) ook de browsercontroles (eerste bezoek licht, schakelaar op 12 pagina's,
console, contrastsweep van elke zichtbare tekst in beide thema's op 375 en 1280 px, tabletbreedtes, het geopende
mobiele menu op 320 tot 480 px, randen van formuliervelden, overlays); met
`QA_DEMO_URL` (een server met `DEMO_MODE=true`) en `DATABASE_URL` ook dashboard, admin en de geprinte documenten.
**`DATABASE_URL` moet een wegwerp- of testdatabase zijn, nooit productie:** de documentcontrole maakt daar een
gebruiker, een onderdeel, een bestelling, een factuur en een creditfactuur (jaar 2999) aan, en met de demoserver een
werkorder en eventueel een monteurprofiel, en verwijdert ze aan het eind weer.
`QA_THEME_FULL=1` is de grote variant (40 pagina's), `QA_REQUIRE_BROWSER=1` maakt een overgeslagen deel een fout.
Alleen Chromium wordt gedraaid. Op `http://localhost` haalt de test de ene CSP-richtlijn `upgrade-insecure-requests` uit
document-antwoorden (anders zet Chromium elke subresource om naar https en faalt hij); `scripts/qa-csp.ts` blijft de
test die het beleid zelf beoordeelt. Niet gecontroleerd (zie D22): Clerk's eigen inlog- en gebruikersmenu in donker,
Safari en Firefox, en hoe een echte telefoon de browserbalk kleurt.

## Naar productie

Het volledige, geordende draaiboek met tijdschattingen staat in **[BLOCKED.md](BLOCKED.md)**. In het kort:

1. Bedrijf inschrijven en de `COMPANY_*`-gegevens verzamelen, inclusief `COMPANY_EMAIL` (de lange pool: weken). Zonder een van de acht blijft de winkel dicht, en na elke wijziging moet je opnieuw bouwen en deployen: de juridische pagina's worden bij de build klaargemaakt.
2. Domein, `NEXT_PUBLIC_APP_URL` (verplicht; zet hem vóór de build en laat hem gezet staan, zie BLOCKED.md stap 2).
3. Supabase: `DATABASE_URL` (transaction pooler, `?pgbouncer=true&connection_limit=1`) en `DIRECT_URL`
   (poort 5432, alleen voor migraties). `npm run db:migrate:deploy`, daarna `npm run db:seed`.
4. Vercel: de variabelen per omgeving; **Preview krijgt een eigen database en Stripe-testsleutels, nooit die
   van productie.** `CRON_SECRET` is nodig, anders draait geen enkele geplande taak.
5. Meldingskanaal (Slack, Discord of e-mail), Clerk, Resend, Stripe, Gemini, Upstash.
6. `npm run preflight -- --env-file … --live-checks`, herstel tot **READY**, dan deployen en met `--url` nogmaals.

Geplande taken: `vercel.json` plant **één** route, `/api/cron/daily`, één keer per dag (03:43 UTC). Die draait de
vier taken na elkaar (bestellingen, bewaartermijnen, abonnementen, Stripe-afstemming) binnen één functie van 60 s,
zodat de configuratie op elk Vercel-abonnement past: volgens de documentatie van Vercel staat het Hobby-abonnement
maar twee cron-taken toe (hier niet te controleren), en vier schema's zouden zo'n deployment laten afwijzen. Elke taak
krijgt een deel van de tijd (de eerste van vier hoogstens 20 s); een taak die daar overheen gaat wordt losgelaten en
gemeld (de dagrun wacht er niet langer op en gaat verder met de volgende; wat al liep kan op de achtergrond nog
afmaken en nog een eigen melding sturen). Past een taak niet meer in de tijd, dan wordt hij overgeslagen, krijg je één
melding en antwoordt de dagrun met 500. De vier losse routes `/api/cron/<taak>` blijven bestaan, zonder schema, voor
een handmatige aanroep met curl (zie BLOCKED.md, stap 4); zo'n losse aanroep krijgt de volle 50 s, handig bij een
achterstand. De regio is `fra1`; pas die aan als je database elders staat.

## Deployen (GitHub Actions naar Vercel)

`.github/workflows/deploy.yml` zet `main` op productie zonder de Git-integratie van Vercel (die is mogelijk niet aan
deze repository gekoppeld: GitHub toont geen deployments of commit-statussen van welke host dan ook). De workflow start
als de workflow **CI** op `main` geslaagd is, of met de hand (Actions, Deploy, Run workflow; alleen vanaf `main`), en
doet dan in deze vaste volgorde, in één script (`scripts/deploy/run.sh`, elke stap een eigen script in `scripts/deploy/`):

1. `vercel pull --yes --environment=production`: projectinstellingen en de Production-variabelen naar `.vercel/`
   (staat in `.gitignore`; de map wordt aan het einde altijd verwijderd, ook na een fout).
2. `npm run db:migrate:deploy` met `DATABASE_URL` en `DIRECT_URL` uit dat bestand, **vóór** de nieuwe code live gaat.
   Dat is veilig omdat elke migratie in `prisma/migrations` alleen toevoegt, en nodig omdat de nieuwe build vanaf zijn
   eerste aanvraag het nieuwe schema verwacht (`/api/v1/health` geeft anders 503). `scripts/qa-deploy.ts` keurt een
   migratie af die iets dropt, hernoemt, hertypt of leegmaakt, rijen verwijdert, een `NOT NULL`-kolom zonder `DEFAULT`
   aan een bestaande tabel toevoegt, een bestaande kolom `NOT NULL` maakt, of een unieke index of constraint legt op
   kolommen die de draaiende code al schrijft (nieuwe tabellen en nieuwe kolommen mogen dat wel); ook in de spellingen
   zonder `COLUMN`, zonder constraint-naam (`ADD UNIQUE (...)`) en met schema-prefix, maar alleen als los statement: de
   controle is tekstueel. Niet gecontroleerd: dezelfde SQL binnen een `DO $$ … $$`-blok of een functie-body, een
   `DEFAULT` weghalen of enum-waarden verwijderen; lees zulke SQL zelf. Ontbreekt `DATABASE_URL` in de
   Production-omgeving, dan stopt de deploy hier, vóór de build.
3. `npm run preflight -- --env-file .vercel/.env.production.local` (offline). **NIET KLAAR** stopt alles voordat er iets
   gebouwd is; het rapport staat in het log en bevat geen geheime waarden (ook dat controleert `scripts/qa-deploy.ts`).
4. `vercel build --prod`, op de runner; er is nog niets geüpload.
5. `vercel deploy --prebuilt --prod`; de deployment-URL komt in de job-samenvatting. Faalt juist deze stap (de CLI
   stopt met een fout of geeft geen URL), dan zegt de samenvatting dat het **onbekend** is of er iets is gedeployed:
   kijk dan eerst onder Deployments in het Vercel-dashboard voordat je opnieuw deployt. Faalt een stap vóór 5, dan is
   er niets gedeployed en zegt de samenvatting dat.
6. `npm run preflight -- --env-file … --url <NEXT_PUBLIC_APP_URL>`: de live site. Faalt dit, dan is de job rood
   **terwijl de deploy al gedaan is**; de samenvatting zegt dat, met de URL. Herstel en deploy opnieuw, of zet in het
   Vercel-dashboard de vorige deployment terug op productie (er is geen automatische rollback).

Drie poorten vooraf: zonder de secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` en `VERCEL_PROJECT_ID` slaat de workflow over
(groen, met een melding in de samenvatting; geen fout); een commit die niet meer de top van `main` is wordt niet
gedeployed, die run deployt in plaats daarvan de huidige top (deploys die in een andere volgorde klaarkomen zouden
anders een oudere versie over een nieuwere zetten, en GitHub bewaart maar één wachtende deploy-run tegelijk, dus de
eigen run van de top kan geannuleerd zijn; de top kan daardoor twee keer gedeployed worden, dat is onschuldig); en de
laatste CI-run van de te deployen commit moet geslaagd zijn, ook bij een handmatige start. Is CI voor de top nog bezig
of rood terwijl een oudere run voor hem invalt, dan slaat die run over (groen, met uitleg in de samenvatting). Bij
rood: herstel CI; een rode CI-run start nooit een deploy en een handmatige start van een rode commit wordt geweigerd,
de eerstvolgende groene CI-run op `main` start de deploy vanzelf. Bij nog bezig: de groene run start hem; staat die
deploy-run daarna in Actions als geannuleerd, start Deploy dan met de hand. Kan een poort zijn vraag niet stellen (de
GitHub API geeft geen geldig antwoord, `origin` is onbereikbaar), dan is de job rood met de reden in de samenvatting;
er is dan niets gedeployed. Twee deploys draaien nooit tegelijk.

**Instellen (eenmalig).**

- `VERCEL_ORG_ID` en `VERCEL_PROJECT_ID`: draai lokaal `npx vercel link` in de repository en kies het project; dat
  schrijft `.vercel/project.json` met `orgId` en `projectId`. (Of lees ze in het Vercel-dashboard: Project Settings,
  General, Project ID; het team-id onder Team Settings, General.)
- `VERCEL_TOKEN`: Vercel-dashboard, Account Settings, Tokens, Create. Scope: het team waarin het project staat. Kies een
  vervaldatum en zet een herinnering om hem te vernieuwen.
- Zet de drie in GitHub: repository Settings, Secrets and variables, Actions, New repository secret.
- Zet in Vercel (Settings, Environment Variables, Production) ook `DIRECT_URL` (session pooler, poort 5432): de site
  gebruikt hem niet, de migratiestap wel. Niet de directe host `db.<ref>.supabase.co`: die is alleen via IPv6 bereikbaar
  en GitHub-runners hebben, voor zover bekend, geen IPv6.
- Staat de Git-integratie van Vercel óók aan voor deze repository, dan deployt elke push **twee** keer (Vercel zelf én
  deze workflow). Kies er één: koppel de repository los in Vercel (Settings, Git) of verwijder `deploy.yml`.

**Niet gedaan; let hierop bij de eerste run.** Deze workflow is niet tegen een echt Vercel-project gedraaid (geen
netwerk en geen token waar hij geschreven is). De scripts eronder zijn getest met een nagemaakte `vercel` en `npm`
(`scripts/qa-deploy.ts`: volgorde, poorten, URL, opruimen, geen geheimen in de uitvoer). Kijk bij de eerste run of
(1) `vercel pull` zonder vraag koppelt en `.vercel/.env.production.local` schrijft (anders kloppen de id's of de scope
van de token niet), (2) de migratiestap de database bereikt via `DIRECT_URL`, (3) de preflight KLAAR of KLAAR MET
WAARSCHUWINGEN geeft, (4) `vercel deploy` de URL op stdout zet zoals de documentatie van Vercel zegt, en (5) de
live-controle slaagt tegen `NEXT_PUBLIC_APP_URL`: dat veronderstelt dat `vercel deploy --prod` pas terugkeert als het
productiedomein naar de nieuwe deployment wijst (zo beschrijft de CLI-documentatie het, zonder `--no-wait`); geeft de
controle direct na de deploy nog de oude versie, dan klopt die aanname niet. Ook niet gezien op een runner: een run die
voor een nieuwere top invalt (`git fetch` van die commit bij GitHub, zoals `actions/checkout` zelf doet; hier alleen
getest tegen een lokale git-origin, vanuit een ondiepe clone die de top nog niet had). De CLI is niet vastgepind
(`vercel@latest`): pin na de eerste geslaagde run in `deploy.yml` de versie die werkte.

## Architectuur

```
src/
├── app/
│   ├── api/                 # REST endpoints (diagnose, checkout, stripe, v1 B2B API, dashboard/api-keys, …)
│   ├── (public pages)       # Landing, diagnose, foutcodes, onderdelen, gidsen, merken, blog, tools, legal
│   ├── dashboard/           # Klant dashboard (diagnoses, bestellingen, wasmachines, profiel, API keys, referrals)
│   ├── monteur/             # B2B landing + Monteur Pro dashboard
│   └── admin/               # Admin (catalogus-CRUD, analytics, AI-kwaliteit, aanvragen & reviews;
│                             #        /admin/gebruikers is alleen-lezen — rol en plan zijn daar niet te wijzigen)
├── components/              # UI, redesign (dark), auth-buttons/providers, cart, …
├── data/                    # Statische catalogus (bron van waarheid voor seed én fallback)
└── lib/
    ├── env.ts               # Centrale env + is*Configured() helpers
    ├── auth.ts              # getCurrentUser() (demo of Clerk), plan-limieten
    ├── prisma.ts / static-db.ts
    ├── api-auth.ts          # B2B API keys (SHA-256 hash in DB, demo key)
    ├── ratelimit.ts         # Upstash of in-memory (per instantie zonder Upstash)
    ├── csp.ts · site-url.ts # Content-Security-Policy uit de omgeving; NEXT_PUBLIC_APP_URL
    ├── notify.ts · monitoring.ts  # meldingen aan de eigenaar; foutmeldingen met afkoeling
    ├── gemini.ts / stripe.ts / email.ts
    ├── (src/middleware.ts)  # SEO rewrites + clerkMiddleware (alleen als geconfigureerd) — staat op src/, niet in lib/
    └── (src/instrumentation.ts) # fouten uit requests en logger.error -> meldingen aan de eigenaar
```

## Data model

Catalogus: `WashingMachine`, `ErrorCode`, `RepairGuide`, `Part` + junctietabellen — bewerkbaar via `/admin/onderdelen`, `/admin/gidsen` en `/admin/foutcodes`.
Gebruikers: `User`, `SavedMachine`, `Diagnosis`, `Order`/`OrderItem`, `StripeEvent`, `ApiKey`.
Monteur-CRM: `Customer` en `WorkOrder` — per monteur afgeschermd (`ownerId`), beheerd op `/monteur/klanten` en `/monteur/werkorders`.
Groei: `Referral` (klik → aanmelding → conversie, €5 per betalende klant, 30 dagen attributie).
Inbox: `Review` (moderatie), `RmaRequest`, `MonteurApplication`, `NewsletterSubscriber`, `DiagnosisFeedback` — beheer via `/admin/aanvragen`.

### Reviews en ratings

Er is precies één bron: door een moderator goedgekeurde rijen in de `Review`-tabel
(`src/lib/reviews.ts`). We leveren geen seed-reviews mee — een review op deze site is
door iemand geschreven die het product gebruikt heeft. Sterbeoordelingen op de pagina én in
schema.org `AggregateRating` worden **altijd** uit die echte reviews berekend; is er geen
review, dan publiceren we geen rating. Verzin hier nooit cijfers: dat is in strijd met het
schema.org-beleid van Google en met de EU Omnibus-richtlijn over consumentenreviews.

### Nieuwsbrief

Dubbele opt-in en een werkende, gratis afmelding (`src/lib/newsletter.ts`; Telecommunicatiewet art. 11.7 lid 6, AVG art. 21 lid 3):

- **Aanmelden** (`POST /api/newsletter`, `POST /api/lead-magnet`) slaat het adres **onbevestigd** op en mailt een ondertekende link;
  pas de klik op `/api/newsletter/confirm` zet `confirmedAt` en zet het contact in de Resend-audience (`RESEND_AUDIENCE_ID`).
- **Afmelden.** Elke mail aan de lijst draagt `/api/newsletter/afmelden?token=…`: een HMAC-link per adres die **niet verloopt**,
  niet uit het adres is af te leiden en nooit als bevestigingslink werkt (andere vorm én ander doel in de handtekening).
  GET toont alleen een knop (mailscanners openen links); POST (de knop, of de RFC 8058 one-click-POST van een mailprogramma)
  zet `unsubscribedAt` in **onze tabel** (leidend) en zet daarna het Resend-contact op `unsubscribed`. Mislukt Resend (500,
  time-out), dan blijft de afmelding staan, zegt de pagina dat de afmelding is opgeslagen en nog wordt doorgegeven, en
  krijg je (ná het antwoord aan de lezer) een melding om het contact zelf te corrigeren vóór de volgende nieuwsbrief:
  één per adres en richting **per serverinstantie** (op Vercel kan dezelfde melding dus vaker komen). Kan de tabel
  zelf niet worden geschreven, dan is het antwoord een eerlijke 503 ("Afmelden lukt nu niet"), nooit "afgemeld".
  Een onbekend adres krijgt dezelfde pagina (Resend wordt ook dan bijgewerkt; "niet in de audience" is geen fout).
  Opnieuw aanmelden én bevestigen heft een afmelding op, maar alleen met een bevestigingslink die **ná** de afmelding
  is gemaild (de uitgiftetijd zit in de token): de knop in een oudere bevestigingsmail laat een latere afmelding staan
  en zegt dat. Bij het opheffen wordt het contact bijgewerkt (`PATCH`) en bij **elke** afwijzing daarvan aangemaakt;
  mislukt ook dat, dan blijft de bevestiging staan en krijg je dezelfde melding (een 404 op het aanmaken noemt
  `RESEND_AUDIENCE_ID` als vermoedelijke oorzaak; bij een afmelding is een 404 niet van "niet in de audience" te
  onderscheiden en dus stil). Limieten op `POST /api/newsletter/afmelden`: vervalste tokens 30 per aanroeper per uur;
  geldige tokens 10 per **adres** per uur en nooit per aanroeper (one-click-POSTs komen van de servers van de
  mailprovider, die al zijn lezers delen; een 429 daar zou een geweigerde afmelding zijn). Verander je `CRON_SECRET`,
  dan werkt geen eerder verstuurde afmeldlink van ons meer (de pagina verwijst dan naar het contactadres; Resends eigen
  link in het sjabloon blijft werken): exporteer de CSV opnieuw en importeer hem vóór de volgende broadcast.
- **Nieuwsbrieven** verstuur je zelf als Resend **Broadcast**; de app verstuurt geen marketingmail. Zet in elke broadcast
  **onze** afmeldlink als merge-veld (zie `DECISIONS.md` D20): `GET /api/newsletter/afmeldlinks` (ingelogd als beheerder)
  geeft een CSV `email,afmeldlink` van alle abonnees om als contact-eigenschap in de audience te laden. Laad die CSV
  **vóór elke broadcast opnieuw** (het is een momentopname: wie zich daarna bevestigde heeft anders geen link) en laat
  Resends **eigen** afmeldlink altijd in het sjabloon staan als vangnet. Een afmelding via die eigen link komt **niet** in
  onze tabel terecht (bekend gat: die lezer telt hier nog mee; of Resend hem zelf niet meer aanschrijft is niet gecontroleerd).
- Het aantal abonnees op `/admin/aanvragen` telt `confirmedAt` gezet én `unsubscribedAt` leeg; daarnaast staat de link naar
  de CSV met afmeldlinks. Accountverwijdering wist de rij en zet daarna het Resend-contact op `unsubscribed` (best effort,
  na het antwoord, nooit een reden om de verwijdering te laten mislukken; het contact zelf blijft bij Resend staan, gevlagd).
- De headers `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058) staan op de bevestigingsmail: `listUnsubscribeHeaders`
  maakt ze en `sendMail`/`sendRaw` geven ze ongewijzigd door aan de Resend-SDK (sectie 5b van de test ziet ze in wat
  de SDK verstuurt). Dat Resend het veld `headers` ook werkelijk op de mail zet, en of een mailprogramma er zijn eigen
  afmeldknop van maakt, is niet vanaf hier gecontroleerd; de link in de mailtekst werkt altijd.
- Test: `scripts/qa-privacy.ts` sectie 1 (verwijdering), 5 en 5b (lokale Resend-stand-in via `RESEND_BASE_URL`, dezelfde override als de SDK).

## Routes (selectie)

| Path | Beschrijving |
|---|---|
| `/` `/diagnose` `/foutcodes/[code]` `/gidsen/[slug]` `/onderdelen/[sku]` `/merken/[brand]/[model]` | Publiek, JSON-LD, static fallback |
| `/[merk]-wasmachine-reparatie` `/wasmachine-kapot/[stad]` `/vs/[concurrent]` `/blog` | Programmatic SEO |
| `/checkout` → `/bestelling/[id]` · `/retour/start` | Bestel- en retourflow |
| `/inloggen` `/registreren` `/upgrade` `/prijzen` | Auth + abonnementen |
| `/dashboard/*` `/monteur/*` `/admin/*` | Beveiligd (Clerk) of demo-admin |
| `/api/v1/*` | B2B REST API (Bearer `wf_live_…`, docs op `/api-docs`) |

## SEO

Zoekmachines krijgen alleen wat waar is, en alles wat niet bij hen hoort blijft buiten beeld. De regels staan op één plek,
`src/lib/seo.ts` (titels, beschrijvingen, canonical, Open Graph, de lijst privépaden, de indexeerbaarheidsregel) en
`src/lib/json-ld.ts` (structured data); `DECISIONS.md` D23 legt het waarom vast.

- **Geautomatiseerd.** Elke publieke pagina bouwt zijn metadata met `pageMetadata()`: een eigen titel (hooguit 60 tekens
  inclusief het merk, dat de template precies één keer toevoegt), een eigen beschrijving van 70 tot 160 tekens, een
  canonical naar zichzelf zonder query string, en een volledige set Open Graph- en Twitter-tags. De sitemap vraagt
  dezelfde `indexability()`-functie als de pagina's, dus ze kunnen elkaar niet tegenspreken. `/robots.txt`, de
  `X-Robots-Tag`-header (`next.config.ts`) en de robots-tag in een `layout.tsx` per privégebied komen uit één lijst,
  `PRIVATE_PATH_PREFIXES`. Gefilterde varianten van een lijstpagina (`?q=`, `?cat=`, `?brand=`, `?sort=`, `?n=`,
  `?difficulty=`) zijn `noindex, follow` zonder canonical, en krijgen dezelfde `noindex` ook als `X-Robots-Tag`-header
  (`variantHeaderRules()`, ook voor `/retour/start?t=` en `/qr/*`), zodat het signaal niet afhangt van hoe de HTML wordt
  afgeleverd; tracking-parameters (`?utm_*`, `?ref=`) worden niet geblokkeerd en wijzen via de canonical naar het schone
  adres. Een Vercel-preview of -development krijgt `Disallow: /` en `X-Robots-Tag: noindex, nofollow`. `robots.txt` heeft
  geen `Allow: /`-regel (toegestaan is de standaard; vóór de Disallow-regels laat hij een parser die de eerste treffer
  neemt elk privépad als open lezen). De gegenereerde afbeeldingen zonder hash in het adres (`/opengraph-image`, `/icon`,
  `/apple-icon`, `/icons/*`) krijgen één dag cache in plaats van het jaar `immutable` van `next/og` (`IMAGE_CACHE_CONTROL`).
  De bestanden in `public/` die geen pagina zijn (`/leadmagnets/*`: de cheatsheet die je voor een e-mailadres krijgt, en
  `/offline.html`) krijgen `X-Robots-Tag: noindex`, want een bestand kan geen robots-tag dragen (`STATIC_NOINDEX_SOURCES`);
  het IndexNow-sleutelbestand blijft gewoon leesbaar. De middleware slaat `.txt` en `.xml` over, zodat `robots.txt`,
  `sitemap.xml` en dat sleutelbestand bij een crawler aankomen zoals ze zijn.
- **Crawlers krijgen de metadata in `<head>`.** Een dynamische pagina (leest `searchParams`) laat Next de titel, beschrijving,
  canonical en robots-tag voor een onbekende client naar `<body>` streamen. Next zet Googlebot niet op de lijst die dit
  blokkerend krijgt; `next.config.ts` (`htmlLimitedBots`) voegt hem toe aan Next's eigen lijst. Gewone bezoekers houden de
  gestreamde vorm. Bij een Next-upgrade: `qa-seo` faalt (`crawler-gets-metadata-in-head`) als een crawler hem weer in `<body>` krijgt.
- **Structured data.** Alleen wat de pagina zelf toont. Product + Offer (prijs en voorraad uit de database, verzendkosten
  zoals de voorwaarden ze noemen), BreadcrumbList (het kruimelpad dat op de pagina staat), HowTo, Article, Organization
  en WebSite uit `publicCompany()` (een niet-ingesteld gegeven ontbreekt; geen halfaf adres). Er is bewust geen builder voor
  `AggregateRating`/`Review` buiten `src/lib/reviews.ts` (alleen goedgekeurde, zichtbare reviews) en geen voor `FAQPage`
  (alleen voor vragen die de pagina zelf toont). Elk script-blok gaat door `ldJson()`, dat `</script>` in een waarde onschadelijk maakt.
- **Verificatie.** Optioneel: `GOOGLE_SITE_VERIFICATION` en `BING_SITE_VERIFICATION` (alleen het token) zetten de
  tags `google-site-verification` en `msvalidate.01`; leeg of ongeldig is geen tag. Gelezen tijdens de build, dus opnieuw deployen.
- **Controle.** `scripts/qa-seo.ts` leest een draaiende **productie**server zoals een crawler: robots.txt (de privépaden
  geblokkeerd en niets dat een pagina nodig heeft), de hele sitemap (200, geen noindex, canonical = het adres zelf,
  geen privépad), alle vaste pagina's en een vaste steekproef van elke dynamische familie (de eerste 3 en elke 12e;
  `QA_SEO_FULL=1` doet alles, `QA_SEO_SEED=n` schuift het venster), per pagina titel/beschrijving/canonical/h1/Open Graph/
  afbeeldingen/structured data tegen de zichtbare tekst, de interne links, de pagina's die niet in de index horen
  (checkout, account, beheer, bestelpagina's, steden, merken zonder catalogus, filtervarianten), het 404-gedrag, de
  doorverwijzingen, de manifest-iconen (bestandsgrootte = opgegeven grootte), de metadata per crawler (Googlebot in vier
  vormen, Bingbot, Applebot, de link-preview-bots) en zestien opzettelijke gebreken die elk door de bijbehorende controle
  gevonden moeten worden. Zonder server draaien de helper- en bronchecks en de omgevingschecks (robots.ts en
  `next.config.ts` met `VERCEL_ENV` leeg, `production`, `preview`, `development`). Aanroep:
  `QA_BASE_URL=http://localhost:3000 npm run qa:seo`. Zet je `CITY_PAGES_INDEXABLE` om (steden-pagina's met eigen
  tekst), zet dan ook `EXPECT_CITY_PAGES_INDEXABLE` bovenin `scripts/qa-seo.ts` om (de check
  `city-switch-agrees-with-the-expectation` zegt het als je het vergeet) en link de steden-pagina's ergens vandaan: nu linkt
  niets naar ze, dus in de sitemap zouden het wezen zijn (`sitemap-page-is-linked-from-somewhere` faalt dan voor alle 51).
- **Een pagina toevoegen.** Publiek en te indexeren: zet de route in `SITEMAP_STATIC_PATHS` (vast) of laat de sitemap hem uit de
  gegevens halen (dynamisch), en geef de pagina `export const metadata = pageMetadata({ title: pageTitle("…"), description:
  pageDescription("…"), path: "/…" })` (dynamisch: `generateMetadata`, met meerdere titelkandidaten van informatief naar kort).
  Privé of transactioneel: zet het pad in `PRIVATE_PATH_PREFIXES` en voeg een `layout.tsx` met `robotsMeta(false, false)` toe
  (kopieer `src/app/admin/layout.tsx`). `qa-seo` faalt op een pagina die in geen van beide lijsten staat.
- **Wat alleen de host kan.** DNS, de www/kaal-doorverwijzing aan de rand, het doorverwijzen van het `*.vercel.app`-adres, het
  indienen van de sitemap en het verifiëren van het domein bij Google en Bing: zie [BLOCKED.md](BLOCKED.md) stap 2 en 14.
  Hier is niets ingediend en niets gerankt; er is geen netwerk naar die diensten.

### Indexeren

"Vraag alles aan bij de zoekmachines" bestaat niet als één knop. Dit is wat er is, wat er niet is en in welke volgorde jij het doet
(besluit D24 in [DECISIONS.md](DECISIONS.md); dezelfde stappen als afvinklijst in [BLOCKED.md](BLOCKED.md), stap 14).

**Eerlijk vooraf.**

- Vanuit deze code is **niets ingediend** bij Google, Bing of IndexNow en niets gerankt: er is geen netwerk naar die diensten
  en de site staat nergens live. Er is gereedschap, getest tegen lokale nepservers. De eerste echte indiening is die van jou.
- **Google** heeft geen interface om gewone pagina's in bulk aan te melden. De Indexing API is alleen voor vacatures
  (`JobPosting`) en livestreams, niet voor deze pagina's. De weg is: het domein verifiëren in Search Console, de sitemap
  indienen en voor een paar sleutelpagina's met de hand URL-inspectie (URL Inspection, "Indexering aanvragen") gebruiken.
  **Bing Webmaster Tools** kan een geverifieerde Search Console-property importeren.
- **IndexNow** meldt een lijst URL's aan Bing, Yandex, Seznam, Naver, Yep en andere deelnemers, niet aan Google (hoogstens
  10.000 URL's per verzoek). Het is een melding dat de pagina's er zijn, geen garantie dat ze worden opgenomen en niets over ranking.
- De **sitemap-ping** van Google en van Bing bestaat niet meer. Er is dus niets dat de sitemap "pingt"; `--ping-sitemap-only`
  legt dat alleen uit en verstuurt niets.
- Alleen **indexeerbare** URL's gaan mee. De lijst is die van `/sitemap.xml` (die dezelfde `indexability()` vraagt als de
  pagina's); het script laat daarna zelf nog alles vallen wat op een ander adres staat, een query-string of #-deel heeft,
  onder een privépad valt, op een noindex-familie staat (de stadspagina's `/wasmachine-kapot/*` en `/qr/*`, dezelfde regels als de
  `X-Robots-Tag` in `next.config.ts`) of een technisch bestand is (sleutelbestand, robots.txt, sitemap). Wat wegvalt wordt geteld
  en getoond. Een pagina die alleen via zijn eigen metadata noindex is, buiten die families, kent het script niet: de sitemap
  noemt er geen en `qa-seo` controleert dat tegen de draaiende site.

**De volgorde, na de livegang.**

1. **Search Console:** verifieer het domein, het liefst als *domeinproperty* met een DNS-TXT-record (dat dekt www, kaal, http en
   https in één keer en blijft staan). Wil je de meta-tag: zet `GOOGLE_SITE_VERIFICATION` (alleen het token) in Production en
   deploy opnieuw.
2. **Sitemap:** dien `https://<domein>/sitemap.xml` in onder Sitemaps.
3. **Met de hand:** vraag in URL-inspectie indexering aan voor de startpagina en de vijf belangrijkste pagina's (het aantal per dag
   is beperkt). Meer dan een handvol is niet de bedoeling; de sitemap doet de rest.
4. **Bing Webmaster Tools:** importeer de site uit Search Console, of verifieer met een DNS-record of `BING_SITE_VERIFICATION`, en
   dien dezelfde sitemap in.
5. **IndexNow:** draai eerst de droogloop, dan pas live. Zonder vinkje is de workflow *SEO submit (IndexNow)* (Actions, *Run
   workflow*) een droogloop, net als `npm run seo:submit -- --origin https://<domein>`: ze lezen de sitemap en tonen de aantallen, de
   eerste en laatste vijf URL's en het batchplan, en versturen niets. Ze zeggen ook of een live run zou doorgaan. Daarna *live* aanvinken
   (alleen vanaf `main`), of lokaal met `--live` (`npm run seo:submit:live -- --origin https://<domein>`). Een live run weigert (exitcode 1, niets verstuurd) tenzij het adres een https-domein is
   (geen localhost, IP-adres, `*.vercel.app` of poort) en `https://<domein>/<sleutel>.txt` de sleutel toont. Een lijst die niet te
   lezen of leeg is (een lege sitemap, alleen URL's van een ander adres) is exitcode 2, ook in een droogloop: er is dan niets te
   versturen. Meld daarna alleen wat nieuw, gewijzigd of verwijderd is (`--urls-file`); dezelfde lijst elke dag sturen is niet
   waar IndexNow voor is. De tool onthoudt niets en draait nergens op een schema.
6. **Wat je niet doet:** niets indienen voordat de winkel zijn bedrijfsgegevens heeft en de pagina's niet meer "volgt na
   inschrijving" zeggen, tenzij je die tekst wilt laten indexeren; nooit een staging- of preview-URL indienen; geen
   "index alles"-diensten die de Indexing API voor andere pagina's gebruiken.

**De sleutel.** `public/<sleutel>.txt` bevat alleen de sleutel (32 hex-tekens, zonder newline) en staat in de repository. Dat is
zo bedoeld: het protocol laat de zoekmachine de sleutel van de site zelf lezen, dus hij is geen geheim. Het script leest
`INDEXNOW_KEY`, anders het ene bestand in `public/` waarvan de inhoud zijn eigen naam is; bij nul of meerdere weigert het.
Het toont de sleutel nooit (alleen de lengte) en het antwoord van een zoekmachine hooguit 300 tekens.

**Afsluitcodes.** 0 klaar (droogloop, of live en elke batch aangenomen); 1 niet uitgevoerd of geweigerd, niets verstuurd; 2 de
URL-lijst was niet te lezen (sitemap onbereikbaar, doorverwezen, ongeldig of leeg); 3 live en minstens één batch niet aangenomen.
Bij 429 en serverfouten wacht het script en probeert het hoogstens drie keer opnieuw.

**Controle.** `npm run qa:indexnow` (`npx tsx scripts/qa-indexnow.ts`; geen netwerk, geen database) bewijst de payload, de batches van 10.000, de
weigeringen en de herhaalpogingen tegen een nep-site en een nepzoekmachine; met `QA_BASE_URL=http://localhost:3000` (een
productiebuild) leest hij ook het sleutelbestand en de echte sitemap. `npm run preflight -- --env-file … --url https://<domein>`
heeft een groep `zoekmachines`: robots.txt noemt de sitemap op het publieke adres en sluit niet alles uit, de sitemap is geldig en
niet leeg, de startpagina heeft geen noindex en een canonical naar het publieke adres, het sleutelbestand antwoordt, en een
ingestelde verificatietag staat echt in de pagina. Niet ingestelde verificatietokens zijn een waarschuwing, geen blokkade: een
DNS-TXT-record is een volwaardig alternatief.

## CI

`.github/workflows/ci.yml`: lint + typecheck (met een informatieve `npm audit`) -> build, en een Postgres-job die
migreert en seedt, `db:smoke` en `money:smoke` draait, de QA-suites die geen server nodig hebben elk op een eigen
database (gekopieerd van een verse template, omdat ze testrijen achterlaten en `qa-admin` een schone catalogus
verwacht), de IndexNow-tooling (`qa-indexnow`, tegen nepservers), de CSP-controle in Chromium, een productiebuild met de
HTTP-smoke, daarna tegen die server `qa-seo` (de site gelezen zoals een crawler) en het serverdeel van `qa-indexnow`
(sleutelbestand en echte sitemap), de checkout- en storefront-suites, de CSP op de echte pagina's en tot slot `qa-theme`
(licht standaard, de schakelaar, contrast in beide thema's, in Chromium). `qa-seo` staat vóór de checkout-suite en
`qa-theme` erna: de checkout-suite maakt en verwijdert catalogusonderdelen die `qa-seo` via de sitemap leest, en de
documentcontrole van `qa-theme` schrijft tijdelijk een bestelling van het jaar 2999. Buiten CI gelaten: de browsersuites die een demo-dev-server
nodig hebben (`qa-checkout-ui`, `qa-plans-ui`, `qa-storefront-browser`) en `qa-seed`/`qa-migration`, die
scratch-databases maken. Dit workflow is hier niet op GitHub gedraaid; de stappen zijn lokaal nagelopen.
