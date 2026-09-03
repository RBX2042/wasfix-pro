# BLOCKED.md — WasFix Pro

Items that cannot be completed autonomously because they require external credentials, real-world signup, or user input. Each entry: what's blocked, why, what unblocks it.

**Status 2026-09-03:** every entry below is blocked on a credential or a real-world
signup, not on code — each integration is wired, exercised against a local Postgres and
demo mode, and activates when its environment variable is set in Vercel.

That is **not** the same as the product being finished. Known gaps that no key will fill:

- **No fulfilment.** `Order` has `SHIPPED` and `DELIVERED` statuses, but nothing in the
  repo ever writes them — the only order action in `/admin/bestellingen` is "markeer
  betaald" for a bank-transfer invoice. Picking, packing, shipping and track & trace
  (which `/voorwaarden` promises the customer) happen outside this system, by hand.
- **No werkbon.** A monteur can create a work order and invoice it; there is no service
  report, no signature and no photo record.
- **No planning.** `WorkOrder.scheduledAt` is a single date field and the dashboard counts
  what falls in the coming week. There is no agenda, no route and no capacity view.
- **No organisation model.** Every business object hangs off one `ownerId` — no teams, no
  seats, no roles within a company. This is why "tot 20 gebruikers" and "witlabel" were
  removed from the Bedrijf tier in `src/lib/plans.ts`; do not sell them back.
- **No error monitoring.** See the Sentry entry below — this one is a launch risk, not a
  nice-to-have.

Read this file as "which keys are missing"; read TODO.md for what is not built.

---

## Database connection (highest impact)
- **Blocked:** persistence in production (orders, users, API keys, reviews, RMA, monteur applications, newsletter, AI feedback). Everything degrades gracefully to demo mode without it.
- **Need:** `DATABASE_URL` — a Postgres connection string.
- **Found:** the Supabase MCP connector lists an active project *"RBX2042's Project"* (`mzrxpvrckbrmghwrhulc`, eu-central-2), but it is shared with other apps (homeinn, snaphor, tijdslot tables). Recommended: create a **dedicated** Supabase project for WasFix so the Prisma schema can own the `public` schema.
- **Unblock:**
  1. Supabase → new project → Settings → Database → *Connection string (URI, Session pooler)*.
  2. Set `DATABASE_URL` in Vercel (Production + Preview).
  3. Run once: `DATABASE_URL=… npm run db:setup` (applies the migrations and seeds the 329 codes / 96 parts / 26 guides with the same IDs as the static catalog).
  4. Optional check: `DATABASE_URL=… npm run db:smoke` (25 CRUD/relation checks).

## Schema changes go through migrations now — never `db push`

`prisma/migrations/` exists (`00000000000000_init`) and `npm run db:setup` runs
`prisma migrate deploy`. That changes the rules for the production database:

- **Deploy a schema change with `prisma migrate deploy`.** It applies exactly the
  migrations in the repo and records them in `_prisma_migrations`, so what ran on
  production is auditable and repeatable.
- **Never run `prisma db push` against production.** `db push` diffs the schema
  straight onto the database without recording anything. The migration history and
  the live schema then disagree, and the next `migrate deploy` either fails or wants
  to reset — which on this database means dropping orders and invoices we are
  legally required to keep for seven years. `npm run db:push` still exists for
  throwaway local databases; that is its only use.
- **Author a change with `npm run db:migrate`** (`prisma migrate dev`) locally, and
  commit the generated folder together with the `schema.prisma` change.
- **An existing database that predates the migrations folder** must be baselined once
  before its first deploy, otherwise `migrate deploy` tries to create tables that are
  already there: `npm run db:baseline` (`prisma migrate resolve --applied
  00000000000000_init`).

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
- **Unblock:** create 3 recurring monthly EUR prices — **Particulier €4,99, Monteur Pro
  €29, Bedrijf €199** — enable iDEAL + Bancontact, add webhook
  `https://wasfix.nl/api/stripe/webhook`, copy keys to Vercel.
- **Get the price objects exactly right, or checkout refuses them.** `/api/stripe/subscribe`
  retrieves each price and compares it against `src/lib/plans.ts` before creating a session;
  a mismatch is a 500 for the customer and an error in the log, not a silent wrong charge.
  It requires per price: `unit_amount` equal to the plan's `priceCents`, currency `eur`,
  recurring `month` / interval_count 1, and the right **`tax_behavior`** — `exclusive` for
  the business tiers (Monteur Pro, Bedrijf: advertised excl. btw) and `inclusive` for the
  consumer tier (Particulier: NL consumer prices must be shown incl. btw). Checkout runs
  with `automatic_tax` enabled, so an `inclusive` business price silently eats the 21% out
  of our margin and an `exclusive` consumer price adds 21% on top of a price we promised
  was inclusive.
- **This runbook used to say €99 for Bedrijf.** It has said €199 on `/prijzen` and in
  `plans.ts` throughout; anyone following the old line would have created the price at half
  the advertised amount and billed every business customer €99 a month.

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

## Error monitoring — there is none (launch risk, not optional)

- **Blocked:** knowing that anything broke in production. There is no Sentry, no
  alternative, and no alerting of any kind. A failed Stripe webhook, a checkout that 503s
  on the `COMPANY.isPlaceholder` guard, or an invoice that fails to issue is written to
  `logger` and then only exists in the Vercel function log, which nobody is watching.
- **Why the existing config does not count:** `@sentry/nextjs` is **not** in
  `package.json`. `sentry.client.config.ts` dynamically imports it and swallows the failure
  in a `.catch(() => {})`, so today it is a no-op — setting `NEXT_PUBLIC_SENTRY_DSN` alone
  changes nothing at all. And even once the package is installed, that file only initialises
  the **browser** SDK. The failures that cost money — payment, webhook, invoicing, seeding —
  all happen server-side and would still go unreported.
- **Need:** `npm i @sentry/nextjs`, `NEXT_PUBLIC_SENTRY_DSN`, plus a server/edge init
  (`sentry.server.config.ts` + `instrumentation.ts`, neither of which exists yet) and
  `SENTRY_AUTH_TOKEN` if source maps are wanted. This one needs code, not just a key.

## Google Search Console (optional)
- **Need:** `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET`, `GSC_REFRESH_TOKEN`. Step-by-step on `/admin/analytics/connect-gsc`.

## KvK API (optional)
- **Need:** `KVK_API_KEY`. Without it `/api/monteur/kvk-lookup` returns a mock company so the form still works.

## Real KvK + BTW number, address, phone
- Same placeholders as "Company fiscal identity" above — also show up in /contact, e-mail footers and legal pages. Same fix: set `COMPANY_KVK`, `COMPANY_VAT`, `COMPANY_STREET`, `COMPANY_POSTAL_CODE`, `COMPANY_IBAN`, `COMPANY_PHONE` once the company is registered.
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

## One-time: prune unsourceable error codes on an existing database

The seed upserts; it never deletes. Codes removed from
`src/data/error-codes.json` because verification could not place them on the
brand they were filed under are gone from a fresh database but still stand in
one that already had them. Run once against such a database:

```
DATABASE_URL=... npx tsx scripts/prune-unsourceable-error-codes.ts --dry-run
DATABASE_URL=... npx tsx scripts/prune-unsourceable-error-codes.ts
```

It deletes only the ids that `data/verification/*.json` marks UNVERIFIED —
never "everything missing from the seed", which would also destroy codes an
admin added through /admin/foutcodes. Re-run it after each new batch of
verdicts lands.

## Error-code verification: what still deserves a second look

The verification pass ran through `WebSearch`, which returns a synthesised
summary of pages rather than the pages themselves — this container's egress
proxy blocks the appliance-repair and manufacturer sites, so no source table
was read verbatim. Every `sourceUrl` in `data/verification/` is a real URL that
came back in results, and the attributed meaning is what those results reported,
but three things are worth a spot-check against an actual service manual before
you lean on them:

- **Whirlpool.** Our old table was a mixture of platforms and twelve of
  twenty-four entries were wrong, so the corrections are a clear improvement.
  But Whirlpool genuinely runs several incompatible Fxx tables (European
  Whirlpool/Laden/Bauknecht, 6th Sense, FSCR, US Duet), and the corrections
  rest on agreement between four or five sites rather than one authoritative
  document. Worth checking against an FFD-platform service manual.
- **Beko E08.** Deliberately not published. Two contradictory Beko E-code
  families circulate (one maps E01-E07 onto the H1-H7 service codes, the other
  gives E01 = door lock, E03 = drain, E04 = fill) and they disagree about E08.
  The eleven Beko codes that were added are ones both families agree on.
- **Bosch/Siemens E01.** Three sources, three meanings (door lock, heating
  circuit, fill). The row carries the best-sourced reading, says on the page
  that sources disagree, and stays REPORTED.

Three codes stay REPORTED because sources disagree about them, not because
nobody looked: Bosch E01, Siemens E01 and Miele F21. Their text carries the
best-sourced reading and the page says the sources conflict.

## Error-code verification method

Every error code carries `provenance`, `sourceUrl` and `sourceName`. Of the 329
codes in `src/data/error-codes.json`, 326 are `VERIFIED` — each cites the page it
was checked against — and 3 are `REPORTED` (the Bosch/Siemens E01 and Miele F21
disagreements named above), which the public page states plainly rather than
implying we checked them.

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
