# QA_CHECKLIST.md

Pre-launch / pre-merge checklist. Run through before every release.

Nothing here runs itself: there is no test runner and no `npm test`. The only
automated checks are `npm run db:smoke`, `npm run money:smoke` and `npm run smoke`
(61 HTTP checks). Everything else below is a human walking the flow. A ticked box
means someone looked — never that a suite passed.

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
- [ ] Stripe Checkout redirect works (test mode)
- [ ] Order confirmation page renders with order ID
- [ ] Demo order (`/bestelling/demo-XXXX?success=1`) shows confirmation

### Forms
- [ ] `/contact` shows the support `mailto:` link and the company details render
      (there is **no** contact form and no `/api/contact` route — do not test for one;
      if a form is ever added it needs a route, spam protection and an AVG notice)
- [ ] `/retour/start` RMA form generates RMA number
- [ ] `/blog` newsletter form posts to `/api/newsletter`
- [ ] Exit-intent modal triggers on mouse-out + dismisses for 7 days

### i18n (when enabled)
- [ ] Set `NEXT_PUBLIC_FEATURE_I18N=true`
- [ ] Geo-detection redirects DE visitor to `/de/`
- [ ] LanguageSwitcher dropdown changes locale
- [ ] hreflang tags in `<head>` for all 4 locales

### Auth flows (when DEMO_MODE=false)
- [ ] `/inloggen` Clerk widget renders
- [ ] Sign-in redirects to `/dashboard`
- [ ] `/dashboard/bestellingen` shows user orders
- [ ] `/admin/*` redirects unauthenticated to login
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
- [ ] `Content-Security-Policy: ...` (or report-only in dev)
- [ ] `/api/*` returns `X-Robots-Tag: noindex`

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

## Required environment variables

See `BLOCKED.md` for full list. For launch:
- [ ] `STRIPE_SECRET_KEY` (live)
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (live)
- [ ] `RESEND_API_KEY`
- [ ] `GEMINI_API_KEY` (with quota)
- [ ] `DATABASE_URL` (real password)
- [ ] Error monitoring — currently **absent**. `@sentry/nextjs` is not installed, so
      `NEXT_PUBLIC_SENTRY_DSN` on its own changes nothing and there is no server-side
      reporting at all. See BLOCKED.md; this needs code, not just a key.

## DNS / Domain

- [ ] `wasfix.nl` → Vercel apex (A 76.76.21.21)
- [ ] `www.wasfix.nl` → Vercel CNAME (cname.vercel-dns.com)
- [ ] SSL certificate auto-issued by Vercel
- [ ] Resend DKIM records present (`resend._domainkey` TXT)
- [ ] DMARC record set
- [ ] SPF record includes Resend

## Post-deploy verification

- [ ] `https://wasfix.nl` returns 200 + HTML
- [ ] `https://wasfix.nl/sitemap.xml` returns valid XML
- [ ] `https://wasfix.nl/robots.txt` returns text/plain
- [ ] Submit sitemap to Google Search Console
- [ ] Submit sitemap to Bing Webmaster Tools
- [ ] Verify in Search Console (DNS TXT or HTML file)
