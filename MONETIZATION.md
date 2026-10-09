# MONETIZATION.md — hoe WasFix Pro geld verdient

Analyse op de catalogus en de code zoals die nu draait (bijgewerkt 8 oktober 2026).
Verkoopprijzen en plannen komen uit `src/data/parts.json` en `src/lib/plans.ts`.

> **Lees de marges in dit document als een gevoeligheidsanalyse, niet als een prognose.** Alle 96
> inkoopprijzen in de database zijn **schattingen**: `scripts/add-part-costs.mjs` rekent ze uit de verkoopprijs
> terug (ongeveer 28% onder de prijs excl. btw voor merk-originele onderdelen, 45% voor universele, plus of min 5%).
> Dat is een functie van wat wij vragen, geen offerte van een leverancier. Ook het vervoerderstarief is een aanname
> (in de admin € 6,50; eerdere versies van dit document gebruikten € 5,20). De winkel markeert elk onderdeel met
> `costSource` `ESTIMATE` of `QUOTE`; de marge in `/admin/economie` telt alleen `QUOTE`. Tot jij offertes hebt
> ingevoerd is elk getal hieronder een indicatie van hoe gevoelig de zaak is, en niet van wat je gaat verdienen.
> De contributietabel per onderdeel in `/admin/economie` is de plek waar de echte cijfers komen.

---

## 1. De vier geldstromen

| Stroom | Status vóór deze wijziging | Status nu |
|---|---|---|
| Onderdelenverkoop | Werkte, maar zonder btw-administratie, zonder factuur en zonder kostprijs | Compleet: btw-specificatie, doorlopende facturen, marge per order |
| Abonnementen | Onverkoopbaar: de gratis versie was onbeperkt, en het betaalde plan was gratis te krijgen | Afdwingbaar sinds 3 sep: gratis = 3 diagnoses per maand, premium gidsen achter de paywall, en een upgrade zonder Stripe faalt dicht (zie §5) |
| B2B API | Werkte (keys, rate limits per plan) | Ongewijzigd |
| Referrals | Attributie werkte | Ongewijzigd |

## 2. Unit-economics van de onderdelenverkoop (gevoeligheid, op geschatte kostprijzen)

Gemeten met `skuContribution()` uit de admin op de 96 onderdelen in de database: één stuk per bestelling,
verzending zoals in `src/lib/plans.ts` (gratis vanaf € 50), € 0,29 betaalkosten (iDEAL-aanname, geen
percentage voor kaarten), 21% btw eruit, **zonder** retouren, verpakking of kaartpercentage. Dit zijn de uitkomsten
op de geschatte kostprijzen, reproduceerbaar via `/admin/economie`:

| Scenario | Gemiddelde bijdrage per bestelling | Onderdelen met verlies |
|---|---|---|
| Geen korting, vervoerder € 5,20 | € 11,00 | 0 van 96 |
| Geen korting, vervoerder € 6,50 | € 9,70 | 1 van 96 |
| Bedrijf (15% korting), vervoerder € 6,50 | € 3,98 | 13 van 96 |
| Bedrijf, echte kostprijzen 15% hoger dan geschat | € 0,04 | 53 van 96 |
| Geen korting, echte kostprijzen 30% hoger dan geschat | € 1,81 | 34 van 96 |

Wat daaruit volgt, ook als de exacte getallen anders uitvallen:

- De marge zit in een paar tientjes per bestelling en is **zeer gevoelig** voor twee getallen die nog niemand heeft
  opgevraagd: de inkoopprijs per onderdeel en het vervoerderstarief. Een kostprijs die 15% hoger uitvalt dan de
  schatting maakt de korting van het Bedrijf-plan verliesgevend.
- Een kleine bestelling levert ongeveer evenveel op als een grote: de gratis verzending vanaf € 50 eet het verschil op.
- Een verkeerd onderdeel (verkeerde pasvorm) kost twee verzendingen. Dat zit niet in bovenstaande cijfers en drukt
  de bijdrage per bestelling verder.
- De eerdere versie van dit document noemde "32,8% blended brutomarge" en "€ 10,50 per order". Die cijfers
  kwamen uit dezelfde geschatte kostprijzen en uit een vervoerderstarief van € 5,20; ze zijn hier vervangen door
  bovenstaande tabel en moeten niet meer als feit worden aangehaald.

**Vaste lasten.** Een ruwe schatting van de reviewers, niet bij de leveranciers nagerekend: ongeveer
€ 70 tot € 120 per maand aan tools (hosting, database, mail, inlog, Redis, AI, domein), plus boekhouder en verzekering.
Bij een bijdrage van ongeveer € 10 per bestelling zijn dat tien orders per maand om break-even te draaien, vóór retouren,
en minder dan dat zolang de kostprijzen schattingen zijn.

## 3. Het structurele probleem met de kortingstiers

De abonnementen geven korting op onderdelen, en die korting komt rechtstreeks uit de marge. De korting geldt pas vanaf
de eerste betaling, niet tijdens de proefperiode (D13). Break-even per plan, het punt waarop de korting op onderdelen
het abonnementsgeld opeet (prijs gedeeld door kortingspercentage, incl. btw):

| Plan | Prijs | Korting | Break-even bij |
|---|---|---|---|
| Particulier | € 4,99 | 5% | € 121 onderdelen per maand |
| Monteur Pro | € 29 | 10% | € 351 onderdelen per maand |
| Bedrijf | € 199 | 15% | € 1.605 onderdelen per maand |

Deze break-even rekent alleen met de korting, niet met de marge, en klopt dus ongeacht de kostprijzen. Wat de korting
**kost** hangt wel van de marge af. Met de geschatte kostprijzen en een vervoerderstarief van € 6,50 daalt de gemiddelde
bijdrage per bestelling van € 9,70 naar € 3,98 (de tabel hierboven): de 15% korting van Bedrijf kost gemiddeld ongeveer
€ 5,70 per bestelling. Het abonnement van € 199 (excl. btw) dekt dat tot ongeveer 35 gemiddelde bestellingen per maand
(199 gedeeld door 5,70); een klant die vaker bestelt kost meer aan gederfde bijdrage dan hij aan abonnement betaalt, tenzij
het extra volume dat compenseert. Dit is een rekenvoorbeeld op schattingen, geen meting.

Dat is geen reden om de korting te schrappen. Het is wel de reden waarom het abonnement extra volume moet aantrekken:
een monteur die door het CRM en de API van € 200 naar € 700 per maand gaat, is wél winstgevender. Het abonnement is
een volume-instrument, geen winstbron.

**Aanbeveling:** meet per abonnee de onderdelenomzet en stel pas een kortingsniveau vast als de kostprijzen offertes
zijn. De admin toont netto omzet, af te dragen btw per kwartaal, inkoopwaarde en marge, de laatste alleen over onderdelen
met een offerte-kostprijs.

## 4. Waarom de consumenten-abonnee het moeilijkste product is

Een wasmachine gaat een keer per drie tot vijf jaar stuk. Een abonnement van
€4,99 per maand voor een behoefte die eens per vier jaar opkomt, verkoopt zich
niet vanzelf en houdt niemand vast. Realistisch is dat een particulier één of
twee maanden betaalt rond een reparatie en dan opzegt: een levenslange waarde
van vijf tot tien euro.

De reparatie zelf is de transactie die telt. Eén verkocht onderdeel (grofweg € 10
bijdrage op de huidige schattingen) is meer waard dan twee maanden Particulier. De AI-diagnose is
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

**Het betaalde abonnement was gratis mee te nemen.** `/api/stripe/subscribe` viel
zonder Stripe-key terug op een directe upgrade, "demo mode". Stripe-keys staan er
niet (BLOCKED.md), dus op de live site kon elke ingelogde bezoeker
`{"plan":"BEDRIJF"}` posten en zichzelf permanent onbeperkte diagnoses, alle
premium gidsen, het monteur-dashboard en 15% korting op elke onderdelenbestelling
geven. Alles in dit document over quota, paywalls en break-even ging daarlangs.
De route faalt nu dicht in productie (503, gelogd) en upgradet alleen nog direct
buiten productie, waar demo-modus een expliciete keuze is.

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
iets aan verdiend werd. Elk onderdeel heeft nu een inkoopprijs met een bron (`ESTIMATE` of
`QUOTE`) en elke bestelling legt de inkoopwaarde vast. Zolang die inkoopprijs een schatting is, heet
de marge in de admin "schatting" en telt ze niet mee in het bevestigde cijfer.

**De prijzen spraken elkaar tegen.** Bedrijf stond op €199 op de prijspagina en
op €99 in de documentatie; Monteur Pro stond op de homepage als "ex BTW" naast
tiers die dat niet waren; en Bedrijf was niet te koop — de knop ging naar het
contactformulier. Alles komt nu uit `src/lib/plans.ts` en alle drie de betaalde
plannen zijn direct af te sluiten.

**De proefperiode bestond niet.** Homepage, prijspagina en voorwaarden beloven
veertien dagen gratis, maar het Stripe-abonnement werd zonder proefperiode
aangemaakt: de klant werd direct afgeschreven. `trial_period_days` staat nu in
de plan-configuratie en gaat mee naar Stripe.

## 6. De monteur kan nu factureren

Het sterkste argument voor Monteur Pro was tot nu toe de korting, en die kost
ons meer dan hij oplevert (§3). Facturatie verandert dat: een zelfstandige
monteur moet toch een factuur sturen, en doet dat vaak in Word of een los
pakket van tien euro per maand. Vanaf nu wordt elke werkorder met een bedrag
één klik een factuur met btw-specificatie, in zijn eigen doorlopende
nummerreeks — een eis van de Belastingdienst die losse Word-documenten
zelden halen.

Dat is functionaliteit waarvoor iemand blijft betalen, ook in een maand dat
hij weinig onderdelen koopt. Precies wat §3 mist: een reden om te blijven die
niet uit de marge komt.

**Maar het is nog geen facturatiepakket, en dat moet je niet zo verkopen.** Wat
er staat is: één factuur per werkorder, op te halen op
`/monteur/werkorders/[id]/factuur`, printen of opslaan als pdf. Wat er *niet* is:

- **versturen** — er gaat geen mail naar de klant; de monteur moet de pdf zelf
  doorsturen;
- **een overzicht** — er is geen factuurlijst en geen omzetstaat; `MonteurInvoice`
  is alleen per werkorder op te vragen;
- **betaald markeren** — het model heeft geen status- of `paidAt`-veld, dus
  openstaand versus betaald bestaat niet en debiteurenbewaking evenmin;
- **crediteren** — een fout op een verstuurde factuur is niet terug te draaien
  binnen de doorlopende nummerreeks.

Een monteur die hierop overstapt houdt zijn debiteuren dus nog steeds ergens
anders bij. Die drie (versturen, lijst, betaald markeren) zijn samen het verschil
tussen "handig" en "ik zeg mijn factuurpakket op" — en dus tussen wel en geen
opzeggingsreden.

## 7. Wat de eigenaar nog moet doen

Deze punten kan code niet oplossen. Het geordende draaiboek met tijdschattingen staat in `BLOCKED.md`.

1. **Echte inkoopprijzen en vervoerderstarief.** De kostprijzen zijn schattingen (zie het kader bovenaan). Vraag
   schriftelijke offertes voor de onderdelen die je het eerst verkoopt en het tarief per gewichtsklasse bij je
   vervoerder. Zet de kostprijs met bron `QUOTE` in `/admin/onderdelen` en kijk in `/admin/economie`.
   Kies een ondergrens per onderdeel en prijs opnieuw of schrap wat die niet haalt, vóórdat je verkeer koopt.
2. **KvK, btw-nummer en adres** (`COMPANY_*`). Een factuur met een verzonnen btw-nummer is geen geldige factuur.
3. **Btw-regime.** De winkel rekent altijd 21%. Valt je bedrijf onder de kleineondernemersregeling, dan klopt dat niet;
   vraag het je boekhouder, samen met factuur- of kasstelsel en de werkwijze voor creditnota's.
4. **Stripe-prijzen aanmaken** voor € 4,99, € 29 en € 199 met het juiste `tax_behavior` (zie `BLOCKED.md`, stap 8).
   `/api/stripe/subscribe` controleert bedrag, valuta, interval en belastinggedrag tegen `plans.ts` en weigert bij een
   afwijking. Zonder die id's is er in productie geen upgrade (503).
5. **Btw verlegd bij EU-klanten buiten Nederland.** We rekenen altijd 21%, ook aan een Belgische monteur met een geldig
   btw-nummer. Verleggen mag pas na VIES-validatie van het nummer; die validatie is niet gebouwd.
6. **Echte gebruikscijfers.** De site claimde 12.000 diagnoses, € 2,1M besparing en 847 ton vermeden CO2; geen daarvan
   werd gemeten en ze zijn verwijderd. Wil je zulke cijfers tonen, bouw dan eerst de meting.
7. **Vraag en conversie zijn nooit geschat.** Dit document rekent met een bijdrage per bestelling, maar niemand heeft
   zoekvolumes voor "merk + foutcode" opgezocht of een conversie aangenomen. De 329 foutcode-pagina's zijn gegenereerd uit
   een sjabloon, wat een risico op dunne inhoud geeft. Haal vóór je verkeer koopt het zoekvolume op en reken het door.
