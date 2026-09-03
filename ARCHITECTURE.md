# ARCHITECTURE.md

WasFix Pro — system architecture. Regenerated from source on **2026-09-03**.

The route, database and stack sections below were read out of the repository
(`src/app/**`, `prisma/schema.prisma`, `package.json`) rather than written from
memory: the previous version of this file had drifted badly enough to be
misleading (Tailwind 4, 14 tables, `src/lib/ai/`, a SQLite `dev.db`, a streaming
diagnose endpoint — none of which were true). If you change a route or a model,
re-read the source instead of trusting this page.

## Tech stack

Versions are the ranges in `package.json`; the CI workflow pins Node 22.

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | 22 (CI) |
| Framework | Next.js (App Router) | ^15.5.18 |
| Language | TypeScript (strict) | ^5.7.2 |
| UI runtime | React | ^19.0.0 |
| Styling | **Tailwind CSS 3.4.17** + custom CSS (`src/app/wasfix-design.css`) | ^3.4.17 |
| UI primitives | Radix UI + shadcn-style components in `src/components/ui` | — |
| Auth | Clerk (`@clerk/nextjs`), demo-mode fallback outside production | ^6.9.6 |
| Database | PostgreSQL via Prisma (Supabase in production) | Prisma ^6.1.0 |
| Public data | Static JSON fallback (`src/data/*.json`) | — |
| AI | Google Gemini (`@google/generative-ai`) | ^0.24.1 |
| Payments | Stripe (iDEAL, Bancontact, card) | ^17.5.0 |
| Email | Resend | ^4.0.1 |
| Rate limiting | Upstash Redis REST, in-memory fallback | — |
| Cart state | Zustand | ^5.0.2 |
| Charts | Recharts (admin analytics) | ^3.8.1 |
| Hosting | Vercel | per BLOCKED.md |

**3D is dead code.** `three`, `@react-three/fiber` and `@react-three/drei` are
installed and `src/components/3d/HeroScene.tsx` exists, but `HeroSceneWrapper`
is imported nowhere — the homepage hero is a hand-written SVG washing machine in
`src/components/redesign/WasFixHome.tsx`. Any document claiming a 3D hero is
describing something that never shipped.

## Routing (App Router)

Every path below has a `page.tsx` under `src/app`. Bracketed segments are dynamic.

### Public marketing & catalogue
- `/` — homepage (dark theme, SVG hero, counts from `catalogStats()`)
- `/diagnose` — AI diagnose chat
- `/foutcodes` · `/foutcodes/[code]` — error-code index and detail
- `/gidsen` · `/gidsen/[slug]` — repair guides (premium guides show 2 steps)
- `/onderdelen` · `/onderdelen/[sku]` — parts catalogue and detail
- `/merken` · `/merken/[brand]` · `/merken/[brand]/[model]`
- `/blog` · `/blog/[slug]`
- `/help` · `/help/[slug]`
- `/prijzen` · `/over` · `/pers` · `/contact` · `/right-to-repair`
- `/api-docs` · `/api-info` — B2B API documentation
- `/monteur` — B2B landing (public)
- `/tools/repareren-of-vervangen` · `/tools/garantie-check` · `/tools/predictive` · `/tools/qr-sticker`
- `/qr/[code]` — QR sticker landing

### Programmatic SEO
- `/reparatie/[merk]` — served as `/[merk]-wasmachine-reparatie` by a rewrite in `src/middleware.ts`
- `/wasmachine-kapot/[stad]` — city pages
- `/vs/[concurrent]` — comparison pages

### Legal
- `/privacy` · `/voorwaarden` · `/cookies` · `/garantie` · `/klachten` · `/disclaimer` · `/retourvoorwaarden`

### Checkout & returns
- `/checkout` → Stripe Checkout **or** bank transfer → `/bestelling/[id]`
- `/bestelling/[id]/factuur` — numbered VAT invoice
- `/retour/start` — RMA self-service

### Auth
- `/inloggen` · `/registreren` · `/upgrade`

### Customer dashboard (auth-gated)
- `/dashboard` + `/diagnoses` · `/bestellingen` · `/wasmachines` · `/profiel` · `/api-keys` · `/referrals`

### Monteur (auth-gated)
- `/monteur/dashboard` · `/monteur/klanten` · `/monteur/werkorders` · `/monteur/onderdelen` · `/monteur/instellingen`
- `/monteur/werkorders/[id]/factuur` — the monteur's own invoice, in their own number series

### Admin (auth-gated, `role === "ADMIN"`)
- `/admin` — revenue, VAT owed, purchase value, gross margin
- `/admin/bestellingen` — orders; the only action is "markeer betaald" for a bank transfer
- `/admin/onderdelen` · `/admin/gidsen` · `/admin/foutcodes` — catalogue CRUD
- `/admin/aanvragen` — reviews, RMA, monteur applications moderation
- `/admin/analytics` · `/admin/analytics/connect-gsc` · `/admin/ai-quality`
- `/admin/gebruikers` — **read-only** user table. There is no role or plan editing anywhere in the UI.

## API endpoints

Methods are the exported handlers in each `route.ts`.

### Public
| Endpoint | Methods |
|---|---|
| `/api/diagnose` | POST — Gemini chat. **Not streaming**: it `await`s a single `chat.sendMessage()` and returns the whole answer. |
| `/api/diagnose/image` | POST — image (vision) diagnose, max 10 MB |
| `/api/diagnose/feedback` | POST |
| `/api/parts` · `/api/parts/[sku]` | GET |
| `/api/errorcodes` · `/api/errorcodes/[code]` | GET |
| `/api/guides` · `/api/guides/[id]` | GET |
| `/api/search` · `/api/stats` | GET |
| `/api/checkout` | POST |
| `/api/retour` | POST |
| `/api/reviews` | GET, POST |
| `/api/newsletter` · `/api/lead-magnet` | POST |
| `/api/monteur/signup` · `/api/monteur/kvk-lookup` | POST |
| `/api/referral/track` | POST, GET |

There is **no `/api/contact`.** `/contact` is a page with a `mailto:` link.

### Auth-gated
| Endpoint | Methods |
|---|---|
| `/api/orders` · `/api/orders/[id]` | GET |
| `/api/user/plan` · `/api/referral/stats` | GET |
| `/api/dashboard/api-keys` | GET, POST, DELETE |
| `/api/account/data-export` | GET |
| `/api/account/delete` | POST |
| `/api/admin/analytics/gsc-status` | GET |
| `/api/stripe/subscribe` · `/api/stripe/portal` | POST |

### B2B API v1 (Bearer `wf_live_…`)
- `GET /api/v1/health`
- `POST /api/v1/diagnose`
- `GET /api/v1/parts/[sku]`
- `GET /api/v1/errorcodes/[brand]/[code]`

### Webhooks
- `POST /api/stripe/webhook` — idempotent via the `StripeEvent` table
- `POST /api/webhooks/clerk` — Svix-verified

## Database (Prisma)

`prisma/schema.prisma` defines **29 models**. Postgres only — there is no SQLite
and no `prisma/dev.db`.

### Catalogue
```
WashingMachine   brand, model, yearFrom, yearTo, imageUrl, description
ErrorCode        code, machineId, title, description, likelyCauses, severity,
                 diyFriendly, provenance, sourceUrl, sourceName
RepairGuide      slug, title, machineId, difficulty, timeMinutes, steps, tools,
                 summary, warnings, isPremium, views
Part             sku, name, brand, category, priceEur, costEur, stock,
                 imageUrl, isOriginal, supplier
PartMachine      M-N parts ↔ machines
ErrorCodeParts   M-N codes ↔ parts
ErrorCodeGuides  M-N codes ↔ guides
GuideParts       M-N guides ↔ parts
```

### Users, orders and billing
```
User             clerkId, email, name, role, plan, stripeCustomerId,
                 stripeSubId, diagnosesUsed, diagnosesResetAt, referralCode
SavedMachine     user ↔ machine, nickname
Diagnosis        saved AI diagnoses (sessionId, symptoms, messages, result)
Order            status, subtotalEur, discountEur, shippingEur, totalEur,
                 vatRate, vatEur, vatNumber, costEur, stripePaymentId,
                 paymentMethod, dueAt, paidAt
OrderItem        line items (partId, quantity, unitPrice)
Invoice          numbered VAT invoice for an order; seller/buyer/lines snapshotted as JSON
InvoiceSequence  per-year counter — the series must be gapless
StripeEvent      processed webhook ids (idempotency)
ApiKey           B2B keys: prefix, SHA-256 hash, scopes, rateLimit, usageCount
UsageCounter     quota counters per scope+key (diagnoses for anonymous visitors)
```

### Monteur (B2B)
```
MonteurProfile        company, kvk, vat, address, iban, vatRate, hourlyRateEur,
                      paymentTerms, invoiceFooter
Customer              per-monteur CRM record (scoped by ownerId)
WorkOrder             reference, machine, errorCode, problem, status, urgent,
                      scheduledAt, priceEur, notes
MonteurInvoice        invoice issued from a work order; onDelete: Restrict so a
                      sent invoice can never vanish and leave a gap
MonteurInvoiceSequence per-monteur, per-year counter
```

### Inbox, growth and feedback
```
Review               moderated reviews (targetType/targetSku/targetSlug, status,
                     verifiedPurchase) — the only source of public ratings
RmaRequest           return requests
MonteurApplication   monteur signups
NewsletterSubscriber e-mail list
DiagnosisFeedback    thumbs on AI answers
Referral             code, referrer, visitorId, signedUpAt, convertedAt, rewardEur
```

### Migrations
`prisma/migrations/` holds `00000000000000_init`. Production schema changes go
through `prisma migrate deploy` (`npm run db:setup`); `prisma db push` is for
throwaway local databases only. See BLOCKED.md.

## Static data fallback

Public pages read `src/data/*.json` (machines, parts, error-codes, guides and
the relation tables) through `src/lib/static-db.ts`, so the catalogue, detail
pages and sitemap work with no `DATABASE_URL`. The same files seed the database
(`prisma/seed.ts`) with stable IDs, so an order placed against the static
catalogue references the same `Part` rows after seeding.

Generated/maintained by `scripts/dump-static-data.mjs`,
`generate-error-codes.mjs`, `generate-parts.mjs`, `generate-guides.mjs`.

Every public claim about catalogue size goes through `catalogStats()`
(`src/lib/catalog-stats.ts`) — never a literal. Do not hardcode a count into a
page or a test; that is the bug those helpers exist to prevent.

Auth, orders and admin still need a database; they degrade rather than crash
(`isDatabaseConfigured()`).

## Library layout (`src/lib`)

```
env.ts               central env parsing + is*Configured() helpers
auth.ts              getCurrentUser() (Clerk, or demo admin outside production)
entitlements.ts      plan limits and quota checks
plans.ts             prices, VAT, COMPANY identity — single source of truth
catalog-stats.ts     catalogue counts derived from src/data
prisma.ts            Prisma client singleton
static-db.ts         JSON fallback reader
gemini.ts            Gemini client + keyword fallback   (there is no src/lib/ai/)
stripe.ts            Stripe client
email.ts + emails/   Resend + templates
invoicing.ts         customer invoices and number series
monteur-invoicing.ts monteur invoices and per-monteur number series
api-auth.ts          B2B API key verification
ratelimit.ts         Upstash REST or in-memory
referrals.ts         click → signup → conversion attribution
reviews.ts           moderated reviews + AggregateRating
analytics.ts · predictive.ts · logger.ts · visitor.ts · utils.ts
```

`src/middleware.ts` (repo root of `src/`, **not** in `lib/`) does the brand-page
SEO rewrite and mounts `clerkMiddleware` when Clerk is configured.

i18n message catalogues live in `messages/{nl,de,en,fr}.json` behind
`NEXT_PUBLIC_FEATURE_I18N`; content itself is not translated yet.

## External services

This table is what the **code** expects. Which of these are actually configured
lives in Vercel, not in the repo — see BLOCKED.md for the current state.

| Service | env var(s) | Behaviour when absent |
|---|---|---|
| Postgres/Supabase | `DATABASE_URL` | static catalogue, nothing persists |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | demo admin outside production; **nobody logged in** in production |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, 3 price ids | orders fall back to bank transfer; subscriptions fail closed (503) in production |
| Company identity | `COMPANY_*` | bank-transfer orders refused in production; legal pages print "volgt na inschrijving" |
| Gemini | `GEMINI_API_KEY` | keyword fallback answers |
| Resend | `RESEND_API_KEY`, `RESEND_AUDIENCE_ID` | e-mail is a no-op; subscribers still stored |
| Upstash | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | in-memory limiter, per instance |
| Google Search Console | `GSC_OAUTH_*`, `GSC_REFRESH_TOKEN` | `/admin/analytics` shows no search data |
| KvK | `KVK_API_KEY` | `/api/monteur/kvk-lookup` returns a mock company |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN` | **nothing** — `@sentry/nextjs` is not installed, so `sentry.client.config.ts` is a no-op stub, and there is no server-side error reporting at all |

## Folder structure

```
wasfix-pro/
├── src/
│   ├── app/                  App Router: pages + api/
│   ├── components/
│   │   ├── ui/               Radix/shadcn primitives
│   │   ├── redesign/         dark-theme homepage components
│   │   ├── 3d/               HeroScene — installed, imported nowhere
│   │   └── …                 cart, nav, forms
│   ├── data/                 static JSON catalogue
│   ├── lib/                  see above
│   └── middleware.ts         SEO rewrites + Clerk
├── prisma/
│   ├── schema.prisma         29 models
│   ├── migrations/           00000000000000_init
│   └── seed.ts               seeds from src/data with stable IDs
├── messages/                 nl/de/en/fr i18n catalogues
├── scripts/                  generators + QA scripts
├── public/                   static assets
└── (root configs)
```

## Build, QA & deploy

- `npm run dev` / `build` / `start` — Next.js (`build` runs `prisma generate` first)
- `npm run typecheck` / `lint`
- `npm run db:setup` — `prisma migrate deploy` + seed
- `npm run db:smoke` — CRUD/relation checks against a database (`scripts/qa-db.ts`)
- `npm run money:smoke` — VAT, invoices, quota, margin (`scripts/qa-money.ts`)
- `npm run smoke` — 61 HTTP checks against a running instance (`scripts/smoke.ts`)
- CI: `.github/workflows/ci.yml` — lint + typecheck → build, plus a Postgres job
  running `db:setup`, `db:smoke`, `build` and the HTTP smoke test.

**There is no unit/integration test suite.** No test runner is installed and
there is no `npm test`; the four scripts above are the whole automated safety
net. Treat any document claiming a passing test count as fiction.

## Performance

The numbers previously recorded here (TTFB figures, "513 sitemap URLs", a
~102 kB shared bundle) were measured on 2026-05-26, before roughly twenty pages
and the whole monteur/invoicing surface were added. They have not been
re-measured, so they are removed rather than quoted as current.

`lighthouserc.json` holds the budgets to check against; run Lighthouse and
`npm run analyze` when you need a real figure.
