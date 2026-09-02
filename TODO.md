# TODO.md — WasFix Pro

Live: https://wasfix.nl · Repo: https://github.com/RBX2042/wasfix-pro

## Status: FEATURE-COMPLETE — 2 sep 2026 (ronde 2)

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

## ✅ Afgerond in ronde 2 (2 sep 2026)

- [x] Monteur-CRM: `Customer` + `WorkOrder` modellen, volledige CRUD op /monteur/klanten en
      /monteur/werkorders, per monteur afgeschermd; dashboard toont echte aantallen
      (was: hardgecodeerd 12 klanten / 5 werkorders)
- [x] Admin catalogus-CRUD: aanmaken, bewerken en verwijderen van onderdelen, gidsen en
      foutcodes (de knoppen deden voorheen niets); onderdeel op een bestelling wordt op
      voorraad 0 gezet in plaats van verwijderd
- [x] Reviews zichtbaar op /onderdelen/[sku] en /gidsen/[slug], met formulier dat naar
      moderatie gaat
- [x] **Verzonnen reviews verwijderd uit structured data** — home (4.8/1247), prijzen
      (4.8/892 en 4.9/234) en onderdeelpagina (4.7/47) publiceerden ratings die nergens op
      gebaseerd waren. Ratings komen nu uitsluitend uit echte reviews
- [x] Referral-attributie persistent: klik → aanmelding → conversie met €5 beloning,
      visitor-id reist mee in Stripe-metadata zodat de webhook kan crediteren
- [x] 29 database-checks, 53 HTTP-smoke checks, 228 routes gecrawld met én zonder database

## ⚠️ Aandacht van de eigenaar gevraagd

- [ ] **Zichtbare testimonials zijn verzonnen personen.** Op de homepage en /monteur staan
      quotes van "Marieke V. uit Rotterdam" e.d. met bespaarde bedragen. Als reclame-uiting
      voor echte klanten zijn die in strijd met de Wet oneerlijke handelspraktijken
      (EU Omnibus). Vervang ze door echte, verifieerbare klantquotes, of label het blok
      duidelijk als voorbeeld. Ik heb de marketingtekst laten staan — dit is jouw keuze.
- [ ] Statistieken als "3.420+ modellen" en "1.247 reviews" in de FAQ/marketingteksten
      controleren op juistheid

## ⏳ Volgende iteratie (nice-to-have)

- [ ] i18n content-vertaling (scaffold staat, feature-flag)
- [ ] Werkorder-PDF / factuur voor monteurs
- [ ] Video-embeds in premium gidsen
- [ ] Referral-uitbetaling (nu wordt het tegoed alleen geregistreerd)
