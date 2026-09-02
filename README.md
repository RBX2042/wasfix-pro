# WasFix Pro

AI-gestuurde wasmachine diagnose + onderdelen platform. Live: https://wasfix.nl

## Stack
- Next.js 15 (App Router) + TypeScript (strict)
- Tailwind CSS + custom shadcn/ui componenten + dark design system (`wasfix-design.css`)
- Prisma + PostgreSQL (Supabase in productie, lokaal Postgres of Docker)
- Google Gemini 2.0 Flash met keyword-fallback als er geen key is
- Clerk (auth) — uitschakelbaar via `DEMO_MODE=true`
- Stripe (iDEAL / Bancontact / kaart, abonnementen + eenmalige orders)
- Resend (transactionele e-mails)
- Upstash Redis (rate limiting, optioneel) · Zustand (cart state)

## Quick start (zonder externe services)

```bash
npm install
npm run dev
```

Open http://localhost:3000. In demo mode (default) werkt de complete flow — diagnose, catalogus, checkout, dashboard, admin — op de statische catalogus in `src/data/*.json` (331 foutcodes, 96 onderdelen, 26 gidsen, 18 machines). Zonder `DATABASE_URL` wordt niets opgeslagen; met `DATABASE_URL` wordt alles persistent.

## Quick start (met database)

```bash
# Postgres via Docker (of gebruik een Supabase connection string)
docker run -d --name wasfix-pg -e POSTGRES_PASSWORD=wasfix -e POSTGRES_DB=wasfix -p 5432:5432 postgres:16
export DATABASE_URL=postgresql://postgres:wasfix@localhost:5432/wasfix

npm run db:setup    # prisma db push + seed uit src/data/*.json (idempotent, IDs blijven gelijk)
npm run db:smoke    # 25 CRUD/relatie-checks
npm run dev
```

De seed maakt 4 demo-accounts: `jdahoe@hotmail.nl` (ADMIN/BEDRIJF, auto-login in demo mode), `demo@wasfixpro.nl` (ADMIN), `monteur@wasfixpro.nl` (TECHNICIAN/MONTEUR_PRO), `klant@wasfixpro.nl` (CONSUMER/FREE).

## Scripts

| Script | Doel |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | CI checks |
| `npm run db:setup` | Schema pushen + catalogus seeden |
| `npm run db:seed` | Alleen seeden (upsert, veilig bij content-updates) |
| `npm run db:smoke` | Database QA (`scripts/qa-db.ts`) |
| `npm run smoke` | HTTP smoke test tegen `BASE_URL` (default localhost:3000) |
| `npm run db:studio` | Prisma Studio |

## Modes

| | `DEMO_MODE=true` (default) | `DEMO_MODE=false` + Clerk keys |
|---|---|---|
| Auth | Iedereen is de demo-admin | Echte login via Clerk (`/inloggen`, `/registreren`), middleware beschermt dashboard/admin/monteur/API |
| Betalen | Order wordt direct "PAID" | Stripe Checkout + webhook |
| AI | Keyword-fallback tenzij `GEMINI_API_KEY` | idem |
| E-mail | No-op tenzij `RESEND_API_KEY` | idem |
| Data | Statisch, of persistent met `DATABASE_URL` | idem |

Elke integratie activeert zichzelf zodra zijn env var bestaat; zie `.env.example` en `BLOCKED.md` voor de volledige lijst en wat er nog van de eigenaar nodig is.

## Production setup

1. **Database**: dedicated Supabase project → `DATABASE_URL` (session pooler URI) → `npm run db:setup` eenmalig.
2. **Auth**: Clerk keys + `CLERK_WEBHOOK_SECRET` (endpoint `/api/webhooks/clerk`) + `DEMO_MODE=false`.
3. **AI**: `GEMINI_API_KEY`.
4. **Payments**: Stripe keys, 3 price IDs, webhook `/api/stripe/webhook`.
5. **Email**: `RESEND_API_KEY` (+ `RESEND_AUDIENCE_ID`).
6. **Optioneel**: Upstash (rate limit), Sentry, PostHog, GSC, KvK.
7. **Deploy**: Vercel (`npm run build` draait `prisma generate`).

## Architectuur

```
src/
├── app/
│   ├── api/                 # REST endpoints (diagnose, checkout, stripe, v1 B2B API, dashboard/api-keys, …)
│   ├── (public pages)       # Landing, diagnose, foutcodes, onderdelen, gidsen, merken, blog, tools, legal
│   ├── dashboard/           # Klant dashboard (diagnoses, bestellingen, wasmachines, profiel, API keys, referrals)
│   ├── monteur/             # B2B landing + Monteur Pro dashboard
│   └── admin/               # Admin (catalogus, gebruikers, analytics, AI-kwaliteit, aanvragen & reviews)
├── components/              # UI, redesign (dark), auth-buttons/providers, cart, …
├── data/                    # Statische catalogus (bron van waarheid voor seed én fallback)
└── lib/
    ├── env.ts               # Centrale env + is*Configured() helpers
    ├── auth.ts              # getCurrentUser() (demo of Clerk), plan-limieten
    ├── prisma.ts / static-db.ts
    ├── api-auth.ts          # B2B API keys (SHA-256 hash in DB, demo key)
    ├── ratelimit.ts         # Upstash of in-memory
    ├── gemini.ts / stripe.ts / email.ts
    └── middleware.ts        # SEO rewrites + clerkMiddleware (alleen als geconfigureerd)
```

## Data model

Catalogus: `WashingMachine`, `ErrorCode`, `RepairGuide`, `Part` + junctietabellen — bewerkbaar via `/admin/onderdelen`, `/admin/gidsen` en `/admin/foutcodes`.
Gebruikers: `User`, `SavedMachine`, `Diagnosis`, `Order`/`OrderItem`, `StripeEvent`, `ApiKey`.
Monteur-CRM: `Customer` en `WorkOrder` — per monteur afgeschermd (`ownerId`), beheerd op `/monteur/klanten` en `/monteur/werkorders`.
Groei: `Referral` (klik → aanmelding → conversie, €5 per betalende klant, 30 dagen attributie).
Inbox: `Review` (moderatie), `RmaRequest`, `MonteurApplication`, `NewsletterSubscriber`, `DiagnosisFeedback` — beheer via `/admin/aanvragen`.

### Reviews en ratings

Reviews komen uit twee bronnen: de curated set in `src/data/reviews.json` en door een
moderator goedgekeurde rijen in de `Review`-tabel. Sterbeoordelingen op de pagina én in
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

`.github/workflows/ci.yml`: lint + typecheck → build, en een Postgres-job die `db:setup`, `db:smoke`, `build` en de HTTP smoke test draait.
