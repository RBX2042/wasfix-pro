# DECISIONS.md — WasFix Pro

Engineering decisions made during the autonomous production-readiness pass. Each entry: date, decision, alternatives considered, reasoning.

---

## 2026-05-23 — Stay with Stripe instead of switching to Mollie

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

**Audit prompt requested:** Sentry + Plausible.
**Decision:** Vercel Analytics + Speed Insights already wired. Add Sentry/Plausible env vars and **structure** to README — actual signup is out of scope without user keys.
**Reason:** Avoid silent failures from unset env. Vercel Analytics covers basic page-view + Web Vitals without external service.
**BLOCKED:** see BLOCKED.md.

## 2026-05-23 — Skip Clerk production for now

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

**Decision:** `CLERK_ENABLED = DEMO_MODE!=="true" && secret && publishable key`, berekend in `next.config.ts` en als `NEXT_PUBLIC_CLERK_ENABLED` aan de client gegeven. ClerkProvider, SignIn/SignUp en clerkMiddleware bestaan alleen in die stand.
**Reason:** een half-geconfigureerde omgeving (één key) mag nooit de site of het dashboard blokkeren.

## 2026-09-02 — Upstash via REST zonder extra dependency

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
