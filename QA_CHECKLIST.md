# QA_CHECKLIST.md

Pre-launch / pre-merge checklist. Run through before every release.

A ticked box means someone looked, never that a suite passed. The automated part is below; the rest is a human
walking the flow.

## Automated (run these first)

| Command | What it proves | Needs |
|---|---|---|
| `npm run typecheck` · `npm run lint` · `npm run build` | compiles, lints, builds | `NEXT_PUBLIC_APP_URL` for a production build to be useful |
| `npm run db:smoke` · `npm run money:smoke` | database CRUD; VAT, invoices, quota, margin | `DATABASE_URL` (migrated + seeded) |
| `npx tsx scripts/qa-admin.ts` · `qa-plans.ts` | owner operations; plans, gating, API keys, admin bootstrap | `DATABASE_URL`; **plain `tsx`, not `--conditions=react-server`** |
| `npx tsx --conditions=react-server scripts/qa-orders.ts` · `qa-stripe.ts` · `qa-diagnose.ts` · `qa-notify.ts` | order domain and credit notes; Stripe webhook and subscriptions (fake Stripe); diagnosis honesty and quota; owner notifications | `DATABASE_URL` (not qa-notify) |
| `npx tsx --conditions=react-server scripts/qa-checkout.ts` · `qa-storefront.ts` | checkout, guest access, cart; storefront truth | a running **production** server (`QA_BASE_URL`, `QA_ANON_URL`) and `VERCEL=1` (they send `x-vercel-forwarded-for`) |
| `npm run qa:platform` · `qa:preflight` · `qa:csp` | env/APP_URL, rate-limit identity, monitoring, health route, migrate, vercel.json, service worker, `.env.example`; the preflight script; the CSP in Chromium | `qa:csp` and part of `qa:platform` need Chromium; `QA_REQUIRE_BROWSER=1` makes a missing browser a failure |
| `npm run smoke` | 60+ HTTP checks against `BASE_URL` | a running server |
| `scripts/qa-checkout-ui.ts` · `qa-plans-ui.ts` · `qa-storefront-browser.mjs` | clicks and layout at 375 px | a DEMO dev server; not in CI |
| `scripts/qa-seed.ts` · `qa-migration.ts` | the seed in production mode; the order-domain migration on a database with data | rights to CREATE DATABASE; run before changing the seed or a migration; not in CI |

Several suites leave test rows behind and `qa-admin` asserts the clean 96-part catalogue: give each suite its own
database copied from a freshly migrated and seeded template (`createdb -T`), as CI does. `.github/workflows/ci.yml` shows the exact
invocations. CI has not been run on GitHub from this repository state; the steps were walked through locally.

`npm run preflight` is the pre-launch check for configuration (see `BLOCKED.md`, step 10). It replaces the old
"required environment variables" list below.

## Build & Type Safety

- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → 0 errors (warnings OK for now)
- [ ] `npm run build` → succeeds
- [ ] `npm run analyze` → no bundle > 200KB on shared chunks

## Functional smoke tests

### Public marketing
- [ ] `/` loads + interactive SVG washer animates
- [ ] `/diagnose` chat works (send "Bosch E18" → receive AI response)
- [ ] `/foutcodes/Bosch-E18` shows detail + FAQ + related guides
- [ ] `/gidsen/koolborstels-motor-vervangen` shows 6-10 steps
- [ ] `/onderdelen/WF-FILTER-09` shows product page with Add-to-Cart

### Conversion flows
- [ ] Cart icon shows count badge after add-to-cart
- [ ] CartDrawer opens on icon click + shows items
- [ ] `/checkout` form validates postcode regex
- [ ] Stripe Checkout redirect works (test mode, iDEAL and card; Netherlands only)
- [ ] Order confirmation page renders with order ID
- [ ] A guest order shows its confirmation at `/bestelling/<id>?t=<token>` (the link in the mail), and the same page without the token is a 404

### Forms
- [ ] `/contact` shows the support `mailto:` link and the company details render
      (there is **no** contact form and no `/api/contact` route — do not test for one;
      if a form is ever added it needs a route, spam protection and an AVG notice)
- [ ] `/retour/start` RMA form generates RMA number
- [ ] `/blog` newsletter form posts to `/api/newsletter`
- [ ] Exit-intent modal triggers on mouse-out + dismisses for 7 days

### i18n (when enabled; no /de /fr /en routes exist yet, so this fails today)
- [ ] Set `NEXT_PUBLIC_FEATURE_I18N=true`
- [ ] Geo-detection redirects DE visitor to `/de/`
- [ ] LanguageSwitcher dropdown changes locale
- [ ] hreflang tags in `<head>` for all 4 locales

### Auth flows (with Clerk keys; test on a Preview with test keys first)
- [ ] `/inloggen` Clerk widget renders
- [ ] Sign-in redirects to `/dashboard`
- [ ] `/dashboard/bestellingen` shows user orders
- [ ] `/admin/*` redirects unauthenticated to login
- [ ] Sign-in and sign-up load (the Content-Security-Policy names the Clerk host); the first `ADMIN_EMAILS` address becomes ADMIN after a verified sign-in
- [ ] `/api/account/data-export` returns a JSON download (`Content-Disposition: attachment`, **not** a ZIP)
- [ ] `/api/account/delete` requires exact confirmation string

### Mobile (test on iPhone SE viewport 375x667)

> Both boxes below were **failing** when this list was last checked (3 sep 2026) and
> were being fixed at the time. Re-measure them; do not tick them from memory.

- [ ] No horizontal scroll — scroll the page sideways on every template, not just `/`
- [ ] Tap targets ≥ 44px — check the bottom nav, the cart drawer and the filter chips
- [ ] Mobile bottom nav shows below 768px
- [ ] Hero CTA visible above fold
- [ ] Diagnose chat usable

## SEO

- [ ] `/sitemap.xml` validates as XML
- [ ] Sitemap contains 500+ URLs
- [ ] `/robots.txt` allows `/`, disallows `/api/`, `/admin/`, `/dashboard/`
- [ ] Schema.org JSON-LD validates via [Google Rich Results test](https://search.google.com/test/rich-results)
  - Homepage: Organization + WebSite + SoftwareApplication + FAQPage (**no** Product or
    AggregateRating — the invented 4.8/1.247 was removed; a rating is only emitted where
    real approved reviews exist)
  - Foutcode: TechArticle + FAQPage + BreadcrumbList
  - Gids: HowTo + steps + tools + supplies + BreadcrumbList
  - Onderdeel: Product + Offer + ShippingDetails + MerchantReturnPolicy + AggregateRating
  - Blog post: Article
- [ ] Canonical URLs set on all dynamic pages
- [ ] OG image renders at `/opengraph-image` (1200×630 PNG)
- [ ] Favicon + apple-touch-icon load (32×32 / 180×180)

## Security headers (curl -I)

- [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: SAMEORIGIN`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Content-Security-Policy:` (enforcing in production; Report-Only only in development). It names your Clerk host
      (`npm run qa:csp`, and `npm run preflight -- --url` checks the live header)
- [ ] `/api/*` returns `X-Robots-Tag: noindex`
- [ ] `/bestelling/*` returns `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: private, no-store`
- [ ] `https://www.<domain>` answers 308 to the host in `NEXT_PUBLIC_APP_URL`

## Performance (Lighthouse mobile)

- [ ] Performance ≥ 85
- [ ] Accessibility ≥ 90
- [ ] Best Practices ≥ 90
- [ ] SEO ≥ 95
- [ ] TTFB < 500ms
- [ ] LCP < 2.5s
- [ ] CLS < 0.1
- [ ] No images without `alt` attribute

## GDPR / Legal

- [ ] Cookie banner shows on first visit
- [ ] "Reject all" stores consent without analytics cookies
- [ ] `/privacy` page comprehensive (13 sections)
- [ ] `/voorwaarden` page comprehensive (16 articles)
- [ ] `/cookies` page lists cookies in table
- [ ] `/garantie` page lives + 24m/12m matrix
- [ ] `/klachten` page links to WebwinkelKeur + ODR
- [ ] `/disclaimer` page has DIY safety warnings
- [ ] `/retourvoorwaarden` page has 30-day herroepingsrecht

## Configuration

- [ ] `npm run preflight -- --env-file .env.production.local --live-checks` says READY (or READY WITH WARNINGS you understand)
- [ ] After the deploy: `npm run preflight -- --env-file .env.production.local --live-checks --url https://<domain>` says the same
- [ ] Error reporting works: temporarily break something on a Preview and check the message arrives in your channel
- [ ] The uptime monitor on `/api/v1/health` is green, and goes red when the database is unreachable

## DNS / Domain

- [ ] The domain points at the Vercel project with the records Vercel shows in its dashboard
- [ ] Both `<domain>` and `www.<domain>` resolve to the project; the one that is not in `NEXT_PUBLIC_APP_URL` redirects
- [ ] SSL certificate issued
- [ ] Resend shows the sending domain as **Verified** (SPF + DKIM; whether these records already existed was never
      checked), and a DMARC record is set
- [ ] Clerk shows its domain records as verified

## Post-deploy verification

- [ ] `https://wasfix.nl` returns 200 + HTML
- [ ] `https://wasfix.nl/sitemap.xml` returns valid XML
- [ ] `https://wasfix.nl/robots.txt` returns text/plain
- [ ] Submit sitemap to Google Search Console
- [ ] Submit sitemap to Bing Webmaster Tools
- [ ] Verify in Search Console (DNS TXT or HTML file)
- [ ] `sitemap.xml` and `robots.txt` name the production host, not localhost
