# TODO.md — WasFix Pro production-readiness pass

Live: https://wasfix.nl · Repo: https://github.com/RBX2042/wasfix-pro

## Status: PASS 2 COMPLETE — 23 mei 2026

13/13 tasks completed this session. Sitemap: 94 → 513 URLs (5.5x SEO).

## ✅ P0 — Critical (productie-blockers)

- [x] Fix /monteur 500-error (split into public landing + auth-gated dashboard)
- [x] Cookie-consent banner (AVG, 3-tier, dark theme)
- [x] Privacy + Voorwaarden full content (13 + 16 sections, NL law-aligned)
- [x] Custom 404 + error pages (dark theme, popular links)
- [x] Stripe checkout productie-flow (iDEAL+Bancontact, code complete)
- [!] Real Clerk auth keys → BLOCKED.md (user must provide)
- [!] Real Gemini key → BLOCKED.md (demo fallback works)
- [!] Real DATABASE_URL → BLOCKED.md (static-data fallback works)

## ✅ P1 — High (core content & flows)

- [x] 20 missing core repair guides (MDX-style JSON, 6-10 steps each)
- [x] 305 extra error codes (Bosch/Siemens/Miele/Samsung/LG/AEG/Whirlpool/Beko/Indesit)
- [x] 76 extra parts (pumps, bearings, belts, motors, boards, locks, dampers, valves, heaters, NTC, doors, filters, knobs, panels, hoses)
- [x] JSON-LD detail pages (FAQPage on foutcodes, HowTo on gidsen, Product+Offer on onderdelen)
- [x] Legal pages: /cookies /garantie /klachten /disclaimer /retourvoorwaarden
- [x] /retour/start RMA-flow + /api/retour endpoint + Resend email templates
- [x] /tools/garantie-check tool (BW 7:17 + EU Right-to-Repair calculator)
- [x] Help center: 5 FAQ → 10 categorized articles (/help/[slug])

## ⏳ Pending (lower priority — next iteration)

- [ ] /monteur/dashboard works without DB (currently auth-gated, throws on Prisma)
- [ ] Predictive maintenance health-score (P2 audit-prompt)
- [ ] QR-sticker PDF generation (P2)
- [ ] /merken/[brand]/[model] model-specific page (P2)
- [ ] API portal with key generation (P2)
- [ ] /blog scaffolding (P2 — 15 SEO articles deferred)
- [ ] Site-wide search (P2 — needs DB for FTS)
- [ ] Reviews on parts/guides (P2 — needs DB)
- [ ] Newsletter signup (P2 — needs RESEND_API_KEY)
- [ ] Email templates (welkomst, abonnement, etc — partial)
- [ ] /merken converteren naar dark theme (P3 design consistency)
- [ ] /dashboard sub-pages tonen data zonder DB (P2 — needs mock/cache)
- [ ] PWA / offline (P3)
- [ ] Video-embeds in premium gidsen (P3)
- [ ] i18n NL+EN (P3 — deferred)
- [ ] Witlabel optie monteurs (P3)

## ✅ Already done in previous sessions

- [x] Domain wasfix.nl + DNS via TransIP API
- [x] Vercel Analytics + Speed Insights
- [x] Favicon + Apple-icon + Dynamic OG image
- [x] JSON-LD on homepage (Organization/WebSite/SoftwareApplication)
- [x] Sitemap optimized (static-db only)
- [x] Cart wiring on homepage (cart icon, count badge, add-to-cart)
- [x] CartDrawer rendered on redesigned pages
- [x] /diagnose rebuilt with dark theme + real Gemini API
- [x] WasFixShell / WasFixNav / WasFixFooter shared components
- [x] Static-data fallback for all public pages

## Metrics deze sessie

| Metric | Before | After |
|---|---|---|
| Error codes | 26 | **331** (+305) |
| Parts in catalog | 20 | **96** (+76) |
| Repair guides | 6 | **26** (+20) |
| Help articles | 5 FAQ | **10 detail articles** |
| Legal pages | 2 | **7** (+5) |
| Pages with JSON-LD | 1 (home) | **All detail pages** |
| Sitemap URLs | 94 | **513** (5.5x) |
| Live HTTP 200 routes | ~25 | **40+** |
