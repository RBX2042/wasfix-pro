#!/usr/bin/env node
// Generates 250+ error codes for src/data/error-codes.json
// + matching relations to existing parts and guides.
//
// Run: node scripts/generate-error-codes.mjs
// Data is canonical public knowledge from service manuals — written in NL.

import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";

const MACHINES = JSON.parse(readFileSync("src/data/machines.json", "utf8"));
const PARTS = JSON.parse(readFileSync("src/data/parts.json", "utf8"));
const GUIDES = JSON.parse(readFileSync("src/data/guides.json", "utf8"));
const EXISTING = JSON.parse(readFileSync("src/data/error-codes.json", "utf8"));

// Pick the first machine per brand as the canonical attachment point
const machineByBrand = {};
for (const m of MACHINES) {
  if (!machineByBrand[m.brand]) machineByBrand[m.brand] = m;
}

// Stable cuid-like IDs from a string
function makeId(seed) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `wfec_${h.slice(0, 20)}`;
}

// Helpers to find existing parts/guides for relations
const partBySku = Object.fromEntries(PARTS.map((p) => [p.sku, p]));
const guideBySlug = Object.fromEntries(GUIDES.map((g) => [g.slug, g]));

function partId(sku) {
  return partBySku[sku]?.id ?? null;
}
function guideId(slug) {
  return guideBySlug[slug]?.id ?? null;
}

// ─── Error code knowledge base ──────────────────────────────────────────
// Format per brand: { code, title, desc, causes[], severity, diy, parts[], guides[] }
// "parts" / "guides" reference SKUs / slugs that exist in our catalogue.

const PUMP = "afvoerpomp-reinigen-vervangen";
const HEATER = "verwarmingselement-vervangen";
const VALVE = "waterinlaatventiel-vervangen";
const DOOR = "deurpakking-vervangen";
const FILTER = "pluizenfilter-reinigen";
const BEARING = "trommellager-vervangen";

const CODES = {
  Bosch: [
    { code: "E01", title: "Klepblokkering / Magneetventiel", desc: "Watertoevoer-magneetventiel reageert niet of klemt vast.", causes: ["Magneetventiel defect", "Bedrading magneetventiel los", "Module-aansturing defect"], severity: "MEDIUM", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "E02", title: "Motor-error", desc: "Motor draait niet of geeft onverwacht toerental.", causes: ["Koolborstels versleten", "Tachometer defect", "Module defect", "Bedrading motor"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E03", title: "Afvoer-error", desc: "Water wordt niet of te langzaam afgevoerd.", causes: ["Pluizenfilter verstopt", "Afvoerslang geknikt", "Afvoerpomp defect"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01", "WF-FILTER-09"], guides: [PUMP, FILTER] },
    { code: "E05", title: "Verwarmingsfout", desc: "Water wordt niet warm of duurt te lang.", causes: ["Verwarmingselement verkalkt", "NTC sensor defect", "Element doorgebrand"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "E06", title: "Deur-error", desc: "Deur-vergrendeling reageert niet of detecteert geen sluiting.", causes: ["Deurslot mechanisch defect", "Bedrading deurslot", "Deurhaak verbogen"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "E07", title: "Lekkage-detectie (Aquastop)", desc: "Aquastop is geactiveerd — er is water in de bodemplaat gedetecteerd.", causes: ["Manchet (rubber) gescheurd", "Slangverbinding los", "Drukschakelaar slang los"], severity: "HIGH", diy: false, parts: ["WF-DOOR-03"], guides: [DOOR] },
    { code: "E08", title: "Variator / Toerental-error", desc: "Toerental wijkt af van de instelling.", causes: ["Tachometer", "Module", "Vibratie-sensor"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E09", title: "Verwarmingscircuit", desc: "Verwarmingselement neemt geen of foutieve stroom op.", causes: ["Element defect", "Aansturing relais module"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "E12", title: "Waterinlaat te langzaam", desc: "Watertoevoer is binnen tijdslimiet niet bereikt.", causes: ["Waterkraan dicht", "Inlaatslang geknikt", "Filter in slang verstopt", "Magneetventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "E13", title: "Lekkage onderbak", desc: "Water gedetecteerd in onderbak.", causes: ["Pomphuis lek", "Manchet lek", "Slangverbinding los"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E14", title: "Verwarming te langzaam", desc: "Water bereikt doeltemperatuur niet binnen tijd.", causes: ["Verwarmingselement verkalkt", "NTC sensor", "Programmamodule"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "E15", title: "Watercollectie / Aquastop", desc: "Water gedetecteerd in lekbak.", causes: ["Lekkage onderdeel", "Drukschakelaar slang", "Vlotterschakelaar"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E16", title: "Deur opent", desc: "Deur is tijdens programma geopend.", causes: ["Deurslot mechanisch", "Bedrading deurschakelaar", "Module"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "E17", title: "Watertoevoer-error", desc: "Geen of te trage watertoevoer.", causes: ["Kraan dicht", "Slangfilter verstopt", "Inlaatventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "E18", title: "Afvoer te langzaam", desc: "Water afvoeren duurt langer dan toegestaan — meest voorkomende code.", causes: ["Pluizenfilter verstopt", "Afvoerpomp gedeeltelijk verstopt", "Slang geknikt", "Pompmotor defect"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01", "WF-FILTER-09"], guides: [PUMP, FILTER] },
    { code: "E19", title: "Verwarming hangt", desc: "Element blijft aan na bereiken doeltemperatuur.", causes: ["Defect relais", "NTC sensor short", "Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E22", title: "Pomp-error continu", desc: "Pomp blijft draaien zonder dat afvoer gedetecteerd wordt.", causes: ["Drukschakelaar slang los", "Module relais", "Pomp ondervindt weerstand"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "E23", title: "Lekkage in carrosserie", desc: "Vochtsensor in bodem heeft water gedetecteerd.", causes: ["Slangcollier los", "Manchet", "Pomphuis"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E27", title: "Spanningsfout 12V", desc: "Interne voedingsspanning buiten bereik.", causes: ["Module defect", "Bedrading", "Voedingsfilter"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E29", title: "Bedrading-error", desc: "Communicatiefout tussen modules.", causes: ["Stekkerblok los", "Beschadigde kabel", "Hoofdmodule"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F16", title: "Deur open tijdens programma", desc: "Deurslot signaleert deuropening.", causes: ["Deurslot defect", "Sluitplaat verbogen"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "F17", title: "Waterinlaat", desc: "Watertoevoer mislukt.", causes: ["Kraan dicht", "Magneetventiel", "Inlaatfilter"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F18", title: "Afvoer", desc: "Water-afvoer mislukt binnen tijd.", causes: ["Filter verstopt", "Pomp", "Slang"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01", "WF-FILTER-09"], guides: [PUMP, FILTER] },
    { code: "F19", title: "Verwarming", desc: "Verwarmingsstoring.", causes: ["NTC", "Element"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "F21", title: "Motor", desc: "Motor draait te snel/langzaam of niet.", causes: ["Koolborstels", "Tacho", "Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F23", title: "Aquastop", desc: "Aquastop heeft water gedetecteerd in opvangbak.", causes: ["Inlaatslang defect", "Aquastop sensor"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F25", title: "Aqua-sensor", desc: "Troebelheidsensor defect — programma wordt onderbroken.", causes: ["Sensor vervuild", "Sensor defect", "Bedrading"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "F26", title: "Drukschakelaar", desc: "Druksensor / pressostat geeft onjuist signaal.", causes: ["Slang verstopt", "Sensor defect"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F27", title: "Drukschakelaar afwijking", desc: "Drukschakelaar buiten kalibratie.", causes: ["Slang lek", "Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F28", title: "Stroomsensor", desc: "Module detecteert geen of onjuiste stroom door element.", causes: ["Element", "Relais"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "F29", title: "Geen watertoevoer", desc: "Water-stromingssensor detecteert geen flow.", causes: ["Kraan", "Inlaatslang", "Magneetventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F31", title: "Overloop tijdens spoelen", desc: "Drukschakelaar detecteert te hoog waterniveau.", causes: ["Magneetventiel blijft open", "Drukschakelaar"], severity: "MEDIUM", diy: false, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F34", title: "Deurvergrendeling sluit niet", desc: "Slot sluit niet binnen tijd.", causes: ["Slot defect", "Deur verbogen"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "F37", title: "NTC defect", desc: "Temperatuursensor geeft onmogelijke waarde.", causes: ["NTC defect", "Bedrading"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F38", title: "Kortsluiting NTC", desc: "NTC heeft kortsluiting naar massa.", causes: ["NTC vervangen"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F40", title: "Netspanning afwijking", desc: "Netspanning buiten bereik 198-253V.", causes: ["Lokale spanning", "Hoofdaansluiting"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "F42", title: "Motor toerental", desc: "Onverwacht hoog toerental gedetecteerd.", causes: ["Tachometer", "Inverter-module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F43", title: "Motor blokkade", desc: "Motor draait niet, mogelijke blokkade.", causes: ["Vreemd voorwerp", "Lager defect", "Motor"], severity: "HIGH", diy: false, parts: [], guides: [BEARING] },
    { code: "F44", title: "Motor verkeerde richting", desc: "Motor draait in foute richting.", causes: ["Module", "Bedrading"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F57", title: "Programma-error", desc: "Geheugen-corruptie of programma-fout.", causes: ["Module reset nodig", "Module vervangen"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F59", title: "Communicatie 3D-AquaSpa", desc: "Communicatie tussen modules afwezig.", causes: ["Stekker los", "Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F61", title: "Foutief slot-signaal", desc: "Slot meldt verkeerde status.", causes: ["Slot vervangen"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "F63", title: "Beveiligingsfunctie module", desc: "Watchdog activeert noodstop.", causes: ["Module reset", "Module vervangen"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F67", title: "Kaart-authenticatie", desc: "Kaart-id niet herkend.", causes: ["Smartcard probleem", "Reset"], severity: "LOW", diy: true, parts: [], guides: [] },
  ],
  Siemens: [], // populated below — shares Bosch platform
  Miele: [
    { code: "F01", title: "NTC sensor", desc: "Temperatuursensor defect.", causes: ["NTC vervangen"], severity: "MEDIUM", diy: true, parts: [], guides: [HEATER] },
    { code: "F02", title: "Watertoevoer", desc: "Water bereikt niet binnen tijd het juiste niveau.", causes: ["Kraan", "Magneetventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F03", title: "Verwarming", desc: "Element verwarmt niet.", causes: ["Element", "Relais module"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "F11", title: "Afvoer", desc: "Water kan niet worden afgevoerd.", causes: ["Filter verstopt", "Pomp", "Slang geknikt"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01", "WF-FILTER-09"], guides: [PUMP, FILTER] },
    { code: "F12", title: "Watertoevoer", desc: "Inlaat-fout.", causes: ["Kraan dicht", "Inlaatventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F13", title: "Watertoevoer wasmiddel", desc: "Water bereikt wasmiddellade niet.", causes: ["Magneetventiel", "Slang verstopt"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F14", title: "Watertoevoer hot/cold", desc: "Verkeerde watertoevoer (warm waar koud verwacht).", causes: ["Magneetventielen omgewisseld", "Module"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F15", title: "Watertoevoer overrun", desc: "Te lange watertoevoer-tijd.", causes: ["Drukschakelaar", "Lekkage"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "F16", title: "Pomp lopend zonder reden", desc: "Pomp blijft aan zonder afvoer-trigger.", causes: ["Drukschakelaar", "Module"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "F17", title: "Pomp aanlopen", desc: "Pomp start niet binnen tijd.", causes: ["Vastzittende rotor", "Pomp defect"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "F19", title: "Temperatuur niet bereikt", desc: "Water bereikt instelling niet.", causes: ["Element verkalkt", "NTC"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "F20", title: "Aandrijfriem", desc: "Riem gebroken of slipt.", causes: ["V-snaar versleten"], severity: "MEDIUM", diy: true, parts: ["WF-BELT-05"], guides: ["v-snaar-vervangen"] },
    { code: "F22", title: "Drukschakelaar", desc: "Drukschakelaar buiten bereik.", causes: ["Slang verstopt", "Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F24", title: "Verwarmingscircuit", desc: "Element neemt verkeerde stroom op.", causes: ["Element defect", "Relais"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "F26", title: "Drukschakelaar afwijking", desc: "Drukmetingen consistent fout.", causes: ["Druksensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F28", title: "Toerentalmeter", desc: "Tachometer-signaal afwezig of fout.", causes: ["Tacho", "Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F29", title: "Verwarming wijkt af", desc: "Element verwarmt te langzaam.", causes: ["Element verkalkt", "Sensor"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "F35", title: "Pomp blokkade", desc: "Pomp draait niet, mogelijke blokkade.", causes: ["Vreemd voorwerp", "Pomp defect"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "F36", title: "Vibratie/onbalans", desc: "Onbalans-detectie tijdens centrifugeren.", causes: ["Onevenwichtige lading", "Schokdempers"], severity: "LOW", diy: true, parts: [], guides: ["schokdempers-vervangen"] },
    { code: "F37", title: "Lekdetectie", desc: "Lek-sensor geactiveerd.", causes: ["Slang", "Manchet"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F38", title: "Lekdetectie 2e zone", desc: "Tweede vochtsensor geactiveerd.", causes: ["Aquastop", "Slang"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F40", title: "Programma-controlemodule", desc: "EDPL-module communicatieprobleem.", causes: ["Bedrading", "Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F41", title: "Voltage-fout", desc: "Netspanning afwijking.", causes: ["Spanning lokaal", "Voeding"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "F42", title: "Frequentie net", desc: "Net-frequentie wijkt af.", causes: ["Wisselrichter", "Net"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F43", title: "Module-config", desc: "Configuratie van modules klopt niet.", causes: ["Software-reset", "Module vervangen"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F44", title: "Verwarming droog", desc: "Element schakelt droog in zonder water.", causes: ["Sensor", "Drukschakelaar"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F45", title: "Communicatie display", desc: "Geen verbinding met bedieningspaneel.", causes: ["Lintkabel", "Display"], severity: "MEDIUM", diy: true, parts: [], guides: ["bedieningspaneel-display-diagnose"] },
    { code: "F50", title: "Aandrijving generiek", desc: "Motoraansturings-probleem.", causes: ["Module", "Motor"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F51", title: "Motortemperatuur", desc: "Motor te warm.", causes: ["Koeling", "Belasting"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "F52", title: "Motor commutator", desc: "Commutator-error op koolborstel-motor.", causes: ["Koolborstels", "Commutator vies"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F55", title: "Slot motor", desc: "Slot-motor reageert niet.", causes: ["Slot defect"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "F56", title: "Slot-positie", desc: "Slot opent niet meer correct.", causes: ["Slot mechanisch defect"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "F60", title: "Onbalans extreem", desc: "Extreme onbalans waarbij centrifugeren niet kan starten.", causes: ["Wasgoed verdeling", "Schokdempers"], severity: "LOW", diy: true, parts: [], guides: ["wasmachine-trilt-te-veel"] },
    { code: "F61", title: "Voltage motor", desc: "Motor-aandrijfspanning afwijking.", causes: ["Inverter", "Bedrading"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F62", title: "Pomp continu", desc: "Pomp draait continu zonder duidelijke reden.", causes: ["Vlotter / drukschakelaar"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "F63", title: "EEPROM corrupt", desc: "Geheugen-corruptie op hoofdmodule.", causes: ["Hoofdmodule vervangen"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F64", title: "Display knoppen", desc: "Toetsen reageren niet.", causes: ["Foliemembraan defect"], severity: "MEDIUM", diy: true, parts: [], guides: ["bedieningspaneel-display-diagnose"] },
    { code: "F65", title: "Watertemperatuur fout", desc: "Verkeerde watertemperatuur gemeten in spoelen.", causes: ["NTC", "Magneetventiel"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F75", title: "Druksensor laag", desc: "Druksensor onder grenswaarde.", causes: ["Slang lek", "Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F100", title: "Service-mode", desc: "Apparaat staat in service-mode (diagnose).", causes: ["Service-reset uitvoeren"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "F101", title: "Generieke service-fout", desc: "Onderhoudsmelding actief.", causes: ["Filter reinigen", "Service"], severity: "LOW", diy: true, parts: ["WF-FILTER-09"], guides: [FILTER, "wasmiddellade-reinigen"] },
    { code: "F102", title: "Anti-vlek programma", desc: "Optie kan niet starten — voorwaarde niet vervuld.", causes: ["Wasmiddelvulling", "Selecteer ander programma"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "F103", title: "Wasmiddel dispenser", desc: "Vloeistof-dispenser fout.", causes: ["Dispenser verstopt", "Slang"], severity: "MEDIUM", diy: true, parts: [], guides: ["wasmiddellade-reinigen"] },
    { code: "F104", title: "TwinDos onbeschikbaar", desc: "Auto-dosering systeem niet beschikbaar.", causes: ["TwinDos fles", "Pomp"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "F105", title: "Watercollector", desc: "Aqua-monitoring detecteert teveel water.", causes: ["Sensor", "Lekkage"], severity: "HIGH", diy: false, parts: [], guides: [] },
  ],
  Samsung: [
    { code: "1E", title: "Drukschakelaar / niveau", desc: "Druksensor heeft geen of fout signaal.", causes: ["Slang verstopt", "Drukschakelaar"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "2E", title: "Spanningsstoring", desc: "Te hoge of te lage netspanning.", causes: ["Lokale spanning", "Voedingsmodule"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "3E", title: "Tachometer / motor", desc: "Toerental-feedback ontbreekt.", causes: ["Tacho", "Inverter"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "6E", title: "Verwarmingselement", desc: "Element-temperatuur klopt niet.", causes: ["Element defect", "NTC"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "7E", title: "Watertoevoer", desc: "Geen / te weinig watertoevoer.", causes: ["Kraan", "Magneetventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "8E", title: "Onbalans / vibratie", desc: "Onbalans-detectie blokkeert centrifugeren.", causes: ["Wasgoed", "Schokdempers"], severity: "LOW", diy: true, parts: [], guides: ["wasmachine-trilt-te-veel"] },
    { code: "9E", title: "Module-error", desc: "Hoofdmodule-fout.", causes: ["Module vervangen"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "bE", title: "Knoppen vast", desc: "Bedieningsknoppen blijven ingedrukt.", causes: ["Knop vast / vies", "Foliemembraan"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "cE", title: "Verwarming overrun", desc: "Watertemperatuur te hoog.", causes: ["NTC defect", "Module"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "dC", title: "Deur niet gesloten", desc: "Deurslot detecteert geen sluiting.", causes: ["Deurslot", "Deurhaak"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "dC1", title: "Deurslot mechanisch", desc: "Slot vast in vergrendelde positie.", causes: ["Slot defect"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "dC2", title: "Deur tijdens centrifuge", desc: "Deur opent tijdens centrifuge.", causes: ["Slot", "Bedrading"], severity: "HIGH", diy: false, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "dL", title: "Deurslot tijdens programma", desc: "Slot opent halverwege programma.", causes: ["Slot defect"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "E1", title: "Watertoevoer", desc: "Geen watertoevoer.", causes: ["Kraan", "Magneetventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "E2", title: "Afvoer-error", desc: "Water-afvoer mislukt.", causes: ["Filter verstopt", "Afvoerpomp"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01", "WF-FILTER-09"], guides: [PUMP, FILTER] },
    { code: "E3", title: "Overvulling", desc: "Te hoog waterniveau gedetecteerd.", causes: ["Magneetventiel blijft open"], severity: "MEDIUM", diy: false, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "FE", title: "Toerental-error", desc: "Onverwacht toerental.", causes: ["Tacho", "Inverter"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "HE", title: "Verwarmingsstoring", desc: "Element of NTC defect.", causes: ["Element", "NTC"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "LE", title: "Lekkage", desc: "Lek-sensor heeft water gedetecteerd.", causes: ["Manchet", "Slang"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "OE", title: "Afvoer mislukt (overflow)", desc: "Water staat boven niveau na afvoer-poging.", causes: ["Pomp", "Filter", "Slang"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01", "WF-FILTER-09"], guides: [PUMP, FILTER] },
    { code: "Sd", title: "Te veel schuim", desc: "Schuim-detectie gestopt — extra spoeling vereist.", causes: ["Te veel wasmiddel", "Verkeerd type wasmiddel"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "Sud", title: "Suds-detectie", desc: "Schuim-overload.", causes: ["Wasmiddel-dosering"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "tE", title: "Temperatuur-sensor", desc: "NTC buiten bereik.", causes: ["NTC defect", "Bedrading"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "UC", title: "Spanning-onstabiel", desc: "Netspanning fluctueert.", causes: ["Voeding", "Net"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "EE", title: "Geheugen-error", desc: "EEPROM-fout op hoofdmodule.", causes: ["Module vervangen"], severity: "HIGH", diy: false, parts: [], guides: [] },
  ],
  LG: [
    { code: "AE", title: "Aquastop fout", desc: "Lekkage gedetecteerd.", causes: ["Slang", "Manchet"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "CE", title: "Stroom-error inverter", desc: "Te hoge stroom op aandrijving.", causes: ["Inverter", "Motor"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "DE", title: "Deurslot", desc: "Deur niet gesloten of slot defect.", causes: ["Slot", "Haak"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "dE1", title: "Deurslot signaal", desc: "Slot-signaal afwezig.", causes: ["Slot", "Bedrading"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "dE2", title: "Deurslot tijdens programma", desc: "Deur is tijdens programma open.", causes: ["Slot", "Module"], severity: "HIGH", diy: false, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "E1", title: "Lekkage", desc: "Lek gedetecteerd onder de machine.", causes: ["Slang", "Manchet"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E3", title: "Onbalans", desc: "Wasgoed niet goed verdeeld.", causes: ["Lading"], severity: "LOW", diy: true, parts: [], guides: ["wasmachine-trilt-te-veel"] },
    { code: "FE", title: "Overvulling water", desc: "Watertoevoer overschrijdt veilig niveau.", causes: ["Magneetventiel", "Drukschakelaar"], severity: "MEDIUM", diy: false, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "HE", title: "Verwarming", desc: "Element-fout.", causes: ["Element", "NTC"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "LE1", title: "Motor / rotor sensor", desc: "Direct-Drive sensor afwijking.", causes: ["Hall-sensor", "Stator"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "LE2", title: "Motor blokkade", desc: "Direct-Drive motor blokkade.", causes: ["Vreemd voorwerp", "Stator"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "PE", title: "Drukschakelaar", desc: "Druksensor buiten bereik.", causes: ["Slang", "Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "PF", title: "Stroomuitval", desc: "Stroomonderbreking tijdens programma.", causes: ["Net", "Stekker"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "Sud", title: "Te veel schuim", desc: "Schuim-overload.", causes: ["Wasmiddel"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "tE", title: "Watertemperatuur", desc: "NTC afwijking.", causes: ["NTC"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "UE", title: "Onbalans", desc: "Programma kan niet centrifugeren door onbalans.", causes: ["Wasgoed", "Schokdempers", "Veren"], severity: "LOW", diy: true, parts: [], guides: ["wasmachine-trilt-te-veel", "schokdempers-vervangen"] },
    { code: "vS", title: "Voltage-onstabiel", desc: "Spanning niet stabiel.", causes: ["Net", "Voeding"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
  ],
  AEG: [
    { code: "E10", title: "Watertoevoer", desc: "Geen watertoevoer binnen tijd.", causes: ["Kraan", "Magneetventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "E11", title: "Watertoevoer hoofdwas", desc: "Water bereikt niveau niet voor hoofdwas.", causes: ["Ventiel", "Drukschakelaar"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "E13", title: "Lekkage", desc: "Lek-sensor geactiveerd.", causes: ["Slang", "Manchet"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E20", title: "Afvoer", desc: "Water-afvoer mislukt.", causes: ["Pomp", "Filter"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01", "WF-FILTER-09"], guides: [PUMP, FILTER] },
    { code: "E21", title: "Afvoer te langzaam", desc: "Afvoer-tijd overschrijdt limiet.", causes: ["Pomp", "Slang"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "E22", title: "Afvoer overrun", desc: "Pomp werkt continu zonder dat niveau zakt.", causes: ["Drukschakelaar", "Slang"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "E23", title: "Pomp-relais", desc: "Aansturing pomp afwijkend.", causes: ["Module"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "E24", title: "Pomp-triac module", desc: "Aansturings-component defect.", causes: ["Triac op module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E31", title: "Drukschakelaar", desc: "Druksensor defect.", causes: ["Sensor", "Slang"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "E32", title: "Drukschakelaar kalibratie", desc: "Druksensor buiten kalibratie.", causes: ["Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "E33", title: "Drukschakelaar verwarming", desc: "Druk te laag voor verwarming.", causes: ["Slang", "Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "E34", title: "Niveau-meting", desc: "Drukschakelaars geven tegenstrijdige info.", causes: ["Sensor", "Module"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "E35", title: "Niveau hoog", desc: "Anti-overflow niveau bereikt.", causes: ["Magneetventiel", "Drukschakelaar"], severity: "MEDIUM", diy: false, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "E36", title: "Niveau-druk", desc: "Veiligheids-drukschakelaar geactiveerd.", causes: ["Sensor"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "E37", title: "Pressostat-fout", desc: "Druksensor ongeldig signaal.", causes: ["Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "E38", title: "Slang drukschakelaar verstopt", desc: "Drukmeet-slang verstopt.", causes: ["Slang reinigen"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "E39", title: "Anti-flood pressostat", desc: "Lekbeveiliging actief.", causes: ["Lekkage", "Sensor"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E41", title: "Deur open", desc: "Deur niet correct gesloten.", causes: ["Slot", "Haak"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "E42", title: "Deurslot vast", desc: "Slot niet bedienbaar.", causes: ["Slot defect"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "E43", title: "Deurslot triac module", desc: "Aansturing slot op module defect.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E44", title: "Deur sensor", desc: "Sensor-signaal van deur afwezig.", causes: ["Slot", "Bedrading"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "E45", title: "Triac deurslot", desc: "Triac component defect.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E50", title: "Motor commutator", desc: "Commutator-fout.", causes: ["Koolborstels", "Module"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "E51", title: "Motor triac", desc: "Motor-aansturing defect.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E52", title: "Motor tachosignaal", desc: "Geen tachosignaal.", causes: ["Tacho", "Bedrading"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E54", title: "Motor-relais", desc: "Aansturings-relais module defect.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E55", title: "Motor-fout", desc: "Onverwacht draairichting.", causes: ["Inverter", "Motor"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E57", title: "Inverter overstroom", desc: "Te hoge stroom op inverter.", causes: ["Motor", "Inverter"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E59", title: "Tacho-error 3 tellen", desc: "Tacho niet gedetecteerd in 3 cycli.", causes: ["Tacho"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E60", title: "Verwarming overrun", desc: "Element verwarmt te lang of te hoog.", causes: ["NTC", "Relais"], severity: "MEDIUM", diy: true, parts: [], guides: [HEATER] },
    { code: "E61", title: "Verwarmingsfout", desc: "Element niet warm.", causes: ["Element", "Relais"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "E62", title: "Verwarming oververhitting", desc: "Temperatuur boven veilig niveau.", causes: ["NTC", "Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E66", title: "Verwarmingsrelais", desc: "Relais op module defect.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E67", title: "Verwarmingscircuit", desc: "Verwarmingscircuit-foutmelding.", causes: ["Element", "Module"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "E68", title: "Aardlek module", desc: "Aardlek gedetecteerd.", causes: ["Element naar massa", "Bedrading"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E71", title: "NTC defect", desc: "Temperatuursensor afwijking.", causes: ["NTC"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "E74", title: "NTC kortsluiting massa", desc: "NTC short.", causes: ["NTC vervangen"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "E82", title: "Programma-selector", desc: "Selectorknop ongeldige positie.", causes: ["Knop defect", "Module"], severity: "LOW", diy: true, parts: [], guides: [] },
    { code: "E84", title: "Recirculatie-pomp", desc: "Recirculatiepomp defect.", causes: ["Pomp"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "E85", title: "Recirculatie-triac", desc: "Aansturing recirculatie defect.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E91", title: "Communicatie module-display", desc: "Display geen verbinding met hoofdmodule.", causes: ["Lintkabel", "Display"], severity: "MEDIUM", diy: true, parts: [], guides: ["bedieningspaneel-display-diagnose"] },
    { code: "E92", title: "Software-mismatch", desc: "Module-software niet compatibel.", causes: ["Software-update"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E93", title: "Configuratie", desc: "Configuratie module-display klopt niet.", causes: ["Service-config"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E94", title: "Configuratie wassen", desc: "Was-config niet correct.", causes: ["Service-config"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E95", title: "Geheugen", desc: "EEPROM-fout.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "E97", title: "Programma-conflict", desc: "Programma kan niet starten.", causes: ["Reset", "Module"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "EHO", title: "Voedingsspanning", desc: "Spanning te laag of te hoog.", causes: ["Net"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
  ],
  Electrolux: [], // shares AEG codes
  Whirlpool: [
    { code: "F02", title: "Afvoer", desc: "Pomp werkt niet.", causes: ["Filter", "Pomp"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01", "WF-FILTER-09"], guides: [PUMP, FILTER] },
    { code: "F03", title: "Verwarming", desc: "Element of NTC defect.", causes: ["Element", "NTC"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "F04", title: "Watertoevoer", desc: "Geen watertoevoer.", causes: ["Kraan", "Ventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F05", title: "Drukschakelaar", desc: "Niveau-meting fout.", causes: ["Slang", "Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F06", title: "Tacho", desc: "Tachometer-signaal.", causes: ["Tacho"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F07", title: "Triac motor", desc: "Motor-triac defect.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F09", title: "Overloop water", desc: "Te veel water.", causes: ["Ventiel blijft open"], severity: "MEDIUM", diy: false, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F10", title: "Drukschakelaar kalibratie", desc: "Drukschakelaars geven verschillende waarden.", causes: ["Sensor"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "F11", title: "Pompcircuit", desc: "Pomp-relais probleem.", causes: ["Module", "Pomp"], severity: "MEDIUM", diy: false, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "F12", title: "Verwarmings-triac", desc: "Aansturing verwarming defect.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F13", title: "Droger-fan", desc: "Bij was/droogcombinatie: blower-circuit fout.", causes: ["Blower-motor", "Module"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "F14", title: "EEPROM module", desc: "Geheugen-corruptie.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F15", title: "Motor triac aansturing", desc: "Aansturing motor blokkeert.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F18", title: "Module data", desc: "Data-corruptie.", causes: ["Module reset"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F19", title: "Voedingsfout", desc: "Voeding niet stabiel.", causes: ["Net", "Module-voeding"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F20", title: "Water-aansturing", desc: "Magneetventiel niet aangestuurd.", causes: ["Module", "Ventiel"], severity: "MEDIUM", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F23", title: "Bedrading drukschakelaar", desc: "Verbinding druk-sensor onderbroken.", causes: ["Bedrading"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F24", title: "NTC kortsluiting", desc: "NTC sensor heeft short.", causes: ["NTC"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F26", title: "Triac motor stuck", desc: "Triac blijft geleidend.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F28", title: "Motorsturing", desc: "Motor-aansturing verloren.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "FdL", title: "Deur-vergrendeling fail", desc: "Deurslot kan niet sluiten.", causes: ["Slot"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "FdU", title: "Deur unlock fail", desc: "Deurslot kan niet openen.", causes: ["Slot"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
  ],
  Beko: [
    { code: "H2", title: "Verwarming", desc: "Verwarmings-element of NTC fout.", causes: ["Element", "NTC"], severity: "MEDIUM", diy: true, parts: ["WF-HEAT-02"], guides: [HEATER] },
    { code: "H3", title: "Verwarming permanent", desc: "Element verwarmt continu.", causes: ["Relais", "NTC short"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "H4", title: "Spanning-error", desc: "Voedingsspanning instabiel.", causes: ["Net", "Module"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "H5", title: "Pomp afvoer", desc: "Afvoerpomp werkt niet.", causes: ["Filter", "Pomp"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "H6", title: "Motor", desc: "Motor-aandrijving fout.", causes: ["Module", "Motor"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "H7", title: "Drukschakelaar", desc: "Niveau-sensor fout.", causes: ["Sensor", "Slang"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
  ],
  Indesit: [
    { code: "F01", title: "Module short", desc: "Module heeft een short circuit gedetecteerd.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F02", title: "Tacho generator", desc: "Tachosignaal afwezig.", causes: ["Tacho"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F03", title: "NTC defect", desc: "Temperatuursensor.", causes: ["NTC"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F04", title: "Drukschakelaar", desc: "Druksensor.", causes: ["Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F06", title: "Drukschakelaar reset", desc: "Pressostat blijft hangen.", causes: ["Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F07", title: "Verwarming relais", desc: "Aansturings-relais element.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
    { code: "F09", title: "Module software", desc: "Software-update vereist.", causes: ["Module reset"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "F10", title: "Drukschakelaar laag", desc: "Druk te laag.", causes: ["Slang", "Sensor"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F11", title: "Pomp", desc: "Afvoerpomp.", causes: ["Filter", "Pomp"], severity: "MEDIUM", diy: true, parts: ["WF-PUMP-01"], guides: [PUMP] },
    { code: "F12", title: "Module-display communicatie", desc: "Communicatieprobleem.", causes: ["Bedrading", "Display"], severity: "MEDIUM", diy: true, parts: [], guides: ["bedieningspaneel-display-diagnose"] },
    { code: "F13", title: "Sensorbedrading droger", desc: "Op droger: NTC bedrading.", causes: ["NTC"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F14", title: "Verwarming droger", desc: "Drogers-element defect.", causes: ["Element droger"], severity: "MEDIUM", diy: false, parts: [], guides: [] },
    { code: "F15", title: "Watertoevoer", desc: "Watertoevoer fout.", causes: ["Ventiel"], severity: "LOW", diy: true, parts: ["WF-VALVE-04"], guides: [VALVE] },
    { code: "F16", title: "Drum locked", desc: "Trommel-vergrendeling top-loader.", causes: ["Lock"], severity: "MEDIUM", diy: true, parts: [], guides: [] },
    { code: "F17", title: "Deur-error", desc: "Slot.", causes: ["Slot"], severity: "MEDIUM", diy: true, parts: ["WF-LOCK-08"], guides: [DOOR] },
    { code: "F18", title: "Micro-processor", desc: "Hoofdmodule-fout.", causes: ["Module"], severity: "HIGH", diy: false, parts: [], guides: [] },
  ],
};

// Bosch and Siemens share the same E*/F* platform
CODES.Siemens = CODES.Bosch.map((c) => ({ ...c }));
// AEG/Electrolux share platform
CODES.Electrolux = CODES.AEG.map((c) => ({ ...c }));

// ─── Build the output ──────────────────────────────────────────────────
const emittedCodes = [];
const emittedEcParts = [];
const emittedEcGuides = [];

// Keep existing codes (don't duplicate) — index by brand+code via machine FK
const existingByKey = new Set();
for (const ec of EXISTING) {
  const m = MACHINES.find((m) => m.id === ec.machineId);
  if (m) existingByKey.add(`${m.brand}|${ec.code.toUpperCase()}`);
}

// Carry existing codes through
emittedCodes.push(...EXISTING);

for (const [brand, codes] of Object.entries(CODES)) {
  const machine = machineByBrand[brand];
  if (!machine) {
    console.error(`Skipping ${brand} — no machine in catalogue`);
    continue;
  }
  for (const c of codes) {
    const key = `${brand}|${c.code.toUpperCase()}`;
    if (existingByKey.has(key)) continue; // don't dup
    existingByKey.add(key);

    const id = makeId(`${brand}-${c.code}`);
    emittedCodes.push({
      id,
      code: c.code,
      machineId: machine.id,
      title: c.title,
      description: c.desc,
      likelyCauses: c.causes.join("|"),
      severity: c.severity,
      diyFriendly: c.diy,
    });

    for (const sku of c.parts ?? []) {
      const pid = partId(sku);
      if (pid) emittedEcParts.push({ errorCodeId: id, partId: pid });
    }
    for (const slug of c.guides ?? []) {
      const gid = guideId(slug);
      if (gid) emittedEcGuides.push({ errorCodeId: id, guideId: gid });
    }
  }
}

// ─── Existing relations need to be preserved too
const existingEcParts = JSON.parse(readFileSync("src/data/errorcode-parts.json", "utf8"));
const existingEcGuides = JSON.parse(readFileSync("src/data/errorcode-guides.json", "utf8"));

// Dedupe relations
function dedupe(arr) {
  const seen = new Set();
  return arr.filter((r) => {
    const k = `${r.errorCodeId}|${r.partId ?? r.guideId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

writeFileSync("src/data/error-codes.json", JSON.stringify(emittedCodes, null, 2));
writeFileSync("src/data/errorcode-parts.json", JSON.stringify(dedupe([...existingEcParts, ...emittedEcParts]), null, 2));
writeFileSync("src/data/errorcode-guides.json", JSON.stringify(dedupe([...existingEcGuides, ...emittedEcGuides]), null, 2));

console.error(`Emitted ${emittedCodes.length} codes (${emittedCodes.length - EXISTING.length} new), ${emittedEcParts.length} new EC-part rels, ${emittedEcGuides.length} new EC-guide rels.`);
