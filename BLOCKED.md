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
- **Blocked:** card/iDEAL/Bancontact payments and paid **subscriptions** (Monteur Pro / Bedrijf via `/upgrade`) — those still require live Stripe keys, no alternative yet.
- **Not blocked any more:** one-off part **orders**. Checkout now offers "op rekening" (pay by invoice, settle by bank transfer within 14 days) as a real, independent payment method — see the section below. Without Stripe keys, every order simply goes through that path automatically; with Stripe keys, the customer chooses between the two, and a failed Stripe attempt falls back to bank transfer instead of erroring out.
- **Need:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PARTICULIER`, `STRIPE_PRICE_MONTEUR`, `STRIPE_PRICE_BEDRIJF`.
- **Ready in code:** hosted Checkout (iDEAL/Bancontact/card) for orders and subscriptions, billing portal, webhook handling `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_failed` with idempotency (StripeEvent table).
- **Unblock:** create 3 recurring products (€4,99 / €29 / €99), enable iDEAL + Bancontact, add webhook `https://wasfix.nl/api/stripe/webhook`, copy keys to Vercel.

## Company fiscal identity (`COMPANY_*`) — blocks "op rekening" orders specifically
- **Blocked:** the bank-transfer payment path above. A real invoice needs a real KvK number, btw number and IBAN — issuing one against the placeholder values in `src/lib/plans.ts` (`KvK 12345678`, fake IBAN) would not be a legally valid invoice, and a customer literally cannot pay a fake IBAN. Checkout detects this (`COMPANY.isPlaceholder`) and refuses to create a bank-transfer order in production (503, logged) rather than send it — Stripe orders are unaffected once Stripe keys exist independently.
- **Need:** `COMPANY_NAME`, `COMPANY_KVK`, `COMPANY_VAT`, `COMPANY_IBAN`, `COMPANY_STREET`, `COMPANY_POSTAL_CODE`, `COMPANY_CITY`, and ideally `COMPANY_EMAIL`/`COMPANY_PHONE`.
- **Unblock:** set the real values in Vercel. No code change — every invoice, the checkout guard, and the legal pages all read from `COMPANY` (`src/lib/plans.ts`), which falls back to placeholders only when these env vars are absent.

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
- Same placeholders as "Company fiscal identity" above (`KvK 12345678`, `Hoofdstraat 1`) — also show up in /contact, e-mail footers and legal pages. Same fix: set `COMPANY_*` once the company is registered.

## Legal review of Privacy/Voorwaarden by NL advocate
- Content based on standard NL e-commerce/AVG templates. Should be reviewed before real orders.

## Production-quality product images
- All parts/machines use placehold.co placeholders.

## Mollie alternative (decided against)
- See DECISIONS.md — staying with Stripe.

## ASWO / Reparatieshop B2B supplier API
- No public API; requires partnership.
