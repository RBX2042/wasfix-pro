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

## ✅ Afgerond (2 sep 2026, avond)

- [x] Werkorder-factuur voor monteurs — bedrijfsgegevens op `/monteur/instellingen`,
      factuur met btw-specificatie per werkorder, eigen doorlopende nummerreeks
      per monteur, afgeschermd per monteur (cross-tenant test)
- [x] Alle verzonnen claims van de site verwijderd (zie hieronder)

## ⏳ Volgende iteratie (nice-to-have)

- [ ] i18n content-vertaling (scaffold staat, feature-flag)
- [ ] Video-embeds in premium gidsen (er is nog geen videomateriaal)
- [ ] Referral-uitbetaling (nu wordt het tegoed alleen geregistreerd)
- [ ] Onderdelen meenemen op de monteur-factuur (nu alleen het werkorderbedrag)

## 🧹 Verwijderde onwaarheden

De site claimde structureel meer dan hij waarmaakte. Alles hieronder is
vervangen door cijfers die uit `src/data/*.json` komen (via `catalogStats()`),
of geschrapt omdat er geen meting onder lag.

| Waar | Stond er | Werkelijk |
|---|---|---|
| Homepage stat-strip | 3.420+ modellen, 2.180 foutcodes, 5.600+ onderdelen, 1.247 gidsen | 18 machines, 331 codes, 96 onderdelen, 26 gidsen |
| Homepage + /monteur | Testimonials van niet-bestaande personen en bedrijven | Vervangen door wat het product aantoonbaar doet |
| Homepage | "4.8/5 · 1.247 reviews" | Verwijderd; ratings komen uit echte reviews |
| /over | 12.000+ diagnoses, €2,1M bespaard, 847 ton CO₂ | Catalogus-cijfers + notitie dat gebruikscijfers pas volgen na meting |
| /pers | Drie verzonnen persberichten, incl. "onderzoek" over 50.000 diagnoses | Feitelijke achtergrond |
| /pers | "50K+ diagnoses sinds launch" | Geschrapt |
| OG-image + FAQ JSON-LD | 3.420+ modellen | Afgeleide cijfers |
| 404 + 51 stadspagina's | 2.180+ codes, 5.600+ onderdelen | Afgeleide cijfers |
| Welkomstmail | 5.600+ onderdelen | Afgeleide cijfers |
| /tools/predictive | "onze interne diagnose-data (50K+ samples)" | Eerlijk: vuistregels, geen dataset |
| /api-docs, /api-info | Enterprise €299 / €99 / €499 — bestond niet | Monteur Pro €29, Bedrijf €199 |
