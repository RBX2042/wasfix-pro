# TODO.md — WasFix Pro

Beoogd adres: https://wasfix.nl · Repo: https://github.com/RBX2042/wasfix-pro

## Status op 8 oktober 2026: nog niet live, en niet feature-complete

Wat er is staat in `README.md`; wat jij moet regelen, in volgorde, staat in `BLOCKED.md`. Hieronder alleen wat
**niet** bestaat of nog open staat. Eerdere versies van dit bestand telden afgeronde punten en testuitslagen op
die niemand meer kon reproduceren; die lijsten zijn weggehaald. Wil je weten wat nu groen is, draai de suites
(`QA_CHECKLIST.md`).

## Structureel niet gebouwd (geen sleutel lost dit op)

- **Werkbon voor monteurs** (servicebon, handtekening, fotoverslag): bestaat niet.
- **Planning:** `WorkOrder.scheduledAt` is één datumveld; er is geen agenda, route of capaciteitsoverzicht.
- **Organisatiemodel:** elk zakelijk object hangt aan één `ownerId`; geen teams, seats of rollen binnen een
  bedrijf. Daarom staan "tot 20 gebruikers" en "witlabel" niet bij Bedrijf; zet ze pas terug als ze gebouwd zijn.
- **Monteur-facturen:** het model heeft geen "betaald"-status; versturen per mail en een factuuroverzicht waren op
  3 september 2026 niet aanwezig en zijn niet opnieuw nagekeken. Onderdelen op de monteur-factuur: alleen het werkorderbedrag.
- **Btw:** vast 21%. Geen kleineondernemersregeling, geen verleggen naar EU-klanten (VIES-validatie ontbreekt).
- **Verwijsprogramma:** staat uit (`NEXT_PUBLIC_FEATURE_REFERRAL`); er is geen automatische uitbetaling. Zie `.env.example`.
- **Database-terugval voor de snelheidslimiet en een dagplafond voor Gemini:** niet gebouwd. Zonder Upstash telt de limiter per
  serverinstantie (`BLOCKED.md`, stap 9).
- **Video in premium gidsen:** er is geen videomateriaal.
- **i18n:** de vertaalbestanden staan klaar (`messages/`), de inhoud is niet vertaald; de routes `/de` `/fr` `/en` bestaan niet.
- **Offline gebruik:** bewust weggehaald (service worker, zie `DECISIONS.md`).

## Wat alleen de eigenaar kan (zie `BLOCKED.md`)

- [ ] Bedrijf inschrijven en `COMPANY_*` invullen
- [ ] Domein, Supabase, Vercel, Clerk, Resend, Stripe, Gemini, Upstash, meldingskanaal
- [ ] Inkoopprijzen (offertes) en vervoerderstarief; voorraad en foto's
- [ ] Boekhouder: btw-regime, creditnota's; juridische controle van privacy en voorwaarden
- [ ] Echte klantquotes verzamelen zodra er klanten zijn (verzonnen aanbevelingen zijn een oneerlijke handelspraktijk,
      art. 6:193c BW)
- [ ] Gebruikscijfers pas tonen als ze gemeten worden ("12.000 diagnoses" e.d. zijn verwijderd)
- [ ] Zoekvolume voor "merk + foutcode" opzoeken en de vraag doorrekenen voordat je verkeer koopt (`MONETIZATION.md` §7)

## Open code-punten (klein)

- [ ] 21 bestanden in `src/` (zoek op `https://wasfix.nl`, o.a. `src/app/page.tsx`, de e-mailtemplates, JSON-LD) hebben het
      adres hard staan; laat ze `siteUrl()` uit `src/lib/site-url.ts` gebruiken, zodat een ander domein overal doorwerkt.
      Op de homepage valt het nu samen met `NEXT_PUBLIC_APP_URL`, maar alleen omdat beide wasfix.nl zijn.
- [ ] `scripts/qa-checkout.ts`, `qa-checkout-ui.ts` en `qa-plans.ts` sturen `x-vercel-forwarded-for` om een eigen limietemmer te
      krijgen; dat werkt alleen met `VERCEL=1` (CI zet dat). Laat ze `x-forwarded-for` sturen.
- [ ] De vier lettertypen (Inter, Syne, Geist, Geist Mono) worden allemaal gebruikt; het weghalen van één verandert het
      ontwerp, dus niet gedaan.

## 🧹 Verwijderde onwaarheden

De site claimde structureel meer dan hij waarmaakte. Alles hieronder is
vervangen door cijfers die uit `src/data/*.json` komen (via `catalogStats()`),
of geschrapt omdat er geen meting onder lag.

| Waar | Stond er | Werkelijk |
|---|---|---|
| Homepage stat-strip | 3.420+ modellen, 2.180 foutcodes, 5.600+ onderdelen, 1.247 gidsen | Afgeleide cijfers (op 3 sep: 18 machines, 329 codes, 96 onderdelen, 26 gidsen) |
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
