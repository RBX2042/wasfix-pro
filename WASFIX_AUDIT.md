# WASFIX_AUDIT.md — Full Product & Software Audit

**Datum:** 2026-08-25
**Auditor:** Claude Code (fresh, independent pass — not a rerun of prior self-reports)
**Scope:** volledige repository (`RBX2042/wasfix-pro`), live architecture, business model, security, UX

> **Leeswijzer.** Deze repo bevat al meerdere eerdere "audit"-documenten
> (`qa-report.md`, `production-readiness-report.md`, `WALKTHROUGH_REPORT.md`,
> `LAUNCH_REPORT.md`, `INVESTOR_READY.md`) die zichzelf een score van 92-100/100
> gaven. Die documenten zijn **niet leidend** voor dit audit: ze zijn geschreven
> door dezelfde soort AI-sessie die het eigen werk beoordeelde, testen vooral
> "compileert het en geeft de demo-mode de verwachte JSON terug", en missen de
> kritieke bevinding in §D.1 hieronder volledig. Behandel oudere scores als
> marketingtekst, niet als beveiligingsverificatie.

---

## A. Current architecture

Volledige technische architectuur staat in [`ARCHITECTURE.md`](./ARCHITECTURE.md)
(grotendeels accuraat, hergebruikt hier). Samengevat:

| Layer | Keuze |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript strict |
| Styling | Tailwind CSS + custom dark-theme components |
| Auth | Clerk — **niet actief geconfigureerd**, site draait in `DEMO_MODE` |
| Database | Prisma → Postgres (Supabase) — **niet actief verbonden**, `DATABASE_URL` is een placeholder |
| Public content | Static JSON fallback (`src/data/*.json`), gegenereerd door scripts |
| AI | Google Gemini 2.0 Flash — key aanwezig maar quota=0, draait op demo-fallback |
| Payments | Stripe — code aanwezig, geen live keys/producten |
| Email | Resend — DNS klaar, geen API key |
| Hosting | Vercel (wasfix.nl is live) |

**Kernconclusie architectuur:** de site draait vandaag volledig op de
static-JSON-fallback-laag. Geen van de vijf kritieke externe diensten
(DB, Auth, AI, Payments, Email) is met echte productie-credentials
verbonden. Dat is op zichzelf geen ramp voor een marketing/SEO-site — maar
het betekent dat elke eerdere "productie-gereed"-claim in de oudere
rapporten ongetest is tegen de situatie waarin die diensten wél actief zijn.
Zie §D.1: de auth-bypass wordt pas een actief datalek zodra `DATABASE_URL`
echt wordt ingevuld — wat het eerstvolgende geplande "unblock"-item is
volgens `BLOCKED.md`.

**Wat volledig ontbreekt in het datamodel** (`prisma/schema.prisma`, 14 modellen):
geen `Company`/tenant, geen `Membership`/rol-per-bedrijf, geen `Customer`
(los van consumer `User`), geen `Appointment`, geen `WorkOrder` /
`WorkOrderItem`, geen `Invoice` / `InvoiceItem` / `Payment`, geen
`Subscription`-tabel (plan staat als string op `User`), geen `ApiKey` /
`ApiUsage` (de v1-API-laag heeft er wel code voor — zie §D.3 — maar geen
tabel), geen `Supplier`, geen `AuditLog`, geen `Notification`, geen
`PartCompatibility`-metadata (alleen een kale M-N junction), geen
`MachineDocument`. Dit is de kern van de kloof tussen "AI-diagnose website"
en de gevraagde "OS for appliance repair businesses" — zie
`WASFIX_ROADMAP.md` Phase 2-4.

---

## B. Feature matrix

Legenda: ✅ werkt in productie · 🟡 werkt alleen in demo-mode / gedeeltelijk · 🔴 bestaat niet

### Consumer

| Feature | Bestaat | Werkt | Productieklaar | Ontbreekt | Prioriteit |
|---|---|---|---|---|---|
| AI Diagnose (chat) | ✅ | 🟡 (Gemini quota=0 → demo-antwoorden) | Nee | Echte Gemini key, streaming, multi-turn confidence-engine (§9 van de opdracht) | P1 |
| Foto Diagnose | ✅ | 🟡 (zelfde quota-probleem) | Nee | Echte vision-key, geen upload-opslag (geen Storage/CDN) | P1 |
| Foutcodes (331 codes, static) | ✅ | ✅ | Ja (static data) | — | — |
| Reparatiegidsen (26 gidsen) | ✅ | ✅ | Ja | Video-embeds, premium-gate niet aan echte betaling gekoppeld | P2 |
| Onderdelen (96 parts, static) | ✅ | ✅ | Ja voor catalogus, **nee voor checkout→betaling** (geen live Stripe) | Live Stripe producten, echte voorraad-sync | P0/P1 |
| Repareren vs vervangen | ✅ | ✅ | Ja | — | — |

### Monteur

| Feature | Bestaat | Werkt | Productieklaar | Ontbreekt | Prioriteit |
|---|---|---|---|---|---|
| Dashboard | ✅ | Echte, per-company gescoopte cijfers (klanten, actieve werkorders, eigen AI-diagnoses) | Ja voor de kern | Facturatie-/omzet-KPI's (wachten op Invoice-model), first-time-fix rate | P1 |
| CRM (klanten) | ✅ | Echte data, tenant-gescoped, cross-tenant getest (403) | Ja voor de kern | Notities-UI, facturen-tab, company-onboarding-scherm (nu: lazy-provisioning) | P1 |
| Apparaten | ✅ | `CustomerMachine`-model: merk/model/serienummer, gekoppeld aan klant en werkorders | Ja voor de kern | Foto's, garantie-datum in UI, aankoopdatum in UI | P1 |
| Werkorders | ✅ | Volledig `WorkOrder`-model + servergevalideerde statusflow (opdracht §6), regels toevoegen, notities | Ja voor de kern | Camera/foto-upload, handtekening-capture, PDF-werkbon, automatische facturatie | P1 |
| Planning (dag/week/maand, drag&drop) | 🔴 | — | Nee | `Appointment`-model, planner-UI | P2 |
| Route/reistijd | 🔴 | — | Nee | Maps-integratie | P2 |
| AI Diagnose (monteur-versie) | 🟡 | Zelfde als consumer | Nee | Monteur-specifieke output (repair time, cost estimate) | P1 |
| Onderdelen (bulk bestellen) | 🟡 stub | UI aanwezig, geen backend | Nee | B2B-prijzen, leverancier-koppeling | P2 |
| Werkbon (digitaal) | 🔴 | — | Nee | Volledig nieuw — camera, uren, handtekening | P1 |
| Handtekening | 🔴 | — | Nee | Signature capture component | P1 |
| Factuur | 🔴 | — | Nee | `Invoice`-model + PDF-generatie | P1 |
| Betaling (monteur→klant) | 🔴 | — | Nee | Koppeling Stripe/factuur | P2 |

### Bedrijf

| Feature | Bestaat | Werkt | Productieklaar | Ontbreekt | Prioriteit |
|---|---|---|---|---|---|
| Teams / Rollen | 🔴 | Alleen een `role`-string op `User` (CONSUMER/TECHNICIAN/BUSINESS/ADMIN), geen bedrijfscontext | Nee | `Company` + `Membership` + RBAC | P1 |
| Rapportages / KPI | 🟡 | `/admin/analytics` bestaat, toont GSC/traffic, geen business-KPI's (MRR, churn, first-time-fix) | Nee | KPI-engine (§21 van opdracht) | P2 |
| Multi-location | 🔴 | — | Nee | — | P3 |
| White-label | 🔴 | — | Nee | Branding-per-company, custom domain | P3 |
| API | 🟡 | Scaffold met 1 hardcoded demo-key (`wf_demo_...`), geen `ApiKey`-tabel, geen self-service issuance | Nee | Zie §D.3 | P2 |

### AI Engine

| Feature | Bestaat | Werkt | Productieklaar | Ontbreekt | Prioriteit |
|---|---|---|---|---|---|
| Fault diagnosis | ✅ | 🟡 demo-fallback | Nee (quota=0 key) | Echte key, confidence-per-oorzaak i.p.v. 1 antwoord | P1 |
| Vision | ✅ | 🟡 demo-fallback | Nee | Zie boven | P1 |
| Model recognition | 🔴 | — | Nee | — | P2 |
| Parts matching | 🟡 | Keyword/category-regex, geen echte compatibility-tabel | Nee | `PartCompatibility` met verified-flag (opdracht §11: "geef nooit een onderdeel als compatibiliteit onzeker is" — huidige matching is regex-based en dus per definitie onzeker) | P1 |
| Repair procedure | ✅ | ✅ (static gidsen) | Ja | — | — |
| Predictive maintenance | 🟡 | Component/route aanwezig (recent commit), niet gevalideerd tegen echte servicehistorie (die niet bestaat) | Nee | Echte data om op te trainen/regelen | P3 |

### Commerce

| Feature | Bestaat | Werkt | Productieklaar | Ontbreekt | Prioriteit |
|---|---|---|---|---|---|
| Parts catalogus | ✅ | ✅ | Ja | — | — |
| Inventory | 🟡 | `Part.stock` is een los getal, geen supplier/min-stock/waarschuwingen | Nee | Inventory-model (opdracht §12) | P2 |
| Orders | ✅ | ✅ (demo-mode: order zonder echte betaling wordt als PAID gemarkeerd) | **Nee — orders worden als betaald gemarkeerd zonder dat er echt betaald is als Stripe niet actief is** | Zie §D.2 | P0 |
| Suppliers | 🔴 | — | Nee | — | P2 |
| Pricing | ✅ | ✅ | Ja | Niet configureerbaar vanuit admin (hardcoded in `auth.ts` `PLAN_LIMITS`) | P2 |
| Margins | 🔴 | — | Nee | Cost-price ontbreekt op `Part`, dus geen marge-rapportage mogelijk | P2 |

### Admin

| Feature | Bestaat | Werkt | Productieklaar | Ontbreekt | Prioriteit |
|---|---|---|---|---|---|
| Users | ✅ | ✅ query, **maar zichtbaar voor iedereen door §D.1** | Nee tot §D.1 gefixed is | — | P0 |
| Companies | 🔴 | — | Nee | — | P1 |
| Machines / Fault codes / Parts (CMS) | 🟡 | Admin-pagina's bestaan voor foutcodes/onderdelen, geen volledige CMS-workflow (geen approve/publish/audit trail) | Deels | — | P2 |
| AI logs | 🟡 | `Diagnosis`-tabel logt alles, geen apart "AI failures"-dashboard | Deels | Zie §34 van opdracht | P2 |
| Payments | 🟡 | `StripeEvent`-tabel voor idempotency, geen payments-overzicht-UI | Deels | — | P2 |
| Subscriptions | 🟡 | Plan-upgrade werkt in demo, geen echte Stripe-subscriptions actief | Nee | — | P1 |
| Analytics | ✅ | ✅ | Ja | — | — |

---

## C. Bugs gevonden

1. **🔴 P0 — Auth-bypass / privilege escalation.** Zie §D.1. Dit is de belangrijkste
   bevinding van dit hele audit.
2. **✅ Gefixt — Orders werden als "PAID" gemarkeerd zonder echte betaling**
   wanneer een Stripe-sessie-aanmaak faalde terwijl Stripe wél geconfigureerd
   was. Dat pad geeft nu een harde 502 i.p.v. een stille "geslaagd"-fallback.
   De demo-fallback (Stripe helemaal niet geconfigureerd — investor-deploys)
   blijft ongewijzigd werken.
3. **✅ Gefixt — Monteur-dashboard toonde platform-brede data.** `recentOrders`
   op `/monteur/dashboard` haalde voorheen de laatste orders van *alle
   klanten* op, niet van een tenant. Met het nieuwe `Company`/`Membership`-
   model (Phase 2) is deze query verwijderd en vervangen door echte,
   company-gescoopte werkorder- en klantcijfers; handmatig cross-tenant
   getest (een klant van bedrijf B geeft 403 voor een monteur van bedrijf A).
4. **🟡 P1 — In-memory rate limiter reset bij elke serverless cold start** en
   is niet gedeeld tussen Vercel-instanties. `/api/diagnose` en
   `/api/checkout` rate limits zijn dus makkelijk te omzeilen door herhaalde
   cold starts of parallelle requests over meerdere regio's. Bekend en
   gedocumenteerd (`UPSTASH_REDIS_REST_URL` staat als "nodig" in
   `BLOCKED.md`), maar nooit als security-issue geclassificeerd — het is er
   wel een zodra `/api/checkout` of `/api/diagnose` misbruikt wordt voor
   spam/kosten-DoS op de Gemini-quota.
5. **🟡 P1 — API v1-platform is een facade.** `validateApiKey()` in
   `src/lib/api-auth.ts` heeft precies één geldige sleutel: een hardcoded
   demo-key in de broncode zelf. Er is geen `ApiKey`-Prisma-model, geen
   issuance-flow, geen usage-tracking. `/api-info` en `/api/v1/health`
   presenteren dit alsof het een werkend platform is — dat moet niet als
   "live" gecommuniceerd worden naar (potentiële) B2B-klanten totdat het
   echt bestaat.
6. **🟢 P2 — Cart dedupe-bug** (stale `partId` na re-seed) is al gevonden en
   gefixt door een eerdere sessie (`WALKTHROUGH_REPORT.md`) — geverifieerd
   aanwezig in de huidige code (`cart-provider.tsx` dedupet op `sku`). Geen
   actie nodig.
7. **🟢 P2 — Geen centrale env-validatie bij boot.** `src/lib/env.ts` bestaat
   maar valideert niet dat kritieke combinaties kloppen (bv. "DEMO_MODE=false
   maar geen CLERK_SECRET_KEY" start gewoon door en faalt pas bij de eerste
   request). Een `NEXT_PUBLIC_APP_URL`-mismatch met de echte host zou
   Stripe-redirects en CORS-checks breken zonder duidelijke foutmelding.

---

## D. Security

Volledige security-bevindingen staan in [`WASFIX_SECURITY.md`](./WASFIX_SECURITY.md).
De twee belangrijkste:

### D.1 — Kritiek: authenticatie-bypass via demo-mode (gefixt in deze PR)

`src/lib/auth.ts` en `src/middleware.ts` activeren "demo mode" niet alleen via
een expliciete `DEMO_MODE=true`, maar **ook automatisch zodra
`CLERK_SECRET_KEY` ontbreekt** — en dat is exact de huidige productiestatus
(`BLOCKED.md`: "Clerk production keys... Blocked"). In demo mode:

- `middleware.ts` slaat **alle** auth-gating voor `/admin`, `/dashboard` en
  `/monteur/*` volledig over (`if (isDemoMode) return NextResponse.next();`).
- `getCurrentUser()` retourneert voor *elke* bezoeker, zonder in te loggen,
  automatisch de echte superadmin-account (`jdahoe@hotmail.nl`, role
  `ADMIN`, plan `BEDRIJF`) — of een static ADMIN-object als de DB
  onbereikbaar is.
- `/admin/page.tsx` checkt alleen `user.role !== "ADMIN"` — en omdat demo
  mode altijd `ADMIN` teruggeeft, ziet iedere anonieme bezoeker het volledige
  admin-dashboard inclusief echte gebruikerslijst, orders en omzet zodra de
  database bereikbaar is.

Vandaag is de impact beperkt doordat `DATABASE_URL` nog een placeholder is
(dus de meeste queries falen en tonen static fallback-data) — maar dat is
toeval, geen bescherming, en het eerstvolgende geplande "unblock"-item is
precies het invullen van een echte `DATABASE_URL`. Op dat moment wordt dit
een actief, extern exploiteerbaar datalek van echte klantgegevens zonder dat
er iets hoeft te "misgaan" — het is de bedoelde werking van de huidige code.

**Fix toegepast in deze PR** (zie `WASFIX_SECURITY.md` §1 voor details):
demo-mode wordt niet langer stilzwijgend geactiveerd door een ontbrekende
sleutel in productie, en de middleware faalt closed (blokkeert) in plaats
van open (laat door) als Clerk niet te initialiseren is.

### D.2 — Overig
Zie `WASFIX_SECURITY.md` voor de volledige checklist (RLS/tenant-isolatie,
webhook-verificatie, rate limiting, file uploads, AI-prompt-veiligheid,
GDPR).

---

## E. UX audit (samenvatting)

Volledige per-pagina UX-notities zijn hieronder in tabelvorm; dit is geen
"maak het mooier"-exercitie maar een audit van workflow-volledigheid.

| Pagina | Probleem | Waarom | Oplossing | Prioriteit |
|---|---|---|---|---|
| `/monteur/dashboard` + subpagina's | Oogt als een werkend CRM/werkorder-systeem maar is 100% statische demo-data | Monteurs die het product proberen, botsen direct op een muur zodra ze iets proberen te wijzigen — er is niets te bewaren | Ofwel duidelijk "Preview / binnenkort" labelen, ofwel (aanbevolen) bouwen per Roadmap Phase 2 | P1 |
| `/diagnose` (mobiel) | Chat-interface werkt, maar de gevraagde "single dynamic confidence-engine met vervolgvragen" (opdracht §9) ontbreekt — het is nu één antwoord per beurt | Monteur/consumer krijgt geen percentage-uitgesplitste diagnose zoals gevraagd | AI-engine-verbetering, zie Roadmap Phase 5 | P1 |
| `/checkout` | Geen zichtbare indicatie dat betaling "demo" is wanneer Stripe niet actief is — gebruiker ziet gewoon een bevestiging | Verwarrend en risicovol zodra er echt geld omgaat (zie bug C.2) | Blokkeer checkout hard als Stripe niet geconfigureerd is in productie, i.p.v. stille demo-fallback | P0 |
| `/prijzen` | Prijzen wijken af van de opdracht-voorgestelde staffel (huidige: Particulier €4,99, Monteur €29, Bedrijf €199 vs. opdracht: Consumer Plus €7,99 / Monteur Solo €39 / Monteur Pro €79 / Business €199+) | Geen "Monteur Solo vs Pro"-onderscheid, dus geen upsell-pad binnen de monteur-doelgroep | Herzie staffel — zie `WASFIX_REVENUE_MODEL.md` | P1 |
| `/admin` | Geen enkele auth-guard-indicatie in de UI zelf (geen "je bent ingelogd als demo-admin"-banner) | Verergert §D.1 — zelfs een oplettende gebruiker zou niet doorhebben dat ze automatisch admin zijn | Opgelost door de D.1-fix (bypass verdwijnt), plus: voeg een zichtbare demo-mode-banner toe wanneer demo mode wél bewust actief is | P0 (via D.1) |
| Mobile (algemeen) | `MobileBottomNav` bestaat voor consumer-navigatie; monteur-flows hebben geen mobile-first "één-hands-bediening"-ontwerp (camera/voice/werkbon uit opdracht §27) | De doelgroep die dit dagelijks op straat gebruikt (monteurs) heeft de zwakste mobiele flow | Bouwen in Phase 2 samen met de werkbon | P1 |

---

*Zie ook: [`WASFIX_SECURITY.md`](./WASFIX_SECURITY.md),
[`WASFIX_REVENUE_MODEL.md`](./WASFIX_REVENUE_MODEL.md),
[`WASFIX_ROADMAP.md`](./WASFIX_ROADMAP.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md).*
