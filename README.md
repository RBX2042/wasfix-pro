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
| Betalen | Zonder Stripe-sleutels: bankoverschrijving | iDEAL en kaart via Stripe, of bankoverschrijving |
| AI | Trefwoorden-terugval tenzij `GEMINI_API_KEY` (de terugval zegt dat) | idem |
| E-mail | Geen verzending tenzij `RESEND_API_KEY` | idem |
| Data | Statische catalogus, of persistent met `DATABASE_URL` | De database is verplicht |

Elke koppeling gaat aan zodra zijn variabele bestaat; `.env.example` noemt ze allemaal.

## Naar productie

Het volledige, geordende draaiboek met tijdschattingen staat in **[BLOCKED.md](BLOCKED.md)**. In het kort:

1. Bedrijf inschrijven en de `COMPANY_*`-gegevens verzamelen (de lange pool: weken).
2. Domein, `NEXT_PUBLIC_APP_URL` (verplicht; zet hem vóór de build en laat hem gezet staan, zie BLOCKED.md stap 2).
3. Supabase: `DATABASE_URL` (transaction pooler, `?pgbouncer=true&connection_limit=1`) en `DIRECT_URL`
   (poort 5432, alleen voor migraties). `npm run db:migrate:deploy`, daarna `npm run db:seed`.
4. Vercel: de variabelen per omgeving; **Preview krijgt een eigen database en Stripe-testsleutels, nooit die
   van productie.** `CRON_SECRET` is nodig, anders draait geen enkele geplande taak.
5. Meldingskanaal (Slack, Discord of e-mail), Clerk, Resend, Stripe, Gemini, Upstash.
6. `npm run preflight -- --env-file … --live-checks`, herstel tot **READY**, dan deployen en met `--url` nogmaals.

Geplande taken staan in `vercel.json` (vier routes, elk één keer per dag, de veilige keuze voor elk
abonnement; strakker zetten kan, zie BLOCKED.md). De regio is `fra1`; pas die aan als je database elders staat.

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
