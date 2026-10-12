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
| `npx tsx --conditions=react-server scripts/qa-orders.ts` · `qa-stripe.ts` · `qa-diagnose.ts` · `qa-notify.ts` · `qa-credit-note.ts` | order domain, restock cap and credit notes; Stripe webhook and subscriptions (fake Stripe); diagnosis honesty and quota; owner notifications; the credit note as a document (its HTTP half needs `QA_ANON_URL`, else reported as skipped) | `DATABASE_URL` (not qa-notify) |
| `VERCEL=1 npx tsx scripts/qa-privacy.ts` | erasure through both doors, data export, guest orders, newsletter double opt-in and opt-out (local Resend stand-in) | `DATABASE_URL`; **plain `tsx`**; `VERCEL=1` (separate rate-limit buckets) |
| `npm run qa:deploy` | the deploy pipeline's gates and order (`scripts/deploy/*.sh`, `deploy.yml`) with a fake `vercel` and a fake `npm` | nothing (no database, no network) |
| `npx tsx --conditions=react-server scripts/qa-checkout.ts` · `qa-storefront.ts` | checkout, guest access, cart; storefront truth | a running **production** server (`QA_BASE_URL`, `QA_ANON_URL`) and `VERCEL=1` (they send `x-vercel-forwarded-for`) |
| `npm run qa:platform` · `qa:preflight` · `qa:csp` | env/APP_URL, rate-limit identity, monitoring, health route, migrate, vercel.json, service worker, `.env.example`; the preflight script; the CSP in Chromium | `qa:csp` and part of `qa:platform` need Chromium; `QA_REQUIRE_BROWSER=1` makes a missing browser a failure |
| `npm run smoke` | 60+ HTTP checks against `BASE_URL` | a running server |
| `QA_BASE_URL=http://localhost:3000 npm run qa:seo` (`QA_SEO_FULL=1` = every sitemap URL; without `QA_BASE_URL` only the helper, source and `VERCEL_ENV` checks run) | SEO readiness: robots/sitemap/page agreement, canonical, titles and descriptions, structured data against the printed page, private areas, noindex variants as tag and header, static documents in `public/` noindex, metadata in `<head>` for 9 crawlers, preview/development noindex, 404, redirects, manifest icons and image cache, 16 planted defects | a running **production** server and the repo checkout (it reads the source tree and starts child processes with `tsx`); in CI after the HTTP smoke test and before the checkout suite |
| `npm run qa:indexnow` (`QA_BASE_URL` + `QA_REQUIRE_SERVER=1` adds the server half) | the IndexNow tooling: key file, payload and 10,000-URL batches, every refusal, retries, a redirect never followed, size/count/time limits, noindex families and technical files dropped, hostile sitemaps, the key never printed, dry-run default, the manual workflow and its documents; with a server also the key file as plain text, robots.txt not shutting it out, the middleware not touching it, and the real sitemap | nothing (no database, no network); `QA_BASE_URL` for the server half |
| `QA_BASE_URL=http://localhost:3000 QA_REQUIRE_BROWSER=1 npm run qa:theme` (`QA_DEMO_URL` adds dashboard, admin, a 375 px sweep of 12 private pages and the pakbon, pick list and work-order prints; `QA_THEME_FULL=1` = 40 pages) | light is the default even for a dark OS, the toggle (menu, mobile menu, bottom bar, footer) works by mouse and keyboard and survives reload and navigation, no flash, theme-color follows the choice, every visible text reaches AA in both themes at 375 and 1280 px, headers fit at 640 to 1180 px, the OPENED mobile menu, footer controls and bottom-bar panel fit at 320 to 480 px, form fields are told apart at 3:1 and show a focus ring, a junk stored theme and blocked web storage do not take the pages down, overlays are legible, documents print light with `.dark` set, global-error honours the stored choice | a running **production** server (`VERCEL=1 next start`), Chromium (`QA_REQUIRE_BROWSER=1`), `DATABASE_URL` of a **throw-away** database (the document check writes a user, part, order, invoice and credit note of year 2999 and deletes them); in CI last |
| `scripts/qa-checkout-ui.ts` · `qa-plans-ui.ts` · `qa-storefront-browser.mjs` | clicks and layout at 375 px | a DEMO dev server; not in CI |
| `npx tsx scripts/qa-migration.ts` | the migrations on a database WITH data (the order-domain migration and the `restockedQty` backfill), every pre-existing value compared afterwards | rights to CREATE DATABASE (creates and drops a scratch database); in CI |
| `scripts/qa-seed.ts` | the seed in production mode | rights to CREATE DATABASE; run before changing the seed; not in CI |

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
- [ ] Exit-intent modal triggers on mouse-out + dismisses for 7 days; with site data blocked in the browser the page still renders (the offer just does not show)

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
- [ ] `/robots.txt` has no `Allow: /` line, disallows `/api/`, `/admin`, `/dashboard` and the other private paths (`src/lib/seo.ts`), names the sitemap on the
      public address, and has **no** `Disallow: /` for `*` (that is what a Vercel preview gets, and it must not reach production)
- [ ] Schema.org JSON-LD validates via [Google Rich Results test](https://search.google.com/test/rich-results)
  - Homepage: Organization + WebSite + SoftwareApplication (**no** Product, FAQPage or
    AggregateRating — the invented 4.8/1.247 was removed; a rating is only emitted where
    real approved reviews exist; `FAQPage` was removed everywhere, D23)
  - Foutcode: TechArticle + BreadcrumbList
  - Gids: HowTo + steps + tools + supplies + BreadcrumbList
  - Onderdeel: Product + Offer + ShippingDetails + MerchantReturnPolicy (brand only for a real manufacturer; AggregateRating + Review only where approved reviews exist)
  - Blog post: Article
  - `/prijzen`: the plan Offers carry price, period (per month) and the VAT basis
- [ ] Canonical URLs set on all dynamic pages; a filtered list (`/onderdelen?q=…`) has `noindex, follow`, **no** canonical, and the same noindex as an `X-Robots-Tag` header
- [ ] `/leadmagnets/foutcodes-cheatsheet.html` and `/offline.html` answer `X-Robots-Tag: noindex`; `/<indexnow-key>.txt` answers 200 as plain text without it
- [ ] OG image renders at `/opengraph-image` (1200×630 PNG)
- [ ] Favicon + apple-touch-icon load (32×32 / 180×180)

## Theme (light by default, dark on request)

Chromium is automated (`npm run qa:theme`); these are what only a real device shows.

- [ ] iPhone Safari, Android Chrome (360x800), desktop Firefox, iPad portrait and landscape: a first visit is **light** with the OS in dark mode
- [ ] Switch to Donker, reload (no flash of light), click through three pages: the browser bar colour stays dark
- [ ] Open the menu on a 360 px phone: the Thema control sits inside the margins and nothing scrolls sideways
- [ ] The redesign pages (home, diagnose, blog) at iPad portrait show their links on a second row (768 to 940 px); the header fits at 1024 px
- [ ] Print an invoice from dark mode: it prints light
- [ ] The sign-in page (Clerk) in dark: Clerk keeps its own light card there (`src/components/auth-providers.tsx` passes only `colorPrimary`); decide whether that is acceptable
- [ ] Edit `localStorage.theme` by hand to `" dark"` and reload: the site is light and usable (the value is removed)

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
- [ ] `QA_BASE_URL=https://wasfix.nl npx tsx scripts/qa-seo.ts` passes against the live site (robots.txt open for `*`, sitemap, canonicals, no stray noindex), **before** the sitemap is submitted
- [ ] Verify in Search Console (DNS TXT, the `GOOGLE_SITE_VERIFICATION` tag or an HTML file)
- [ ] Submit sitemap to Google Search Console; request indexing by hand (URL inspection) for the home page and the five most important pages
- [ ] Submit sitemap to Bing Webmaster Tools (it can import the Search Console property)
- [ ] `https://wasfix.nl/<indexnow-key>.txt` shows the key; run the workflow *SEO submit (IndexNow)* as a dry run, then with *live* ticked (only from `main`). Nothing has been submitted from the repository: this is the first time
- [ ] `sitemap.xml` and `robots.txt` name the production host, not localhost
