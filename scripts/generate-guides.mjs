#!/usr/bin/env node
// Generate 20 missing repair guides for src/data/guides.json
// Each guide: 6-10 detailed NL steps, tools list, safety warnings.

import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";

const EXISTING = JSON.parse(readFileSync("src/data/guides.json", "utf8"));
const PARTS = JSON.parse(readFileSync("src/data/parts.json", "utf8"));
const GUIDE_PARTS = JSON.parse(readFileSync("src/data/guide-parts.json", "utf8"));

function makeId(seed) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `wfgde_${h.slice(0, 20)}`;
}

function partId(sku) {
  return PARTS.find((p) => p.sku === sku)?.id ?? null;
}

const NOW = new Date().toISOString();

// ─── 20 new guides ──────────────────────────────────────────────────
const NEW = [
  {
    slug: "koolborstels-motor-vervangen",
    title: "Koolborstels motor vervangen",
    summary: "Bij een Bosch E21 of Whirlpool F53: vervang de koolborstels van je wasmachinemotor in 45 minuten. Bespaart €120 versus een monteur.",
    difficulty: "MEDIUM",
    timeMinutes: 45,
    isPremium: false,
    parts: ["WF-MOTOR-17"],
    warnings: "Werk alleen aan een ontkoppelde machine. Wacht 5 minuten na ontkoppelen voor restspanning op condensatoren is weggevloeid.",
    tools: ["Torx T20 schroevendraaier", "Platte schroevendraaier", "Werklamp", "Multimeter (optioneel)"],
    steps: [
      { stepNum: 1, title: "Veiligheid", description: "Stekker uit, watertoevoer dicht. Wacht 5 min." },
      { stepNum: 2, title: "Achterpaneel verwijderen", description: "Draai de 6-8 schroeven aan de achterkant los. Het paneel komt naar achteren toe los." },
      { stepNum: 3, title: "V-snaar verwijderen", description: "Til de V-snaar van de poelie af. Tip: draai de trommel terwijl je trekt — dan loopt de riem er vanzelf af.", warning: "Bewaar de riem — als deze niet versleten is kun je hem terugplaatsen." },
      { stepNum: 4, title: "Motor lokaliseren", description: "De motor zit onder of achter de trommel, herkenbaar aan de poelie en koolborstels (zwarte rechthoekige houders aan de zijkant)." },
      { stepNum: 5, title: "Oude koolborstels uit", description: "Maak de elektrische connector los van elke koolborstel. Druk de plastic klem in en trek de borstel met houder eruit. Doe ze één voor één voor referentie." },
      { stepNum: 6, title: "Lengte controleren", description: "Een nieuwe koolborstel is ~25mm. Versleten = korter dan 10mm. Te scheef versleten? Ook vervangen." },
      { stepNum: 7, title: "Nieuwe borstels plaatsen", description: "Schuif de nieuwe koolborstels in de houders tot ze klikken. Sluit de connectoren weer aan. Beide tegelijk vervangen, ook als één nog goed is." },
      { stepNum: 8, title: "Testdraai", description: "Plaats de V-snaar terug, sluit het paneel, en draai een test-programma. Een korte 'inrij'-fase met geluid is normaal de eerste 5 minuten." },
    ],
  },
  {
    slug: "drukschakelaar-testen-vervangen",
    title: "Drukschakelaar testen en vervangen",
    summary: "Foutcodes E04, F05, of water blijft staan? Test de drukschakelaar (pressostat) in 20 minuten en vervang indien defect.",
    difficulty: "MEDIUM",
    timeMinutes: 40,
    isPremium: false,
    parts: [],
    warnings: "Werk met een multimeter — verkeerde aansluitingen kunnen de hoofdmodule beschadigen.",
    tools: ["Multimeter", "Tang", "Schroevendraaier"],
    steps: [
      { stepNum: 1, title: "Stekker eruit + bovendeksel open", description: "Schroef de bovenkap aan de achterkant los en schuif naar achteren. De drukschakelaar is een rond kunststof onderdeel rechts of links boven." },
      { stepNum: 2, title: "Slangetje van schakelaar halen", description: "Trek het transparante slangetje los. Inspecteer op verstopping (blaas erin — moet vrij doorlopen). Verstopt? Spoel met warm water — meestal lost dit het probleem op." },
      { stepNum: 3, title: "Slangetje terugplaatsen", description: "Als slang vrij is, terugplaatsen en test eerst voor je verder gaat — vaak hoeft de schakelaar niet vervangen." },
      { stepNum: 4, title: "Multimeter-test", description: "Trek de elektrische connector eruit. Tussen pin 11-12 moet je 0-Ohm hebben in rust, oneindig bij druk. Blaas in het slangetje — meting moet wisselen." },
      { stepNum: 5, title: "Schakelaar verwijderen", description: "Een schroef of klikbevestiging — open en haal eraf." },
      { stepNum: 6, title: "Nieuwe plaatsen", description: "Identieke vervanger plaatsen, slangetje terug, connector terug, bovenkap dicht. Test met een korte spoeling." },
    ],
  },
  {
    slug: "module-elektronica-testen",
    title: "Besturingsprint (PCB) testen en vervangen",
    summary: "Bij intermitterende fouten of geen reactie van de wasmachine: hoe controleer je de hoofdmodule. Inclusief reset-procedure die vaak werkt.",
    difficulty: "HARD",
    timeMinutes: 90,
    isPremium: true,
    parts: ["WF-BOARD-09", "WF-BOARD-11", "WF-BOARD-12"],
    warnings: "Op de hoofdmodule staan condensatoren met netspanning. Werk ALTIJD met de stekker eruit én wacht minimaal 10 minuten. Niet aanraken aan componentenkant.",
    tools: ["Schroevendraaier (Torx + plat)", "Multimeter", "Anti-statische polsband (aanbevolen)", "Foto-app voor bedrading"],
    steps: [
      { stepNum: 1, title: "Eerst: reset proberen", description: "Stekker 30 minuten eruit. Soms volstaat dit om een tijdelijke softwarefout te wissen." },
      { stepNum: 2, title: "Service-mode (Bosch/Siemens)", description: "Programmaknop op 0 + 2 knoppen tegelijk indrukken (varieert per model). Check je handleiding voor exacte reset-combo." },
      { stepNum: 3, title: "Module lokaliseren", description: "Meestal achter het bedieningspaneel (bovenin) of links/rechts in de behuizing. Verwijder eerst zijpanelen of bovendeksel.", warning: "Stekker MOET eruit zijn voordat je dit doet." },
      { stepNum: 4, title: "Visuele inspectie", description: "Kijk naar opgezwollen condensatoren (boven plat = goed, bol = defect), zwarte verbrande plekken, gescheurde solder-verbindingen.", warning: "Geen onderdelen aanraken — alleen kijken." },
      { stepNum: 5, title: "Bedrading fotograferen", description: "Maak van elke connector een duidelijke foto VOORDAT je iets loskoppelt. Dit is je redmiddel bij terugbouw." },
      { stepNum: 6, title: "Connectoren los", description: "Maak elke connector los — vaak met klik-mechanisme. Trek aan de plug, niet aan de draden." },
      { stepNum: 7, title: "Module losschroeven", description: "2-4 schroeven of clips. Module komt vrij." },
      { stepNum: 8, title: "Nieuwe module: NIET aanraken op componentenkant", description: "Vasthouden aan randen. ESD-gevoelig." },
      { stepNum: 9, title: "Montage in omgekeerde volgorde", description: "Connectors klikken vast. Dubbelcheck met foto's." },
      { stepNum: 10, title: "Service-config (sommige merken)", description: "Bij Miele en AEG moet een nieuwe module via service-tool worden geprogrammeerd met het juiste model. Vraag bij twijfel een monteur." },
    ],
  },
  {
    slug: "schokdempers-vervangen",
    title: "Schokdempers vervangen",
    summary: "Wasmachine trilt of loopt door tijdens centrifugeren? Versleten schokdempers. Vervang in paar of in vier. €40-€60 + 60 minuten.",
    difficulty: "MEDIUM",
    timeMinutes: 60,
    isPremium: false,
    parts: ["WF-DAMP-16", "WF-DAMP-17", "WF-DAMP-18", "WF-DAMP-19", "WF-DAMP-20"],
    warnings: "Een wasmachine weegt 60-80kg. Werk met 2 personen of gebruik een autokrik. Niet alleen kantelen!",
    tools: ["Doppensleutel set (10-17mm)", "Autokrik of helper", "Werklamp"],
    steps: [
      { stepNum: 1, title: "Voorbereiding", description: "Stekker eruit, watertoevoer dicht, wasmachine leeg en droog. Verwijder zeeplade (verminder gewicht)." },
      { stepNum: 2, title: "Achterkap of voorkap af", description: "Afhankelijk van merk en model. Bij de meeste merken: leg de wasmachine voorzichtig op de achterkant op een handdoek." },
      { stepNum: 3, title: "Oude dempers lokaliseren", description: "Twee of vier cilindrische dempers tussen onderkant trommel en framelichaam. Beide uiteinden zijn met een bout vastgezet (10-13mm meestal)." },
      { stepNum: 4, title: "Bout boven en onder los", description: "Onthoud welke bout van bovenop kwam — vaak iets langer dan onderaan." },
      { stepNum: 5, title: "Demper eruit", description: "Trek de oude demper eruit. Knijp hem in met je hand — een gezonde demper geeft weerstand, een versleten gaat snel in." },
      { stepNum: 6, title: "Nieuwe demper plaatsen", description: "In omgekeerde volgorde. Bout matig stevig (niet over-aantrekken — 8-10Nm)." },
      { stepNum: 7, title: "Vervang ALTIJD beide dempers", description: "Ook als 1 nog goed lijkt. Anders wordt de andere binnen 3 maanden ook stuk en heb je dubbel werk." },
      { stepNum: 8, title: "Test", description: "Wasmachine rechtop, waterpas zetten met stelvoeten (zie aparte gids). Korte was met paar handdoeken testen op trilling." },
    ],
  },
  {
    slug: "v-snaar-vervangen",
    title: "V-snaar vervangen",
    summary: "Trommel draait niet maar motor brommen wel? Riem is gebroken of slipt. €13 + 20 minuten werk.",
    difficulty: "EASY",
    timeMinutes: 25,
    isPremium: false,
    parts: ["WF-BELT-06", "WF-BELT-07", "WF-BELT-08", "WF-BELT-09"],
    warnings: "",
    tools: ["Schroevendraaier (Torx T20 of Phillips)"],
    steps: [
      { stepNum: 1, title: "Stekker eruit", description: "Standaard voorbereiding." },
      { stepNum: 2, title: "Achterpaneel verwijderen", description: "6-8 schroeven aan de achterkant. Het paneel komt naar achteren toe los." },
      { stepNum: 3, title: "Riem inspecteren", description: "Een verbroken riem ligt los in de behuizing. Een versleten riem is glad/glanzend of heeft kerfjes aan de geribbelde kant." },
      { stepNum: 4, title: "Riem-maatcheck", description: "Op de oude riem staat een code (bv. 1196 J5). Bij gebroken riem: meet machine-fabrikant + model en zoek juiste maat op." },
      { stepNum: 5, title: "Nieuwe riem plaatsen", description: "Leg de riem eerst over de kleine motorpoelie. Trek hem dan over de grote trommelpoelie terwijl je de trommel langzaam draait. Hij valt vanzelf op zijn plek." },
      { stepNum: 6, title: "Spanning controleren", description: "Druk in het midden — de riem mag maximaal 1cm meegeven. Te slap? Riem is verkeerde maat. Te strak? Idem." },
      { stepNum: 7, title: "Paneel terug + test", description: "Korte centrifuge-test. Geen piepgeluid? Riem zit goed." },
    ],
  },
  {
    slug: "deurslot-vervangen",
    title: "Deurslot vervangen",
    summary: "Foutcode dE / E40 / F16: deur sluit niet of blokkeert. Vervang het deurslot in 30 minuten.",
    difficulty: "MEDIUM",
    timeMinutes: 30,
    isPremium: false,
    parts: ["WF-LOCK-09", "WF-LOCK-10", "WF-LOCK-11", "WF-LOCK-12", "WF-LOCK-13", "WF-LOCK-14"],
    warnings: "",
    tools: ["Torx T20 schroevendraaier", "Platte schroevendraaier", "Tang"],
    steps: [
      { stepNum: 1, title: "Stekker eruit + machine leegmaken", description: "Standaard. Verwijder eventueel water uit pluizenfilter." },
      { stepNum: 2, title: "Manchet-clip verwijderen", description: "De voorste rubberen manchet zit met een metalen veer of klem vast. Wip die los met platte schroevendraaier." },
      { stepNum: 3, title: "Manchet naar binnen schuiven", description: "Geef wat speling om bij de slot-bevestiging te kunnen." },
      { stepNum: 4, title: "Slot-schroeven los", description: "Meestal 2 Torx-schroeven aan de zijkant van de deuropening (Bosch/Siemens), of 2 schroeven in de slot-behuizing (Samsung/LG)." },
      { stepNum: 5, title: "Connectoren los", description: "Eén of twee elektrische connectoren — fotografeer eerst. Druk klem in en trek af." },
      { stepNum: 6, title: "Nieuw slot installeren", description: "Connector vast, schroeven vast (niet overdrijven). Manchet weer over de slot-rand schuiven." },
      { stepNum: 7, title: "Manchet-clip terugplaatsen", description: "De metalen veer over de rand schuiven. Trek hard tot hij klikt — anders gaat hij weer los onder druk van waswater." },
      { stepNum: 8, title: "Test", description: "Korte spoeling met paar handdoeken. Geen lekkage? Geen foutcode? Klaar." },
    ],
  },
  {
    slug: "ntc-temperatuursensor-vervangen",
    title: "NTC temperatuursensor vervangen",
    summary: "Water blijft koud of te heet? NTC-sensor defect. €8 onderdeel, 30 min werk.",
    difficulty: "MEDIUM",
    timeMinutes: 30,
    isPremium: false,
    parts: ["WF-NTC-15", "WF-NTC-16", "WF-NTC-17", "WF-NTC-18"],
    warnings: "De NTC zit in het verwarmingselement — let op het vele restwater dat eruit kan komen.",
    tools: ["Schroevendraaier (Torx)", "Multimeter (optioneel)", "Emmer + handdoek"],
    steps: [
      { stepNum: 1, title: "Voorbereiding", description: "Stekker eruit, waterkraan dicht. Pluizenfilter openen en restwater aftappen." },
      { stepNum: 2, title: "Onderpaneel verwijderen", description: "Bij de meeste machines: het paneel met pluizenfilter wegschuiven of demonteren." },
      { stepNum: 3, title: "Verwarmingselement opzoeken", description: "Aan de onderkant van de trommel. Een staaf met 2-pin's connector + NTC eraan vast." },
      { stepNum: 4, title: "NTC eruit", description: "Maak de 2-pin's NTC-connector los. De sensor zelf zit meestal geklemd in een rubberen behuizing — trek voorzichtig los." },
      { stepNum: 5, title: "Test (optioneel)", description: "Multimeter op weerstand. 25°C → ~10K Ohm. Houd in lauw water — moet zakken naar 6-7K." },
      { stepNum: 6, title: "Nieuwe NTC", description: "Vervang. Druk goed in de rubberen behuizing tot hij klikt. Connector aansluiten." },
      { stepNum: 7, title: "Test programma", description: "Kort wasje 40°C — voel of de deur warm wordt." },
    ],
  },
  {
    slug: "magneetventiel-inlaat-vervangen",
    title: "Magneetventiel waterinlaat vervangen",
    summary: "Foutcode E12, IE of water komt niet binnen? Vervang het magneetventiel in 25 minuten.",
    difficulty: "EASY",
    timeMinutes: 25,
    isPremium: false,
    parts: ["WF-VALVE-08", "WF-VALVE-09", "WF-VALVE-10", "WF-VALVE-12"],
    warnings: "",
    tools: ["Tang", "Schroevendraaier", "Emmer"],
    steps: [
      { stepNum: 1, title: "Test eerst de waterkraan", description: "Is de kraan open? Soms is dit het hele probleem." },
      { stepNum: 2, title: "Slangfilter check", description: "Draai de aanvoerslang los van de wasmachine. Er zit een klein zeefje achter — vaak vol kalk/zand. Spoel schoon — vaak is dit voldoende." },
      { stepNum: 3, title: "Bovendeksel openen", description: "Stekker eruit. Schroef bovendeksel los en schuif weg." },
      { stepNum: 4, title: "Magneetventiel lokaliseren", description: "Rechtsachterboven, aangesloten op de aanvoerslang. Heeft 1-2-3 of 4 uitgangen afhankelijk van model." },
      { stepNum: 5, title: "Connector + slangen los", description: "Maak de elektrische connector los. Knijp de slangklemmen in en trek de slangen eraf. Restwater opvangen." },
      { stepNum: 6, title: "Ventiel losdraaien", description: "1-2 schroeven of een bracket-klem. Eruit nemen." },
      { stepNum: 7, title: "Nieuw ventiel plaatsen", description: "In omgekeerde volgorde. Connector klikt vast." },
      { stepNum: 8, title: "Testen", description: "Korte spoeling. Geen lek? Klaar." },
    ],
  },
  {
    slug: "aquastop-slang-testen-vervangen",
    title: "AquaStop slang testen en vervangen",
    summary: "Lekkagebescherming defect? Foutcode E07 of F23? Diagnose + vervanging in 20 minuten.",
    difficulty: "EASY",
    timeMinutes: 20,
    isPremium: false,
    parts: ["WF-VALVE-11", "WF-HOSE-04"],
    warnings: "",
    tools: ["Tang"],
    steps: [
      { stepNum: 1, title: "Wat is AquaStop?", description: "AquaStop is een slang met een magneetventiel aan het kraanuiteinde. Bij druk-detectie sluit de toevoer automatisch. Voorkomt waterschade bij slangbreuk." },
      { stepNum: 2, title: "Reset proberen", description: "Soms blijft de AquaStop in 'gesloten' stand staan. Sluit de kraan, ontkoppel de slang, wacht 1 minuut, opnieuw aansluiten." },
      { stepNum: 3, title: "Visuele inspectie", description: "Kijk naar de aansluiting op de wasmachine. Een rode indicator of een loszittende plastic kopie wijst op activatie." },
      { stepNum: 4, title: "Slangwissel", description: "Kraan dicht. Draai de aansluiting bij de kraan los (handvast — geen sleutel nodig). Idem aan de wasmachinekant." },
      { stepNum: 5, title: "Nieuwe AquaStop plaatsen", description: "Eerst losjes aandraaien aan beide zijden. Kraan open — check op lek. Strak aandraaien handmatig." },
      { stepNum: 6, title: "Test programma", description: "Spoelprogramma met de deur op een kier — observeer of er water binnenkomt." },
    ],
  },
  {
    slug: "wasmachine-waterpas-zetten",
    title: "Wasmachine waterpas zetten",
    summary: "Wasmachine schudt of loopt door tijdens centrifugeren? Begin met waterpas zetten — vaak het hele probleem.",
    difficulty: "EASY",
    timeMinutes: 15,
    isPremium: false,
    parts: ["WF-MISC-02"],
    warnings: "",
    tools: ["Waterpas", "Sleutel 17mm (vaak meegeleverd)"],
    steps: [
      { stepNum: 1, title: "Plaats de wasmachine op zijn definitieve plek", description: "Niet op een tegelige zijwand of trillingsgevoelige ondergrond — anders is waterpas zetten zinloos." },
      { stepNum: 2, title: "Waterpas op bovenkant leggen", description: "Eerst links-rechts, dan voor-achter." },
      { stepNum: 3, title: "Stelvoeten draaien", description: "Linksdraaien = poot uit = die kant omhoog. Rechtsdraaien = poot in. Vergrendelmoer eerst losdraaien (vaak 17mm)." },
      { stepNum: 4, title: "Een hoek moet wankel zijn", description: "Onjuist! Alle 4 de voeten moeten DE GROND raken. Wankel = de wasmachine kan kantelen onder centrifuge." },
      { stepNum: 5, title: "Test", description: "Duw op een hoek. Geeft niet? Idem voor de andere hoeken. Anti-vibratie-mat onder 4 voetjes overweegt." },
      { stepNum: 6, title: "Borgmoeren vastdraaien", description: "Anders trillen de voeten zich los." },
    ],
  },
  {
    slug: "wasmiddellade-reinigen",
    title: "Wasmiddellade reinigen (schimmel verwijderen)",
    summary: "Zwarte aanslag of vieze geur uit de wasmiddellade? Reinig hem in 15 minuten — voorkomt vuile was.",
    difficulty: "EASY",
    timeMinutes: 15,
    isPremium: false,
    parts: ["WF-MISC-04"],
    warnings: "",
    tools: ["Oude tandenborstel", "Witte azijn (1L)", "Microvezeldoek"],
    steps: [
      { stepNum: 1, title: "Lade volledig uittrekken", description: "Trek uit, druk meestal op een ontgrendelklem in het midden om de lade helemaal eruit te halen." },
      { stepNum: 2, title: "Onder warm water afspoelen", description: "Alle vakken. Verwijder grove wasmiddelresten." },
      { stepNum: 3, title: "Azijn-week", description: "Leg in warme azijn (1:1 met water) voor 30 min. Werkt tegen kalk én schimmel." },
      { stepNum: 4, title: "Schrobben met tandenborstel", description: "Vooral hoekjes en het sifongedeelte. Niet vergeten: het 'plafond' van het ladevak in de machine — daar zit ook vaak aanslag." },
      { stepNum: 5, title: "Sifongedeelte uitnemen", description: "De plastic sifon in het wasmiddelvak komt los — vaak vol slijm. Spoel apart." },
      { stepNum: 6, title: "Droog terugplaatsen", description: "Doek erlangs voor het terugzetten." },
      { stepNum: 7, title: "Onderhoudswas", description: "Een lege 90°C-wasbeurt met een reinigingstablet doodt verdere schimmel." },
    ],
  },
  {
    slug: "bedieningspaneel-display-diagnose",
    title: "Bedieningspaneel / display reageert niet — diagnose",
    summary: "Knoppen werken niet, display dood, of onleesbaar? Diagnose-volgorde voor je iets duurs gaat vervangen.",
    difficulty: "MEDIUM",
    timeMinutes: 30,
    isPremium: false,
    parts: ["WF-BOARD-10", "WF-PANEL-01", "WF-PANEL-02", "WF-PANEL-03"],
    warnings: "Werk altijd met stekker eruit.",
    tools: ["Schroevendraaier", "Doek"],
    steps: [
      { stepNum: 1, title: "Test 1: Reset", description: "Stekker 30 min eruit. Soms heeft de module een hardstop nodig." },
      { stepNum: 2, title: "Test 2: Andere stopcontact", description: "Probeer een ander stopcontact. Lokale spanning kan instabiel zijn." },
      { stepNum: 3, title: "Test 3: Knoppen apart", description: "Werken sommige knoppen wel, andere niet? Dan is het foliepaneel kapot, niet de hele module." },
      { stepNum: 4, title: "Schoonmaken", description: "Trek de programmaknoppen eraf, maak schoon met droge borstel — soms zit pluis vast." },
      { stepNum: 5, title: "Lintkabel check", description: "Open het paneel. Een platte lintkabel tussen display en hoofdmodule kan loszitten. Even uittrekken en weer terug." },
      { stepNum: 6, title: "Display alleen vervangen", description: "Lukt het niet? Vaak is enkel het display kapot, niet de complete hoofdmodule. Goedkoper te vervangen." },
      { stepNum: 7, title: "Module vervangen als laatste", description: "Pas als alles uit te sluiten is. Module is duur — bij twijfel: monteur." },
    ],
  },
  {
    slug: "geur-uit-wasmachine-verwijderen",
    title: "Geur uit wasmachine verwijderen",
    summary: "Stinkt de was uit een schone wasmachine? Onderhoudswas + filter + lade reinigen. 90 minuten totaal, geuren weg.",
    difficulty: "EASY",
    timeMinutes: 90,
    isPremium: false,
    parts: ["WF-MISC-04"],
    warnings: "",
    tools: ["Witte azijn (1L)", "Soda", "Microvezeldoek"],
    steps: [
      { stepNum: 1, title: "Oorzaken stinken", description: "Bacteriën + schimmel in: pakking, lade, filter, slang. Door koud wassen ophopen. Veel wasmiddel verergert het." },
      { stepNum: 2, title: "Stap 1: Pluizenfilter leegmaken", description: "Zie aparte gids. Pluis + muntjes = bacteriebron. Reinig met azijn." },
      { stepNum: 3, title: "Stap 2: Wasmiddellade reinigen", description: "Zie aparte gids. Schimmel weghalen." },
      { stepNum: 4, title: "Stap 3: Deurpakking schoonmaken", description: "Trek de plooien open. Met azijn-doekje schoonvegen. Vergeet de onderkant niet — daar verzamelt water." },
      { stepNum: 5, title: "Stap 4: Hete onderhoudswas", description: "90°C-koken-programma. Leeg. Met 1 reinigingstablet of 500ml azijn in het wastrommel + 200gr soda in het wasmiddelvakje." },
      { stepNum: 6, title: "Stap 5: Deur open laten staan", description: "Na elke was de deur en wasmiddellade open laten staan voor 1-2 uur — laat drogen." },
      { stepNum: 7, title: "Preventie", description: "1x per maand een hete-was op 60°C+. Niet altijd op 30°C wassen. Dosering wasmiddel halveren — minder rest = minder bacteriën." },
    ],
  },
  {
    slug: "wasmachine-ontkalken",
    title: "Wasmachine ontkalken",
    summary: "In kalkgebieden (NL midden + oost): elke 6 maanden ontkalken. Stappenplan voor schoonmaak van element + trommel.",
    difficulty: "EASY",
    timeMinutes: 90,
    isPremium: false,
    parts: ["WF-MISC-03"],
    warnings: "Citroenzuur of bleek NIET combineren — gevaarlijke gassen.",
    tools: ["Ontkalker (1L) OF Witte azijn (1L) OF 200gr citroenzuur poeder"],
    steps: [
      { stepNum: 1, title: "Wanneer ontkalken?", description: "Kalk verkort levensduur element + verhoogt energieverbruik. In hard-water gebieden (Noord-Holland, Utrecht, Brabant deels): elke 4-6 maanden. Zacht-water gebieden (Zeeland, deel Drenthe): 1x per jaar." },
      { stepNum: 2, title: "Welke ontkalker", description: "Speciale wasmachine-ontkalker (€8-10) is het veiligste. Witte azijn werkt ook (1L) maar kan rubberdelen aantasten bij overmatig gebruik. Citroenzuur (poeder) is het krachtigst — 200gr in het wasmiddelvak." },
      { stepNum: 3, title: "Lege programma starten", description: "Zonder was. Hoogste temperatuur (90°C of koken). Voeg ontkalker toe via het wasmiddelvak (of zoals product voorschrijft)." },
      { stepNum: 4, title: "Spoelfase", description: "Belangrijk: laat de spoelcycli volledig draaien — ontkalker moet eruit." },
      { stepNum: 5, title: "Tweede leeg programma", description: "60°C zonder ontkalker. Spoelt resten weg." },
      { stepNum: 6, title: "Wasmiddellade extra reinigen", description: "Daar zit ook kalk aanslag op." },
      { stepNum: 7, title: "Preventie: dosering aanpassen", description: "Bij hard water: wasmiddel-dosering verlagen. Wasmiddel met ingebouwde ontkalker (Calgon-effect) gebruiken — let op: dit is wel marketing, gewone wasmiddel + maandelijkse ontkalking is goedkoper en even effectief." },
    ],
  },
  {
    slug: "wasmachine-maakt-lawaai-centrifugeren",
    title: "Wasmachine maakt lawaai bij centrifugeren — diagnose",
    summary: "Hard geluid, gerommel, of klepperen bij centrifuge? Diagnose-volgorde van goedkoopste naar duurste oorzaak.",
    difficulty: "MEDIUM",
    timeMinutes: 45,
    isPremium: false,
    parts: ["WF-BEAR-03", "WF-DAMP-16", "WF-MISC-02"],
    warnings: "",
    tools: ["Waterpas", "Lamp", "Schroevendraaier"],
    steps: [
      { stepNum: 1, title: "Check 1: Wasgoed verdeling", description: "Eén handdoek + grote items kan onbalans veroorzaken. Probeer eerst een eerlijke lading." },
      { stepNum: 2, title: "Check 2: Vreemd voorwerp in pluizenfilter", description: "Open het pluizenfilter. Vaak zitten daar muntjes, knopen, beugel-bh-haken in." },
      { stepNum: 3, title: "Check 3: Transportbouten", description: "Zit de wasmachine kort na verhuizing? Check of de transportbouten aan de achterkant zijn verwijderd!" },
      { stepNum: 4, title: "Check 4: Waterpas", description: "Zie aparte gids. Wankelig staat = lawaai." },
      { stepNum: 5, title: "Check 5: Anti-vibratie voeten", description: "Stelvoeten leeggesleten of glad? Vervang of plaats anti-vibratie matten." },
      { stepNum: 6, title: "Check 6: Schokdempers", description: "Gaat het lawaai door als de wasmachine waterpas staat? Schokdempers versleten — zie aparte gids." },
      { stepNum: 7, title: "Check 7: Lagers (slechtste scenario)", description: "Klingelend of metaalachtig geluid dat steeds erger wordt = trommellagers. Dit is een grote reparatie (zie premium-gids 'Trommellager vervangen'). Vaak goedkoper om wasmachine te vervangen." },
    ],
  },
  {
    slug: "wasmachine-trilt-te-veel",
    title: "Wasmachine trilt of loopt door tijdens centrifugeren",
    summary: "Wasmachine danst de keuken door? Dit is bijna altijd waterpas of schokdempers. Diagnose stap-voor-stap.",
    difficulty: "EASY",
    timeMinutes: 30,
    isPremium: false,
    parts: ["WF-MISC-01", "WF-MISC-02"],
    warnings: "",
    tools: ["Waterpas"],
    steps: [
      { stepNum: 1, title: "Eerste check: transport-bouten", description: "Bij nieuwe of verhuisde wasmachines: VAAK vergeten. Aan achterkant 3-4 bouten. Eruit." },
      { stepNum: 2, title: "Ondergrond", description: "Houten vloer? Tegelige ondergrond? Plaats anti-vibratie matten of een dikke plaat onder de machine." },
      { stepNum: 3, title: "Waterpas zetten", description: "Zie aparte gids. Vier voeten alle vier op de grond." },
      { stepNum: 4, title: "Wasgoed verdeling", description: "Centrifugeert hij door met ander wasgoed wel goed? Dan is het de lading." },
      { stepNum: 5, title: "Schokdempers test", description: "Open de achter- of voorkap. Druk op de trommel van bovenaf. Hij moet langzaam terugveren — niet hard naar boven schieten. Schiet terug = dempers stuk." },
      { stepNum: 6, title: "Schokdempers vervangen", description: "Zie aparte gids. Beide tegelijk." },
      { stepNum: 7, title: "Veren controleren", description: "Twee tegen-veren bovenaan houden de trommel ophangen. Mogen niet doorgezakt zijn." },
    ],
  },
  {
    slug: "wasmachine-start-niet",
    title: "Wasmachine start niet — diagnose",
    summary: "Drukt op start maar er gebeurt niets? Loop deze checklist af voordat je een monteur belt.",
    difficulty: "EASY",
    timeMinutes: 30,
    isPremium: false,
    parts: ["WF-LOCK-09"],
    warnings: "",
    tools: ["Multimeter (optioneel)"],
    steps: [
      { stepNum: 1, title: "Check 1: Spanning op stopcontact", description: "Werkt een lampje op datzelfde stopcontact? Niet? Stop. Dan is het stopcontact dood." },
      { stepNum: 2, title: "Check 2: Zekering in meterkast", description: "Soms valt een groep eruit. Resetten." },
      { stepNum: 3, title: "Check 3: Aardlekschakelaar", description: "Idem — kan getript zijn door vorige cyclus." },
      { stepNum: 4, title: "Check 4: Deur écht dicht?", description: "Druk de deur extra hard aan. Als hij niet vergrendelt = deurslot probleem, geen start probleem. Zie 'deurslot vervangen'." },
      { stepNum: 5, title: "Check 5: Kinderslot", description: "Drukken op de juiste knop-combo (vaak temp + spoeling 3 sec)." },
      { stepNum: 6, title: "Check 6: Watertoevoer aan", description: "Kraan open? Sommige modellen weigeren te starten zonder watertoevoer." },
      { stepNum: 7, title: "Check 7: Foutcode op display", description: "Zie / fotograaf de foutcode + lees onze foutcode-database. Dan ken je het probleem." },
      { stepNum: 8, title: "Check 8: Reset via stekker", description: "30 min eruit." },
    ],
  },
  {
    slug: "was-wordt-niet-schoon",
    title: "Was wordt niet schoon — diagnose",
    summary: "Vlekken, vieze geur, of grijs-witte vlek-aanslag? 7 oorzaken en wat eraan te doen.",
    difficulty: "EASY",
    timeMinutes: 30,
    isPremium: false,
    parts: ["WF-MISC-04"],
    warnings: "",
    tools: ["Thermometer (optioneel)"],
    steps: [
      { stepNum: 1, title: "Oorzaak 1: Overbelading", description: "Te volle trommel = te weinig water + bewegingsruimte. Vuller dan 75% trommel = niet schoon." },
      { stepNum: 2, title: "Oorzaak 2: Te weinig wasmiddel", description: "Hard water? Vies-wasgoed? Dosering verhogen. Maar niet overdoseren — schuim staat in." },
      { stepNum: 3, title: "Oorzaak 3: Te koud wassen", description: "Onder 30°C werken veel vlekoplossers niet. Maandelijks een 60+°C wasje moet voor alle wasgoed." },
      { stepNum: 4, title: "Oorzaak 4: Wasmachine zelf vies", description: "Schimmel/bacteriën in machine = vies wasgoed eruit. Zie 'Geur uit wasmachine'." },
      { stepNum: 5, title: "Oorzaak 5: Verwarmingselement verkalkt", description: "Machine zegt 60°C, water blijft op 35°C door verkalkt element. Ontkalken (zie aparte gids)." },
      { stepNum: 6, title: "Oorzaak 6: Te kort programma", description: "Eco-30 is op een hele lichte was. Voor echt vuil: katoen 60°C." },
      { stepNum: 7, title: "Oorzaak 7: Niet-spoelen probleem", description: "Witte strepen op de was = wasmiddelrest = onvolledig spoelen. Drukschakelaar of magneetventiel issue." },
    ],
  },
  {
    slug: "wasmachine-lekt-onderaan",
    title: "Wasmachine lekt onderaan — diagnose",
    summary: "Water onder de machine? Vind het lek in 30 minuten zonder paniek.",
    difficulty: "EASY",
    timeMinutes: 30,
    isPremium: false,
    parts: ["WF-DOOR-04", "WF-PUMP-02", "WF-HOSE-03"],
    warnings: "Stop wasmachine direct. Stekker eruit. Waterkraan dicht.",
    tools: ["Werklamp", "Doek", "Tang"],
    steps: [
      { stepNum: 1, title: "Bron lokaliseren", description: "Open een korte spoeling met stekker eruit (klop zachtjes op de deur — vaak gaat hij toch dicht). Kijk WAAR het water vandaan komt." },
      { stepNum: 2, title: "Lek bij de deur?", description: "Manchet (deurpakking) heeft gat of slijtage. Zie 'deurpakking vervangen'." },
      { stepNum: 3, title: "Lek bij wasmiddelvak?", description: "Verstopte sifon-uitlaat — wasmiddelvak loopt over. Reinig de lade en sifongedeelte." },
      { stepNum: 4, title: "Lek bij voorkant onderaan?", description: "Pluizenfilter niet goed vastgedraaid OF dichting in filter versleten." },
      { stepNum: 5, title: "Lek bij achterkant?", description: "Aanvoerslang los of beschadigd. Check beide aansluitpunten." },
      { stepNum: 6, title: "Lek tijdens centrifuge alleen?", description: "Mogelijk afvoerslang los of pomp lekkage. Open achterpaneel." },
      { stepNum: 7, title: "Lek door slang trommel naar pomp?", description: "De grote zwarte slang tussen trommel en pomp scheurt soms. Vervangen." },
    ],
  },
  {
    slug: "wasmachine-stinkt-onderhoud",
    title: "Wasmachine stinkt — preventief onderhoud",
    summary: "Voorkom slechte geuren met dit maandelijkse onderhoudsroutine van 15 minuten.",
    difficulty: "EASY",
    timeMinutes: 15,
    isPremium: false,
    parts: ["WF-MISC-04", "WF-MISC-03"],
    warnings: "",
    tools: ["Microvezeldoek", "Tandenborstel", "Witte azijn"],
    steps: [
      { stepNum: 1, title: "Maandelijkse hete onderhoudswas", description: "1x per maand: 60°C of 90°C lege wasbeurt met 1 reinigingstablet of 500ml azijn." },
      { stepNum: 2, title: "Deurpakking wekelijks", description: "Veeg de plooien van de pakking met droge doek na elke was. Voorkomt schimmel." },
      { stepNum: 3, title: "Wasmiddellade maandelijks", description: "Trek eruit, spoel onder warm water. Schroob met tandenborstel." },
      { stepNum: 4, title: "Pluizenfilter maandelijks", description: "Open, leegmaken, spoelen. Het mooiste moment: meteen na een wasbeurt zodat het filter al nat is." },
      { stepNum: 5, title: "Deur en lade open laten", description: "Na elke was 1-2 uur open. Laat drogen. Dit voorkomt 80% van geurproblemen." },
      { stepNum: 6, title: "Wasmiddel halveren", description: "Te veel wasmiddel = restjes in machine = bacteriegroei. Dosering volgen op verpakking — vaak halveren werkt prima." },
      { stepNum: 7, title: "Halfjaarlijks ontkalken", description: "Zie 'Wasmachine ontkalken'. Verlengt levensduur element." },
    ],
  },
];

// ─── Build output ─────────────────────────────────────────────────────
const existingSlugs = new Set(EXISTING.map((g) => g.slug));
const emitted = [...EXISTING];
const emittedGp = [...GUIDE_PARTS];

for (const g of NEW) {
  if (existingSlugs.has(g.slug)) continue;
  const id = makeId(`guide-${g.slug}`);
  emitted.push({
    id,
    title: g.title,
    slug: g.slug,
    machineId: null,
    difficulty: g.difficulty,
    timeMinutes: g.timeMinutes,
    steps: JSON.stringify(g.steps),
    tools: g.tools.join("|"),
    summary: g.summary,
    warnings: g.warnings || "",
    isPremium: g.isPremium,
    views: 0,
    createdAt: NOW,
  });

  for (const sku of g.parts) {
    const pid = partId(sku);
    if (pid) emittedGp.push({ guideId: id, partId: pid });
  }
}

function dedupeGp(arr) {
  const seen = new Set();
  return arr.filter((r) => {
    const k = `${r.guideId}|${r.partId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

writeFileSync("src/data/guides.json", JSON.stringify(emitted, null, 2));
writeFileSync("src/data/guide-parts.json", JSON.stringify(dedupeGp(emittedGp), null, 2));

console.error(`Emitted ${emitted.length} guides (${emitted.length - EXISTING.length} new) + ${emittedGp.length - GUIDE_PARTS.length} new guide-part rels.`);
