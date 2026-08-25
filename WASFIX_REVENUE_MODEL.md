# WASFIX_REVENUE_MODEL.md — Business Model Audit

**Datum:** 2026-08-25

---

## 1. Wie is de beste primaire klant?

Niet de consument. De AI-diagnose-consumer-flow (foutcode opzoeken →
gids lezen → misschien een onderdeel kopen) heeft een lage
willingness-to-pay en een eenmalige, niet-terugkerende relatie — een
wasmachine gaat gemiddeld 1x per 8-10 jaar kapot. De **zelfstandige
monteur / klein reparatiebedrijf (1-10 monteurs)** is de betere primaire
klant:

- Herhaalgebruik: dagelijks, niet eenmalig.
- Duidelijke pain point met meetbare ROI (zie §2).
- Natuurlijk pad naar recurring revenue (het bedrijf runt via WasFix,
  niet alleen "zoekt er iets in op").
- De consument-flow blijft strategisch waardevol als **acquisitiekanaal
  voor monteurs** (SEO-verkeer op foutcodes/gidsen genereert leads die
  WasFix aan een monteur in de buurt kan koppelen — zie
  Technician Marketplace, §36 van de opdracht) en als losstaande
  transactie-omzet (onderdelenverkoop), maar is niet de kern van het
  SaaS-verdienmodel.

## 2. Wat is de belangrijkste pain point (van de primaire klant)?

Voor een zelfstandige monteur/klein bedrijf: **versnippering van
tools.** Vandaag draait dat typisch op WhatsApp voor klantcontact, een
Excel/papieren agenda voor planning, een los facturatieprogramma
(Moneybird/e-Boekhouden), en losse foutcode-opzoek-sites of
fabrikantenhandleidingen. Niets praat met elkaar. Tijd die verloren gaat
aan administratie i.p.v. reparaties is direct omzetverlies (elke
niet-declarabele minuut is inkomen mislopen). De AI-diagnose is een leuke
feature, maar de reden dat een monteur *blijft betalen* is "mijn hele
bedrijf draait hierop en overstappen is te veel gedoe" — dat vraagt om
CRM + planning + werkbon + facturatie in één workflow, niet om losse AI.

## 3. Welke features veroorzaken willingness-to-pay?

1. **Tijd besparen op administratie** — digitale werkbon die automatisch
   een factuur genereert is de sterkste driver (opdracht §7).
2. **Minder herhaalbezoeken** — AI-pre-diagnose + parts-matching die vóór
   het bezoek al het juiste onderdeel meebrengt, verhoogt first-time-fix
   rate. Dat is direct meetbaar in omzet per bezoek.
3. **Onafhankelijkheid van meerdere abonnementen** — één tool i.p.v. vier
   is zelf al een besparing.
4. **Groei-functies (Pro/Business tiers)**: team-planning, multi-user,
   rapportages — zodra een zelfstandige naar een klein team groeit is dit
   niet "nice to have" maar noodzaak.

## 4. Wat moet gratis blijven?

- Consumer: beperkt aantal AI-diagnoses/maand, basis-foutcodes, basis-gidsen
  (huidige `FREE`-plan-logica in `PLAN_LIMITS` is hiervoor een redelijk
  uitgangspunt — 3 diagnoses/maand).
- Monteur: een gratis/trial-laag met 1 gebruiker, beperkt aantal actieve
  werkorders — genoeg om de kernworkflow te ervaren, niet genoeg om er een
  heel bedrijf op te runnen. Dit is de activatie-hefboom.

## 5. Wat moet betaald worden?

- Onbeperkte AI-diagnoses (consumer).
- Elke CRM/werkorder/planning/facturatie-functionaliteit (monteur).
- Team-/multi-user-functies, API-toegang, white-label (bedrijf).
- Premium content (uitgebreide reparatiegidsen, video).

## 6. Welke features zijn geschikt voor B2B?

CRM, werkorders, planning, digitale werkbon, facturatie, bulk-onderdelen
bestellen tegen B2B-prijzen, rapportages/KPI's, team-rollen.

## 7. Welke features zijn geschikt voor enterprise?

Multi-location, white-label (eigen branding/domein voor een
reparatieketen), API-platform met SLA, dedicated support, custom
rapportages, factuur-i.p.v.-creditcard-billing.

## 8. Waar kan WasFix transaction revenue verdienen?

- Marge op onderdelenverkoop (consumer én monteur-bulkbestelling).
- Commissie op de Technician Marketplace (§36 opdracht): WasFix koppelt
  een consument aan een beschikbare monteur en neemt een percentage van
  de opdrachtwaarde.
- Betaalverwerkingsmarge indien WasFix ooit als facturatie/incasso-laag
  voor monteurs fungeert (vergelijkbaar met hoe Moneybird/Stripe-achtige
  tools een kleine fee op transacties kunnen vragen) — **niet nu bouwen**,
  wel architectuur-ready houden.

## 9. Waar kan WasFix recurring revenue verdienen?

De abonnementenladder (§14 opdracht, zie herziene staffel hieronder) is
de primaire recurring-revenue-motor. ARPU groeit naarmate een monteur
meer gebruikers/functies afneemt.

## 10. Waar kan WasFix API revenue verdienen?

Fabrikanten, verzekeraars (garantie-claims), en grotere reparatieketens
die foutcode/parts-data of AI-diagnose willen integreren in hun eigen
systemen. Dit is de kleinste maar hoogste-marge stream — puur
data/compute, geen operationele kosten per klant.

---

## Herziene pricing-staffel

De huidige live staffel (`Particulier €4,99 / Monteur Pro €29 / Bedrijf
€199`, hardcoded in `src/lib/auth.ts` `PLAN_LIMITS`) heeft geen
tussenstap tussen een solo-monteur en een heel bedrijf, en geen
duidelijke upsell-trigger. Aanbevolen staffel, aansluitend bij de
opdracht (§14) maar aangepast aan wat er vandaag al gebouwd is:

| Plan | Prijs | Doelgroep | Kernfeatures |
|---|---|---|---|
| Free | €0 | Consument die 1x een probleem opzoekt | 3 AI-diagnoses/mnd, basis-foutcodes, basis-gidsen |
| Consumer Plus | €7,99/mnd | Herhaalgebruiker, huishouden met meerdere apparaten | Onbeperkte diagnoses, volledige database, premium gidsen, servicehistorie, korting op onderdelen |
| Monteur Solo | €39/mnd | Zelfstandige monteur (1 gebruiker) | CRM, apparaten, werkorders, AI, onderdelen, digitale werkbon |
| Monteur Pro | €79/mnd | Klein team (2-5 monteurs) | Alles Solo + team-planning, geavanceerde rapportages, automatisering, API-read-access, bulk-bestellen |
| Business | vanaf €199/mnd | Reparatiebedrijf/keten | Multi-user, rollen, multi-location, white-label, volledige API, dedicated support |

**Belangrijk:** pricing moet configureerbaar worden vanuit `/admin`
(opdracht §14, §33) i.p.v. hardcoded in `PLAN_LIMITS` — dit is een
concreet Phase 3/4-item, geen dag-1-vereiste, maar de huidige hardcoded
aanpak betekent dat elke prijswijziging vandaag een code-deploy vereist.

---

## LTV / CAC / churn — huidige status

Er is vandaag **geen instrumentatie** om deze cijfers te meten: geen
`Subscription`-tabel met start/churn-datums, geen cohort-tracking, geen
MRR-berekening (`/admin/analytics` toont traffic/SEO-data, geen
business-KPI's). Dit moet gebouwd worden vóór er zinvolle
groei-beslissingen op deze metrics genomen kunnen worden — zie Roadmap
Phase 3-4 en opdracht §21.
