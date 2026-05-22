# WasFix Pro — Investeerdersdemo Script

**Versie:** 2026-04-28
**Live URL:** http://localhost:49899
**Doel:** Series A Pre-seed: €150K voor 12% equity

---

## 2-Minuten Demo (live in browser)

### Slide 1 — Het probleem (30 sec)

> "Elke dag staan 11.000 Nederlanders voor een kapotte wasmachine. Ze bellen een monteur — €89 alleen voor diagnose, plus 3 weken wachten — of ze googelen wanhopig naar foutcodes en vinden niets bruikbaars. Dat is een markt van **€2,1 miljard** in Nederland en België waar geen enkele speler AI heeft."

**👉 Open:** http://localhost:49899
- Wijs op de hero **3D wasmachine** met spinning drum
- Wijs op de stats: **18 machines · 26 foutcodes · 20 onderdelen · 10 merken**
- Stats animeren omhoog (AnimatedCounter)

### Slide 2 — De oplossing: Foto diagnose (45 sec)

> "Wij hebben de eerste Nederlandse AI gebouwd die wasmachines diagnostiseert in 60 seconden. Klant maakt een foto van de foutcode, of beschrijft het probleem. Direct krijgen ze diagnose, oorzaak, en de juiste onderdelen om te bestellen."

**👉 Klik:** "Start gratis diagnose"
- Klik tab **"Foto uploaden"**
- Upload een foto van een wasmachine display met foutcode
- Wacht op AI analyse (Claude Vision API)
- Toon: detectedCode, detectedBrand, confidence %, automatische diagnose
- Of klik snel-prompt **"Bosch foutcode E18"** (geen foto nodig)
- Wijs op **animated confidence gauge (87%)** + **radar chart** + **3 aanbevolen onderdelen**

### Slide 3 — De moneymaker: Calculator (20 sec)

> "Naast diagnose: de eerste Nederlandse repareer-of-vervang calculator. Eerlijk advies, geen verkoper-bias. Gebaseerd op leeftijd, kosten, energielabel en CO₂ impact. Dit is **uniek in NL**."

**👉 Navigate:** http://localhost:49899/tools/repareren-of-vervangen
- Toon de calculator met sliders
- Demo: 8 jaar oud + €300 reparatie + B label = REPLACE advies
- Demo: 4 jaar + €80 reparatie + A++ label = REPAIR advies (€600 bespaard)
- Wijs op de **CO₂ besparing** badge

### Slide 4 — Volledige flow (20 sec)

> "Van probleem naar opgelost in 2 minuten."

**👉 Klik:** "In winkelmand" op de afvoerpomp (€28,50)
- Cart icoon: badge met **1**
- Klik cart → **drawer met item + 15% BEDRIJF korting**
- Klik **"Naar afrekenen"** → totaal **€30,18**
- Klik **"Bestelling plaatsen"** → orderbevestiging

### Slide 5 — Admin Analytics (15 sec)

> "Realtime analytics voor onze klanten en onszelf."

**👉 Navigate:** http://localhost:49899/admin
- Wijs op **stats cards** (gebruikers, omzet, bestellingen, diagnoses)
- Wijs op **Revenue chart (30 dagen)** — Area + Line gecombineerd
- Wijs op **Top foutcodes bar chart** — kleur op severity

---

## Key Metrics voor Pitch Deck

### Markt
- **TAM:** €2.1B (NL+BE witgoed reparatie)
- **SAM:** €420M (wasmachine-specifiek)
- **SOM jaar 1:** €180K ARR
- **Jaarlijkse storingen NL:** 4.2M

### Unit economics
| Metric | Waarde |
|---|---|
| CAC (SEO) | €4 |
| CAC (Google Ads) | €18 |
| LTV Particulier | €4.99 × 14 mnd = **€70** |
| LTV Monteur Pro | €29 × 18 mnd = **€522** |
| LTV Bedrijf | €199 × 24 mnd = **€4.776** |
| Bruto marge (SaaS) | 65-70% |
| Bruto marge (onderdelen) | 15-18% |

### Funding ask
- **€150.000 pre-seed** voor 12% equity
- Runway: 14 maanden
- Doel: 5.000 betaalde gebruikers in maand 14
- Hire: 1 senior dev + 1 SEO/content marketeer + 50% commerciële founder

---

## Concurrentie-positie

```
                    HEEFT AI DIAGNOSE
                           │
            WasFix Pro ●   │
         (NL specialist)   │   iFixit FixBot
                           │   (Engels, generiek)
─────────────────────────────────────────────────
GEEN               │       │     HEEFT
ONDERDELEN         │       │     ONDERDELEN
                   │       │
    Zoofy/Twistoo  │       │   PartsNL, FixPart
    (lead-gen)     │       │   (geen diagnose)
                           │
                    GEEN AI DIAGNOSE
```

**Unieke positie:** AI diagnose + foto-vision + NL onderdelen + reparatiegidsen + repareer/vervang calculator. **Geen enkele NL/BE speler heeft dit.**

| Concurrent | Hun zwakte | Onze sterkte |
|---|---|---|
| Coolblue Witgoedreparatie (€89/diagnose) | Duur, traag, geen DIY | €4.99/maand, onbeperkt, instant |
| Witgoed.repair (booking only) | Geen AI, hoge marge | AI eerst, monteur optioneel |
| PartsNL / FixPart (parts only) | Klant moet zelf weten wat | Wij verbinden diagnose → onderdeel |
| iFixit FixBot (US) | Engels, geen NL onderdelen | NL-first, NL voorraad |
| Zoofy / Twistoo (lead-gen) | Pure marktplaats | End-to-end product |

---

## Het pitch slot

> "Coolblue vraagt €89 voor één diagnose. Wij doen het onbeperkt voor €4,99 per maand. PartsNL verkoopt onderdelen zonder diagnose — wij verkopen een **oplossing**. iFixit heeft AI maar in het Engels en zonder NL onderdelen — wij hebben beide.
>
> Met €150K bouwen we de Coolblue-killer. Wanneer kunt u tekenen?"

---

## Quick demo URL's

| URL | Wat |
|---|---|
| / | Homepage met 3D model + animated stats + testimonials |
| /diagnose | AI chat + **foto upload tab** |
| /tools/repareren-of-vervangen | **Calculator** (uniek in NL) |
| /onderdelen/WF-PUMP-01 | 3D part viewer |
| /admin | Revenue + error frequency charts |
| /sitemap.xml | 60+ SEO pagina's geïndexeerd |
| /foutcodes/Bosch-E18 | SEO-optimized error page met JSON-LD |

---

*Gegenereerd 2026-04-28 — WasFix Pro is gereed voor pitch.*
