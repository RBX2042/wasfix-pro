# MONETIZATION.md — hoe WasFix Pro geld verdient

Analyse op de echte catalogus en de code zoals die nu draait (2 september 2026).
Alle bedragen komen uit `src/data/parts.json` en `src/lib/plans.ts`; de
berekeningen zitten in `scripts/qa-money.ts` en zijn dus reproduceerbaar.

---

## 1. De vier geldstromen

| Stroom | Status vóór deze wijziging | Status nu |
|---|---|---|
| Onderdelenverkoop | Werkte, maar zonder btw-administratie, zonder factuur en zonder kostprijs | Compleet: btw-specificatie, doorlopende facturen, marge per order |
| Abonnementen | Onverkoopbaar: de gratis versie was onbeperkt | Afdwingbaar: gratis = 3 diagnoses per maand, premium gidsen achter de paywall |
| B2B API | Werkte (keys, rate limits per plan) | Ongewijzigd |
| Referrals | Attributie werkte | Ongewijzigd |

## 2. Unit-economics van de onderdelenverkoop

De catalogus draait op een **blended brutomarge van 32,8%** — 29,5% op
merk-originele onderdelen, 44,7% op universele. Dat is normaal voor de
onderdelenhandel: bij originele onderdelen pakt de fabrikant de marge.

Per bestelling, met €5,20 verzendkosten en €0,29 iDEAL-kosten als aanname:

| Scenario | Klant betaalt | Bijdrage aan de zaak |
|---|---|---|
| 1 mediaan onderdeel (€28,50) + verzending | € 34,45 | **€ 10,50** |
| Mandje van €55 (gratis verzending) | € 55,00 | **€ 9,43** |

Twee dingen vallen op. Een kleine bestelling levert ongeveer evenveel op als
een grote: de gratis verzending vanaf €50 eet het verschil op. En met ~€10 per
order is het aantal orders per maand de enige knop die er echt toe doet — bij
100 orders per maand is dat €1.000 brutomarge, waar nog hosting, support en
retouren vanaf gaan.

De €50-drempel is dus scherp gekozen maar niet gratis: hij verhoogt het mandje
en verlaagt tegelijk de marge per euro. Dat is een bewuste afweging, geen bug.

## 3. Het structurele probleem met de kortingstiers

De abonnementen geven korting op onderdelen. Die korting komt rechtstreeks uit
de brutomarge. Break-even per plan — het punt waarop de korting het
abonnementsgeld opeet:

| Plan | Prijs | Korting | Break-even bij |
|---|---|---|---|
| Particulier | € 4,99 | 5% | € 121 onderdelen per maand |
| Monteur Pro | € 29 | 10% | € 351 onderdelen per maand |
| Bedrijf | € 199 | 15% | € 1.605 onderdelen per maand |

Concreet: een monteur die €500 per maand aan onderdelen koopt levert **zonder**
abonnement €136 brutomarge op, en **met** Monteur Pro €123 — inclusief de €29
abonnementsgeld. De korting kost meer dan het abonnement opbrengt.

Dat is geen reden om de korting te schrappen. Het is wel de reden waarom het
abonnement extra volume moet aantrekken: een monteur die door het CRM en de
API van €200 naar €700 per maand gaat, is wél winstgevender. Het abonnement is
een volume-instrument, geen winstbron. Wie dat omdraait in de begroting komt
bedrogen uit.

**Aanbeveling:** meet per abonnee de onderdelenomzet. Blijft die onder de
break-even, dan betaalt het abonnement zichzelf terug; komt die er ruim boven
zonder dat het volume groeit, dan is de kortingstrap te steil. De admin toont
nu netto omzet, af te dragen btw, inkoopwaarde en brutomarge, dus dit is te
volgen zodra er orders zijn.

## 4. Waarom de consumenten-abonnee het moeilijkste product is

Een wasmachine gaat een keer per drie tot vijf jaar stuk. Een abonnement van
€4,99 per maand voor een behoefte die eens per vier jaar opkomt, verkoopt zich
niet vanzelf en houdt niemand vast. Realistisch is dat een particulier één of
twee maanden betaalt rond een reparatie en dan opzegt: een levenslange waarde
van vijf tot tien euro.

De reparatie zelf is de transactie die telt. Eén verkocht onderdeel (€10,50
bijdrage) is meer waard dan twee maanden Particulier. De AI-diagnose is
daarmee vooral een **acquisitiekanaal voor de onderdelenverkoop**, niet een
product op zichzelf.

Dat pleit voor de inrichting zoals die er nu staat: drie gratis diagnoses per
maand zijn ruim genoeg om iemand door één reparatie te helpen en het onderdeel
te verkopen, terwijl wie er structureel meer nodig heeft — de klusser, de
monteur — vanzelf tegen de grens loopt.

Waar het echte terugkerende geld zit is de monteur: die heeft de behoefte
wekelijks, gebruikt het CRM en de API, en koopt onderdelen met volume.

## 5. Wat er ontbrak en nu werkt

**De gratis versie was onbeperkt.** De quotacheck stond in `if (user)`, dus wie
niet was ingelogd kreeg ongelimiteerd AI-diagnoses. Er was geen enkele reden om
een account te maken, laat staan te betalen — het abonnement verkocht iets dat
het product weggaf. Gebruik wordt nu gemeten per account, en anders per
bezoeker-cookie met een IP-hash als terugval.

**Premium gidsen waren niet afgeschermd.** `isPremium` toonde alleen een
badge; de volledige tekst was gratis, terwijl "alle premium gidsen" het
Particulier-plan verkoopt. Nu zijn de eerste twee stappen zichtbaar — genoeg om
de gids te beoordelen en genoeg echte inhoud voor Google — en zit de rest
achter de upgrade.

**Er was geen btw-administratie en geen factuur.** De voorwaarden zeggen dat
prijzen inclusief 21% btw zijn, maar geen enkele bestelling legde dat vast en
een factuur bestond niet. Dat is in Nederland verplicht, inclusief zeven jaar
bewaarplicht. Bestellingen slaan nu btw-tarief en btw-bedrag op, en elke
betaalde bestelling krijgt een doorlopend genummerde factuur met
btw-specificatie op `/bestelling/[id]/factuur`. De prijs die de klant betaalt
verandert niet: de btw zat er altijd al in, hij werd alleen niet gesplitst.

**Er was geen kostprijs.** De admin toonde "omzet" en niemand kon zien of daar
iets aan verdiend werd. Elk onderdeel heeft nu een inkoopprijs en elke
bestelling legt de inkoopwaarde vast, zodat netto omzet, af te dragen btw en
brutomarge apart zichtbaar zijn.

**De prijzen spraken elkaar tegen.** Bedrijf stond op €199 op de prijspagina en
op €99 in de documentatie; Monteur Pro stond op de homepage als "ex BTW" naast
tiers die dat niet waren; en Bedrijf was niet te koop — de knop ging naar het
contactformulier. Alles komt nu uit `src/lib/plans.ts` en alle drie de betaalde
plannen zijn direct af te sluiten.

**De proefperiode bestond niet.** Homepage, prijspagina en voorwaarden beloven
veertien dagen gratis, maar het Stripe-abonnement werd zonder proefperiode
aangemaakt: de klant werd direct afgeschreven. `trial_period_days` staat nu in
de plan-configuratie en gaat mee naar Stripe.

## 6. Wat de eigenaar nog moet doen

Deze punten kan code niet oplossen.

1. **Echte inkoopprijzen.** De huidige kostprijzen zijn schattingen
   (`scripts/add-part-costs.mjs`) zodat de margerapportage iets te tonen heeft.
   Vervang ze door de werkelijke leveranciersprijzen via `/admin/onderdelen` —
   zolang dat niet gebeurt is de marge een indicatie, geen boekhouding.
2. **KvK, btw-nummer en adres.** Staan nog op placeholders en komen zo op de
   factuur terecht. Een factuur met een verzonnen btw-nummer is geen geldige
   factuur. Vul `COMPANY_KVK`, `COMPANY_VAT`, `COMPANY_NAME`, `COMPANY_STREET`,
   `COMPANY_POSTAL_CODE`, `COMPANY_CITY` en `COMPANY_IBAN`.
3. **Stripe-prijzen aanmaken** voor €4,99, €29 en €199 en de drie price-id's
   instellen. Zonder die id's valt elke upgrade terug op de demo-modus.
4. **Btw verlegd bij EU-klanten buiten Nederland.** Op dit moment rekenen we
   altijd 21%, ook aan een Belgische monteur met een geldig btw-nummer. Dat is
   fiscaal veilig maar commercieel onaantrekkelijk. Verleggen mag pas na
   VIES-validatie van het nummer; het btw-nummer wordt nu al vastgelegd en op
   de factuur getoond, de validatie zelf is nog niet gebouwd.
5. **Verzendtarief controleren.** De €5,95 en de gratis-verzendgrens van €50
   zijn aannames. Leg ze naast het werkelijke PostNL-tarief per gewichtsklasse;
   een trommellager weegt aanzienlijk meer dan een pluizenfilter.
