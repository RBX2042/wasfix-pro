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

## CI

`.github/workflows/ci.yml`: lint + typecheck (met een informatieve `npm audit`) -> build, en een Postgres-job die
migreert en seedt, `db:smoke` en `money:smoke` draait, de QA-suites die geen server nodig hebben elk op een eigen
database (gekopieerd van een verse template, omdat ze testrijen achterlaten en `qa-admin` een schone catalogus
verwacht), de CSP-controle in Chromium, een productiebuild met de HTTP-smoke, de checkout- en storefront-suites
tegen die server en de CSP op de echte pagina's. Buiten CI gelaten: de browsersuites die een demo-dev-server
nodig hebben (`qa-checkout-ui`, `qa-plans-ui`, `qa-storefront-browser`) en `qa-seed`/`qa-migration`, die
scratch-databases maken. Dit workflow is hier niet op GitHub gedraaid; de stappen zijn lokaal nagelopen.
