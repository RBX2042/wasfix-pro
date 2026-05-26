# TODO.md — WasFix Pro production-readiness pass

Live: https://wasfix.nl · Repo: https://github.com/RBX2042/wasfix-pro

Legenda: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked (see BLOCKED.md)

## P0 — Critical (productie-blockers)

- [~] Fix /monteur 500-error
- [ ] Cookie-consent banner (AVG)
- [ ] Privacy + Voorwaarden full content
- [ ] Custom 404 + error pages (dark theme)
- [ ] Stripe checkout productie-flow + iDEAL
- [!] Real Clerk auth keys → see BLOCKED.md
- [!] Real Gemini key → see BLOCKED.md (currently demo fallback works)
- [!] Real DATABASE_URL → see BLOCKED.md (static-data fallback works for public pages)

## P1 — High (core content & flows)

- [ ] 20 missing core repair guides (MDX content)
- [ ] 250+ extra error codes (per-brand database)
- [ ] 80+ extra parts (SKUs, prices, images)
- [ ] JSON-LD on detail pages (FAQPage / HowTo / Product+Offer)
- [ ] Legal pages: /garantie /klachten /disclaimer /retourvoorwaarden /cookies
- [ ] /retour RMA-flow scaffolding
- [ ] Help articles (uitbreiden /help)

## P2 — Medium (growth & SEO)

- [ ] Site-wide search
- [ ] Reviews on parts/guides
- [ ] Newsletter signup (Resend)
- [ ] Blog scaffolding (defer content)

## P3 — Nice-to-have

- [ ] PWA / offline
- [ ] Dark-mode toggle (already dark on key pages)
- [ ] Live monteur-coach video flow
- [ ] White-label option

## Already done this session

- [x] Domain switch to wasfix.nl + DNS via TransIP API
- [x] Vercel Analytics + Speed Insights
- [x] Favicon + Apple-icon + Dynamic OG image
- [x] JSON-LD on homepage (Organization/WebSite/SoftwareApplication)
- [x] Sitemap optimized (static-db only, 94 URLs)
- [x] Cart wiring on homepage (cart icon, count badge, add-to-cart)
- [x] CartDrawer rendered on redesigned pages
- [x] /diagnose rebuilt with dark theme + real Gemini API
- [x] WasFixShell / WasFixNav / WasFixFooter shared components
- [x] Static-data fallback for all public pages
