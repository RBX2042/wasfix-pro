# WASFIX_ROADMAP.md

**Datum:** 2026-08-25

Classificatie: **P0** = kritieke bug/security/legal · **P1** = directe omzet
/ core product · **P2** = belangrijke verbetering · **P3** = nice-to-have.

Per feature, wanneer gebouwd: 1) database → 2) backend → 3) API →
4) frontend → 5) validation → 6) permissions → 7) tests → 8) mobile UX →
9) error handling. Niet alles tegelijk — één fase per keer, PR per feature.

---

## P0 — nu (deze sessie)

| # | Item | Status |
|---|---|---|
| P0.1 | Auth-bypass / privilege-escalation via impliciete demo-mode | **Fixed in deze PR** — zie `WASFIX_SECURITY.md` §1 |
| P0.2 | Checkout markeert orders als `PAID` bij Stripe-fout/ontbrekende key | Gedocumenteerd, **niet** in deze PR gefixt — vereist een productbeslissing (harde foutmelding tonen aan klant i.p.v. stille demo-succes) die eerst met de eigenaar afgestemd moet worden, want het raakt de huidige investor-demo-flow. Voorstel: alleen hard falen wanneer `NODE_ENV=production` én `DEMO_MODE=false`. |
| P0.3 | `DEMO_MODE=true` blijft aan in productie zolang er geen echte klantdata in de DB staat | **Actie voor mens, niet voor code** — moet uit vóór `DATABASE_URL` echt wordt ingevuld. Zie `BLOCKED.md`. |
| P0.4 | Checkout hard blokkeren wanneer Stripe niet productie-klaar is | Volgt op P0.2, zelfde afweging |

## P1 — core product / directe omzet (volgende sessies, één voor één)

Dit is de kern van "Monteur SaaS" — de grootste kloof tussen huidige
site en de gevraagde "OS for appliance repair businesses". Bouwvolgorde
per de negen-stappen-regel hierboven, telkens één afgeronde verticale
slice:

1. **Datamodel-fundament**: `Company`, `Membership` (user↔company met rol),
   `Customer`, `Machine` (klant-apparaat, los van het bestaande
   catalogus-`WashingMachine`), migraties zonder dataverlies.
2. **Werkorder-systeem**: `WorkOrder` + statusflow (opdracht §6),
   `WorkOrderItem`, gekoppeld aan `Customer`/`Machine`/monteur.
3. **CRM**: klanten-overzicht + detail (contact, apparaten, historie,
   facturen) — tenant-gescoped.
4. **Digitale werkbon**: start/stop-tijd, foto's, onderdelen, diagnose,
   handtekening-capture — mobile-first (opdracht §7, §27).
5. **Facturatie**: `Invoice`/`InvoiceItem` gegenereerd vanuit een
   afgeronde werkorder, PDF, e-mail via Resend.
6. **Live Stripe-subscriptions**: echte producten/prijzen, webhook-sync
   naar een echte `Subscription`-tabel (vervangt de huidige losse
   `plan`-string).
7. **AI-diagnose-engine v2**: multi-oorzaak-confidence-uitsplitsing +
   dynamische vervolgvragen (opdracht §9) i.p.v. één antwoord.
8. **Parts-matching met verified compatibility**: `PartCompatibility`
   met een expliciete "zeker/onzeker"-vlag — nooit een onderdeel tonen
   als compatibiliteit onzeker is (opdracht §11).
9. **GDPR-verificatie end-to-end**: data-export/delete-endpoints echt
   testen tegen een live database, niet alleen dat de route bestaat.

## P2 — belangrijke verbetering

- Planning (dag/week/maand, drag&drop, opdracht §8).
- Rate limiter naar Upstash Redis (multi-instance correct).
- `ApiKey`/`ApiUsage`-tabellen + self-service key-issuance (het huidige
  API-platform is een facade, zie `WASFIX_SECURITY.md` §2.4).
- Inventory-uitbreiding: supplier, min-stock, cost-price/marge.
- Admin-configureerbare pricing (i.p.v. hardcoded `PLAN_LIMITS`).
- CSP-header toevoegen naast de bestaande security-headers.
- Business-KPI-dashboard (MRR, churn, first-time-fix) — vereist eerst
  een `Subscription`-tabel uit P1.6.
- QR machine-profile volledig doorontwikkelen (basis bestaat al per
  recente commits) naar een compleet klant-zichtbaar apparaatprofiel.

## P3 — nice-to-have

- White-label / multi-location.
- Technician Marketplace (opdracht §36) — expliciet
  "architecture-ready", niet nu bouwen.
- WhatsApp-integratie (opdracht §17).
- i18n volledige contentvertaling (scaffold bestaat al, feature-flagged
  uit).
- 3D/voice-features, predictive-maintenance-verfijning.

---

## Fasering (Phase 1-8, zoals gevraagd in de opdracht)

| Fase | Naam | Inhoud | Status |
|---|---|---|---|
| 1 | Stability + Security | P0-lijst hierboven | **In uitvoering (deze PR)** |
| 2 | Monteur SaaS | Datamodel + CRM + werkorders + werkbon + planning (P1.1-P1.4, P2 planning) | Niet gestart |
| 3 | Parts commerce | Live Stripe checkout, inventory, marge-rapportage | Niet gestart |
| 4 | Billing | Facturatie + echte subscriptions (P1.5-P1.6) | Niet gestart |
| 5 | AI engine | Multi-confidence diagnose-engine, verified parts-matching (P1.7-P1.8) | Niet gestart |
| 6 | White-label | Multi-tenant branding | Niet gestart |
| 7 | API | Volwaardig `ApiKey`/`ApiUsage`-platform (P2) | Scaffold aanwezig, niet productie |
| 8 | Marketplace | Technician marketplace (P3) | Niet gestart |

**Belangrijk:** bouw niet alles tegelijk. Elke fase levert een werkende,
geteste, mobile-getoetste verticale slice op — geen halfafgemaakte
features. Nooit bestaande functionaliteit of data verwijderen zonder
reden; nooit fake data tonen als productiedata; nooit een
security-/AVG-claim maken die niet technisch geverifieerd is.
