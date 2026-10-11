# ARCHITECTURE.md

WasFix Pro — system architecture. Regenerated from source on **2026-09-03**; the platform, deployment and
monitoring parts (CSP, health, monitoring, crons, QA, build) were rewritten on **2026-10-08**. Order, invoicing and
Stripe internals are described in the headers of their own files (`src/lib/invoicing.ts`, `order-status.ts`,
`src/app/api/stripe/`), not repeated here.

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
| Framework | Next.js (App Router) | ^15.5.27 (the lowest 15.x for which `npm audit` reports no published Next advisory; `next` itself still shows as moderate through its bundled postcss, fixed only in Next 16.4.0) |
| Language | TypeScript (strict) | ^5.7.2 |
| UI runtime | React | ^19.0.0 |
| Styling | **Tailwind CSS 3.4.17** + custom CSS (`src/app/wasfix-design.css`) | ^3.4.17 |
| UI primitives | Radix UI + shadcn-style components in `src/components/ui` | — |
| Auth | Clerk (`@clerk/nextjs`), demo-mode fallback outside production | ^6.9.6 |
| Database | PostgreSQL via Prisma (Supabase in production) | Prisma ^6.1.0 |
| Public data | Static JSON fallback (`src/data/*.json`) | — |
| AI | Google Gemini (`@google/generative-ai`) | ^0.24.1 |
| Payments | Stripe (iDEAL and card; Netherlands only, decision D6) | ^17.5.0 |
| Email | Resend | ^4.0.1 |
| Rate limiting | Upstash Redis REST, in-memory fallback (per instance) | — |
| Cart state | Zustand | ^5.0.2 |
| Charts | Recharts (admin analytics) | ^3.8.1 |
| Hosting | Vercel (`vercel.json`: region fra1, one daily cron) | per BLOCKED.md |

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
| `/api/newsletter` · `/api/lead-magnet` | POST (stores the address unconfirmed and mails a signed confirmation link) |
| `/api/newsletter/confirm` | GET (a page with the button), POST (confirms; an opt-out made after the link was mailed stands) |
| `/api/newsletter/afmelden` | GET (a page with the button), POST (the button, or a mail client's RFC 8058 one-click POST, answered as text; our table first, then the Resend audience; two rate-limit buckets) |
| `/api/monteur/signup` · `/api/monteur/kvk-lookup` | POST |
| `/api/referral/track` | POST, GET |
| `/api/client-error` | POST (browser errors from the error boundaries; same-origin only, rate-limited, stores nothing; the owner is told an error name and a path pattern, never the browser's text) |

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
| `/api/newsletter/afmeldlinks` | GET (admin only: CSV `email,afmeldlink` of every subscriber, to load into the Resend audience before a broadcast; linked from `/admin/aanvragen`) |
| `/api/stripe/subscribe` · `/api/stripe/portal` | POST |

### B2B API v1 (Bearer `wf_live_…`)
- `GET /api/v1/health`
- `POST /api/v1/diagnose`
- `GET /api/v1/parts/[sku]`
- `GET /api/v1/errorcodes/[brand]/[code]`

### Scheduled (Bearer `CRON_SECRET`, GET or POST)
- `/api/cron/daily` — the only path in `vercel.json`; runs the four jobs below in order
- `/api/cron/orders` · `/api/cron/retention` · `/api/cron/stripe-subscriptions` · `/api/cron/stripe-reconcile` — unscheduled, for hand runs

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
OrderItem        line items (partId, quantity, unitPrice, restockedQty)
Invoice          numbered VAT invoice for an order; seller/buyer/lines snapshotted as JSON
InvoiceSequence  per-year counter — the series must be gapless
StripeEvent      processed webhook ids (idempotency)
ApiKey           B2B keys: prefix, SHA-256 hash, scopes, rateLimit, usageCount
UsageCounter     quota counters per scope+key (diagnoses for anonymous visitors)
```

**Restocks.** When a refund puts returned units back on the shelf (a SHIPPED or DELIVERED order), the units are
counted on the order line, `OrderItem.restockedQty`, inside the refund's transaction: one conditional update
(`restockedQty <= quantity - units` in the WHERE, the increment in the SET) is both the cap "ordered minus already
put back" and the lock, so two refunds can never together exceed what was ordered (`applyRestock` in
`src/lib/invoicing.ts`; `checkRestock` runs first for the Dutch refusal texts). Cancelling restocks everything and
ends the order, so it is not counted there. Credit notes issued before migration
`20261009120000_order_item_restocked_qty` carried this record as a `restock` array on their first printed line; that
migration backfilled the column from them, the annotation is never written since, and the data export strips it from
those old notes (an issued document is immutable, so they keep it).

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
ratelimit.ts         Upstash REST or in-memory; clientIp() trusts x-vercel-forwarded-for only on Vercel
csp.ts · site-url.ts Content-Security-Policy built from the env (Clerk host from the publishable key); NEXT_PUBLIC_APP_URL checks
notify.ts            owner notifications (Slack, Discord, e-mail), the one module that tells the owner anything
monitoring.ts        cool-down + cap in front of notify for server errors (used by src/instrumentation.ts); renders logger.error payloads from an allow-list of fields
referrals.ts         click → signup → conversion attribution
reviews.ts           moderated reviews + AggregateRating
analytics.ts · predictive.ts · logger.ts · visitor.ts · utils.ts
```

`src/middleware.ts` (repo root of `src/`, **not** in `lib/`) does the brand-page
SEO rewrite and mounts `clerkMiddleware` when Clerk is configured. `src/instrumentation.ts` (Next's instrumentation
hook) installs the error reporting: exceptions that escape a request and every `logger.error` reach the owner through
`notify.ts`, with a cool-down per error signature and a cap per hour; unhandled promise rejections are logged. It runs
in the Node.js runtime only.

i18n message catalogues live in `messages/{nl,de,en,fr}.json` behind
`NEXT_PUBLIC_FEATURE_I18N`; content itself is not translated yet.

## External services

This table is what the **code** expects. Which of these are actually configured
lives in Vercel, not in the repo — see BLOCKED.md for the current state.

| Service | env var(s) | Behaviour when absent |
|---|---|---|
| Public address | `NEXT_PUBLIC_APP_URL` | production: Vercel build refuses; elsewhere checkout 503, empty sitemap, robots.txt without host |
| Postgres/Supabase | `DATABASE_URL` (transaction pooler), `DIRECT_URL` (migrations only) | static catalogue, nothing persists; production checkout 503 |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `ADMIN_EMAILS` | demo admin outside production; **nobody logged in** in production |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, 3 price ids | only bank transfer; subscriptions fail closed (503) in production; a failing Stripe call never falls back silently |
| Company identity | `COMPANY_*` | both checkout paths 503 in production; legal pages print "volgt na inschrijving" |
| Owner channel | `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `ORDER_NOTIFY_EMAIL` / `COMPANY_EMAIL` + Resend | the owner is told nothing (logged once) |
| Scheduled jobs | `CRON_SECRET` | every `/api/cron/*` route answers 503 |
| Gemini | `GEMINI_API_KEY` | labelled keyword fallback |
| Resend | `RESEND_API_KEY`, `RESEND_AUDIENCE_ID` | e-mail is a no-op; subscribers still stored. With both set, confirmations, opt-outs and erasures are recorded in our table first and the audience contact follows (best effort); a failed audience update is reported to the owner once per address and direction per instance |
| Upstash | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | in-memory limiter, per instance; warned once in production |
| Google Search Console | `GSC_OAUTH_*`, `GSC_REFRESH_TOKEN` | `/admin/analytics` shows no search data |
| KvK | `KVK_API_KEY` | `/api/monteur/kvk-lookup` returns a mock company |

There is no Sentry: `sentry.client.config.ts` is a no-op stub that needs `@sentry/nextjs`, which is not installed.
Server errors reach the owner through `src/instrumentation.ts` and `notify.ts` instead. Every variable is
documented in `.env.example`; `npm run preflight` checks them.

## Deployment and operations

- **CSP:** `src/lib/csp.ts`, applied in `next.config.ts`. The header is computed when `next.config.ts` is loaded for the build, so a changed Clerk key needs a rebuild.
- **Canonical host:** the www/apex variant not in `NEXT_PUBLIC_APP_URL` is redirected (308) in `next.config.ts`; the root
  layout gives every page a self-referencing canonical.
- **Health:** `GET /api/v1/health` is a readiness check. 503 when the database is unreachable or a migration of this build is missing;
  `next.config.ts` puts the migration folder names into `WASFIX_EXPECTED_MIGRATIONS` at build time for that comparison.
- **Jobs:** `vercel.json` schedules ONE route, `/api/cron/daily`, once a day with `Authorization: Bearer CRON_SECRET`
  (one schedule fits every plan; according to Vercel's documentation Hobby allows two, not verifiable from here). The job
  bodies live in `src/app/api/cron/_lib/jobs/*` (route files may only export handlers), the list and order in
  `_lib/daily-jobs.ts`, and the runner in `_lib/runner.ts`: orders -> retention -> stripe-subscriptions -> stripe-reconcile,
  each isolated (a crash is logged, reported to the owner by name, and the next job still runs), within a 50 s budget of
  the function's 60 s; a job that no longer fits is skipped, reported once, and not retried before the next day. Each job
  is capped at what is left minus 10 s per later job (the first of four: 20 s) and given up on when still running at its
  cap (`job_timed_out`, reported by name; the next job runs), so one backlog job cannot run the function into the
  platform's kill. The orders job derives a deadline per step from its cap and reports a cut-short run as `truncated`;
  reconcile cuts its Stripe scan to fit; retention and stripe-subscriptions have row limits only, the cap is their
  bound. The route answers 500 when any job failed or was skipped, with the per-job detail. The four single-job routes
  stay, unscheduled, for hand runs with the whole budget (`curl -H "Authorization: Bearer $CRON_SECRET" <site>/api/cron/<job>`).
- **Migrations:** `npm run db:migrate:deploy` (through `scripts/migrate.ts`, over `DIRECT_URL`). Never `prisma db push` on production.
- **Service worker:** none. `public/sw.js` unregisters the old one.
- **Go-live check:** `npm run preflight`.

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
│   ├── migrations/           ordered folders; applied with scripts/migrate.ts
│   └── seed.ts               seeds from src/data with stable IDs
├── messages/                 nl/de/en/fr i18n catalogues
├── scripts/                  generators, QA suites (qa-*.ts), preflight.ts, migrate.ts, make-admin.ts
├── vercel.json               region + cron schedule
├── public/                   static assets
└── (root configs)
```

## Build, QA & deploy

- `npm run dev` / `build` / `start` — Next.js (`build` runs `prisma generate` first)
- `npm run typecheck` / `lint`
- `npm run db:setup` — migrations + seed; `db:migrate:deploy` / `db:migrate:status` over `DIRECT_URL`
- `npm run db:smoke`, `money:smoke`, `smoke` — database, money and HTTP checks
- `npm run preflight` — go-live check (see `BLOCKED.md`)
- The `scripts/qa-*.ts` suites (orders, notify, checkout, stripe, plans, admin, diagnose, storefront, csp, platform, preflight):
  what each proves and how to run it is in `QA_CHECKLIST.md`; CI runs them (`.github/workflows/ci.yml`).
- CI: lint + typecheck + informational `npm audit` → build; and a Postgres job with the suites (each on its own database copied
  from a template), a Chromium CSP probe, a production build with the HTTP smoke, and the checkout/storefront suites against it.

There is no unit-test runner and no `npm test`; the scripts above are the safety net. They ran against a real Postgres and
nagemaakte Stripe, Slack and Resend servers, never against the real vendors. Treat any document claiming a test count as
a snapshot: re-run the suite.

## Performance

The numbers previously recorded here (TTFB figures, "513 sitemap URLs", a
~102 kB shared bundle) were measured on 2026-05-26, before roughly twenty pages
and the whole monteur/invoicing surface were added. They have not been
re-measured, so they are removed rather than quoted as current.

`lighthouserc.json` holds the budgets to check against; run Lighthouse and
`npm run analyze` when you need a real figure.
