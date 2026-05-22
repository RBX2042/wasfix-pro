import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BRANDS = [
  { brand: "Miele", description: "Duitse premium wasmachines, lange levensduur" },
  { brand: "Bosch", description: "Betrouwbare Duitse wasmachines met SilencePlus technologie" },
  { brand: "Siemens", description: "iQ-serie met iSensoric en speedPack" },
  { brand: "Samsung", description: "EcoBubble en AddWash technologie" },
  { brand: "LG", description: "Direct Drive motors met TurboWash" },
  { brand: "Whirlpool", description: "6th Sense technologie voor zuinig wassen" },
  { brand: "AEG", description: "ÖKOMix en ProSteam serie" },
  { brand: "Electrolux", description: "PerfectCare met SensiCare systeem" },
  { brand: "Beko", description: "Voordelige wasmachines met AquaTech" },
  { brand: "Indesit", description: "Push & Wash met EcoTime programma's" },
];

const MACHINES = [
  { brand: "Miele", model: "WED 125 WPS", yearFrom: 2019, yearTo: 2024 },
  { brand: "Miele", model: "WSG 363 WCS", yearFrom: 2020, yearTo: 2024 },
  { brand: "Miele", model: "W1 Classic WDB 030", yearFrom: 2017, yearTo: 2022 },
  { brand: "Bosch", model: "WAU28T40NL", yearFrom: 2020, yearTo: 2024 },
  { brand: "Bosch", model: "Serie 6 WAT28695NL", yearFrom: 2018, yearTo: 2023 },
  { brand: "Bosch", model: "Serie 8 WAX32M70NL", yearFrom: 2021, yearTo: 2025 },
  { brand: "Siemens", model: "iQ500 WM14T780NL", yearFrom: 2019, yearTo: 2024 },
  { brand: "Siemens", model: "iQ700 WM16XKH0EU", yearFrom: 2020, yearTo: 2024 },
  { brand: "Samsung", model: "WW90T684DLH EcoBubble", yearFrom: 2020, yearTo: 2024 },
  { brand: "Samsung", model: "WW80T554DAW", yearFrom: 2021, yearTo: 2025 },
  { brand: "LG", model: "F4WV710P1E", yearFrom: 2020, yearTo: 2024 },
  { brand: "LG", model: "F4WV9008P2W", yearFrom: 2021, yearTo: 2025 },
  { brand: "Whirlpool", model: "FFD 9469E BV BE", yearFrom: 2019, yearTo: 2023 },
  { brand: "AEG", model: "L7FE96BS", yearFrom: 2018, yearTo: 2023 },
  { brand: "AEG", model: "LR8E75690", yearFrom: 2021, yearTo: 2025 },
  { brand: "Electrolux", model: "EW6F4831RB", yearFrom: 2019, yearTo: 2024 },
  { brand: "Beko", model: "WTV 8736 XC", yearFrom: 2020, yearTo: 2024 },
  { brand: "Indesit", model: "MTWE 91483 WK EE", yearFrom: 2019, yearTo: 2024 },
];

const PARTS = [
  { sku: "WF-PUMP-01", name: "Afvoerpomp universeel (Bosch/Siemens)", brand: "Universeel", category: "PUMP", priceEur: 28.50, stock: 45, description: "Magnetische afvoerpomp 30W, geschikt voor de meeste Bosch en Siemens modellen vanaf 2010", imageUrl: "https://placehold.co/600x600/1a6b6b/ffffff/png?text=Pomp&font=oswald", isOriginal: false, supplier: "Askoll" },
  { sku: "WF-PUMP-02", name: "Afvoerpomp Miele origineel", brand: "Miele", category: "PUMP", priceEur: 79.00, stock: 12, description: "Originele Miele afvoerpomp, geschikt voor W1 en W2 series", imageUrl: "https://placehold.co/600x600/1a6b6b/ffffff/png?text=Pomp&font=oswald", isOriginal: true },
  { sku: "WF-DOOR-02", name: "Deurpakking Miele W1 serie", brand: "Miele", category: "DOOR", priceEur: 34.00, stock: 23, description: "Originele EPDM deurpakking voor Miele W1 frontladers", imageUrl: "https://placehold.co/600x600/c94b2a/ffffff/png?text=Deur&font=oswald", isOriginal: true },
  { sku: "WF-DOOR-03", name: "Deurpakking Bosch/Siemens", brand: "Universeel", category: "DOOR", priceEur: 24.50, stock: 38, description: "Universele deurpakking voor Bosch en Siemens frontladers 2008+", imageUrl: "https://placehold.co/600x600/c94b2a/ffffff/png?text=Deur&font=oswald", isOriginal: false, supplier: "Gorenje" },
  { sku: "WF-DRUM-03", name: "Trommellager set universeel", brand: "Universeel", category: "BEARING", priceEur: 18.90, stock: 67, description: "Set van 2 kogellagers + asafdichting (6206 + 6306 + 35x65x10)", imageUrl: "https://placehold.co/600x600/4a5568/ffffff/png?text=Lager&font=oswald", isOriginal: false, supplier: "SKF" },
  { sku: "WF-BELT-04", name: "V-snaar Whirlpool 1192 J5", brand: "Whirlpool", category: "BELT", priceEur: 8.50, stock: 89, description: "Originele V-snaar 1192 J5 voor Whirlpool toplader/voorlader", imageUrl: "https://placehold.co/600x600/805ad5/ffffff/png?text=Snaar&font=oswald", isOriginal: true },
  { sku: "WF-BELT-05", name: "V-snaar universeel 1232 J5", brand: "Universeel", category: "BELT", priceEur: 7.20, stock: 124, description: "Universele V-snaar voor diverse merken (AEG, Whirlpool, Indesit)", imageUrl: "https://placehold.co/600x600/805ad5/ffffff/png?text=Snaar&font=oswald", isOriginal: false },
  { sku: "WF-HEAT-05", name: "Verwarmingselement 2200W universeel", brand: "Universeel", category: "HEATING", priceEur: 22.00, stock: 56, description: "Roestvrij stalen verwarmingselement 2200W met thermistor aansluiting", imageUrl: "https://placehold.co/600x600/e53e3e/ffffff/png?text=Verwarming&font=oswald", isOriginal: false, supplier: "Irca" },
  { sku: "WF-HEAT-06", name: "Verwarmingselement Bosch 1900W", brand: "Bosch", category: "HEATING", priceEur: 36.50, stock: 28, description: "Origineel Bosch verwarmingselement 1900W met geïntegreerde NTC", imageUrl: "https://placehold.co/600x600/e53e3e/ffffff/png?text=Verwarming&font=oswald", isOriginal: true },
  { sku: "WF-VALVE-06", name: "Waterinlaatventiel 2-weg", brand: "Universeel", category: "VALVE", priceEur: 15.50, stock: 78, description: "Tweewegs magneetventiel 220V voor warm/koud waterinlaat", imageUrl: "https://placehold.co/600x600/3182ce/ffffff/png?text=Ventiel&font=oswald", isOriginal: false },
  { sku: "WF-VALVE-07", name: "Waterinlaatventiel 3-weg Samsung", brand: "Samsung", category: "VALVE", priceEur: 24.90, stock: 19, description: "Origineel Samsung 3-wegs inlaatventiel voor EcoBubble modellen", imageUrl: "https://placehold.co/600x600/3182ce/ffffff/png?text=Ventiel&font=oswald", isOriginal: true },
  { sku: "WF-CARBON-07", name: "Koolborstels paar universeel", brand: "Universeel", category: "MOTOR", priceEur: 9.90, stock: 156, description: "Set van 2 koolborstels 5x12.5x32mm voor universele motoren", imageUrl: "https://placehold.co/600x600/2d3748/ffffff/png?text=Motor&font=oswald", isOriginal: false },
  { sku: "WF-BOARD-08", name: "Module Samsung Ecobubble", brand: "Samsung", category: "ELECTRONICS", priceEur: 89.00, stock: 8, description: "Hoofdmodule voor Samsung WW8 / WW9 EcoBubble serie", imageUrl: "https://placehold.co/600x600/d69e2e/ffffff/png?text=Elektronica&font=oswald", isOriginal: true },
  { sku: "WF-FILTER-09", name: "Pluizenfilter universeel", brand: "Universeel", category: "FILTER", priceEur: 6.50, stock: 201, description: "Universeel pluizenfilter voor afvoerpomp, past op de meeste merken", imageUrl: "https://placehold.co/600x600/38a169/ffffff/png?text=Filter&font=oswald", isOriginal: false },
  { sku: "WF-HOSE-10", name: "Afvoerslang 1.5m flexibel", brand: "Universeel", category: "HOSE", priceEur: 11.90, stock: 87, description: "Flexibele afvoerslang 1.5m met 22/29mm aansluiting", imageUrl: "https://placehold.co/600x600/319795/ffffff/png?text=Slang&font=oswald", isOriginal: false },
  { sku: "WF-HOSE-11", name: "Aquastop slang 2m", brand: "Universeel", category: "HOSE", priceEur: 24.00, stock: 42, description: "Veiligheidsslang met aquastop ventiel, 2 meter lang", imageUrl: "https://placehold.co/600x600/319795/ffffff/png?text=Slang&font=oswald", isOriginal: false },
  { sku: "WF-MOTOR-12", name: "Inverter motor LG Direct Drive", brand: "LG", category: "MOTOR", priceEur: 165.00, stock: 6, description: "Originele LG Direct Drive inverter motor", imageUrl: "https://placehold.co/600x600/2d3748/ffffff/png?text=Motor&font=oswald", isOriginal: true },
  { sku: "WF-LOCK-13", name: "Deurslot AEG / Electrolux", brand: "AEG", category: "DOOR", priceEur: 32.50, stock: 21, description: "Origineel deurslot voor AEG/Electrolux frontladers met PTC", imageUrl: "https://placehold.co/600x600/c94b2a/ffffff/png?text=Deur&font=oswald", isOriginal: true },
  { sku: "WF-NTC-14", name: "Temperatuursensor (NTC)", brand: "Universeel", category: "ELECTRONICS", priceEur: 12.00, stock: 95, description: "NTC temperatuursensor 10K Ohm voor verwarmingselement", imageUrl: "https://placehold.co/600x600/d69e2e/ffffff/png?text=Elektronica&font=oswald", isOriginal: false },
  { sku: "WF-DAMP-15", name: "Schokdempers set (2 stuks)", brand: "Universeel", category: "BEARING", priceEur: 18.50, stock: 64, description: "Set van 2 schokdempers 80N voor trommelophanging", imageUrl: "https://placehold.co/600x600/4a5568/ffffff/png?text=Lager&font=oswald", isOriginal: false },
];

const ERROR_CODES = [
  // Miele
  { brand: "Miele", model: "WED 125 WPS", code: "F11", title: "Afvoerprobleem", description: "Het water kan niet worden afgevoerd. De cyclus is gestopt en de trommel zit mogelijk vol water.", likelyCauses: "Verstopte pluizenfilter|Geknikte of verstopte afvoerslang|Defecte afvoerpomp|Verstopte afvoersifon", severity: "MEDIUM", diyFriendly: true },
  { brand: "Miele", model: "WED 125 WPS", code: "F53", title: "Motor probleem", description: "De motor draait niet of toerentelregeling werkt niet correct.", likelyCauses: "Defecte koolborstels|Defecte motor|Defecte tachometer|Module probleem", severity: "HIGH", diyFriendly: false },
  { brand: "Miele", model: "WSG 363 WCS", code: "F21", title: "Watertoevoer probleem", description: "Er stroomt geen of te weinig water in de wasmachine.", likelyCauses: "Gesloten waterkraan|Verstopt filter in inlaatslang|Defect waterinlaatventiel|Lage waterdruk", severity: "MEDIUM", diyFriendly: true },
  { brand: "Miele", model: "W1 Classic WDB 030", code: "F23", title: "Waterlek gedetecteerd", description: "De Waterproof System (WPS) heeft een lekkage gedetecteerd in de bodembak.", likelyCauses: "Lekkage afvoerpomp|Lekkage zeepbak|Defecte sealring trommel|Versleten deurpakking", severity: "HIGH", diyFriendly: false },

  // Bosch
  { brand: "Bosch", model: "WAU28T40NL", code: "E18", title: "Afvoer fout (E18 / F18)", description: "Het afvalwater kan niet worden afgevoerd binnen de tijdslimiet.", likelyCauses: "Verstopte pluizenfilter|Verstopte afvoerslang|Defecte afvoerpomp|Verstopte sifon onder gootsteen", severity: "MEDIUM", diyFriendly: true },
  { brand: "Bosch", model: "WAU28T40NL", code: "E21", title: "Motor draait niet vrij", description: "De trommel kan niet draaien, mogelijk geblokkeerd of motor defect.", likelyCauses: "Geblokkeerde trommel (kledingstuk vast)|Defecte motor|Defecte module|Defecte koolborstels", severity: "HIGH", diyFriendly: false },
  { brand: "Bosch", model: "Serie 6 WAT28695NL", code: "F21", title: "Aanstuurfout motor", description: "Communicatieprobleem tussen module en motor.", likelyCauses: "Defecte module|Loszittende kabelverbinding|Defecte tachosensor", severity: "HIGH", diyFriendly: false },
  { brand: "Bosch", model: "Serie 8 WAX32M70NL", code: "E04", title: "Vulwater niveau te hoog", description: "Te veel water in de kuip — drukschakelaar geeft alarm.", likelyCauses: "Defect waterinlaatventiel (blijft open)|Defecte drukschakelaar|Verstopte luchtkamer", severity: "MEDIUM", diyFriendly: true },

  // Siemens
  { brand: "Siemens", model: "iQ500 WM14T780NL", code: "F23", title: "AquaStop geactiveerd", description: "AquaStop heeft watertoevoer afgesloten wegens lekkage.", likelyCauses: "Lekkage in machine|Defecte AquaStop slang|Vocht in bodembak", severity: "HIGH", diyFriendly: false },
  { brand: "Siemens", model: "iQ700 WM16XKH0EU", code: "E27", title: "Spanningsvoorziening probleem", description: "Onderspanning of stroomstoring gedetecteerd.", likelyCauses: "Te lage netspanning|Defecte voeding op module|Loszittende stekker", severity: "MEDIUM", diyFriendly: false },

  // Samsung
  { brand: "Samsung", model: "WW90T684DLH EcoBubble", code: "dE", title: "Deur niet correct gesloten", description: "De deur staat open of het deurslot werkt niet.", likelyCauses: "Deur staat niet goed dicht|Defect deurslot|Wasgoed klemt tussen deur|Beschadigde scharnier", severity: "LOW", diyFriendly: true },
  { brand: "Samsung", model: "WW90T684DLH EcoBubble", code: "4E", title: "Watertoevoer fout", description: "Wasmachine krijgt onvoldoende water binnen.", likelyCauses: "Gesloten kraan|Verstopt zeefje in inlaatslang|Defect inlaatventiel|Lage waterdruk", severity: "MEDIUM", diyFriendly: true },
  { brand: "Samsung", model: "WW80T554DAW", code: "5E", title: "Afvoerprobleem", description: "Wasmachine kan water niet afvoeren.", likelyCauses: "Verstopt pluizenfilter|Geknikte afvoerslang|Defecte afvoerpomp", severity: "MEDIUM", diyFriendly: true },
  { brand: "Samsung", model: "WW80T554DAW", code: "UE", title: "Onbalans gedetecteerd", description: "De trommellading is niet gelijkmatig verdeeld.", likelyCauses: "Onevenwichtige belading|Te kleine lading|Defecte schokdempers|Versleten trommellager", severity: "LOW", diyFriendly: true },

  // LG
  { brand: "LG", model: "F4WV710P1E", code: "OE", title: "Drain Error (OE)", description: "Water wordt niet binnen de tijdslimiet afgevoerd.", likelyCauses: "Verstopt pluizenfilter|Defecte afvoerpomp|Verstopte afvoerslang|Defecte druksensor", severity: "MEDIUM", diyFriendly: true },
  { brand: "LG", model: "F4WV710P1E", code: "LE", title: "Motor Lock Error", description: "Motor is geblokkeerd of de trommel kan niet draaien.", likelyCauses: "Overbelading|Versleten lager|Defecte Hall-sensor|Stator probleem", severity: "HIGH", diyFriendly: false },
  { brand: "LG", model: "F4WV9008P2W", code: "IE", title: "Inlet Error", description: "Geen of te weinig waterinlaat binnen de tijdslimiet.", likelyCauses: "Gesloten kraan|Defect waterinlaatventiel|Verstopt zeefje|Lage waterdruk", severity: "MEDIUM", diyFriendly: true },

  // Whirlpool
  { brand: "Whirlpool", model: "FFD 9469E BV BE", code: "F01", title: "Elektronische module storing", description: "Hoofdmodule reageert niet correct.", likelyCauses: "Defecte hoofdmodule|Vochtindringing op module|Spanningsstoring", severity: "HIGH", diyFriendly: false },
  { brand: "Whirlpool", model: "FFD 9469E BV BE", code: "F08", title: "Verwarmingselement defect", description: "Het verwarmingselement heeft een storing.", likelyCauses: "Defect verwarmingselement|Defecte NTC sensor|Onderbroken kabel naar element", severity: "MEDIUM", diyFriendly: true },

  // AEG
  { brand: "AEG", model: "L7FE96BS", code: "E10", title: "Watertoevoer storing", description: "Onvoldoende watertoevoer.", likelyCauses: "Gesloten kraan|Verstopt zeefje|Defect inlaatventiel|Drukverlies", severity: "MEDIUM", diyFriendly: true },
  { brand: "AEG", model: "L7FE96BS", code: "E20", title: "Afvoerprobleem AEG", description: "Het water wordt niet afgevoerd.", likelyCauses: "Verstopt filter|Defecte pomp|Geknikte slang|Druksensor defect", severity: "MEDIUM", diyFriendly: true },
  { brand: "AEG", model: "LR8E75690", code: "E40", title: "Deurslot probleem", description: "Het deurslot kan niet worden vergrendeld of ontgrendeld.", likelyCauses: "Defect deurslot (PTC)|Beschadigde deurkruk|Module probleem", severity: "MEDIUM", diyFriendly: true },

  // Electrolux
  { brand: "Electrolux", model: "EW6F4831RB", code: "E11", title: "Vultijd overschreden", description: "De wasmachine kon niet binnen de tijdslimiet vullen.", likelyCauses: "Gesloten waterkraan|Defect inlaatventiel|Te lage waterdruk|Verstopt zeefje", severity: "MEDIUM", diyFriendly: true },

  // Beko
  { brand: "Beko", model: "WTV 8736 XC", code: "H1", title: "Verwarmingselement / NTC fout", description: "Probleem met verwarmen tijdens cyclus.", likelyCauses: "Defect verwarmingselement|NTC sensor defect|Bekabeling onderbroken", severity: "MEDIUM", diyFriendly: true },

  // Indesit
  { brand: "Indesit", model: "MTWE 91483 WK EE", code: "F05", title: "Pomp / drukschakelaar fout", description: "Probleem met afvoeren of drukschakelaar geeft fouten.", likelyCauses: "Verstopt filter|Defecte pomp|Defecte drukschakelaar", severity: "MEDIUM", diyFriendly: true },
  { brand: "Indesit", model: "MTWE 91483 WK EE", code: "F08", title: "Verwarmingselement", description: "Verwarmingselement bereikt niet de juiste temperatuur.", likelyCauses: "Defect element|Kalkaanslag op element|NTC defect", severity: "MEDIUM", diyFriendly: true },
];

const REPAIR_GUIDES = [
  {
    slug: "afvoerpomp-reinigen-vervangen",
    title: "Afvoerpomp reinigen en vervangen",
    difficulty: "EASY",
    timeMinutes: 30,
    summary: "Stap-voor-stap handleiding om de afvoerpomp en pluizenfilter te reinigen of te vervangen — werkt voor de meeste merken.",
    warnings: "Trek altijd de stekker uit het stopcontact en draai de waterkraan dicht voordat je begint. Leg een handdoek onder de wasmachine — er komt restwater uit het filter.",
    tools: "Schroevendraaier (Torx T20)|Platte tang|Emmer (5L)|Handdoek|Werklamp",
    steps: JSON.stringify([
      { stepNum: 1, title: "Veiligheid eerst", description: "Haal de stekker uit het stopcontact en draai de watertoevoerkraan dicht. Wacht 5 minuten zodat eventuele restspanning weg is." },
      { stepNum: 2, title: "Pluizenfilter openen", description: "De meeste wasmachines hebben rechtsonder een klepje. Open het en plaats een lage emmer of platte bak onder de uitlaatslang." },
      { stepNum: 3, title: "Water aftappen", description: "Trek de noodaftapslang uit (zwart slangetje) en laat het water in de bak lopen. Dit kan 3-5 liter zijn." },
      { stepNum: 4, title: "Filter openen", description: "Draai het pluizenfilter linksom los. Pas op: er komt nog water uit. Verwijder al het pluis, muntjes en haar." },
      { stepNum: 5, title: "Pomp inspecteren", description: "Schijn met een lamp in de filteropening. Draai het pomprad met je vinger — het moet vrij draaien. Controleer op vreemde voorwerpen.", warning: "Steek nooit je vingers diep in de pompbehuizing zonder zicht — er kunnen scherpe voorwerpen zitten." },
      { stepNum: 6, title: "Pomp vervangen (indien defect)", description: "Kantel de wasmachine voorzichtig achterover en zet vast. Verwijder de bodemplaat (4 schroeven). De pomp is vastgezet met 3 schroeven en heeft 2 slangaansluitingen + elektrische connector." },
      { stepNum: 7, title: "Nieuwe pomp monteren", description: "Plaats de nieuwe pomp in omgekeerde volgorde. Let op de juiste oriëntatie van de slangen en de elektrische connector klikt vast." },
      { stepNum: 8, title: "Testen", description: "Sluit alles weer aan, zet de wasmachine recht, draai de kraan open en steek de stekker erin. Draai een korte centrifugeerprogramma als test." },
    ]),
    isPremium: false,
  },
  {
    slug: "deurpakking-vervangen",
    title: "Deurpakking (manchet) vervangen",
    difficulty: "MEDIUM",
    timeMinutes: 60,
    summary: "Lekt je wasmachine bij de deur of zit er schimmel in de pakking? Vervang de deurpakking zelf in 1 uur.",
    warnings: "Let op de positie van de drainslang in de pakking — deze moet onder zitten. Beschadig de trommel niet bij het verwijderen.",
    tools: "Platte schroevendraaier|Schroevendraaier (Phillips)|Veerklemtang|Werklamp|Spiegel (klein)",
    steps: JSON.stringify([
      { stepNum: 1, title: "Voorbereiding", description: "Trek de stekker uit en draai de kraan dicht. Tap eventueel restwater af via het pluizenfilter." },
      { stepNum: 2, title: "Bovenpaneel verwijderen", description: "Verwijder de 2 schroeven aan de achterkant van het bovenpaneel en schuif het naar achteren. Dit geeft je toegang tot bovenkant van pakking." },
      { stepNum: 3, title: "Buitenste klem verwijderen", description: "Aan de voorkant zit een metalen veerklem rond de pakking. Vind het veertje (vaak onderaan op 6 uur positie) en wrik deze los met platte schroevendraaier." },
      { stepNum: 4, title: "Pakking lostrekken aan voorkant", description: "Trek de buitenste rand van de pakking voorzichtig los van het frame, rondom de hele opening." },
      { stepNum: 5, title: "Frontpaneel openen (indien nodig)", description: "Bij sommige merken (Miele, Bosch) moet het frontpaneel los voor toegang tot de binnenste klem." },
      { stepNum: 6, title: "Binnenste klem verwijderen", description: "De binnenste klem zit tegen de trommelopening. Markeer de positie van de pakking met een stift voordat je hem verwijdert." },
      { stepNum: 7, title: "Oude pakking verwijderen", description: "Trek de pakking volledig uit de trommel. Reinig de rand grondig met azijn-water mix om kalkresten te verwijderen." },
      { stepNum: 8, title: "Nieuwe pakking monteren", description: "Lijn de markering uit (afvoeropening onderaan!). Druk de binnenste rand goed in de groef rondom. Tip: zeepwater maakt het makkelijker." },
      { stepNum: 9, title: "Klemmen terugplaatsen", description: "Eerst de binnenste veerklem vastzetten, dan de buitenste klem. Controleer of de pakking nergens omkrult." },
      { stepNum: 10, title: "Lektest", description: "Plaats panelen terug, sluit aan en draai een korte spoelprogramma. Check rondom de deur op lekkage." },
    ]),
    isPremium: false,
  },
  {
    slug: "trommellager-vervangen",
    title: "Trommellager vervangen (geavanceerd)",
    difficulty: "HARD",
    timeMinutes: 180,
    summary: "Bij luid gerommel of grommend geluid zijn de trommellagers vaak versleten. Een grote klus, maar bespaart je honderden euro's.",
    warnings: "Dit is een uitdagende reparatie. Bij gelijmde kuipen (vooral Bosch/Siemens na 2010) is vervanging vaak niet rendabel. Controleer eerst of jouw model een schroefkuip heeft.",
    tools: "Volledige dopsleutelset|Lagertrekker|Plastic hamer|Drijver|Multimeter|Steeksleutels 8-19mm|Penaal/draaibank toegang gewenst",
    steps: JSON.stringify([
      { stepNum: 1, title: "Voorbereiden en demonteren bovenkant", description: "Stekker eruit, kraan dicht. Verwijder bovenpaneel, zeepbak, frontpaneel, bedieningspaneel — leg alle schroeven gesorteerd weg." },
      { stepNum: 2, title: "Onderdelen losmaken", description: "Verwijder schokdempers (onderaan), tegengewicht (boven, vooraan), aanvoer- en afvoerslangen, drukslangetje, motor (4 bouten), verwarmingselement." },
      { stepNum: 3, title: "Kuip uitnemen", description: "Maak alle kabelbomen los, fotografeer alles voor montage. Til de kuip uit de wasmachine — vraag hulp, dit kan 25kg+ zijn." },
      { stepNum: 4, title: "Kuiphelften scheiden", description: "Schroefkuip: verwijder de bouten rondom de kuipnaad. Gelijmde kuip: voorzichtig opzagen of breken — handgreep voor montage van de nieuwe kuip is nodig." },
      { stepNum: 5, title: "Trommel + as uitnemen", description: "Til de trommel uit de achterkuip. De as en lagers blijven in de achterkuip vastzitten." },
      { stepNum: 6, title: "Oude lagers verwijderen", description: "Trek de afdichtring eruit. Sla de lagers met een drijver eruit (afwisselend om te voorkomen dat het scheef trekt). Reinig de zitting grondig." },
      { stepNum: 7, title: "Nieuwe lagers + sealring plaatsen", description: "Sla het kleinste lager eerst in (vaak 6206), dan het grote (6306). Gebruik een drijver passend op de buitenring. Plaats de sealring met de open kant naar buiten." },
      { stepNum: 8, title: "Trommel terugplaatsen", description: "Smeer de as in met lager-vet. Schuif de trommel terug — soms tikken nodig. Test of hij vrij draait." },
      { stepNum: 9, title: "Kuip dichten en monteren", description: "Bij gelijmde kuip: gebruik nieuwe kuipverbinder + waterdicht silicone. Schroefkuip: nieuwe O-ring tussen de helften en gelijkmatig aandraaien." },
      { stepNum: 10, title: "Volledige montage en test", description: "Plaats alles in omgekeerde volgorde terug. Draai eerst een leeg programma op 30°C als test, check op lekkage en geluid." },
    ]),
    isPremium: true,
  },
  {
    slug: "filter-reinigen",
    title: "Pluizenfilter reinigen (basis onderhoud)",
    difficulty: "EASY",
    timeMinutes: 15,
    summary: "Een verstopte pluizenfilter veroorzaakt afvoerproblemen, slechte was en muffe geur. Maak het maandelijks schoon.",
    warnings: "Heb een platte bak of grote handdoek klaar — er kan tot 3 liter water uit komen.",
    tools: "Platte schroevendraaier|Bak/Emmer (3L)|Handdoek|Tandenborstel|Azijn (optioneel)",
    steps: JSON.stringify([
      { stepNum: 1, title: "Stroom uit", description: "Trek de stekker uit. Veiliger werken, ook bij zo'n simpele klus." },
      { stepNum: 2, title: "Klepje openen", description: "Onderaan de wasmachine zit een paneeltje (links of rechts). Wrik het open met een platte schroevendraaier of munt." },
      { stepNum: 3, title: "Water aftappen", description: "Trek de zwarte noodaftapslang los, plaats de bak eronder en haal het stopdopje eraf. Laat al het water weglopen." },
      { stepNum: 4, title: "Filter eruit", description: "Draai het filter linksom los. Het komt vrij makkelijk uit. Verwijder al het pluis, haar en eventuele muntjes." },
      { stepNum: 5, title: "Reinigen", description: "Spoel het filter af onder kraanwater en schrob met een tandenborstel. Voor extra schoon: 30 min in azijn weken." },
      { stepNum: 6, title: "Pomphuis controleren", description: "Voel met de vinger in het pomphuis (na water afgetapt!) of er geen voorwerpen zitten. Draai het pomprad — moet vrij draaien." },
      { stepNum: 7, title: "Terugplaatsen", description: "Plaats het filter terug en draai stevig vast (rechtsom). Klepje sluiten. Stekker erin en korte test draaien." },
    ]),
    isPremium: false,
  },
  {
    slug: "waterinlaatventiel-vervangen",
    title: "Waterinlaatventiel vervangen",
    difficulty: "MEDIUM",
    timeMinutes: 45,
    summary: "Geen of te weinig water? Defecte ventiel? Vervang de inlaatventiel zelf in 45 minuten.",
    warnings: "Draai de waterkraan goed dicht. Vergeet niet de schroefdraad af te dichten met teflon tape bij de slangaansluiting.",
    tools: "Schroevendraaiers|Steeksleutel 19mm|Multimeter|Teflon tape|Werklamp",
    steps: JSON.stringify([
      { stepNum: 1, title: "Veiligheid", description: "Stekker eruit, waterkraan dicht. Schroef de waterinlaatslang los en vang restwater op." },
      { stepNum: 2, title: "Bovenpaneel demonteren", description: "Verwijder de 2 schroeven achter en schuif het bovenpaneel naar achteren. De inlaatventiel zit meestal rechtsboven." },
      { stepNum: 3, title: "Ventiel inspecteren", description: "Localiseer het ventiel (kleine plastic eenheid met 1-3 spoelen). Maak een foto van de aansluitingen voor montage." },
      { stepNum: 4, title: "Ventiel testen", description: "Met multimeter: meet weerstand op de spoelen. Goede spoel: 3-4 kΩ. Open circuit = defect.", warning: "Test alleen met machine spanningsloos." },
      { stepNum: 5, title: "Slangen losmaken", description: "Draai de slangklemmen los (knijpen of schroef) en trek de aanvoerslangen naar de zeepbak los." },
      { stepNum: 6, title: "Ventiel demonteren", description: "Verwijder de bevestigingsschroef of clip. Trek de elektrische connectoren los (let op de volgorde — fotografeer)." },
      { stepNum: 7, title: "Nieuwe ventiel monteren", description: "Plaats het nieuwe ventiel in dezelfde oriëntatie. Sluit alle elektrische connectoren aan zoals de foto." },
      { stepNum: 8, title: "Slangen aansluiten", description: "Bevestig de aanvoerslangen met klemmen. Bij de buitenaansluiting: wikkel teflon tape om de schroefdraad voor lekvrije afdichting." },
      { stepNum: 9, title: "Test", description: "Draai de waterkraan voorzichtig open, check op lekkage. Plaats bovenpaneel terug, stekker erin en draai een spoelprogramma als test." },
    ]),
    isPremium: false,
  },
  {
    slug: "verwarmingselement-vervangen",
    title: "Verwarmingselement vervangen",
    difficulty: "MEDIUM",
    timeMinutes: 75,
    summary: "Was komt koud uit de machine? Foutcode H1, F08 of E08? Het verwarmingselement is meestal de schuldige.",
    warnings: "Element kan na recente was nog heet zijn. Test eerst met multimeter voordat je vervangt — kalkophoping kan ook de boosdoener zijn.",
    tools: "Steeksleutel 8mm of 10mm|Schroevendraaier (Torx)|Multimeter|Tang|Bak voor kalkresten",
    steps: JSON.stringify([
      { stepNum: 1, title: "Voorbereiding", description: "Stekker eruit, waterkraan dicht. Wacht 30 min als de machine recent gebruikt is." },
      { stepNum: 2, title: "Toegang krijgen", description: "Bij de meeste merken zit het element achteraan, soms voor (Bosch). Verwijder achterpaneel of frontpaneel." },
      { stepNum: 3, title: "Element identificeren", description: "Een metalen plaatje met centrale moer en 2-3 elektrische aansluitingen, onder of achter de trommel." },
      { stepNum: 4, title: "Multimeter test", description: "Trek de connectoren los en meet weerstand op de 2 buitenste pinnen. Goed: 25-30 Ω. Open of kortsluiting = vervangen." },
      { stepNum: 5, title: "Aardlek test", description: "Meet weerstand tussen pin en metalen frame element. Goed: oneindig. Lage weerstand = element lekt naar massa, gevaarlijk!" },
      { stepNum: 6, title: "Element losmaken", description: "Draai de centrale moer los (NIET helemaal eraf). Druk de bout naar binnen. Wrik het element voorzichtig los — het kan vastzitten door kalk." },
      { stepNum: 7, title: "Trekken", description: "Trek het element met een wrikkende beweging eruit. Vang vrijkomend water op. Verwijder de oude rubber pakking helemaal." },
      { stepNum: 8, title: "Inspecteer kuipopening", description: "Verwijder kalkresten en pluis uit de opening. Reinig met een doek." },
      { stepNum: 9, title: "Nieuw element plaatsen", description: "Bevochtig de pakking met water of zeep. Schuif het element in de opening — zorg dat het volledig past en de pakking goed zit." },
      { stepNum: 10, title: "Vastzetten", description: "Draai de centrale moer aan tot de pakking aandrukt — niet te strak (rubber kan scheuren). Sluit elektrische connectoren aan zoals voorheen." },
      { stepNum: 11, title: "Test", description: "Sluit alles weer aan en draai een wasprogramma op 60°C. Voel na 30 min of de machine warm aanvoelt." },
    ]),
    isPremium: true,
  },
];

async function main() {
  console.log("🌱 Seeding database...");

  // Wipe in dependency order
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.diagnosis.deleteMany();
  await prisma.errorCodeParts.deleteMany();
  await prisma.errorCodeGuides.deleteMany();
  await prisma.guideParts.deleteMany();
  await prisma.partMachine.deleteMany();
  await prisma.errorCode.deleteMany();
  await prisma.repairGuide.deleteMany();
  await prisma.part.deleteMany();
  await prisma.savedMachine.deleteMany();
  await prisma.washingMachine.deleteMany();

  console.log("📦 Creating washing machines...");
  const machineMap = new Map<string, string>();
  for (const m of MACHINES) {
    const created = await prisma.washingMachine.create({
      data: {
        brand: m.brand,
        model: m.model,
        yearFrom: m.yearFrom,
        yearTo: m.yearTo,
        description: BRANDS.find((b) => b.brand === m.brand)?.description ?? "",
        imageUrl: `https://placehold.co/800x800/1a6b6b/ffffff/png?text=${m.brand.replace(/\s+/g,'+')}+${m.model.replace(/\s+/g,'+')}&font=oswald`,
      },
    });
    machineMap.set(`${m.brand}::${m.model}`, created.id);
  }

  console.log("🔧 Creating parts...");
  const partMap = new Map<string, string>();
  for (const p of PARTS) {
    const created = await prisma.part.create({ data: p });
    partMap.set(p.sku, created.id);
  }

  console.log("⚠️ Creating error codes...");
  const errorCodeMap = new Map<string, string>();
  for (const ec of ERROR_CODES) {
    const machineId = machineMap.get(`${ec.brand}::${ec.model}`);
    if (!machineId) {
      console.warn(`No machine for ${ec.brand} ${ec.model}`);
      continue;
    }
    const created = await prisma.errorCode.create({
      data: {
        code: ec.code,
        title: ec.title,
        description: ec.description,
        likelyCauses: ec.likelyCauses,
        severity: ec.severity,
        diyFriendly: ec.diyFriendly,
        machineId,
      },
    });
    errorCodeMap.set(`${ec.brand}::${ec.code}`, created.id);
  }

  console.log("📘 Creating repair guides...");
  const guideMap = new Map<string, string>();
  for (const g of REPAIR_GUIDES) {
    const created = await prisma.repairGuide.create({
      data: {
        slug: g.slug,
        title: g.title,
        difficulty: g.difficulty,
        timeMinutes: g.timeMinutes,
        summary: g.summary,
        warnings: g.warnings,
        tools: g.tools,
        steps: g.steps,
        isPremium: g.isPremium,
        views: Math.floor(Math.random() * 5000) + 100,
      },
    });
    guideMap.set(g.slug, created.id);
  }

  // Link parts to machines
  console.log("🔗 Linking parts to machines...");
  const universalParts = ["WF-PUMP-01", "WF-DRUM-03", "WF-BELT-05", "WF-HEAT-05", "WF-VALVE-06", "WF-CARBON-07", "WF-FILTER-09", "WF-HOSE-10", "WF-HOSE-11", "WF-NTC-14", "WF-DAMP-15"];
  for (const m of MACHINES) {
    const machineId = machineMap.get(`${m.brand}::${m.model}`)!;
    for (const sku of universalParts) {
      await prisma.partMachine.create({
        data: { partId: partMap.get(sku)!, machineId },
      });
    }
    // Brand-specific parts
    const brandParts: Record<string, string[]> = {
      Miele: ["WF-PUMP-02", "WF-DOOR-02"],
      Bosch: ["WF-DOOR-03", "WF-HEAT-06"],
      Siemens: ["WF-DOOR-03", "WF-HEAT-06"],
      Samsung: ["WF-VALVE-07", "WF-BOARD-08"],
      LG: ["WF-MOTOR-12"],
      Whirlpool: ["WF-BELT-04"],
      AEG: ["WF-LOCK-13"],
      Electrolux: ["WF-LOCK-13"],
    };
    for (const sku of brandParts[m.brand] ?? []) {
      await prisma.partMachine.create({
        data: { partId: partMap.get(sku)!, machineId },
      });
    }
  }

  // Link error codes to parts
  console.log("🔗 Linking error codes to parts...");
  const errorPartLinks = [
    { ec: "Miele::F11", parts: ["WF-PUMP-02", "WF-FILTER-09", "WF-HOSE-10"] },
    { ec: "Miele::F53", parts: ["WF-CARBON-07", "WF-MOTOR-12"] },
    { ec: "Miele::F21", parts: ["WF-VALVE-06"] },
    { ec: "Miele::F23", parts: ["WF-DOOR-02", "WF-HOSE-11"] },
    { ec: "Bosch::E18", parts: ["WF-PUMP-01", "WF-FILTER-09", "WF-HOSE-10"] },
    { ec: "Bosch::E21", parts: ["WF-CARBON-07"] },
    { ec: "Bosch::F21", parts: ["WF-CARBON-07"] },
    { ec: "Bosch::E04", parts: ["WF-VALVE-06"] },
    { ec: "Siemens::F23", parts: ["WF-HOSE-11"] },
    { ec: "Samsung::4E", parts: ["WF-VALVE-07", "WF-VALVE-06"] },
    { ec: "Samsung::5E", parts: ["WF-PUMP-01", "WF-FILTER-09"] },
    { ec: "Samsung::UE", parts: ["WF-DAMP-15", "WF-DRUM-03"] },
    { ec: "Samsung::dE", parts: ["WF-LOCK-13"] },
    { ec: "LG::OE", parts: ["WF-PUMP-01", "WF-FILTER-09"] },
    { ec: "LG::LE", parts: ["WF-MOTOR-12", "WF-DRUM-03"] },
    { ec: "LG::IE", parts: ["WF-VALVE-06"] },
    { ec: "Whirlpool::F08", parts: ["WF-HEAT-05", "WF-NTC-14"] },
    { ec: "AEG::E10", parts: ["WF-VALVE-06"] },
    { ec: "AEG::E20", parts: ["WF-PUMP-01", "WF-FILTER-09"] },
    { ec: "AEG::E40", parts: ["WF-LOCK-13"] },
    { ec: "Electrolux::E11", parts: ["WF-VALVE-06"] },
    { ec: "Beko::H1", parts: ["WF-HEAT-05", "WF-NTC-14"] },
    { ec: "Indesit::F05", parts: ["WF-PUMP-01", "WF-FILTER-09"] },
    { ec: "Indesit::F08", parts: ["WF-HEAT-05", "WF-NTC-14"] },
  ];
  for (const link of errorPartLinks) {
    const ecId = errorCodeMap.get(link.ec);
    if (!ecId) continue;
    for (const sku of link.parts) {
      const partId = partMap.get(sku);
      if (!partId) continue;
      await prisma.errorCodeParts.create({
        data: { errorCodeId: ecId, partId },
      });
    }
  }

  // Link error codes to guides
  console.log("🔗 Linking error codes to guides...");
  const drainGuide = guideMap.get("afvoerpomp-reinigen-vervangen")!;
  const filterGuide = guideMap.get("filter-reinigen")!;
  const valveGuide = guideMap.get("waterinlaatventiel-vervangen")!;
  const heatGuide = guideMap.get("verwarmingselement-vervangen")!;
  const sealGuide = guideMap.get("deurpakking-vervangen")!;
  const bearingGuide = guideMap.get("trommellager-vervangen")!;

  const ecGuideLinks = [
    { ec: "Miele::F11", guides: [filterGuide, drainGuide] },
    { ec: "Miele::F23", guides: [sealGuide] },
    { ec: "Bosch::E18", guides: [filterGuide, drainGuide] },
    { ec: "Bosch::E04", guides: [valveGuide] },
    { ec: "Samsung::4E", guides: [valveGuide] },
    { ec: "Samsung::5E", guides: [filterGuide, drainGuide] },
    { ec: "Samsung::UE", guides: [bearingGuide] },
    { ec: "LG::OE", guides: [filterGuide, drainGuide] },
    { ec: "LG::IE", guides: [valveGuide] },
    { ec: "LG::LE", guides: [bearingGuide] },
    { ec: "Whirlpool::F08", guides: [heatGuide] },
    { ec: "AEG::E10", guides: [valveGuide] },
    { ec: "AEG::E20", guides: [filterGuide, drainGuide] },
    { ec: "Beko::H1", guides: [heatGuide] },
    { ec: "Indesit::F05", guides: [filterGuide, drainGuide] },
    { ec: "Indesit::F08", guides: [heatGuide] },
  ];
  for (const link of ecGuideLinks) {
    const ecId = errorCodeMap.get(link.ec);
    if (!ecId) continue;
    for (const guideId of link.guides) {
      await prisma.errorCodeGuides.create({
        data: { errorCodeId: ecId, guideId },
      });
    }
  }

  // Link guides to parts
  console.log("🔗 Linking guides to parts...");
  const guidePartLinks = [
    { guide: "afvoerpomp-reinigen-vervangen", parts: ["WF-PUMP-01", "WF-PUMP-02", "WF-FILTER-09", "WF-HOSE-10"] },
    { guide: "deurpakking-vervangen", parts: ["WF-DOOR-02", "WF-DOOR-03"] },
    { guide: "trommellager-vervangen", parts: ["WF-DRUM-03", "WF-DAMP-15"] },
    { guide: "filter-reinigen", parts: ["WF-FILTER-09"] },
    { guide: "waterinlaatventiel-vervangen", parts: ["WF-VALVE-06", "WF-VALVE-07"] },
    { guide: "verwarmingselement-vervangen", parts: ["WF-HEAT-05", "WF-HEAT-06", "WF-NTC-14"] },
  ];
  for (const link of guidePartLinks) {
    const guideId = guideMap.get(link.guide);
    if (!guideId) continue;
    for (const sku of link.parts) {
      const partId = partMap.get(sku);
      if (!partId) continue;
      await prisma.guideParts.create({
        data: { guideId, partId },
      });
    }
  }

  // Create demo admin user
  console.log("👤 Creating demo user...");
  await prisma.user.upsert({
    where: { email: "demo@wasfixpro.nl" },
    update: {},
    create: {
      email: "demo@wasfixpro.nl",
      name: "Demo User",
      role: "ADMIN",
      plan: "MONTEUR_PRO",
    },
  });

  console.log("✅ Seed complete!");
  console.log(`   ${MACHINES.length} machines, ${PARTS.length} parts, ${ERROR_CODES.length} error codes, ${REPAIR_GUIDES.length} guides`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
