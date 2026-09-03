# BLOCKED.md — WasFix Pro

Items that cannot be completed autonomously because they require external credentials, real-world signup, or user input. Each entry: what's blocked, why, what unblocks it.

**Status 2026-09-02:** the codebase is feature-complete for every item below — each integration is wired, tested against a local Postgres + demo mode, and activates the moment its environment variable is set in Vercel. Nothing here needs code changes; it needs keys.

---

## Database connection (highest impact)
- **Blocked:** persistence in production (orders, users, API keys, reviews, RMA, monteur applications, newsletter, AI feedback). Everything degrades gracefully to demo mode without it.
- **Need:** `DATABASE_URL` — a Postgres connection string.
- **Found:** the Supabase MCP connector lists an active project *"RBX2042's Project"* (`mzrxpvrckbrmghwrhulc`, eu-central-2), but it is shared with other apps (homeinn, snaphor, tijdslot tables). Recommended: create a **dedicated** Supabase project for WasFix so the Prisma schema can own the `public` schema.
- **Unblock:**
  1. Supabase → new project → Settings → Database → *Connection string (URI, Session pooler)*.
  2. Set `DATABASE_URL` in Vercel (Production + Preview).
  3. Run once: `DATABASE_URL=… npm run db:setup` (pushes the schema and seeds the 331 codes / 96 parts / 26 guides with the same IDs as the static catalog).
  4. Optional check: `DATABASE_URL=… npm run db:smoke` (25 CRUD/relation checks).

## Clerk production keys — nu blokkerend voor het dashboard

**Let op:** sinds de veiligheidsfix is demo-modus uitgeschakeld in productie.
Zolang er geen Clerk-keys staan, is op de live site niemand ingelogd en zijn
`/dashboard`, `/monteur/*` en `/admin` niet bereikbaar. Dat is met opzet: in de
oude situatie kreeg *elke* bezoeker van wasfix.nl het superadmin-account,
inclusief de catalogus-CRUD en de gebruikerslijst.

- **Blocked:** real login/registration (currently `DEMO_MODE=true`, auto-login as demo admin).
- **Need:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`.
- **Ready in code:** ClerkProvider, `<SignIn/>`/`<SignUp/>` on /inloggen + /registreren, `clerkMiddleware` protecting /dashboard, /admin, /monteur/*, /api/orders, /api/user, /api/account, /api/dashboard; Svix-verified webhook at `/api/webhooks/clerk` (user.created/updated/deleted → User table, welcome e-mail).
- **Unblock:** create app at https://dashboard.clerk.com/, add the 3 keys to Vercel, set `DEMO_MODE=false`, add a webhook endpoint `https://wasfix.nl/api/webhooks/clerk` (events: user.*). The first login with `jdahoe@hotmail.nl` claims the seeded ADMIN row by e-mail.

## Stripe production keys
- **Blocked:** real payments (checkout falls back to a "paid" demo order).
- **Need:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PARTICULIER`, `STRIPE_PRICE_MONTEUR`, `STRIPE_PRICE_BEDRIJF`.
- **Ready in code:** hosted Checkout (iDEAL/Bancontact/card) for orders and subscriptions, billing portal, webhook handling `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_failed` with idempotency (StripeEvent table).
- **Unblock:** create 3 recurring products (€4,99 / €29 / €99), enable iDEAL + Bancontact, add webhook `https://wasfix.nl/api/stripe/webhook`, copy keys to Vercel.

## Gemini API key (real)
- **Blocked:** real AI diagnose (keyword-based demo fallback answers now).
- **Need:** `GEMINI_API_KEY` with quota.
- **Unblock:** https://aistudio.google.com/app/apikey → Vercel env. No code change.

## Resend API key
- **Blocked:** transactional e-mail (order confirmation, RMA, monteur application, welcome, lead magnet, newsletter audience).
- **Need:** `RESEND_API_KEY` (+ optional `RESEND_AUDIENCE_ID`).
- **Unblock:** https://resend.com/ → add domain wasfix.nl (DKIM/SPF DNS already exist) → API key → Vercel env. Subscribers are also stored in the `NewsletterSubscriber` table, so nothing is lost while Resend is missing.

## Upstash Redis (optional)
- **Blocked:** shared rate limiting across serverless instances (in-memory limiter is used per instance now).
- **Need:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- **Ready in code:** `src/lib/ratelimit.ts` switches to the Upstash REST API automatically, fail-open.

## Sentry DSN (optional)
- **Need:** `NEXT_PUBLIC_SENTRY_DSN` + `npm i @sentry/nextjs`. `sentry.client.config.ts` is prepared.

## Google Search Console (optional)
- **Need:** `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET`, `GSC_REFRESH_TOKEN`. Step-by-step on `/admin/analytics/connect-gsc`.

## KvK API (optional)
- **Need:** `KVK_API_KEY`. Without it `/api/monteur/kvk-lookup` returns a mock company so the form still works.

## Real KvK + BTW number, address, phone
- Set `COMPANY_KVK`, `COMPANY_VAT`, `COMPANY_STREET`, `COMPANY_POSTAL_CODE`, `COMPANY_IBAN`, `COMPANY_PHONE` once the company is registered.
- Until then the public pages print "volgt na inschrijving" instead of the placeholder — `realOrNull()` in `src/lib/plans.ts` decides. Do **not** hardcode a number back into a page: showing `KvK 12345678` as fact is the thing that guard exists to prevent.

## Legal review of Privacy/Voorwaarden by NL advocate
- Content based on standard NL e-commerce/AVG templates. Should be reviewed before real orders.

## Production-quality product images
- All parts/machines use placehold.co placeholders.

## Mollie alternative (decided against)
- See DECISIONS.md — staying with Stripe.

## ASWO / Reparatieshop B2B supplier API
- No public API; requires partnership.

## One-time: clear invented guide view counts on an existing database

`src/data/guides.json` now seeds every guide at 0 views and the guide page
counts for real, but the seed does not overwrite `views` on update (that would
wipe genuine counts on every deploy). A database seeded before this change
still holds the invented numbers, so run once against it:

```
DATABASE_URL=... npx tsx scripts/reset-fabricated-guide-views.ts
```

It is safe to run twice (the second run reports nothing to do), but after real
views accumulate it would destroy data — so run it once, now, and not again.

## Error-code verification (315 of 331 codes still to check)

Every error code carries `provenance`, `sourceUrl` and `sourceName`. Today 16
codes are `VERIFIED` — each cites the page it was checked against — and 315 are
`REPORTED`, which the public page states plainly rather than implying we
checked them.

To work the backlog:

1. `src/data/error-codes.json` is the source; `/admin/foutcodes` edits the same
   fields against the database (a code cannot be saved as VERIFIED without a
   source URL — enforced in `ErrorCodeSchema`).
2. Prefer the manufacturer's own support pages (samsung.com/nl/support,
   bosch-home.nl, lg.com/nl) over reseller blogs. Where two sources disagree,
   leave it `REPORTED` — a disagreement is exactly when we must not claim to
   have checked. Samsung `8E` (unbalance vs. inter-component communication) and
   LG `LE` (locked motor vs. door lock) are open cases of this.
3. Codes that cannot be sourced for that brand should be deleted, not kept.
   Suspicion falls hardest on the long sequential runs (Bosch/Siemens E01-E09,
   Miele F100-F105) where nothing distinguishes a real code from a filled gap.
4. `scripts/qa-money.ts` fails the build if a VERIFIED code has no source URL,
   or if a code marked DIY names the heating circuit, motor or control module
   in its title.

Note: this container's egress proxy blocks the appliance-repair sites, so the
research has to run through search rather than fetching those pages directly.
