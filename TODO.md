# TODO.md — WasFix Pro

Live: https://wasfix.nl · Repo: https://github.com/RBX2042/wasfix-pro

## Status: FEATURE-COMPLETE — 2 sep 2026

Alle code-side werk is af en geverifieerd (crawl van 227 routes zonder én met database: 0 crashes; 25/25 DB-checks; 42/42 HTTP smoke checks; `next build` groen, 138 statische pagina's). Wat overblijft zijn uitsluitend **credentials/keuzes van de eigenaar** — zie `BLOCKED.md`.

## 🔑 Eigenaar (niet door code op te lossen)

- [ ] `DATABASE_URL` — dedicated Supabase project aanmaken, daarna `npm run db:setup`
- [ ] Clerk keys + webhook secret, `DEMO_MODE=false`
- [ ] Stripe live keys + 3 price IDs + webhook
- [ ] `GEMINI_API_KEY` met quota
- [ ] `RESEND_API_KEY` (+ audience)
- [ ] Echte KvK/BTW/adres/telefoon in /contact, e-mailfooters, legal pages
- [ ] Juridische review privacy/voorwaarden
- [ ] Echte productfoto's (placehold.co nu)

## ✅ Afgerond deze sessie (2 sep 2026)

- [x] Database-laag: seed uit `src/data/*.json` met stabiele IDs (orders verwijzen naar dezelfde Part-IDs als de statische catalogus)
- [x] Nieuwe modellen: ApiKey, Review, RmaRequest, MonteurApplication, NewsletterSubscriber, DiagnosisFeedback
- [x] `isDatabaseConfigured()` — geen enkele route crasht meer zonder DB (/monteur/dashboard, /api/orders, /api/user/plan, /api/account/*, /api/stripe/subscribe, Clerk webhook)
- [x] Echte Clerk auth: ClerkProvider, `<SignIn/>`/`<SignUp/>`, header user-menu, clerkMiddleware, Svix-geverifieerde webhook, e-mail-claim van bestaande accounts
- [x] B2B API keys: aanmaken/lijst/revoke in dashboard, SHA-256 hash in DB, usage tracking, plan-afhankelijke rate limits
- [x] Reviews/RMA/monteur-aanmeldingen/nieuwsbrief/AI-feedback worden opgeslagen; moderatie op `/admin/aanvragen` (server actions)
- [x] Stripe: subscription webhook (created/updated/deleted, payment_failed), billing-portal knop, Bancontact bij abonnementen
- [x] Rate limiting via Upstash REST (fail-open) wanneer geconfigureerd
- [x] AVG: data-export knop in profiel, account-verwijdering anonimiseert + verwijdert Clerk-identiteit
- [x] Ontbrekende pagina's: `/admin/analytics/connect-gsc`, redirect `/voor-monteurs` → `/monteur`
- [x] Lint 0 errors/0 warnings, typecheck groen, CI met Postgres-job + smoke tests

## ⏳ Volgende iteratie (nice-to-have)

- [ ] Monteur werkorders/klanten persistent maken (nu demo-data in de UI)
- [ ] Admin CRUD-formulieren voor catalogus (nu read-only tabellen; content leeft in `src/data`)
- [ ] Referral-attributie in DB
- [ ] i18n content-vertaling (scaffold staat, feature-flag)
- [ ] Reviews tonen op onderdeel/gids-pagina's vanuit DB (API levert ze al)
- [ ] Video-embeds in premium gidsen
