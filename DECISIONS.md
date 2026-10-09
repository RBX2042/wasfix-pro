# DECISIONS.md — WasFix Pro

Engineering and product decisions. Each entry: date, decision, alternatives considered, reasoning.
**The newest block is first.** Older entries stay as history; where a later decision replaced one,
the old entry says so in a "Replaced by" line instead of being rewritten.

---

## 2026-10-08 — Binding decisions D1 to D13 (taken by the project lead)

These govern the code and the documents. They were not re-argued while building to them.

- **D1 Owner notifications.** One module, `src/lib/notify.ts`. Channels: `SLACK_WEBHOOK_URL`,
  `DISCORD_WEBHOOK_URL`, and an e-mail to `ORDER_NOTIFY_EMAIL ?? COMPANY_EMAIL` through Resend. No other webhook variable
  exists. Messages carry order number, total, item count and an admin link, never a customer's name, address or e-mail.
  `RESEND_API_KEY` alone is not a channel (an e-mail needs an address too).
- **D2 Guest access to an order.** A random per-order token in `Order.accessToken`; URL `/bestelling/<id>?t=<token>`.
  Access is: a valid token (constant-time comparison), or the signed-in owner, or an admin. The token is never logged;
  pages that honour it send `noindex` and `no-referrer`.
- **D3 Order states.** PENDING (Stripe, unpaid) and OPENSTAAND (bank transfer, unpaid) -> PAID -> SHIPPED -> DELIVERED.
  CANCELLED is reachable from PENDING, OPENSTAAND and PAID, not from SHIPPED. `src/lib/order-status.ts` is the only place
  that defines transitions. Every transition is a conditional `updateMany` with the expected status in the WHERE clause,
  and a count of 0 means someone else won, so concurrent calls cannot both succeed.
- **D4 Credit notes.** Invoices are never edited or deleted. A cancellation or refund of an invoiced order issues a credit
  note (creditfactuur) from its own gapless per-year series (`CN-YYYY-NNNNN`, Europe/Amsterdam year) in the same transaction
  as the state change.
- **D5 No silent Stripe-to-bank-transfer fallback.** If Stripe fails, the customer stays on checkout with a clear message,
  no order, invoice or reservation is created, and the owner is notified. (A customer who asked for iDEAL used to receive
  a permanent invoice and a 21-day stock hold, and nobody was told.)
- **D6 Netherlands only, card and iDEAL.** Belgium and Bancontact claims are removed from code and copy; the owner can
  re-add them deliberately.
- **D7 Admin bootstrap.** `ADMIN_EMAILS` (comma list). Only an e-mail that Clerk reports as VERIFIED may be promoted or may
  claim an existing row. Production never seeds users. `npx tsx scripts/make-admin.ts <email>` is the direct route
  (it uses `DIRECT_URL`, else `DATABASE_URL`).
- **D8 Cost provenance.** `Part.costSource` is `ESTIMATE` or `QUOTE`. Every margin figure counts `QUOTE` only and labels
  the rest "schatting". In production the seed creates parts with stock 0.
- **D9 Honesty.** When the AI is unavailable the keyword fallback is labelled as such, with no invented confidence and no
  "Powered by Gemini". Fabricated UI (fake dashboards, fake numbers, fake popularity) is removed or clearly labelled as an
  example. Where a claim was removed instead of building the feature, the report says so.
- **D10 New environment variables:** `ADMIN_EMAILS`, `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `ORDER_NOTIFY_EMAIL`,
  `CRON_SECRET`, `DIRECT_URL`. Declared in `src/lib/env.ts`, documented in `.env.example`. No others without a reason in this file.
- **D11 No new paid third-party services.** New npm dependencies only when essential.
- **D12 Language.** User-facing text is Dutch in the existing tone. Code comments are English and explain why.
- **D13 Plan discount.** A plan's parts discount applies only while the subscription is paying, never during the trial
  period ("vanaf je eerste betaling", as the plan features say).

## 2026-10-08 — Platform decisions (bundle S6)

- **One Content-Security-Policy builder, `src/lib/csp.ts`, driven by the environment.** A production Clerk instance lives
  on the owner's own domain (`clerk.<domain>`); clerk-js, its XHRs, its Cloudflare bot challenge and a `blob:` worker all load
  from there, and the old fixed policy listed only `*.clerk.accounts.dev`, so sign-in could never have worked in
  production. The host is read from the publishable key (base64 of `<host>$`). `*.clerk.accounts.dev` is added only for test
  keys (previews); PostHog and Google Analytics hosts only when their keys are set. Alternative rejected: a wildcard for all
  of Clerk's domains (a wildcard on a domain anyone can register under is not tight).
  `scripts/qa-csp.ts` proves it in Chromium; it was not run against a real Clerk instance.
- **`NEXT_PUBLIC_APP_URL` has no localhost default in production.** A Vercel production build refuses to build without a
  usable value; anywhere else the build and boot print a loud warning, checkout answers 503 (`src/lib/cart-gate.ts`, which uses the same `checkAppUrl` test as the build, the sitemap and preflight: a value without `https://`, with a path, or local is refused everywhere),
  and sitemap.xml/robots.txt publish nothing rather than a wrong address. Alternative rejected: failing every production
  build everywhere, which would break every local `next build` + `next start` used for testing.
- **Sitemap `lastmod` only where a row has a date** (blog posts, guides). It used to be "now" on every entry, which with hourly regeneration made the whole sitemap look modified every hour. 404 pages carry no canonical or `og:url` (`src/app/not-found.tsx`): the root layout's relative canonical otherwise resolved to the internal `/_not-found` route.
- **Canonical host.** The www or apex variant that is not in `NEXT_PUBLIC_APP_URL` is redirected there with a 308
  (`next.config.ts`); every page gets a canonical that names itself (`alternates.canonical: "./"` in the root layout).
  `*.vercel.app` is not redirected because previews live there.
- **Two database connection strings.** `DATABASE_URL` = Supabase transaction pooler with `?pgbouncer=true&connection_limit=1`;
  `DIRECT_URL` = direct or session connection used only by `scripts/migrate.ts`. `directUrl` in `schema.prisma` was rejected: it
  makes `DIRECT_URL` mandatory for every Prisma command including `postinstall` (checked on a copy). Preview deployments use
  their own database and Stripe test keys.
- **Rate-limit identity.** `x-vercel-forwarded-for` is believed only when `VERCEL` is set (the platform overwrites it);
  elsewhere it is ignored and the last `x-forwarded-for` hop is used, which is only sound behind exactly one trusted proxy. Without
  Upstash the limiter is per instance; that is logged once in production and reported by `npm run preflight` as a degraded but
  allowed state. A database-backed fallback was not built here.
- **Error monitoring without a new service.** `src/instrumentation.ts` reports request errors and every `logger.error` through
  `notifyError` (D1), with a 15-minute cool-down per error signature and at most 20 messages per hour, and logs unhandled
  rejections. Only the first non-empty line of a message and the route pattern (never the query string) are sent; the error code (Prisma P2002, Stripe codes) is part of the signature, so two different failures on one route do not hide each other. A `logger.error` payload that is a plain object is sent as an allow-list of identifier fields (`REPORTABLE_FIELDS` in `src/lib/monitoring.ts`), never whole. The cap (20 an hour) and the cool-down are per process, and all owner error alerts share one gate. Sentry was not installed (D11).
- **Browser error reports (`/api/client-error`) never forward browser text.** The route is public, so the owner is told only an error name from a fixed list and a path matching a strict pattern, behind its own 3-an-hour gate in front of the shared one (a visitor must not be able to use up the cap meant for server errors), and the request must be same-origin. The browser's message goes to the server log. Alternative rejected: forwarding the message truncated and scrubbed: a link in it still auto-links in Slack.
- **Service worker removed.** The old one cached every HTML page including signed-in ones, and registered before any consent.
  `public/sw.js` is now a kill switch that deletes caches and unregisters itself. Offline use is lost; for a webshop it
  was worth less than the risk.
- **Scheduled jobs run once a day** in `vercel.json`, to be safe on every plan. The routes document the intended tighter schedule
  (hourly orders, 15-minute reconcile). Whether a given Vercel plan allows more frequent crons was not verified.
- **`maxDuration` is set in the route files** (checkout, webhook, subscribe, portal, crons), not in a `vercel.json` `functions`
  block: a pattern that matches no function fails the deployment, and matching could not be verified without Vercel.
- **Health route is a readiness check.** `/api/v1/health` answers 503 when the database is unreachable or a migration from the
  build is missing, without details.
- **Region.** `vercel.json` pins `fra1` (Frankfurt) as a documented choice, not a fact about where the database is; change it to match.

---

## 2026-05-23 — Stay with Stripe instead of switching to Mollie

*Update 2026-10-08: Stripe stays; the payment methods are now iDEAL and card only (D6). Bancontact is removed from code and copy, so the "Bancontact" mentions below are history. There is no Mollie integration and no plan for one.*

**Audit prompt requested:** Mollie (iDEAL, Bancontact, kaarten).
**Decision:** Keep Stripe (already integrated in package.json).
**Reason:** Stripe Payments natively supports iDEAL, Bancontact, Cards, SEPA Direct Debit for EU customers. Switching payment providers mid-flow would require re-wiring checkout, webhook handlers, customer creation, subscription billing — multi-day rework with no functional benefit. Stripe also has equal or better DX, NL pricing competitive at 1.4% + €0.25 iDEAL.
**Trade-off:** B2B factuur-betaling iets minder native dan Mollie. Workaround: Stripe Invoicing met Net-30 terms voor MONTEUR/BEDRIJF rollen.

## 2026-05-23 — Keep npm, not pnpm

**Audit prompt requested:** pnpm install / pnpm typecheck.
**Decision:** Stay on npm (`package-lock.json` present, no `pnpm-lock.yaml`).
**Reason:** Switching package managers mid-project = lockfile churn, CI changes, no benefit. npm runs the same scripts.

## 2026-05-23 — Static-data fallback as canonical data layer for public pages

**Audit prompt requested:** Full Prisma + Postgres with all content seeded.
**Decision:** Public-facing pages (foutcodes, gidsen, onderdelen, merken, homepage) read from `src/data/*.json` via `src/lib/static-db.ts`. Prisma-only for user-specific data (orders, subscriptions, reviews) which requires real DATABASE_URL.
**Reason:** DATABASE_URL contains a placeholder password (`<your-password-here>`) so Prisma cannot connect. Static-data fallback was already built and works perfectly for public content. Switching every detail page to require live Postgres = brittle. Static data is git-versioned, auditable, fast, zero DB calls.
**Trade-off:** Content updates require deploy. Acceptable for a catalogue that changes monthly, not minute-ly.

## 2026-05-23 — Generate content programmatically (TypeScript scripts)

**Audit prompt requested:** 20 guides + 250 codes + 80 parts.
**Decision:** Use `scripts/generate-content.mjs` style scripts to emit JSON into `src/data/`, not hand-write 350 MDX files.
**Reason:** Scale and consistency. A script gives every code/part the same shape, IDs follow a pattern, relations are computed correctly. MDX-per-guide for the 20 guides only (those need narrative content).

## 2026-05-23 — Use Tailwind for new pages, not migrate everything to design system

**Audit prompt requested:** Consistent shadcn/Tailwind throughout.
**Decision:** New pages (cookie banner, /klachten, /garantie, /404) get Tailwind utility classes matching dark-theme tokens from `wasfix-design.css`. Existing legacy light-theme pages (admin, dashboard inner) are NOT migrated wholesale — only critical user-flow pages are dark-themed.
**Reason:** Time. Full design migration is ~30+ hours. User-facing flows (homepage → diagnose → checkout) are the priority.

## 2026-05-23 — Stripe Checkout (hosted) instead of Elements

**Audit prompt requested:** Multi-step custom checkout.
**Decision:** Use Stripe Checkout Sessions (hosted page) for payment step.
**Reason:** Lower PCI scope (no card data touches our servers), one-line iDEAL/Bancontact support, mobile-optimized OOTB, Stripe handles 3DS/SCA. Our `/checkout` page handles address collection, then redirects to Stripe-hosted page for payment.

## 2026-05-23 — Skip Sentry / Plausible install (env-blocked)

*Replaced by D1 and the 2026-10-08 monitoring decision: owner notifications and `src/instrumentation.ts` instead of Sentry.*

**Audit prompt requested:** Sentry + Plausible.
**Decision:** Vercel Analytics + Speed Insights already wired. Add Sentry/Plausible env vars and **structure** to README — actual signup is out of scope without user keys.
**Reason:** Avoid silent failures from unset env. Vercel Analytics covers basic page-view + Web Vitals without external service.
**BLOCKED:** see BLOCKED.md.

## 2026-05-23 — Skip Clerk production for now

*Replaced: demo mode no longer exists in production, so there is nothing to keep on; a deployment needs Clerk keys (see BLOCKED.md, step 6).*

**Audit prompt requested:** Clerk productie (DEMO_MODE=false).
**Decision:** Keep DEMO_MODE=true until user provides real CLERK_SECRET_KEY for production. Code is already structured to work in both modes.
**Reason:** Without real keys, switching DEMO_MODE off would break login/registration immediately.
**BLOCKED:** see BLOCKED.md.

## 2026-05-23 — i18n deferred (NL-only)

**Audit prompt requested:** NL + EN minimaal.
**Decision:** Defer to next iteration. Current audience = NL consumers. EN would mostly serve EU monteurs (small segment).
**Reason:** Lower ROI than fixing /monteur, building content, completing checkout flow.

## 2026-05-23 — Blog deferred

**Audit prompt requested:** 15 SEO blog articles.
**Decision:** Defer P2 blog content. Existing /gidsen + /foutcodes already give SEO surface area. 250+ new foutcodes + 20 guides is a higher-priority SEO lift.

## 2026-05-23 — Postgres FTS for search (when DB online)

**Audit prompt requested:** Algolia or Postgres FTS or Meilisearch.
**Decision:** Postgres FTS when DATABASE_URL is live. Until then: simple client-side filter on static-db JSON.
**Reason:** No external service dependency, no extra cost, fast enough for our catalog size.

## 2026-09-02 — Database optioneel, maar één bron van waarheid

**Probleem:** de seed (`prisma/seed.ts`) bevatte een oude subset (18/20/26) met random IDs, terwijl checkout onderdelen uit de statische catalogus resolveert. Met een echte DB zou elke order een FK-fout geven.
**Decision:** `src/data/*.json` is de canonieke catalogus; de seed upsert die 1-op-1 (zelfde IDs) en raakt gebruikersdata nooit aan. Alles wat een DB nodig heeft, checkt `isDatabaseConfigured()` en degradeert anders naar demo.
**Trade-off:** content-updates vereisen een deploy + `npm run db:seed`. Acceptabel; admin CRUD-formulieren komen later.

## 2026-09-02 — Clerk alleen actief als volledig geconfigureerd

*Aangepast 2026-10-08: in een productiebuild telt `DEMO_MODE` niet meer mee; `CLERK_ENABLED` hangt daar alleen van beide sleutels af (`next.config.ts`).*

**Decision:** `CLERK_ENABLED = DEMO_MODE!=="true" && secret && publishable key`, berekend in `next.config.ts` en als `NEXT_PUBLIC_CLERK_ENABLED` aan de client gegeven. ClerkProvider, SignIn/SignUp en clerkMiddleware bestaan alleen in die stand.
**Reason:** een half-geconfigureerde omgeving (één key) mag nooit de site of het dashboard blokkeren.

## 2026-09-02 — Upstash via REST zonder extra dependency

*Aanvulling 2026-10-08: zonder Upstash telt de limiter per instantie; dat wordt eenmalig gelogd en door `npm run preflight` gemeld.*

**Decision:** `fetch` naar de Upstash pipeline-API (INCR + EXPIRE NX) in plaats van `@upstash/ratelimit`.
**Reason:** nul extra packages, werkt op edge en node, fail-open naar de in-memory limiter bij storing.

## 2026-09-02 — Ratings alleen uit echte reviews

**Probleem:** home, prijzen en de onderdeelpagina publiceerden `AggregateRating` met
verzonnen aantallen (1247, 892, 234, 47) plus drie verzonnen `Review`-objecten.
**Decision:** alle hardgecodeerde rating-markup verwijderd. `src/lib/reviews.ts` berekent
rating en aantal uit de echte reviews (seed + goedgekeurde DB-rijen) en geeft `undefined`
terug als er geen zijn, zodat er dan niets wordt gepubliceerd.
**Reason:** Google's structured-data-beleid verbiedt ratings die niet op de pagina staan of
niet echt zijn (manual action als sanctie), en de EU Omnibus-richtlijn verplicht dat als
consumentenreviews gepresenteerde content ook echt van consumenten komt.
**Open:** de zichtbare testimonial-blokken bevatten nog verzonnen personen. Dat is
marketingcopy van de eigenaar, dus gemeld in TODO.md in plaats van eenzijdig verwijderd.

## 2026-09-02 — Constanten buiten "use server"-modules

**Probleem:** `WORK_ORDER_STATUSES` en de categorie-arrays werden geëxporteerd uit bestanden
met `"use server"`. Next.js staat daar alleen async functies toe; de admin- en
werkorderpagina's gaven daardoor een 500.
**Decision:** constanten in aparte modules (`_lib/constants.ts`, `_lib/catalog-constants.ts`)
die zowel de server actions als de client-formulieren importeren.

## 2026-09-02 — Tenant-scoping op elke monteur-mutatie

**Decision:** iedere update/delete van `Customer` en `WorkOrder` gaat via `updateMany`/
`deleteMany` met `{ id, ownerId }` in de where-clause, niet via `update({ where: { id } })`.
**Reason:** met alleen het id zou een monteur met een gegokt id een klant van een ander
kunnen bewerken. Nu levert dat `count: 0` op in plaats van een wijziging; er is een test
voor in `scripts/qa-db.ts`.
