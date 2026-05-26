# BLOCKED.md — WasFix Pro

Items that cannot be completed autonomously because they require external credentials, real-world signup, or user input. Each entry: what's blocked, why, what unblocks it.

---

## Stripe production keys
- **Blocked:** Real payment flow end-to-end (test mode works locally)
- **Need:** `STRIPE_SECRET_KEY` (sk_live_...) + `STRIPE_WEBHOOK_SECRET` + price IDs for the 3 subscription tiers
- **Unblock:** User creates Stripe account at https://dashboard.stripe.com/, enables iDEAL/Bancontact in payment methods, creates 3 subscription products (Particulier €4,99, Monteur Pro €29, Bedrijf €99), copies keys to Vercel env vars

## Clerk production keys
- **Blocked:** Real auth (currently DEMO_MODE=true)
- **Need:** `CLERK_SECRET_KEY` (sk_live_...), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (pk_live_...), `CLERK_WEBHOOK_SECRET`
- **Unblock:** Create Clerk app at https://dashboard.clerk.com/, configure SSO providers, copy keys to Vercel + set `DEMO_MODE=false`

## Gemini API key (real)
- **Blocked:** Real AI diagnose (currently demo-mode fallback because quota=0)
- **Need:** Valid `GEMINI_API_KEY` with quota
- **Unblock:** Generate new key at https://aistudio.google.com/app/apikey (30 sec, free tier 15 RPM is plenty)

## Resend API key
- **Blocked:** Transactional emails (order confirmations, password resets, contact-form replies)
- **Need:** `RESEND_API_KEY` + verified domain `wasfix.nl`
- **Unblock:** DKIM/SPF DNS already in place (Resend `_domainkey` records visible). Just create Resend account at https://resend.com/, add `wasfix.nl` domain, verify (instant since DNS is already set), generate API key

## Sentry DSN
- **Blocked:** Error monitoring in production
- **Need:** `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`
- **Unblock:** Create project at https://sentry.io/, get DSN

## UploadThing keys
- **Blocked:** Image uploads in /diagnose (for photo-based AI diagnose)
- **Need:** `UPLOADTHING_SECRET` + `UPLOADTHING_APP_ID`
- **Unblock:** Sign up at https://uploadthing.com/

## Upstash Redis
- **Blocked:** Rate limiting on public APIs (currently no rate limit on /api/diagnose)
- **Need:** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- **Unblock:** Free tier at https://upstash.com/, create Redis database

## Database connection
- **Blocked:** Dashboard data persistence, real orders, user profiles, reviews, etc.
- **Need:** Valid `DATABASE_URL` (Supabase Postgres connection string)
- **Unblock:** User pastes the real postgres password into Vercel env var (or grants access to update). Connection string format is set up; only password placeholder remains.

## Mollie alternative (decided against)
- **Note:** Audit-prompt requested Mollie. Decision logged in DECISIONS.md — staying with Stripe. If user later wants to switch, full code change is ~4-8 hours.

## Production-quality product images
- All parts/machines currently use placehold.co placeholders. Real product photography or supplier image-licensing is a separate workstream.

## Legal review of Privacy/Voorwaarden by NL advocate
- Content written based on standard NL e-commerce/AVG templates. Should be reviewed by a Dutch lawyer before going live with real orders.

## Real KvK + BTW number for /contact + email footers
- Currently placeholders. User needs to register company at KvK (if not yet) and add to env or hardcoded constants.

## ASWO / Reparatieshop B2B supplier API
- Monteur bulk-order feature would integrate with real spare parts wholesaler. No public API; requires partnership negotiation.
