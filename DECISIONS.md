# DECISIONS.md — WasFix Pro

Engineering and product decisions. Each entry: date, decision, alternatives considered, reasoning.
**The newest block is first.** Older entries stay as history; where a later decision replaced one,
the old entry says so in a "Replaced by" line instead of being rewritten.

---

## 2026-10-12 — D24 Indexing is asked for through the sitemap (by hand) and IndexNow (by tool); there is no "index everything" call, and nothing has been submitted (bundle I)

- **The request.** "Vraag alles aan bij index": ask the search engines to index everything that should be indexed. What can honestly be
  built is a tool, a key file, a manual workflow, a preflight group and the owner's steps. What cannot is the act itself: from where this was
  built there is no network to Google, Bing, IndexNow, Vercel or GitHub, there are no accounts, and the site is not deployed anywhere. **Nothing
  was submitted, nothing was verified at a search engine, nothing was ranked.** The tests talk to local fake servers only.
- **Decision.**
  - Two channels, one list. Google (and Bing, which can import the property) get the **sitemap**, submitted by hand in Search Console and Bing
    Webmaster Tools after the domain is verified, plus URL Inspection by hand for the home page and a handful of key pages. Bing, Yandex,
    Seznam, Naver, Yep and other participants also get **IndexNow**, a bulk list of URLs sent by `scripts/seo-submit.ts`. Google does not take
    part in IndexNow. The list is always the sitemap's.
  - `scripts/lib/indexnow.ts` (the rules, testable: key format, origin rules, URL filter, batches of at most 10,000, payload, status
    readings in Dutch, bounded backoff, sitemap and head parsing; the only I/O is `httpGet`, `postBatch` and `readSitemap`, which take an
    injected `fetch`), `scripts/seo-submit.ts` (the command), `public/<key>.txt` (the key file), `.github/workflows/seo-submit.yml` (by
    hand only), a preflight group `zoekmachines` (offline half always, site half with `--url`), `scripts/qa-indexnow.ts` (the tests).
  - **Dry run is the default.** It reads `<origin>/sitemap.xml` (and a sitemap index's children; a file whose `<url>` or `<sitemap>` is never closed is refused as "niet goed gevormd" instead of being returned as a shorter list), prints the counts, what was dropped and why, the
    first and last five URLs and the batch plan, says whether a live run would go ahead, and sends nothing (exit 0 when the list could be
    read). `--live` is a separate, explicit flag.
  - **`--live` refuses** (exit 1, nothing sent, and for the rules that need no network not even a request) unless: the origin is https, a public
    domain (not localhost, an IP address, a single-label or reserved name such as `.test` or `example.com`, not `*.vercel.app`, no port); a key
    is found (`INDEXNOW_KEY`, else exactly one `public/*.txt` whose content is its own name; zero or several refuse); `INDEXNOW_ENDPOINT`, if
    set, is a documented engine endpoint or `http://127.0.0.1` / `http://localhost`; and `https://<host>/<key>.txt` answers 200 **without a redirect**
    and holds the key (fetched before the sitemap is read). The list is a separate matter: a list that cannot be obtained, or that is empty after
    filtering (an empty sitemap, only foreign addresses), is exit 2 and not 1, live or not, and nothing is sent either way. Exit codes: 0 done, 1
    refused or not run, 2 the list could not be read (sitemap unreachable, redirected, invalid, too large, or empty after filtering), 3 a batch was
    not accepted.
  - **Retries.** 429 and server errors (and no answer) are retried at most three times with a doubling wait (2 s, 4 s, 8 s, never above 60 s,
    never below a `Retry-After`); 400, 403 and 422 are reported at once with a Dutch explanation; a redirect from the endpoint is a failure,
    never followed. A 200 or 202 is reported as "received", with the sentence that it is no guarantee and says nothing about ranking.
  - **The key is public by design** (the protocol makes the engine read it from the site), so it is generated once (32 hex characters from
    `crypto.randomBytes`), written to `public/<key>.txt` with no trailing newline, and committed. The tools still print only its length and mask it
    (and the key file's address) in anything shown, including an engine's answer that echoes it; a response body is shown at most 300 characters.
  - **No sitemap ping.** The sitemap ping endpoints of Google and Bing were retired, so no code calls one; `--ping-sitemap-only` exists to say so,
    sends nothing and exits 1. The sitemap goes in by hand.
- **What is never submitted, and why.** The filter (`filterUrls`) is a second guard behind the sitemap, which already applies `indexability()`.
  It drops, counts and shows: a URL on another host, scheme or port (www vs apex included), with a query string (a bare `?` included) or fragment (the canonical
  addresses have none, and the filtered list variants are noindex), under a private path (`PRIVATE_PATH_PREFIXES`, also in another case,
  percent-escaped or with doubled slashes), on the city pages `/wasmachine-kapot/*` (noindex by D23 while `CITY_PAGES_INDEXABLE` is false), on
  every other family that `next.config.ts` marks noindex without a condition (`noindexFamilyPrefixes()` reads `variantHeaderRules()` in
  `src/lib/seo.ts`; today `/qr/*` and `/leadmagnets/*`, so a new family added there is dropped here without a change) and on every single
  file marked so (`noindexExactPaths()`; today `/offline.html`), a technical `.txt` or `.xml` file at the root
  (the key file itself, `robots.txt`, a sitemap), longer than 2048 characters, malformed or carrying credentials, and duplicates. A sitemap bug
  or a hand-made `--urls-file` can therefore not become a submission of a noindex or private page; the preflight reports such a URL as a warning.
  What it cannot catch is a page that is noindex only through its own metadata, outside these families: the sitemap must not list one, and
  `scripts/qa-seo.ts` checks that against the running site. A host written with its closing dot (`https://wasfix.nl.`) is read as the plain
  name, so it cannot slip past the local-host rule (`https://localhost.`).
- **Why not an "index everything" call.** Google's Indexing API is documented for pages with `JobPosting` or `BroadcastEvent` markup only; using it for
  a shop would be against its terms and is what the "index all" services sell. Search Console offers no bulk request for ordinary pages, only the
  sitemap and URL Inspection one page at a time (with a daily limit). The sitemap ping is gone. Bing's route for the same is the sitemap plus
  IndexNow. So the honest "all" is: the sitemap everywhere, IndexNow where it is understood, and a few hand-picked requests at Google.
- **Alternatives rejected.** Calling the Indexing API for ordinary pages (against its documentation, risks the account). Pinging the sitemap
  (retired). A key that is a secret in the environment only (the protocol publishes it; a secret would be theatre, and the engine could not
  verify it; `INDEXNOW_KEY` can still pick a different key whose file is in `public/`). Submitting automatically on deploy or on a schedule (IndexNow is
  for what is new, changed or removed; the tool keeps no record of what was sent, so it would resend the same list; the workflow is
  `workflow_dispatch` only, contents read, no secrets, live only from `main`). Building the list from the database (it would drift from
  the sitemap, which is what Search Console reads). Following redirects for the key file or the sitemap (the engines' behaviour is not documented
  for that, and a redirected sitemap names URLs of another host; it is reported with the target instead). Importing `indexability()` instead of
  reading the published sitemap (the sitemap file is the source of truth; the filter is defence in depth, not a second source).
- **Key file and middleware, on a production build.** Verified on a production build (`next build` and `next start -p 3103`, the CI-like environment, `VERCEL=1`, Clerk not configured): `GET /<key>.txt` answers 200 `text/plain; charset=UTF-8` with exactly the 32-byte key, no redirect, no `X-Robots-Tag` and no rewrite; the answer is the same for bingbot, YandexBot, Googlebot and an "IndexNow" agent, for HEAD, and for 60 requests in a row (nothing in `src/middleware.ts` or `next.config.ts` rate-limits or blocks it); `robots.txt` does not disallow it for any engine (the `Disallow: /` of the AI-crawler group does not apply to them). The site-wide CSP and security headers are on it and do no harm. **The middleware no longer runs on it (integration).** As built, the matcher of `src/middleware.ts` did not exclude `.txt` or `.xml`, so the middleware ran on the key file, `robots.txt` and `sitemap.xml`: with `NEXT_PUBLIC_FEATURE_I18N` off (the default, `.env.example`) the one effect was the 30-day `wasfix-locale-suggested` hint cookie for a visitor whose country or Accept-Language is not Dutch, but **with the flag on** it would have redirected any path without a locale prefix, from a visitor whose country or language maps to another locale (de, fr, ...), to `/<locale>/<path>` (a 404, because no locale routes exist, which is why `.env.example` says to leave the flag off), and an engine fetching the key file from such a country would have been redirected and refused; with Clerk configured every crawler fetch of the three files would also have run `clerkMiddleware` for nothing. The integration added `txt|xml` to the extension exclusion of the matcher (the `/api` guard stays: a path under `/api` that ends in `.txt` still goes through it), so the three files skip the middleware and the caveat is gone: no flag, no cookie, no Clerk run. `scripts/qa-indexnow.ts` reads the matcher text and requires the three files to be excluded and pages, the API and the private areas not; with `QA_BASE_URL` it requests the three files with `Accept-Language: de` and `x-vercel-ip-country: DE` and requires 200, no cookie and no redirect, and a page requested the same way DOES get the cookie (so the check can see one). Still not exercised: the same request with real Clerk keys, and Vercel's own static handling and CDN. `scripts/qa-indexnow.ts` repeats the file and robots checks with `QA_BASE_URL` set, and reads the real sitemap through the tool: 533 URLs, none dropped, and the live path (against a fake engine) sends exactly those. The preflight group, run with `--url` against the same server, passes every site check and warns only about the two unset verification tokens.
- **Preflight (group `zoekmachines`, id lowercase like the others).** Offline: the key (format, and that `public/` holds its file, found by
  length only), and `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` as ok, "ingesteld maar geen geldig token" or "niet ingesteld" (a warning
  on production, information on staging, never a blocker: DNS TXT verification needs neither), plus a `skip` line for what needs the site. With
  `--url`: robots.txt answers 200, does not shut everybody out and names the sitemap on `NEXT_PUBLIC_APP_URL`; the sitemap is valid XML (index
  followed), not empty, entirely on that address; the home page has no `noindex` in the header or a robots meta tag (staging: noindex is expected and
  reported as such) and a canonical equal to the public address; a configured verification tag is really in the page; the key file answers 200 and
  holds the key (a warning, not a blocker: IndexNow is optional). The page is read from `--url` and judged against `NEXT_PUBLIC_APP_URL`, because the
  public address may not answer yet. It overlaps the older robots/sitemap lines of group `live` (S6), which are untouched; a failing
  site therefore shows the same finding twice.
- **Not verified from here.** That any engine accepts a submission, that the key file is fetched and validated by them (the IndexNow documentation
  describes 200/202/400/403/422/429; this was built from it, not against it), that the retired ping endpoints are gone as of today, that Search
  Console and Bing Webmaster Tools accept the verification, and that the workflow runs on GitHub (it was parsed, and its shell step was run with a
  fake `npx`). The GitHub variable names `PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` are the ones the workflow reads; neither is set anywhere.
- **Integration.** The CI steps (`qa-indexnow` in the offline suites, and again with the server after the HTTP smoke test), the npm scripts
  (`qa:indexnow`, `seo:submit`, `seo:submit:live`) and the checklist rows are in; the middleware matcher excludes `.txt` and `.xml` (above); the
  filter also drops `/leadmagnets/*` and `/offline.html` (the same rule as the `X-Robots-Tag` of D23), a bare `?`, and a sitemap with a `<url>`
  that is never closed is refused instead of returned shorter. `public/<key>.txt` must be committed with the rest: the site serves it and
  `qa-indexnow` and the preflight read it.

## 2026-10-11 — D23 Search engines get what is true, and nothing that is not; what stays out stays out the same way everywhere (bundle S)

- **Decision.** The SEO rules live in two modules and every page is built from them. `src/lib/seo.ts` (self-contained, so
  `next.config.ts` and `scripts/qa-seo.ts` import it): `pageTitle()` (the first candidate that fits 60 characters with
  the brand suffix the root template adds exactly once; else the first that fits alone, as an absolute title; else cut at a
  word), `pageDescription()` (70 to 160 characters, padded with a plain true sentence only while too short, cut at a word),
  `pageMetadata()` (title, description, self-canonical without query string, and a COMPLETE Open Graph and Twitter set),
  `indexability()` (the one function the page robots tag and the sitemap both ask), `PRIVATE_PATH_PREFIXES` (the one list of
  private and transactional paths), `LIST_FILTER_PARAMS`, `verificationMetadata()`. `src/lib/json-ld.ts`: builders that take
  only inputs the page also shows (`organizationLd` from `publicCompany()`, `websiteLd`, `breadcrumbLd`, `productLd`,
  `articleLd`) and `ldJson()`, the only way a script block is written.
- **The audit (crawl of the production build, CI-like environment, 533 sitemap URLs + 78 hand-picked others), with the fix:**
  - P1 JSON-LD was written with plain `JSON.stringify` inside `<script>`: a `</script>` in a part description or a review
    body (visitor text, emitted in `Review.reviewBody`) ends the element and the rest is markup, on a site whose CSP allows
    inline scripts. `ldJson()` writes `<` as `<`; `qa-seo` fails on any script block that does not use it.
  - P1 `FAQPage` on 340 pages (home, 329 error codes, 10 brand pages): the questions were generated for the markup and are
    not printed on the page, which Google's FAQ rules require, and some answers promised more than the terms do ("gratis retour"
    in every case, "onderdelen blijven 10 jaar beschikbaar", "10-15 jaar mee"). Removed. There is deliberately no FAQ builder;
    `qa-seo` fails a FAQPage whose questions are not in the page text.
  - P1 497 of the 533 pages lost `og:url`, `og:locale` and `og:site_name`: Next merges metadata one level deep, so a page that exports its
    own `openGraph` replaces the root layout's. Every page now calls `pageMetadata()`.
  - P2 robots.txt used trailing slashes (`/admin/`, `/dashboard/`, `/monteur/dashboard/`, ...), which do not match the pages
    `/admin`, `/dashboard`, `/monteur/dashboard` (a robots rule is a prefix of the path); `/monteur/instellingen` was missing.
    The list has no trailing slash except `/api/` (`/api-docs` and `/api-info` are public pages).
  - P2 `/checkout`, `/inloggen`, `/registreren` and every dashboard, admin and technician page carried no noindex at all, only a
    robots.txt line. They now have the three legs: Disallow (robots.ts), `X-Robots-Tag: noindex, nofollow` (next.config.ts
    `headers()`, which also covers the 307 to the sign-in page) and a robots tag (a pass-through `layout.tsx` per area).
    Disallow plus noindex is a backstop, not a contradiction: Google cannot read a tag on a page it may not fetch, so the
    header and tag are for a crawler that fetches anyway; what must be seen to be dropped (cities, thin brands, variants) is NOT
    disallowed.
  - P2 filtered, searched, sorted and "show more" variants of the three list pages (`?q=`, `?cat=`, `?brand=`, `?sort=`,
    `?n=`, `?difficulty=`) were indexable with a canonical to the unfiltered page. Now `noindex, follow` WITHOUT a canonical
    (a canonical to another page next to a noindex is a mixed signal Google may resolve by dropping the page it points to).
    Parameters that do not change the content (`utm_*`, `ref`, `prefill`, `onderwerp`, `plan`, `order`) keep the
    self-canonical without query string; the `Disallow: /*?ref=*` and `/*?utm_*` lines are gone, because a robots.txt cannot
    strip a parameter and a blocked address cannot show its canonical (it can sit in the index as an empty entry).
  - P2 titles and descriptions: 90 of 533 titles over 65 characters (up to 95), 10 with the brand twice ("... · WasFix Pro ·
    WasFix Pro"), 127 descriptions under 70 characters (error codes down to 35) and 4 over 160, `/over` and `/api-info` on the
    site-wide sentence. After: all 533 titles 20 to 60 characters, none with the brand twice, none cut, all descriptions 70 to 160,
    all titles and descriptions unique.
  - P2 `BreadcrumbList` did not match the breadcrumbs on the page (parts: a brand step linking to a noindex filter; error codes:
    a brand step that is not shown). It is now the trail the page prints, and `qa-seo` checks names, links and targets.
  - P2 `/prijzen` Offers pointed at `/upgrade?plan=` (noindex, disallowed): now `/prijzen`. `Product` shipping was always
    EUR 5.95 although a part of EUR 50 or more ships free (`shippingFor()`); `HowTo.estimatedCost` was the sum of every part listed
    beside a guide (a total the page does not show, for parts that can be alternatives): removed.
  - P2 `Organization` carried an address that was only `addressCountry` and a 32 px logo. Now built from `publicCompany()`: legal
    name, address (only complete), VAT number, KvK, e-mail and phone appear only when configured; the logo is the 180 px app
    icon. `qa-seo` checks that every such fact is printed somewhere on the site.
  - P2 The manifest declared 192 and 512 px maskable icons that were the 180 px apple icon, and a dark splash colour although
    light is the default (D22). New routes `/icons/192`, `/icons/512`, `/icons/maskable-512` are real files of that size;
    `qa-seo` reads every PNG header against the declared size. The favicon is 48 px (Google asks for a multiple of 48).
  - P3 Sitemap: `changefreq` and `priority` were typed by hand ("weekly" on the privacy policy) and are ignored by Google;
    gone. `lastmod` stays on blog posts and guides only (the only rows with a date). `/reparatie/<slug>` was a second address
    for each brand page (200): 308 to `/<slug>-wasmachine-reparatie`. `/favicon.ico` was a 404: 307 to `/icon`. The meta
    `keywords` tags are gone (Google ignores them, Bing reads stuffing as spam). Copy the page does not back was cut from
    descriptions: "nooit meer een verkeerd onderdeel" (`/monteur`), "EU Right to Repair compliant" (calculator), "persberichten"
    and "founder bio" (`/pers`).
  - P3 Preview and development deployments (`VERCEL_ENV` set and not `production`) get `Disallow: /` and `X-Robots-Tag:
    noindex, nofollow`; a self-hosted server or CI, where `VERCEL_ENV` is absent, is treated as production.
  - P3 Optional `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` (`<meta name="msvalidate.01">`); unset or malformed = no tag.
- **Kept, deliberately.** The AI-crawler opt-out group in `robots.ts` (owner choice, D-earlier); `Host:` in robots.txt
  (Yandex-only, ignored by Google, asserted by `scripts/qa-platform.ts`); the `SearchAction` on the home page, now with a test
  that its target (`/foutcodes?q=`) answers with results; `Service` JSON-LD on the brand pages (its serviceType is now the
  diagnosis, not "reparatie", which WasFix does not perform).
- **Repair round after review (the first delivery was read back by someone else; two P2 and the P3s were right).**
  - P2 Metadata after `</head>` for Googlebot. A dynamic page (one that reads `searchParams`) has its title, description,
    canonical, `og:*` and robots tag streamed into `<body>` for any client Next does not know as a crawler that needs them
    in `<head>` (`htmlLimitedBots`). Next deliberately leaves Googlebot off that list. The first delivery said Googlebot
    "hoists them into `<head>` when it renders", and the suite crawled as Bingbot, so it could not see otherwise. Measured
    now (Chromium with a Googlebot smartphone user agent, production build, networkidle plus 3 s): the title, description,
    canonical and `og:title` sit in `<body>` in the rendered DOM of all 7 pages tried (`/contact`, `/onderdelen`,
    `/diagnose`, `/gidsen`, `/foutcodes`, `/retour/start`, `/onderdelen?q=pomp`; the parent of `<title>` is `BODY`), and the
    raw HTML of `/contact`, `/diagnose`, `/retour/start` and the variant has them after `</head>` too (for the other three
    it depends on the state of the data cache). Fix: `next.config.ts` sets `htmlLimitedBots` to Next's own list plus
    `Googlebot` (imported, so an upgrade that extends Next's list is not lost). After it, in all 7 the raw HTML and the
    rendered DOM have them in `<head>`, and `qa-seo` finds them there for Googlebot (smartphone, desktop, Image),
    Google-InspectionTool, Bingbot, Applebot, Twitterbot, facebookexternalhit and Slackbot, on 12 indexable pages and 5
    noindex URLs (three filter variants, the return form with a token, a QR page): 153 fetches,
    `crawler-gets-metadata-in-head`. With Next's default list the same run fails `metadata-in-head` on 6 of 92 crawled pages
    and `crawler-gets-metadata-in-head` on 33 of 153 fetches (all Googlebot rows). Ordinary visitors keep the streamed form
    (the regex does not match a browser user agent: `env-visitors-keep-the-streamed-form`); the price is a crawler's
    response waiting for `generateMetadata()`. The noindex of a variant no longer hangs on the delivery form either:
    `variantHeaderRules()` sends `X-Robots-Tag: noindex, follow` for every filter parameter of `/onderdelen`, `/foutcodes`
    and `/gidsen` (one rule per key of `LIST_FILTER_PARAMS`, only for a non-blank value, as `isListVariant` reads it),
    `noindex, nofollow` for `/retour/start?t=` and `noindex, follow` for `/qr/*`. The brief limits `next.config.ts` to SEO
    `headers()` and `redirects()`; `htmlLimitedBots` is neither, and is the one line outside that scope, taken because the
    measurement left no other way to make the head complete for Googlebot (making the pages static would remove their
    filters and prefill).
  - P2 The preview/development rule (`Disallow: /`, `X-Robots-Tag: noindex, nofollow` on everything) had a test for the
    predicate only. `qa-seo` now loads `robots.ts` and `next.config.ts` in child processes with `VERCEL_ENV` unset,
    `production`, `preview` and `development` (`env-*` checks): preview answers `Disallow: /` with no sitemap line and the
    catch-all header is the LAST `X-Robots-Tag` rule (so it wins over the variant rules); production has neither and keeps the
    AI-crawler opt-out group and the sitemap line.
  - P3 `Allow: /` was emitted before the Disallow lines: a parser that stops at the first match (Python's `urllib.robotparser`,
    older tools) read every private path as open. Removed (allowed is the default); `robots-blocks-private-path-first-match`
    parses like that and `env-robots-has-no-allow-rule` guards the source.
  - P3 `/opengraph-image`, `/icon` and `/apple-icon` were served `immutable, max-age=31536000` at addresses without a content
    hash (og:image, twitter:image, the manifest, the Organization logo). All four image routes now pass `IMAGE_CACHE_CONTROL`
    (one day) as their `headers` option; `image-cache-is-at-most-a-day` reads the header of each.
  - P3 Product JSON-LD named "Universeel" (a compatibility label) as the brand of 42 of 96 parts: `brand` is left out for
    `UNIVERSAL_BRAND`. P3 `/prijzen` plan Offers were bare prices: each now carries a `UnitPriceSpecification` with
    `billingDuration: P1M` and `valueAddedTaxIncluded` (false for the business plans, as the page prints "excl. btw").
  - P3 `privateMetadata()` was exported and used nowhere: deleted (the 11 private layouts use `robotsMeta(false, false)`).
  - P3 The known-debt exception for links to noindex pages matched any `/<slug>-wasmachine-reparatie`; it now names the five
    thin brands (`KNOWN_THIN_BRANDS`) and `known-thin-brands-are-the-brands-without-a-sitemap-entry` keeps the list honest.
    No page of the crawl renders an `<img>` (graphics are SVG, CSS and the generated icons): `img-alt` and `img-dimensions`
    only run on the planted defect, and there is no hero image to give `priority` or `sizes` (the LCP-image item of the brief
    does not apply to this site today; the qa-seo NOTE says so).
  - P3 `CITY_PAGES_INDEXABLE` and the suite: flipping it now needs `EXPECT_CITY_PAGES_INDEXABLE` in `scripts/qa-seo.ts` flipped
    with it (the check `city-switch-agrees-with-the-expectation` says so); the sitemap and crawl checks follow that constant
    instead of assuming cities are noindex. The mutation run that flipped it also showed that nothing links to the 51 city
    pages today, so they would enter the sitemap as orphans (`sitemap-page-is-linked-from-somewhere` fails for all 51): link
    them from somewhere first. The same run found that a literal `false` type made the flip a TYPE error in `qa-seo` that
    would have stopped `next build` (scripts/ is type-checked); the constant is typed `boolean` now. CI order: `qa-seo` runs after "HTTP smoke test" and BEFORE "Checkout + storefront"
    (qa-checkout creates and deletes catalogue parts, which this suite reads through the sitemap).
  - P3 The Product `returnFees` (`ReturnFeesCustomerResponsibility`) describes the 30-day change-of-mind return, where the
    customer pays the return shipping (`/retourvoorwaarden` section 4); a defective part, a wrong delivery and a warranty claim
    are free, and one `returnFees` value cannot say both. The policy links to the terms page (`merchantReturnLink`) that does.
- **Alternatives rejected.** Canonical to the unfiltered page for filtered lists (mixed with noindex; indexable duplicates
  without it). `Disallow` for the parameter variants (hides the tag, and a URL found by link can still sit in the index).
  A FAQ builder next to the page text (nothing prints the FAQ today; an unused builder invites the markup-only FAQ back).
  Per-page robots tags on the 30 private pages instead of a layout per area (30 edits to files another bundle is editing).
  `preload: false` on Inter, Geist and Geist Mono: measured (Slow 4G, 4x CPU, median of 5, lab numbers on localhost) and
  dropped, because it left 3 to 4 font files downloaded on every page anyway and moved `/diagnose` from CLS 0.036 to 0.056.
  Leaving Googlebot on Next's streamed metadata because "Google renders JavaScript": that was the first delivery's choice, it
  was an assumption, and the repair round measured the opposite (see the repair round above).
- **Not verified from here.** Nothing was submitted to Google, Bing or IndexNow and nothing was ranked: there is no network to
  them. No Rich Results Test or Search Console run; the structured data is checked for structure, for agreement with the
  page text and for the schema.org vocabulary the pages use, not against Google's validator. Core Web Vitals are lab numbers
  from Chromium on localhost under emulated throttling, not field data. The www/apex redirect is proved by `qa-platform` (the
  configuration) and by a request with the other `Host` header in `qa-seo`; DNS and the host's own redirect are the owner's
  (BLOCKED.md step 2). The `X-Robots-Tag` and `Disallow: /` on previews are proved by loading `robots.ts` and `next.config.ts`
  with `VERCEL_ENV=preview` and `development` (qa-seo `env-*`), not on a real Vercel preview. Whether Google honours a robots tag
  or canonical that sits in `<body>` after rendering is not known and not needed any more: Googlebot gets them in `<head>`.
- **Integration (S, T and I read together; the second review's P3s, decided).**
  - Changed: (1) the variant header's value pattern is `[\s\S]*\S[\s\S]*` (it was `.*\S.*`: Next anchors it and `.` does not match a line
    break, so `?q=a%0Ab` had the robots tag in the page and no header; `helper-variant-header-rules-match-a-value-with-a-line-break`).
    (2) The static documents in `public/` that are handed out or serve the app, `/leadmagnets/*` (the cheat sheet an e-mail address buys, a
    second copy of it with a `.pdf` name that is the same HTML) and `/offline.html`, were crawlable and indexable, outside every list
    the suite checked; they send `X-Robots-Tag: noindex, follow` (`STATIC_NOINDEX_SOURCES`, part of `variantHeaderRules()` so the IndexNow
    filter drops them from the same rule), and `qa-seo` walks `public/` and requires every `.html`, `.htm` and `.pdf` there to answer
    noindex and not be in the sitemap, and the IndexNow key file (`public/<key>.txt`) to stay plain. (3) The `/contact` description
    promised "de bedrijfsgegevens zodra de inschrijving rond is", true only while the company is unconfigured; with the details set the
    page prints them. It now says only what the page always has (what the contact is for, the response time). (4) `/monteur`'s h1 still
    said "De pro-tool die nooit meer een verkeerd onderdeel bestelt", the absolute claim this decision cut from its description; the
    heading is the line a snippet is built from, so it now reads "De pro-tool die je helpt het juiste onderdeel te vinden". (5) The
    middleware matcher excludes `.txt` and `.xml` (D24 has the reason).
  - Left as they are, on purpose: the five thin brands (Zanussi, Hotpoint, Candy, Haier, Panasonic) stay linked from the footer and `/merken`.
    The pages exist, say honestly that the catalogue holds nothing for the brand yet, and are noindex; a visitor who searches for the
    brand still finds the way to the diagnosis, the cost to crawling is nil at 533 URLs, and `qa-storefront` asserts that the footer mirrors
    `brands.json`. `qa-seo` prints the five links as a NOTE and checks the list of names in both directions against the sitemap. The skipped
    heading level on 35 pages is a NOTE (`QA_SEO_STRICT_HEADINGS=1` makes it a failure): no ranking effect, and 35 presentational edits right
    after a theme pass are not worth the risk. The ten `/merken/<brand>` pages are indexable with 38 to 60 words each (a model list); the
    rule is "has machines", there is no objective threshold, and raising it removes pages from the sitemap and from the IndexNow list on a
    judgement; that is the owner's call. The `SearchAction` of the home page targets a noindex variant and Google has retired the sitelinks
    search box, so the markup is probably inert; it is true (the page has that search) and stays. Link-preview fetchers that Next's list does
    not know (Pinterestbot, Mastodon) still get the streamed metadata on the six dynamic pages; those are no share targets.
  - Read together with D22 and D24 on one production build: the sitemap (533 URLs), the IndexNow list (the tool's filter drops none of them),
    `robots.txt` (no sitemap URL is disallowed) and the preflight group `zoekmachines` (sitemap, robots.txt, home page, key file) agree on what is
    indexable; the full `qa-seo` crawl of all 533 URLs finds no noindex, no off-origin or non-canonical address, one h1 each.
  - CI order: `qa-seo` and the server half of `qa-indexnow` run after the HTTP smoke test and before the checkout suite (it creates and deletes
    catalogue parts that both read through the sitemap); `qa-theme` runs last (D22).

## 2026-10-11 — D22 Light is the default, dark is a switch, documents stay white (bundle T)

- **Decision.** Every first visit is LIGHT, whatever the operating system prefers: `defaultTheme="light"` on the
  `ThemeProvider` in `src/app/layout.tsx` (and as the default of `src/components/theme-provider.tsx`). A visible switch
  (`src/components/theme-toggle.tsx`: Licht, Donker, Systeem) is in the header of both page families, the mobile
  menu, the bottom bar on a phone (which is not rendered in `/admin`, `/dashboard` and `/checkout`: there the header
  menu has it), the footers and the two auth pages (a fixed one in the corner); the choice lives in `localStorage` key `theme`
  (next-themes' default, functional, listed on `/cookies`). `enableSystem` stays on so that "Systeem" works, but it is an
  explicit choice. The provider now wraps everything in `<body>` (it used to wrap only the cart subtree), because the
  bottom bar and the modals are siblings of that subtree and the toggle in the bottom bar needs the context.
- **Why not "system" by default.** The owner asked for light as the standing state ("maak altijd een lichte modus") and
  a way to move to dark. next-themes' own default is "system", which would give a visitor with a dark phone a dark site
  on a first visit they never asked for, and the brand's primary look (cream, teal, rust) is a light design. Verified in
  `node_modules/next-themes` (0.4.6), not assumed: the inline script reads `localStorage.getItem(key) || defaultTheme`
  and consults `prefers-color-scheme` only when that value is the string `"system"`. `scripts/qa-theme.ts` (a) opens
  every page with an OS that prefers dark and empty storage and fails unless it is light; changing the prop to
  `"system"` makes it fail twice, the wiring check and phase (a) (proved, mutation M3 below).
- **Two token sets, both measured.** `globals.css` has a LIGHT set (`:root`) and a DARK set (`.dark`, inside
  `@media not print`), each complete: surfaces, text, primary, accent, destructive, three status colours (`success`,
  `warning`, `info`, each with a foreground), the form-control outline (`--input`, 3:1), the focus ring, `--overlay`,
  `--code`, the hero wash. Every text pair reaches 4.5:1 and every UI colour 3:1 (WCAG formula, re-measured by the
  script on the CSS and on the rendered pages). Three values moved to get there: the rust accent is darker in light
  (`14 64% 38%`; the brand's `#c94b2a` was 4.1:1 as text and 4.3:1 behind cream text), the destructive red is darker in
  light and lighter in dark (it was 4.0 and 3.9:1 as text), and `--input` is a real outline (it equalled the hairline
  `--border`, 1.3:1). The status classes replace the pairs `bg-amber-50 dark:bg-amber-950/30` and friends (about 70 lines):
  `bg-warning/10 text-warning`. A dynamic class (`border-${colour}-500`) in the repair-or-replace calculator
  produced no amber or red variants at all; it is a lookup of complete class names now.
- **The redesign pages (home, diagnose, legal, blog, tools ...) have their own two palettes**, in `wasfix-design.css`:
  the DARK one is what the page always looked like (navy, blue, cyan; two grey text steps lifted for AA and the
  primary button one step deeper, because white on `#5d97ff -> #3b7aff` was 2.9:1 at the top), the LIGHT one is a
  designed light page of the same identity (white cards on a cool grey-white, the same blues, a deep cyan where the
  bright one is not readable as text), not the dark page forced light. The washing-machine drawing reads `--wm-*`
  variables (a white appliance in light). Translucent mixes use channel variables (`rgb(var(--acc-rgb) / 0.08)`) so
  one rule serves both palettes. **Collision fixed on the way:** that scope declared `--border` and `--muted` as
  colours while the app's token system (shadcn naming) owns the same names as HSL triples, so Tailwind's
  `border-border` and `bg-muted` resolved to an invalid colour inside it. The scope's names are `--line*` and `--mute`
  now (about 140 references, mechanical), and `--surf` (used by two components, defined nowhere) exists.
- **Documents print light.** The dark tokens sit in `@media not print`; `dark:` utilities are a Tailwind `variant`
  with the same guard (`darkMode: ["variant", "@media not print { &:is(.dark *) }"]`); print forces `color-scheme: light`
  (next-themes writes it as an inline style, which only an important rule beats) and white backgrounds. The script
  opens the invoice, credit note, packing slip, pick list and work-order invoice with `.dark` set under emulated print
  media and requires white paper, dark ink and AA contrast. The QR sticker and the logos on `/pers` are literal on
  purpose (a printed label and a brand sheet are not themes).
- **`<meta name="theme-color">` and its limit.** The `viewport` export emits one tag per `prefers-color-scheme`
  (`colorScheme: "light"`, not "light dark": that would let a dark phone paint a dark canvas before the stylesheet
  arrives). A class-based switch is invisible to that media query, so once the page is hydrated the provider writes
  the colour of the CHOSEN theme into every tag, and keeps doing so: Next puts the server's tags back on every
  client-side navigation (the first version was right only until the first link was clicked; found in review), so an
  observer on `<head>` re-applies the colour whenever a tag is added or changed. What it cannot do: before hydration and with JavaScript off the
  browser bar follows the phone, not the stored choice; and the colour is one per theme, a few shades off on the
  redesign pages whose background differs.
- **Things that follow the tokens now:** the cookie banner, search modal, exit-intent modal, bottom bar, cart drawer,
  toasts (sonner's variables are pointed at the tokens in `globals.css`; the `<Toaster>` itself only got a position offset, below), the charts
  (`hsl(var(--primary))`, tooltips on `--popover`), the 3D scenes (`use-scene-palette.ts` reads the tokens and
  re-reads them when the class on `<html>` changes; a MutationObserver, because the provider writes the class in an
  effect that runs after its children's), and the stand-alone `global-error.tsx`, which renders outside the layout and
  the provider: it carries two literal palettes (`STANDALONE_PALETTE`, checked against the tokens) and applies the
  stored choice twice over: an inline script in the document, which runs before the first paint when React renders it
  on the server, and an effect for when it is rendered in the browser (a `<script>` rendered on the client never runs).
  Both paths are run by `scripts/qa-theme.ts` with the same five cases; a real server render of `global-error` was
  not produced here, the server path is tested by rendering the component with `react-dom/server`.
- **Found by looking, fixed, and now tested.** The washing machine on the home page hung its part label 124 to 180
  units outside the drawing's 600-wide viewBox, so the browser cut it ("erpomp"); the label now sits above or below
  the hotspot and inside the viewBox (also true at the last commit, not caused by the theme). The toast sat at the
  very top, over the header's theme toggle, cart and account buttons for its four seconds; the `<Toaster>` got an
  `offset` of 76 px (the one change to the layout's JSX beyond the three things the brief gave this bundle in
  `layout.tsx`: the provider props, the html/body class and the viewport export; the integrator should know). The three cookie
  banner buttons clipped "Mijn keuze opslaan" at 375 px (`white-space: nowrap`); they wrap. Sonner's own light
  success colours (`#008a2e` on `#ecfdf2`, 4.26:1) showed on a dark page until its variables were pointed at the
  tokens. The admin chart legend said "Donker/licht", ambiguous next to a theme switch; it says "Volle kleur =
  betaald, gedempte kleur = geplaatst."
- **How `scripts/qa-theme.ts` was checked (each break run, seen to fail, restored).** Header toggle removed: "no toggle in
  the header/nav". Mobile-menu toggle removed: the b check and the 375 px dashboard/admin check. `--muted-foreground`
  (light) to 62%: the token-pair check (2.38:1 on the background), the stand-alone palette check and 414 failures in the
  rendered sweep. A redesign token (`--mute`) to `#8b97b3`: the palette check (2.4 to 2.9:1). `defaultTheme="system"`: wiring
  check and phase (a) (`dark=true` for an OS that prefers dark). `@media not print` removed from the dark tokens: the
  wrapper check and all five documents (heading `#f8f5f2` on white, 1.09:1). Sonner override without its `html `
  prefix: both toast checks. Storage key changed: the stored choice is ignored (b, b2). `ThemeColorSync` made a no-op:
  b3. `applyStoredTheme()` of `global-error.tsx` removed: h. The toast offset, the banner `nowrap` and the old label
  geometry each restored to their earlier state: the three new overlay checks. Run time on a production build, 12
  pages, 4 shared cores at load average 4 to 6 (so on the slow side): 1 min 53 s to 2 min 6 s without the demo server (8 runs),
  3 min 51 s with it (the demo server is `next dev`, which compiles each route on first visit); `QA_THEME_FULL=1` (40
  pages, demo server): 5 min 30 s. The first version ran in about 1 min 25 s; the extra half minute is the wait for a still
  page before every sweep and the tablet-width part.
- **Review and repair (T-repair).** An independent review found three defects of the first version and five smaller ones.
  Each is fixed and each fix has a check that fails without it.
  1. *The contrast sweep was timing-dependent.* On a fresh production build the CI-sized run failed in 4 of 6 runs with one
     false failure ("ERROR" `#88e8fe` on `#f2f5fc`, 1.28:1, home page, 375 px, light). The home page's chat demo adds a message
     every second or two for about 4 s after hydration. The verifier read the label's box, hid the label and photographed it a
     few frames later; when the page had moved in between, the photograph showed the light drum beside the dark display. The
     first report's "43/43 and 49/49" was true of those runs and not of the suite. Now the verifier reads the line boxes again
     after each photograph and measures again when they moved (up to 4 times; an element that never holds still is a failure,
     not a pass), every sweep waits until the page has stopped changing size and the chat demo has played its last message,
     and the judged counts are identical in every run (8802 elements, 1149 proven by gradient stops, 163 measured on pixels,
     16 SVG labels that another element covers and that are named as not judged). A self-test (`d0`) moves the layout at the
     exact moment of the photograph. Proof: with the box comparison removed it reports `#e6f1ff on #ffffff = 1.14:1`, the
     reviewer's false failure. After the fix the CI-sized run passed 7 of 7 on the first repaired build and once more on the
     final build (about 2 min each, the machine at load average 4 to 6); that is evidence, the deterministic proof is `d0`.
  2. *`theme-color` followed the choice only until the first client-side navigation* (above): an observer on `<head>`. Check
     b3 now makes two client navigations in each direction. Proof: observer removed, all four navigations fail
     ("OS light, dark chosen, after navigation 1 to /diagnose: #f4f1eb/#121212 (want #121212)").
  3. *The toggle made both header rows too wide at tablet widths.* The marketing header (six links, switch, cart, account button,
     CTA) needs 1092 px and ran 13 px past the screen at 1024 px with "AI Diagnose" wrapped; it now switches to its menu at
     1120 px (it was 1024) and the links are compact under 1280 px. The redesign nav (six links on the home page) cut off
     "Start gratis" at 896 to 960 px; its links are `nowrap` and compact under 1180 px, and leave the first row under 940 px (it
     was 880): the home page fits from 916 px, the rest of the margin is for the wider signed-in account controls. (First repair:
     the links were then hidden with no menu at all from 768 to 940 px, a band 60 px wider than before; see the second repair
     below, which puts them on a second row.) The shop pages from 1024 to 1119 px use the menu, which has the links.
     New check `e2`: no sideways scrolling and a one-line header row at 768, 900, 960, 1024, 1100 and 1180 px, both themes.
     Proofs: marketing breakpoint back to `lg`, "scrollWidth 1054 > 1024 ... controls past the container: Start diagnose";
     redesign compaction removed, "Start gratis past the container; AI Diagnose, Foutcodes ... wrapped" at 900 to 1024 px.
  4. *Smaller:* the stand-alone error page also carries an inline script for the server-rendered case (above; proof: script
     removed, "stored dark, OS light: dark=false" in the server-rendered run); the bottom bar on the redesign pages wears that
     page's palette instead of the shop's cream and neutral (it sits outside the page's scope, so `wasfix-design.css` writes its
     six colours once per palette inside `@supports selector(:has(*))`, and check `i` compares them with the scope's variables;
     proof: block removed, all six differ in both themes; the first version of that check compared nothing, because `\d` in a
     template literal is `d`, and the proof caught it); an unused variable; the README and the script header now say that
     `DATABASE_URL` is written to (a throw-away database only); the two wrong sentences of this decision (the `<Toaster>` and
     the run times) are corrected.
  5. *Tried and rejected:* lifting the light-theme greys of the 3D parts so the bearing is not a black blob. A lighter grey
     renders the same black bearing (the scene has no environment map, so a metal has nothing to reflect; the materials are the
     original ones, and the brief limits that folder to colours). Reverted; the limit is written in `use-scene-palette.ts`.
- **Second repair (T-repair-2).** A second review found one defect that the first repair's checks could not see, because every
  check measured the header with the menu CLOSED, and a handful of smaller things. Each fix has a check that fails without it.
  1. *The opened mobile menu: the theme control ran past the gutter at 320 to 414 px* (the page scrolled sideways at 360 px and
     "Systeem" was cut off at 320 px). The segmented control is 262 to 292 px wide and sat beside its "Thema" label. Fixed twice
     over, so one cannot undo the other unnoticed: the row stacks under 480 px (label above, control as wide as the row, the
     three choices sharing it equally), and the control itself can no longer be wider than its column (`max-width: 100%`,
     the three choices shrink, and under 400 px their icons give way to the words, which are the accessible names). The same
     CSS fixed the footers, where the control stuck 3 px out of the gutter at 320 px. Two header details found by the new
     check: at 320 px the burger sat 1 px past the content edge, and from 640 to 1119 px the row had no room to spare (signed
     in with Clerk, "Dashboard" + avatar is about 16 px wider than "Mijn account", not measurable here), so the buttons sit
     4 px closer under 1120 px. New check `e3` opens the menu at 320, 360, 375, 414, 479, 480 and 768 px in both themes and
     requires: no sideways scroll, the control inside the container's content box with no clipped word, every other button
     of the header row inside it, the footer controls of a shop page and a redesign page inside it, the bottom bar's panel
     on the screen, and (375 px) the opened menu through the contrast sweep. Proofs: the old row and the old CSS together fail
     with the reviewer's numbers ("scrollWidth 367 > 360", "Systeem past the container", control 15 to 79 px out of the
     gutter); the new row on the old CSS still fails at 320 px; the old row on the new CSS passes (the CSS is the safety net,
     the row is the design); the old button gap fails ("Menu sluiten past the container" at 320 px); the bottom-bar panel
     pushed off the screen fails at every phone width; low-contrast text in the open menu fails the 375 px sweep in both themes.
  2. *Form fields on the redesign pages had a 1.2 to 1.4:1 edge* (the palette's hairline, `--line`), where WCAG 1.4.11 asks
     3:1 for what identifies a control. The text sweep never measured non-text contrast. New palette variable `--field-line`
     (light `#76829b`, 3.2 to 3.9:1 on every surface a field sits on; dark `#6b7894`, 3.5 to 4.5:1), used by the four forms
     of that family (return form, warranty check, predictive tool, QR sticker); check S2 measures it against all five surfaces
     of both palettes, and the new check `j` measures the rendered edge of every visible input, select and textarea of 11
     pages in both themes (36 fields; 17 pages and 38 fields with `QA_THEME_FULL=1`) against the surface behind it. The first
     full-list run found one field the hand-picked list had missed, the newsletter field of `/blog` (1.33:1 light, 1.39:1
     dark); it uses `--field-line` now and `/blog` is in the CI-sized list. **The one named exception:** the chat field and the code
     search of the redesign pages have no edge of their own; each sits in a strip with its own hairline, beside its button,
     and is named by its placeholder, and the check requires that strip to carry the line. That is a judgement under WCAG
     1.4.11 (the strip, not the field, is the visible control), not a measured 3:1; the app's own fields (`--input`, 3:1 and
     better in both sets) pass on their edge. Proofs: one form back to the hairline fails `j` (1.42:1 light, 1.29:1 dark,
     five fields); a light `--field-line` of `#c0c8d8` fails S2 (1.4 to 1.7:1 on all five surfaces).
  3. *The redesign nav had no links and no menu between 768 and 940 px.* The links now sit on a second row of the nav in that
     band (CSS only; the nav is 44 px taller there), and check `e2` requires, from 768 px, links on show or a menu button. The
     first version of that check counted the brand and the buttons as links (`querySelectorAll("nav a")` on a `<nav>` matches
     every link inside it) and passed with the fix removed; the proof run exposed it, the selector is fixed, and the proof
     now fails on the home, diagnose and blog pages at 768 and 900 px in both themes. `e2` also measures 640 px now.
  4. *Smaller:* the CSV column list of the admin import panel wraps (it ended 178 px past a 375 px screen; the page did not
     scroll, so only the element showed it), and the demo part of the suite (part `g`) now checks 12 dashboard, admin and
     monteur pages at 375 px in dark for sideways overflow, which it did not before (proof: wrap removed, "/admin/onderdelen:
     overflowing code.").
  5. *Reported by the repair, outside this bundle's files (fixed at integration, see the next bullet):* `ExitIntentModal.tsx` read and
     wrote `localStorage` and `sessionStorage` without `try`/`catch` (lines 29, 30, 42, 57, 80, 99, also at the last commit), so a browser
     that blocks site data sent every page that mounts it (the home page, the part list) to the global error page; the 404 of unknown
     slugs on dynamic routes; Clerk's sign-in and user menu in dark; and the provider now wrapping everything in `<body>` and the
     Toaster offset, two edits beyond the three `layout.tsx` concerns of this bundle in a file the SEO bundle also edits (kept, both).
- **Integration (T, S and I together).** Two more things the review of the second repair found, plus the findings it reported outside
  the bundle, decided:
  1. *A stored theme with whitespace sent every page to the global error page, for good.* `" dark"`, `"dark light"` and `"a b"` in
     `localStorage["theme"]` make next-themes call `classList.add()` with a token that has a space; the call throws in an effect, the error
     boundary answers "Er is iets misgegaan", and the bad value is read again on every load, so the visitor is locked out until they clear
     site data. Only a hand-edited or corrupted entry gets there (the app writes light, dark or system), but the failure is total and
     permanent and the repair is one line: `src/app/layout.tsx` inlines `STORED_THEME_GUARD_SCRIPT` (`src/components/theme-colors.ts`) just
     above the provider, which removes a stored value that is not one of the three before next-themes reads it. Alternatives rejected: a
     `value` map on the provider (the junk then reaches the toggle as the current choice and the page is light by accident), and sanitising
     inside the provider (it runs after the library's own `useState` has read the raw string).
  2. *`ExitIntentModal` guards web storage.* A probe (`storageUsable()`) before the effect arms the offer, and every write goes through
     `remember()`, which swallows the error. With storage unreadable the offer does not show at all: a browser that cannot remember that
     it was shown or dismissed would get it again on every page. The other direct storage calls of the app were looked at with the
     same probe (blocked storage on 8 pages, below) and need nothing.
  3. *The return form and the exit-intent e-mail field had `outline: none` inline*, which beats every `:focus-visible` rule of a stylesheet:
     a keyboard user could not see which field they were in (the review tabbed through `/retour/start` in both themes: five fields,
     `none 0px`). Removed; the browser's own ring shows. Check `j` now focuses every visible field of its pages in both themes and
     requires an outline or a shadow.
  4. *Check `k` (new).* Seven junk values of the stored theme (`" dark"`, `"dark light"`, `"a b"`, `"banana"`, `"DARK"`, `""`, `"null"`) on the
     home page and the part list, and blocked web storage (`localStorage` and `sessionStorage` throwing a `SecurityError` on access) on 8
     pages: each must show its own h1, not the global error page, be light, raise no uncaught error, and (junk) have lost the bad value.
     Proofs are in the report of the integration (guard script removed: the three whitespace values fail on both pages; storage guards
     removed: `/`, `/onderdelen` and `/foutcodes` fail; the outline put back inline: `/retour/start` fails in both themes (five fields) and the
     exit-intent field fails in both).
  5. *Not changed, owner's call:* Clerk's `appearance` passes only `colorPrimary`, so in dark its card keeps Clerk's own light surface
     (legible, but a light box on a dark page). Mapping `colorBackground`, `colorText` and `colorInputBackground` to the tokens needs the
     sign-in page rendered with real keys to be sure the CSS variables are accepted there; none exist here. The manual checklist has a row.
     The two light palettes differ on purpose (shop cream `#f4f1eb`, redesign pages cool white `#f6f8fc`); the 3D bearing renders almost
     black in both themes because the scene has no environment map (a material or lighting change, which the folder's brief excluded).
  6. *The CSP lets both inline scripts run.* `src/lib/csp.ts` allows `script-src 'self' 'unsafe-inline'` (no nonce or hash), so next-themes'
     script and the guard above execute; `qa-csp` loads 14 real pages of the production build in Chromium with the enforcing header and
     sees no violation (60/60), and the persistence checks of `qa-theme` (Donker survives a reload, `.dark` is on `<html>` before the first
     paint) could not pass if either script were blocked.
  7. *The switch does not disturb what a crawler reads.* A one-off crawl of 67 sitemap URLs as Googlebot and as a browser (134 fetches):
     exactly one `<title>` and one `<h1>` per page, the guard script in `<body>` and ahead of next-themes' own script (none in `<head>`),
     two `theme-color` tags per page, nothing about the theme in any JSON-LD block. (One duplicate-id finding, the washing-machine SVG
     gradients `cabFill`, `panelFill`, `glassFill`, `drumFill` and `seal` twice on the home page, is the same at the last commit.)
- **Seen, not caused here (investigated at integration, not fixed).** An unknown slug on a dynamic route (`/onderdelen/NOPE`, `/blog/nope`,
  `/foutcodes/nope`, `/merken/nope`, `/vs/nope`, `/bestelling/xyz`) answers 404 with Next's client-rendered fallback shell
  (`<html id="__next_error__">`, no inline theme script, the "niet gevonden" title in `<head>`), whereas an unmatched URL
  (`/dit-bestaat-niet`) answers 404 with the full, themed `not-found.tsx`. It is the same at the last commit (the review built `e2fb43c` in a
  scratch tree and saw it there), so it is not a theme regression. At integration it reproduced on the production build for every page that
  throws `notFound()`: ISR pages (`revalidate = 60`, with `generateStaticParams`) and dynamic ones, with and without a `not-found.tsx` of their
  own (`/bestelling/[id]` has one), and with a Googlebot user agent; the server log shows no render error. What it costs: the status (404) and
  the noindex are right and `qa-seo` checks both on a dozen such addresses, so a crawler drops the address; a visitor with Donker stored sees the
  themed 404 after hydration with a short flash of the light shell before it. What would change it is not in our files: `dynamicParams = false`
  would route unknown slugs to the global 404 for the pages whose slugs come from static JSON (blog, vs, help), but it would break the catalogue
  pages (a part created in the admin after the build must render), and it would be a workaround for a framework behaviour, not a cause. Left
  as it is; if Next fixes the shell in a later 15.x, the 404 checks of `qa-seo` stay as they are.
- **Alternatives rejected.** "System" as the default (above). A floating toggle injected by the root layout (a fixed
  button over every page, and the layout's JSX is not this bundle's). A `useTheme()`-driven placeholder swap until
  mounted for the menu button (the icon is chosen by CSS from the class that the inline script already set, so server
  HTML and first client render are identical and nothing moves). Renaming the app's `--border` and `--muted` instead
  of the redesign's (breaks the shadcn convention for every future component).
- **Not verified from here.** Clerk's own sign-in and user-menu components in dark (no Clerk keys, no network;
  `src/components/auth-providers.tsx` passes only `colorPrimary`); how a real phone paints its browser bar; Safari and
  Firefox (only Chromium ran). The PWA manifest reads `THEME_COLOR_LIGHT` since the SEO bundle's edit of
  `src/app/manifest.ts`; an installed app was not opened.

## 2026-10-09 — D21 The restock record is a column on the order line, not an annotation in the credit note (bundle R)

- **Decision.** `OrderItem.restockedQty` (migration `20261009120000_order_item_restocked_qty`: additive, with a
  backfill) counts the units of a line that refunds already put back on the shelf. The cap "ordered minus already
  restocked" is enforced with ONE conditional update on that column inside the refund's transaction (`applyRestock`
  in `src/lib/invoicing.ts`): `restockedQty <= quantity - units` in the WHERE, the increment in the SET, count 0 is
  the refusal, whether the request asked for too much or a concurrent refund took the units first. `checkRestock`
  still runs first, for the Dutch refusal texts; the update is the guarantee. Nothing writes the `restock`
  annotation into a credit note's linesJson any more, and `issueCreditNote` no longer knows about restocks at all.
- **Why.** Until now the units went on the first printed line of the credit note's linesJson and the cap parsed every
  note of the order: stock bookkeeping inside a fiscal document, a data export that had to strip it (and did not: the
  stripping tested `Array.isArray` on a JSON *string* and never fired), and a cap that depended on JSON parsing.
- **Backfill.** The migration sums the `restock` arrays of all existing notes per (order, part) and writes the sum,
  capped at the line's quantity, in plain SQL with `jsonb_typeof` guards and a tolerant cast (a note whose linesJson
  is not JSON or not an array, a line without the array, an entry with the wrong types, a quantity that is negative
  or beyond int4 (0..2147483647): each contributes nothing and aborts nothing; the sums are taken in numeric and the
  only cast to int comes after the cap, so no value in a note can raise "integer out of range"). The one cast of a
  quantity to numeric sits inside a `CASE` on its `jsonb_typeof`, not as a plain WHERE conjunct next to the typeof
  test: Postgres documents no evaluation order for WHERE conjuncts, and with the planner's cost of `jsonb_typeof`
  raised on a scratch copy the plain conjunct was evaluated first and aborted the backfill on a quantity `"abc"`;
  the `CASE` text ran clean under the same costs. Credit notes are not rewritten, because an issued document is
  immutable: old notes keep their annotation, the data export strips it (`stripLegacyRestock`), and nothing else
  reads it.
- **The parameter type of `applyRestock` is `TxOnly`**, `Prisma.TransactionClient & { $transaction?: never }`, not
  `Prisma.TransactionClient`: that type is an `Omit` of the full client, so the bare `prisma` satisfies it
  structurally and a plain `t: Tx` parameter stops nothing (proved: a probe passing `prisma` compiled against
  `t: Tx` and fails against `TxOnly`). A part that spans two lines is claimed line by line, and a conflict on the
  second must roll the first claim back, so running outside the refund's transaction may not compile.
- **The replay with a restock (the webhook books first).** The note no longer records what it restocked, so the
  form's idempotency key is the marker: the first replayed booking that brings a key claims the note (applies the
  ticked restock once, under the cap, and stores the key); the same form submitted again finds its key on the note
  and restocks nothing. A replay that brings no key restocks nothing (before, it restocked and only the annotation
  stopped a repeat). Every real caller (`performRefund`) brings a key.
- **Alternatives rejected.** A `restockJson` column on CreditNote (still bookkeeping on the document, and a second
  place to sum). Keeping the annotation next to the column (two truths that can disagree). Check-then-write under
  the order lock alone (correct today, because `recordRefund` locks the order row first, but then the cap depends
  on every future caller taking that lock; the conditional update depends on nothing read before it).
- **The two admin pages (closed in the integration pass).** `src/app/admin/retouren/page.tsx` and
  `src/app/admin/bestellingen/page.tsx` were outside the bundle and still computed "what can still go back" with the
  legacy reader `restockedFromNotes`: after a post-migration refund they offered the restocked units again, and the
  booking refused them with the Dutch cap message before Stripe was touched (`checkRestock` in `performRefund`),
  nothing moved. Applied since: `retouren/page.tsx` selects `restockedQty` on the items (no `creditNotes` any more)
  and builds the form with `quantity: Math.max(0, i.quantity - i.restockedQty)`; `bestellingen/page.tsx` computes
  `restockedOfItems(o.items)` (`ORDER_LIST_INCLUDE` loads the items with `include`, so the column is on every row) and
  `linesJson` left the `creditNotes` select in `src/app/admin/_lib/orders-query.ts`; `restockedFromNotes` and
  `restockOfLinesJson` are deleted from `src/lib/invoicing.ts` (only `stripLegacyRestock` still touches the
  annotation, for the data export). The pages are server components behind the admin login, so
  `scripts/qa-orders.ts` 12h pins their source (the column selected and subtracted, no legacy reader anywhere) rather
  than rendering them.
- **Not verified from here:** the migration against the production database (no network). It is proved on a
  scratch database by `scripts/qa-migration.ts` (old-format notes, exact and capped backfill, negative, out-of-range
  and non-number quantities skipped, no pre-existing value changed), and the cap, the race and the replay by
  `scripts/qa-orders.ts` section 12 (the lock test 12e hands over with promises and `pg_stat_activity`, not with a
  sleep: the second transaction starts only once the first holds the row, and the first commits only once Postgres
  reports the second waiting on a lock).

## 2026-10-09 — D20 Newsletter opt-out: our table is authoritative, the Resend audience follows, every broadcast carries our link (bundle N)

- **Decision.** Every address on the list has a signed opt-out link, `/api/newsletter/afmelden?token=…`: HMAC-SHA256
  over the address with the key already derived for the confirmation token (`CRON_SECRET`, else `CLERK_SECRET_KEY`,
  decision D10), a purpose string the confirmation token never signs, two parts instead of three, so neither token
  verifies as the other. It does not expire (an opt-out must keep working for as long as the address is on the list) and
  carries no secret, but cannot be derived from the address: it only travels in mail to that address. GET shows a
  button (mail scanners open links); POST (the button, or a mail client's RFC 8058 one-click POST with body
  `List-Unsubscribe=One-Click`, answered with a line of text) sets `unsubscribedAt` in `NewsletterSubscriber` FIRST and
  then PATCHes the Resend contact to `unsubscribed: true`, best effort within the existing 8 s deadline. Resend failing
  (500, timeout) never fails the opt-out; the page then says the opt-out is stored, in force and still being passed on
  (not "you receive nothing more", which only the owner's follow-up makes true), and the owner is told once per address
  and direction per process (an in-memory set: a serverless host repeats it per instance; reason and row id, never the
  address) AFTER the response, through next/server `after()` as notify.ts asks, so the reader never waits for a 3 s
  channel timeout. When our own table cannot be written the answer is an honest 503 ("Afmelden lukt nu niet"), never
  "afgemeld". A second click is still "afgemeld"; an unknown address gets the identical page and no row (no
  enumeration, and no re-storing of a purged or erased address), and its Resend contact is still flagged (the token
  proves we once mailed it); Resend's 404 for an address it does not know is an answer, not a failure, and raises no
  notice. A new sign-up plus a new click clears the opt-out and puts the contact back as subscribed; a confirmation
  link mailed BEFORE the opt-out does not: the link's issue time is in the token (expiry minus TTL), the clear is one
  conditional statement (`unsubscribedAt < issuedAt`), and the person who presses the button in an old mail is told the
  opt-out stands and can sign up again (AVG art. 21 lid 3: a later objection is never undone by an earlier mail).
  Rate limits, two buckets: a token that does NOT verify counts against the caller (30 per address and hour, the guard
  against guessing); a valid token never counts against the caller, only against the address it was signed for (10 per
  hour from any callers), because one-click POSTs come from the mail provider's servers, shared by all its readers (and
  readers behind a carrier NAT share one address), and a 429 there would be a refused opt-out for a request that can
  only ever unsubscribe its own address; past the per-address bucket the opt-out was recorded by the first POST. The
  body (a small form) is therefore read before anything is counted.
- **How the audience is kept in step.** Subscribe updates the contact (`PATCH {unsubscribed:false}`) and creates it
  when the update is refused with ANY non-2xx status, not only 404: an address that opted out earlier is still a
  contact flagged unsubscribed, and what Resend answers to a duplicate create could not be verified from here, while an
  update has one documented meaning; but what it answers for a contact it does not know could not be verified either,
  and a wrong guess about that status would have silently stopped the audience from growing while our table said the
  person subscribed (review finding, repaired the same day). When both calls fail the confirmation stands and the owner
  is told once per address and direction per process, like a failed opt-out; when the CREATE answered 404 the notice
  names `RESEND_AUDIENCE_ID` as the thing to check (a contact being created cannot be "not found", so that 404 is the
  audience path itself), which is the owner's only signal for a wrong id: an opt-out's single PATCH gets the same 404
  for an unknown contact and stays silent by design. Both calls share one deadline. The audience base URL honours
  `RESEND_BASE_URL` like the Resend SDK, so the QA suite runs a real local HTTP stand-in (200, 500, 422, hang, 404)
  instead of patching `fetch`.
- **Newsletters are Resend Broadcasts sent by the owner; the app sends no marketing mail.** The confirmation mail is the
  only mail this code sends to the list, and it carries the link, the sentence that every newsletter will, and the
  RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers from `listUnsubscribeHeaders()`. A broadcast is one
  body for all contacts, so a per-reader link can only reach it as a merge field. Chosen, as the simplest honest
  option within this bundle: `GET /api/newsletter/afmeldlinks` (admin only) gives every subscriber with its link as CSV
  `email,afmeldlink`; the owner loads that column into the audience as a contact property and uses the merge field in
  **every** broadcast, so our table sees the opt-out. The CSV is a snapshot, so it is re-imported right before every
  send (a contact confirmed after the last import would otherwise have an empty property and no link of ours in that
  newsletter), and Resend's own unsubscribe link ALWAYS stays in the template as the fallback for such a contact: a
  newsletter without a working opt-out is unlawful, so the fallback is not optional. **Known gap, named:** an opt-out
  through Resend's own link is not synced back to our table (whether Resend itself stops mailing that contact is not
  verified from here; our count stays too high and a later sign-up would read "already subscribed"); closing it needs
  a Resend webhook (`contact.updated`) that this bundle did not build.
- **Not built, and why.** Storing the link as a contact property from our own code (the property API and its merge
  syntax could not be verified from here, and a refused property would risk the subscribe call itself); an expiring
  opt-out token (would break old mails); a GET that unsubscribes (scanners); a row for unknown addresses (would
  re-store erased data). The custom-header passthrough in `sendMail`/`sendRaw` was outside this bundle's files; the
  integration pass added it (see below).
- **Repaired after review (same day).** The create now follows any refused update, not only a 404, and a confirmation
  whose update and create both fail is reported to the owner like a failed opt-out; the owner notice goes out after
  the response; the page and the one-click line say "stored and in force, still being passed on" when the Resend
  update failed; the rate limit runs before the body is read; the owner workflow says "re-import the CSV before every
  send, keep Resend's own link as the fallback". Section 5b now also pins the purpose string in the signature, the
  silent 404 on an opt-out (unknown address, never-confirmed row), the PATCH for an unknown address, the 422
  fall-through, the both-fail notice and its dedupe, the asynchronous notice and the 429 shapes.
- **Repaired after the second review (same day).** An old confirmation link no longer undoes a later opt-out (issue
  time in the token, conditional clear, "Je afmelding blijft staan" page); the rate limit became the two buckets above
  (before: 30 per caller for valid and forged tokens alike, which after a broadcast would have refused the 31st
  one-click reader behind one provider address); the subscribe notice names `RESEND_AUDIENCE_ID` on a 404 from the
  create; the docs say "per server instance" where they said "once per address". Section 5b now also pins the honest
  503 when the table cannot be written (button and one-click), the per-address-AND-direction dedupe, the old-link
  rule, the wrong-audience-id notice and the opt-out's silent 404 under it, a valid token from a caller whose
  forged-token bucket is exhausted, and the per-address bucket.
- **Integration pass (same day), the cross-file items.** `SendMailOptions.headers` and `RawMail.headers` exist and
  `sendMail` -> `sendRaw` hand them to the Resend SDK as given (`headers` in the `emails.send` payload, SDK 4.8.0), so
  the RFC 8058 pair is on the wire; section 5b sends one mail through the real `sendMail` to the local Resend stand-in
  and reads both headers back from the body the SDK posted (that a mail client turns them into its own button is not
  verifiable from here). An account erasure (`src/lib/erasure.ts`) flags the Resend contact unsubscribed after the
  commit (`forgetNewsletterContactAfterResponse`: the same PATCH as an opt-out, after the response, never a reason for
  the erasure to wait or fail; the contact itself stays in Resend, flagged; section 1 pins the PATCH for both doors).
  The one-click URL gets a line of text for every answer, 200 and 503 included, also on a bodiless POST (5b pins it).
  `/admin/aanvragen` links to the CSV export next to the subscriber count. BLOCKED step 7 and the README say that a
  `CRON_SECRET` rotation invalidates every opt-out link sent before it. **Edge named, not changed:** a repeated opt-out
  keeps the FIRST `unsubscribedAt` (the idempotent write), and the confirmation compares the link's issue time with
  that timestamp, so an opt-out repeated after a newer sign-up's link went out is undone by the button in that newer
  mail; that needs the mailbox owner's own press on "Ja, meld mij aan" (a consent act), and a later objection made
  through our link always stands against every link mailed before it.
- **Not verified from here:** anything against the real Resend API (no network): that the `headers` field of
  `emails.send` ends up on the delivered message (only what the SDK sends is seen); that `PATCH
  /audiences/{id}/contacts/{email}` accepts the address in the path (the Resend documentation and SDK say id or email),
  which status an unknown contact gets (the code no longer depends on it), what a duplicate create answers (the code
  only creates after a refused update), that an unknown audience id answers 404 on the create (the SDK maps `not_found`
  to 404; the hint in the notice rests on that), and that a broadcast can fill a contact property as a merge field. A key
  rotation (new `CRON_SECRET`) invalidates every opt-out link sent before it; the invalid-link page then points to the
  configured contact address. `scripts/qa-privacy.ts` section 5b proves the behaviour above against the local stand-in.

## 2026-10-09 — D19 Production deploys run from GitHub Actions, gated on CI and on the preflight (bundle D)

- **Decision.** `.github/workflows/deploy.yml` deploys `main` to Vercel with the Vercel CLI (`vercel pull`, `vercel build
  --prod`, `vercel deploy --prebuilt --prod`), triggered by a successful run of the CI workflow on `main`, or by hand from
  `main`. It never runs without the three repository secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`: a
  skip with a note, not a failure, so an unwired repository stays green), never deploys a commit that is no longer the tip
  of `main` (`scripts/deploy/check-ref.sh`: queued deploys finish in arbitrary order, and an older commit deployed after a
  newer one is a silent rollback), never deploys a commit whose most recent CI run is not a success
  (`scripts/deploy/check-ci.sh`, so a hand-started deploy obeys "no red main" too), and never runs two deploys at once
  (one concurrency group, `cancel-in-progress: false`: a deploy must not be cut off between the migration and the upload).
- **A run whose commit is no longer the tip deploys the tip instead of skipping.** GitHub keeps one waiting run per
  concurrency group and cancels the older waiting one; since CI runs finish in any order, the cancelled run can be the
  tip's own deploy run, and a green skip would leave `main` undeployed until the next push. So `check-ref.sh` outputs the
  commit to deploy (its own, or the tip), `check-ci.sh` must find the tip's newest CI run green (not green: the run steps
  aside with exit 0 and says what to do; the tip is then deployed by its next GREEN CI run, the running one when it
  finishes or the one after a fix, because a red CI run never triggers the workflow and a dispatch of a red commit is
  refused by the same gate), and `scripts/deploy/checkout-tip.sh` fetches the tip by sha into the shallow checkout and
  verifies HEAD before `npm ci`, the migrations and the build. The tip can be deployed twice this way (by the stand-in
  and by its own run when that one was not cancelled): harmless, the migrations are a no-op the second time and the
  deployment is identical.
- **Order: pull -> migrate -> preflight -> build -> deploy -> preflight --url.** Migrations run BEFORE the new code is live
  because every migration is additive and the new build expects the new schema from its first request (the health route
  answers 503 until then). `scripts/qa-deploy.ts` enforces the rule it can enforce: a migration fails the suite when it
  drops (table, column, index, constraint, type), renames, retypes or truncates, deletes rows, adds a `NOT NULL` column
  without a `DEFAULT` to an existing table, makes an existing column `NOT NULL`, or puts a unique index or a constraint
  (UNIQUE, PRIMARY KEY, FOREIGN KEY, CHECK) on columns the live code already writes; tables and columns created in the
  same migration are exempt (the live code never writes them: `20261008100000` relies on that for `Order.accessToken`,
  `Order.idempotencyKey` and `RmaRequest.linkedOrderId`). The scanner is textual and statement-anchored: it reads the
  spellings Postgres accepts for these at the start of a statement (`ADD` and `ALTER` without the `COLUMN` keyword,
  unnamed constraints such as `ADD UNIQUE (...)`, `IF NOT EXISTS`, schema-qualified tables) and is itself tested on
  SQL samples of each, in both directions, before it runs over the real migrations. Not scanned: the same DDL inside a
  `DO $$ ... $$` block, a function body or an `EXECUTE` string (only the DROP/RENAME/TYPE/TRUNCATE/DELETE words are
  seen there), a `--` inside a string literal (read as a comment), dropping a DEFAULT, removing enum values, the lock a
  new index takes on a very large table; those need a human reading the SQL. Without `DATABASE_URL` in the
  Production environment the pipeline stops before the build. The offline preflight must be READY or READY WITH WARNINGS
  before anything is built; its report prints no secret value (proved on a file of recognisable fake secrets). The live
  probe afterwards targets `NEXT_PUBLIC_APP_URL`, not the deployment's own `*.vercel.app` address: customers use the
  domain, the preflight compares every live check against it, and Vercel's deployment protection can put a login page in
  front of a generated address. A failing probe fails the job although the deploy has happened; the summary says so,
  with the URL. A failure inside `vercel deploy` itself (non-zero exit, or no URL on stdout) is reported as UNKNOWN,
  with the instruction to look at the dashboard's Deployments before deploying again: the CLI may have uploaded and
  promoted before it failed. Only a failure before that step is reported as "nothing deployed". No automatic rollback
  was built: promoting the previous deployment is one action in the dashboard, and the owner should look at the report
  first.
- **Shell scripts, not workflow steps.** The logic is `scripts/deploy/*.sh` (one script per gate and per step, `run.sh`
  for the order and the `.vercel/` cleanup on every exit), so `scripts/qa-deploy.ts` runs the whole pipeline in CI with a
  fake `vercel` and a fake `npm` on PATH, a fake GitHub API and a temporary git origin, without a token or a database.
  The pulled variables file is read by a small parser (`env_value` in `lib.sh`), never sourced and never printed; the
  scripts print names, counts, hosts and the deployment URL only. Every way a gate can fail ends in `fail()` (an error
  annotation, the job summary, exit 1), including a GitHub API answer that is not JSON (a maintenance page with HTTP
  200) or is JSON without the documented `workflow_runs` array (`{}`, `{"message": ...}`: never read as "no CI run",
  which the API did not say) and an unreachable `origin` for `git ls-remote`; a bare stack trace or a bare git error is
  not an owner-facing message. The "no CI run" hint says to wait for CI or re-run it, not to push: the job only runs
  for a commit that is on `main` already.
- **Alternatives rejected.** The Vercel Git integration (it may not be linked, GitHub shows no deployments or statuses
  from any host, and enabled next to this workflow it makes every push deploy twice: BLOCKED.md step 4b says to pick
  one). A marketplace GitHub Action for Vercel (one more unverifiable moving part; the CLI calls are three lines).
  Migrating after the deploy (a 503 window on every deploy). Deploying on `push` to `main` directly (that is before CI
  has judged the commit). Pinning a CLI version (none could be verified from here: `vercel@latest`, with the instruction
  to pin the version that worked after the first successful run).
- **Not verified from here:** the workflow against a real Vercel project (no network, no token); the exact format of the
  file `vercel pull` writes (the parser accepts `NAME="value"` and `NAME=value`); that `vercel deploy` prints the URL on
  stdout (the documented CI pattern); that `vercel deploy --prod` returns only after the production domain points at the
  new deployment (the CLI's documented default without `--no-wait`; the probe of `NEXT_PUBLIC_APP_URL` right after it
  relies on this, and README "Deployen" item (5) says what a wrong assumption looks like); that GitHub lets the runner
  fetch the tip by sha (`git fetch origin <sha>`, what `actions/checkout` itself does; tested here against a local bare
  origin only, from a shallow clone built the way `actions/checkout` builds it that did not yet have the tip, so the
  fetch itself is what the test exercises; not against github.com); the GitHub concurrency and `workflow_run` semantics
  the stand-in rule is built on (documented, not observed); that GitHub-hosted runners have no IPv6 (the reason the
  runbook asks for `DIRECT_URL` to be the session pooler, not the IPv6-only direct host).

## 2026-10-09 — D18 One daily schedule runs the four scheduled jobs (bundle C)

- **Decision.** `vercel.json` schedules exactly one route, `/api/cron/daily`, once a day (03:43 UTC). It runs the four
  jobs in a fixed order (orders -> retention -> stripe-subscriptions -> stripe-reconcile), each isolated, inside one
  function with `maxDuration = 60`. The job bodies moved out of the route files into `src/app/api/cron/_lib/jobs/*`
  (a route file may only export handlers and route config, so a job cannot be imported from one); the list and its order
  are `_lib/daily-jobs.ts`, the runner is `_lib/runner.ts`. The four single-job routes remain, unscheduled, with the same
  guard, the same JSON and the same `maxDuration`: for a hand run with curl, an external scheduler, or an owner whose
  plan allows more schedules.
- **Why one schedule.** According to Vercel's documentation (not verifiable from here: no network) the Hobby plan allows
  2 cron jobs per project, each at most once a day, and Pro allows 40. Four schedules would reject a Hobby deployment.
  Rather than rely on the exact number, the configuration is plan-agnostic: one schedule.
- **The budget trade-off.** 60 s is the lowest function limit of any plan; a higher `maxDuration` than the plan allows
  fails the build, so it is not raised. The runner uses 50 s of it and starts no job with less than 10 s left. What does
  not fit is skipped, recorded in the result, reported to the owner once (the notice says the jobs are not retried before
  the next day and gives the curl that runs them now), and the route answers 500 whenever a job failed or was skipped so
  the platform's cron log shows the day as failed, with the per-job detail in the body (never the error text: a Prisma or
  Stripe message can quote a connection string; that goes to the log and the owner notice). The price: four jobs share
  one minute instead of having one each. To keep one job from taking the others with it, every job gets a cap: what
  is left minus 10 s for each later job, never below 10 s (so the first of four may take 20 s, the last gets all that
  is left; a quick job leaves its share to the next). The runner gives up on a job still running at its cap (recorded
  as failed with `job_timed_out`, logged, the owner told by name, the next job started); without that, a backlog day
  in the orders job would run the function into the platform's 60 s kill with no response, no notice and the other
  three jobs lost for the day. A promise cannot be cancelled, so the abandoned job finishes or fails in the background
  (logged) and may be frozen with the function once the response is out; a job should therefore fit itself inside its
  cap. Which bounds each job has (repair after review): the **orders** job derives a deadline for each of its three
  steps from its cap (the bank-transfer sweep up to half of it, through the `deadlineMs` that `src/lib/cart-expiry.ts`
  already offered; the abandoned-order sweep its usual 15 s at most; the reminders the rest, stopping before the next
  claim, so a cut-off loses nothing, it delays) and reports a cut-short run as `truncated` to the result and to the
  owner, with the curl that drains the rest now; the **stripe-reconcile** job cuts its Stripe scan to what is left
  (20 s at most, as before); **retention** and **stripe-subscriptions** take no deadline and are bounded by row counts
  only (batches of 2000 rows; at most 100 Stripe cancellations per run), so for those two the runner's cut-off is the
  only time bound. On a backlog day the orders job therefore does about 20 s of work per daily run (a hand run of
  `/api/cron/orders` gets the whole 50 s); before this bundle it had a minute of its own. The order is the priority:
  money first (orders), then retention, then subscriptions and the reconcile safety net.
- **Alternatives rejected.** Keep four schedules and hope the plan allows them (the owner would find out at go-live from
  a rejected deployment). Two schedules (fits Hobby's documented limit exactly, leaving no room for a third job, ever).
  Raise `maxDuration` (fails the build on a plan that does not allow it). Let a job that failed be retried inside the
  same run (a job that crashes once will usually crash twice; the next day's run is the retry).
- **Reporting.** A failed job is logged with `report: false` and reported through `notifyError` by name once; the
  logger's sink would otherwise tell the owner a second time.
- **Not verified from here:** the plan limits and the deploy itself. `scripts/qa-platform.ts` section 8 holds the
  configuration to exactly one daily schedule pointing at the daily route whose job list covers the four jobs, and
  `scripts/qa-admin.ts` section 6 proves the runner (isolation, order, budget, one notice per failure, one notice for the
  skipped jobs) with fake jobs and a fake clock, and the daily route end to end against the database.

---

## 2026-10-09 — D14 to D17 (taken during the fix round; recorded here because the code cites them)

- **D14 No way back from CANCELLED.** A bank transfer that arrives after the order was cancelled (grace period
  over, units released, credit note issued) does not revive the order: the money is refunded and the customer told.
  `src/lib/order-status.ts`, `src/lib/invoicing.ts`; terms 7.1.
- **D15 `COMPANY_EMAIL` is the contact address and part of readiness.** Every page that names a contact address
  prints `COMPANY_EMAIL`; without it the pages say "volgt na inschrijving", no address is invented, and checkout
  stays closed like for a missing fiscal field. `src/lib/company-validate.ts`, `src/lib/cart-gate.ts`, `src/app/contact/page.tsx`.
- **D16 A guest order is attached to a real account only when the placer is signed in as it.** A guest who types
  the e-mail address of an existing account gets a guest order on the shared holder row, reachable by its token,
  never a row in a stranger's dashboard. `src/lib/checkout-user.ts`, `src/app/admin/_lib/economics.ts`.
- **D17 The per-address order cap is 10 per day, not 3.** An address is not a person (households, offices,
  carrier-grade NAT); the cap exists against abuse, not against customers. `src/lib/cart-limits.ts`.

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
  *Replaced by D18 (2026-10-09): one schedule, `/api/cron/daily`, runs the four jobs; the number of schedules, not only their frequency, is plan-bound.*
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
