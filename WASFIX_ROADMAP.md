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
| P0.2 | Checkout markeert orders als `PAID` bij Stripe-fout | **Fixed** — een Stripe-sessie-aanmaakfout geeft nu een harde 502 i.p.v. een stille demo-succes-fallback. De fallback blijft alleen actief wanneer Stripe helemaal niet geconfigureerd is (`!stripe`), niet meer wanneer een geconfigureerde Stripe-call daadwerkelijk faalt. |
| P0.3 | `DEMO_MODE=true` blijft aan in productie zolang er geen echte klantdata in de DB staat | **Actie voor mens, niet voor code** — moet uit vóór `DATABASE_URL` echt wordt ingevuld. Zie `BLOCKED.md`. |

## P1 — core product / directe omzet (volgende sessies, één voor één)

Dit is de kern van "Monteur SaaS" — de grootste kloof tussen huidige
site en de gevraagde "OS for appliance repair businesses". Bouwvolgorde
per de negen-stappen-regel hierboven, telkens één afgeronde verticale
slice:

1. **Datamodel-fundament**: `Company`, `Membership` (user↔company met rol),
   `Customer`, `CustomerMachine` (klant-apparaat, los van het bestaande
   catalogus-`WashingMachine`). ✅ **Gedaan** — migratie via `prisma db push`
   geverifieerd zonder dataverlies tegen een lokale Postgres.
2. **Werkorder-systeem**: `WorkOrder` + statusflow (opdracht §6),
   `WorkOrderItem`, gekoppeld aan `Customer`/`CustomerMachine`/monteur.
   ✅ **Gedaan** — status-transities worden serverside gevalideerd
   (`src/lib/work-order.ts`), illegale sprongen (bv. NEW → PAID) worden
   geweigerd (getest).
3. **CRM**: klanten-overzicht + detail (contact, apparaten, historie) —
   tenant-gescoped. ✅ **Gedaan** — `/monteur/klanten` en
   `/monteur/klanten/[id]` lezen/schrijven nu echte data; elke API-route
   controleert `companyId`-eigenaarschap (handmatig cross-tenant getest:
   een klant van bedrijf B geeft 403 voor een monteur van bedrijf A).
   **Nog niet gedaan**: facturen-tab op klantdetail (wacht op stap 5),
   een echte company-onboarding-flow (nu: lazy-provisioning bij eerste
   bezoek — werkt, maar geen naam/KvK-invoerscherm).
4. **Digitale werkbon**: start/stop-tijd, foto's, handtekening-capture —
   mobile-first (opdracht §7, §27). **Deels gedaan**: onderdelen/regels
   toevoegen, monteur-notities en klant-handtekening (canvas signature
   pad, opgeslagen als PNG data-URL, getest) werken al op
   `/monteur/werkorders/[id]`. **Nog niet gedaan**: camera/foto-upload
   (heeft file-storage nodig — geen `UploadThing`/Supabase Storage key
   beschikbaar, zie `BLOCKED.md`), start/stop-tijdregistratie.
5. **Facturatie**: `Invoice`/`InvoiceItem` gegenereerd vanuit een
   afgeronde werkorder. ✅ **Datalaag + view gedaan** —
   `POST /api/work-orders/[id]/invoice` genereert een factuur uit de
   regels + voorrijkosten (21% BTW, end-to-end geverifieerd inclusief
   bedragen), zet de werkorder op INVOICED, weigert dubbel factureren.
   `/monteur/facturen/[id]` is een print-vriendelijke read-only weergave
   (Print/Bewaar-als-PDF via de browser). **Nog niet gedaan**: echte
   PDF-generatie (library nodig) en e-mail naar de klant (RESEND_API_KEY
   nodig) — bewust niet half gebouwd, zie `BLOCKED.md`.
6. **Live Stripe-subscriptions**: echte producten/prijzen, webhook-sync
   naar een echte `Subscription`-tabel (vervangt de huidige losse
   `plan`-string). Niet gestart.
7. **AI-diagnose-engine v2**: multi-oorzaak-confidence-uitsplitsing +
   dynamische vervolgvragen (opdracht §9) i.p.v. één antwoord. Niet gestart.
8. **Parts-matching met verified compatibility**: `PartCompatibility`
   met een expliciete "zeker/onzeker"-vlag — nooit een onderdeel tonen
   als compatibiliteit onzeker is (opdracht §11). Niet gestart.
9. **GDPR-verificatie end-to-end**: data-export/delete-endpoints echt
   testen tegen een live database, niet alleen dat de route bestaat.
   Niet gestart.

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
| 2 | Monteur SaaS | Datamodel + CRM + werkorders + werkbon + planning (P1.1-P1.4, P2 planning) | **In uitvoering** — datamodel, CRM en werkorder-systeem (P1.1-P1.3) gedaan; werkbon deels (P1.4); planning nog niet gestart |
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
