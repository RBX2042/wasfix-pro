#!/usr/bin/env node
// Generate 80+ parts catalogue entries for src/data/parts.json
// + relations to machines via src/data/part-machine.json

import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";

const MACHINES = JSON.parse(readFileSync("src/data/machines.json", "utf8"));
const EXISTING_PARTS = JSON.parse(readFileSync("src/data/parts.json", "utf8"));
const EXISTING_PM = JSON.parse(readFileSync("src/data/part-machine.json", "utf8"));

function makeId(seed) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `wfpart_${h.slice(0, 20)}`;
}

const machinesByBrand = {};
for (const m of MACHINES) {
  (machinesByBrand[m.brand] ??= []).push(m);
}

// img placeholder helper — uses placehold.co
function img(label, color = "1a6b6b") {
  const txt = encodeURIComponent(label.slice(0, 40));
  return `https://placehold.co/800x800/${color}/ffffff/png?text=${txt}&font=oswald`;
}

// ─── Parts catalogue ──────────────────────────────────────────────────
// Categories: PUMP, MOTOR, BEARING, BELT, BOARD, LOCK, DAMPER, VALVE,
// HEATER, NTC, DOOR, FILTER, KNOB, PANEL, HOSE, SEAL

const PARTS = [
  // ── Pumps (per brand-platform) ────────────────────────────────────
  { sku: "WF-PUMP-02", name: "Afvoerpomp Askoll M50 30W", category: "PUMP", brand: "Universeel", priceEur: 32.50, stock: 24, isOriginal: false, description: "Universele afvoerpomp 30W met 5 schoepen, draairichting links. Past op de meeste Bosch/Siemens/Constructa wasmachines met 4-pins connector. Vervangt origineel onderdeel zoals 145212, 144978.", oemNumbers: ["145212", "144978", "144486"], compatibleBrands: ["Bosch", "Siemens"], color: "5d97ff" },
  { sku: "WF-PUMP-03", name: "Afvoerpomp Plaset 60W (Miele)", category: "PUMP", brand: "Miele", priceEur: 89.00, stock: 12, isOriginal: true, description: "Originele Miele afvoerpomp 60W voor W1/W2/W3 series. Hogere capaciteit voor diepere centrifuges. Inclusief afdichtringen.", oemNumbers: ["6239562", "6239561"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-PUMP-04", name: "Afvoerpomp Hanyu 30W (Samsung)", category: "PUMP", brand: "Samsung", priceEur: 38.90, stock: 18, isOriginal: true, description: "Originele Samsung afvoerpomp voor EcoBubble en WW-series. 2-pins connector, draairichting links.", oemNumbers: ["DC31-00054A"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-PUMP-05", name: "Afvoerpomp LG (Direct Drive)", category: "PUMP", brand: "LG", priceEur: 42.00, stock: 14, isOriginal: true, description: "Originele LG afvoerpomp met geïntegreerde anti-blokkeerring. Voor F-serie Direct Drive wasmachines.", oemNumbers: ["5859ER1006K", "5859ER1006A"], compatibleBrands: ["LG"], color: "9f1c1c" },
  { sku: "WF-PUMP-06", name: "Afvoerpomp AEG Electrolux 25W", category: "PUMP", brand: "AEG", priceEur: 36.50, stock: 22, isOriginal: true, description: "Origineel AEG/Electrolux afvoerpomp 25W. Past op L-serie en LR-serie wasmachines.", oemNumbers: ["1326630009", "8581326630016"], compatibleBrands: ["AEG", "Electrolux", "Zanussi"], color: "353535" },
  { sku: "WF-PUMP-07", name: "Afvoerpomp Whirlpool/Indesit 30W", category: "PUMP", brand: "Whirlpool", priceEur: 28.50, stock: 30, isOriginal: false, description: "Universele afvoerpomp voor Whirlpool, Indesit, Hotpoint, Ariston. 4-pins connector.", oemNumbers: ["481010585015", "C00141034"], compatibleBrands: ["Whirlpool", "Indesit", "Hotpoint"], color: "0064bf" },
  { sku: "WF-PUMP-08", name: "Recirculatiepomp universeel", category: "PUMP", brand: "Universeel", priceEur: 54.00, stock: 9, isOriginal: false, description: "Recirculatie / spray-pomp voor moderne wasmachines. Verbeterde wasprestatie door waterspatpatroon op de trommel.", oemNumbers: [], compatibleBrands: ["AEG", "Bosch", "Siemens", "Miele"], color: "5d97ff" },

  // ── Bearings ──────────────────────────────────────────────────────
  { sku: "WF-BEAR-01", name: "Trommellager 6203 ZZ", category: "BEARING", brand: "Universeel", priceEur: 8.50, stock: 80, isOriginal: false, description: "Hoogwaardig SKF 6203 ZZ kogellager. Standaard maat voor veel oudere wasmachines (jaren 90-2010). Per stuk geleverd — bij vervanging altijd beide lagers + asafdichting vervangen.", oemNumbers: ["6203-ZZ", "6203 2RS"], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-BEAR-02", name: "Trommellager 6204 ZZ", category: "BEARING", brand: "Universeel", priceEur: 9.20, stock: 75, isOriginal: false, description: "SKF 6204 ZZ kogellager. Gemeengoed voor Bosch/Siemens en LG. Per stuk — vervang in paar.", oemNumbers: ["6204-ZZ"], compatibleBrands: ["Bosch", "Siemens", "LG"], color: "5d97ff" },
  { sku: "WF-BEAR-03", name: "Trommellager 6205 ZZ", category: "BEARING", brand: "Universeel", priceEur: 10.50, stock: 60, isOriginal: false, description: "SKF 6205 ZZ. Veel toegepast op Bosch/Siemens medium-load wasmachines.", oemNumbers: ["6205-ZZ"], compatibleBrands: ["Bosch", "Siemens", "AEG"], color: "5d97ff" },
  { sku: "WF-BEAR-04", name: "Trommellager 6206 ZZ", category: "BEARING", brand: "Universeel", priceEur: 12.00, stock: 50, isOriginal: false, description: "SKF/FAG 6206 ZZ kogellager. Voor zwaardere belasting (8-10kg machines).", oemNumbers: ["6206-ZZ"], compatibleBrands: ["Miele", "Whirlpool"], color: "5d97ff" },
  { sku: "WF-BEAR-05", name: "Trommellager 6306 ZZ (Miele)", category: "BEARING", brand: "Miele", priceEur: 28.00, stock: 25, isOriginal: true, description: "Originele Miele lager voor W1/W2 serie. Zwaarder uitgevoerd voor langere levensduur.", oemNumbers: ["6306-2RS"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-BEAR-06", name: "Asafdichting trommel 40x72x10", category: "SEAL", brand: "Universeel", priceEur: 14.50, stock: 70, isOriginal: false, description: "Trommel-as afdichtring (oliekeerring) 40x72x10mm. Verplicht bij lager-vervanging. Vetbestendig, hittebestendig tot 90°C.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },

  // ── Belts ─────────────────────────────────────────────────────────
  { sku: "WF-BELT-06", name: "V-snaar 1196 J5 EL", category: "BELT", brand: "Universeel", priceEur: 12.50, stock: 60, isOriginal: false, description: "V-snaar 1196mm met 5 ribbels, ElastoTec. Voor wasmachines met indirecte aandrijving. Past op veel oudere Bosch/Siemens/AEG modellen.", oemNumbers: ["1196 J5"], compatibleBrands: ["Bosch", "Siemens", "AEG"], color: "353535" },
  { sku: "WF-BELT-07", name: "V-snaar 1270 J5", category: "BELT", brand: "Universeel", priceEur: 13.00, stock: 55, isOriginal: false, description: "V-snaar 1270mm 5 ribbels. Voor Whirlpool/Indesit en sommige Bosch modellen.", oemNumbers: ["1270 J5"], compatibleBrands: ["Whirlpool", "Indesit"], color: "353535" },
  { sku: "WF-BELT-08", name: "V-snaar 1280 J5", category: "BELT", brand: "Universeel", priceEur: 13.50, stock: 50, isOriginal: false, description: "V-snaar 1280mm 5 ribbels.", oemNumbers: ["1280 J5"], compatibleBrands: ["Universeel"], color: "353535" },
  { sku: "WF-BELT-09", name: "V-snaar 1290 J5", category: "BELT", brand: "Universeel", priceEur: 13.50, stock: 50, isOriginal: false, description: "V-snaar 1290mm 5 ribbels. Voor moderne high-efficiency machines.", oemNumbers: ["1290 J5"], compatibleBrands: ["Universeel"], color: "353535" },
  { sku: "WF-BELT-10", name: "V-snaar 1885 H7", category: "BELT", brand: "Universeel", priceEur: 16.50, stock: 35, isOriginal: false, description: "V-snaar 1885mm 7 ribbels (H-profiel). Voor industriële en grotere capaciteit machines.", oemNumbers: ["1885 H7"], compatibleBrands: ["Whirlpool"], color: "353535" },

  // ── Motors ────────────────────────────────────────────────────────
  { sku: "WF-MOTOR-13", name: "Universele koolmotor 380W", category: "MOTOR", brand: "Universeel", priceEur: 89.00, stock: 12, isOriginal: false, description: "Universele wasmachinemotor met koolborstels, 380W. 4-pins connector. Geschikt voor de meeste merken met indirecte aandrijving (riem). Inclusief borstels.", oemNumbers: [], compatibleBrands: ["Bosch", "Siemens", "AEG", "Whirlpool"], color: "5d97ff" },
  { sku: "WF-MOTOR-14", name: "Inverter motor Samsung DD", category: "MOTOR", brand: "Samsung", priceEur: 195.00, stock: 4, isOriginal: true, description: "Originele Samsung Direct Drive inverter motor voor EcoBubble en moderne WW-series. 8-pins connector.", oemNumbers: ["DC93-00322A"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-MOTOR-15", name: "Whirlpool koolmotor 320W", category: "MOTOR", brand: "Whirlpool", priceEur: 92.00, stock: 8, isOriginal: true, description: "Origineel Whirlpool wasmachine-motor met koolborstels, 320W.", oemNumbers: ["481236158340"], compatibleBrands: ["Whirlpool", "Indesit"], color: "0064bf" },
  { sku: "WF-MOTOR-16", name: "AEG inverter motor 1300rpm", category: "MOTOR", brand: "AEG", priceEur: 215.00, stock: 5, isOriginal: true, description: "Originele AEG inverter motor voor L7 en L8 series. Permanent-magneet motor zonder koolborstels.", oemNumbers: ["1327542017"], compatibleBrands: ["AEG", "Electrolux"], color: "353535" },
  { sku: "WF-MOTOR-17", name: "Koolborstel-set universeel 5x12.5mm", category: "MOTOR", brand: "Universeel", priceEur: 9.50, stock: 100, isOriginal: false, description: "Set van 2 koolborstels 5x12.5x32mm met houder. Past op de meeste universele wasmachinemotoren. Vervang in paar.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },

  // ── Boards / Electronics ──────────────────────────────────────────
  { sku: "WF-BOARD-09", name: "Hoofdmodule Bosch EDW-platform", category: "BOARD", brand: "Bosch", priceEur: 219.00, stock: 3, isOriginal: true, description: "Originele Bosch besturingsprint voor EDW-platform (Serie 4, 6). Geprogrammeerd of leeg leverbaar — geef serienummer door bij bestelling.", oemNumbers: ["00657090"], compatibleBrands: ["Bosch", "Siemens"], color: "1a6b6b" },
  { sku: "WF-BOARD-10", name: "Display module Bosch Serie 6", category: "BOARD", brand: "Bosch", priceEur: 145.00, stock: 5, isOriginal: true, description: "Origineel display + bedieningspaneel voor Bosch Serie 6 WAT/WAU 2018-2024.", oemNumbers: ["00646014"], compatibleBrands: ["Bosch"], color: "1a6b6b" },
  { sku: "WF-BOARD-11", name: "Hoofdmodule Miele EDPL", category: "BOARD", brand: "Miele", priceEur: 295.00, stock: 2, isOriginal: true, description: "Originele Miele EDPL elektronicamodule voor W1 Classic-serie. Vervanging met service-config tool.", oemNumbers: ["10527571"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-BOARD-12", name: "AEG EWM hoofdmodule", category: "BOARD", brand: "AEG", priceEur: 189.00, stock: 4, isOriginal: true, description: "AEG EWM2300 hoofdmodule. Voor L7/L8-serie. Inclusief montage-handleiding.", oemNumbers: ["973914912320001"], compatibleBrands: ["AEG", "Electrolux"], color: "353535" },
  { sku: "WF-BOARD-13", name: "Whirlpool 8 Sense module", category: "BOARD", brand: "Whirlpool", priceEur: 169.00, stock: 3, isOriginal: true, description: "Whirlpool 8 Sense / FFD-serie hoofdmodule.", oemNumbers: ["481010743440"], compatibleBrands: ["Whirlpool"], color: "0064bf" },
  { sku: "WF-BOARD-14", name: "Samsung PCB EcoBubble", category: "BOARD", brand: "Samsung", priceEur: 175.00, stock: 4, isOriginal: true, description: "Samsung EcoBubble PCB / hoofdprint. Voor WW-serie 2020-2024.", oemNumbers: ["DC92-01803A"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-BOARD-15", name: "LG Direct Drive PCB", category: "BOARD", brand: "LG", priceEur: 165.00, stock: 4, isOriginal: true, description: "LG hoofdmodule voor Direct Drive F4-series. Inclusief inverter.", oemNumbers: ["EBR75195134"], compatibleBrands: ["LG"], color: "9f1c1c" },

  // ── Door locks ────────────────────────────────────────────────────
  { sku: "WF-LOCK-09", name: "Deurslot Bosch ZV-446", category: "LOCK", brand: "Bosch", priceEur: 32.50, stock: 18, isOriginal: true, description: "Bosch/Siemens deurslot model ZV-446. Mechanisch met PTC-vergrendeling. Past op Serie 4/6/8 en Constructa.", oemNumbers: ["00633765", "00638259"], compatibleBrands: ["Bosch", "Siemens"], color: "1a6b6b" },
  { sku: "WF-LOCK-10", name: "Deurslot Miele original", category: "LOCK", brand: "Miele", priceEur: 64.00, stock: 10, isOriginal: true, description: "Miele origineel deurslot voor W1/W2 series. Geïntegreerde veiligheidsschakelaar.", oemNumbers: ["6611450"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-LOCK-11", name: "Deurslot Samsung 3-pins", category: "LOCK", brand: "Samsung", priceEur: 28.50, stock: 20, isOriginal: true, description: "Samsung origineel deurslot. 3-pins connector, voor WW8/WW9 series.", oemNumbers: ["DC34-00025D"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-LOCK-12", name: "Deurslot LG (E-vergrendeling)", category: "LOCK", brand: "LG", priceEur: 31.00, stock: 15, isOriginal: true, description: "LG origineel deurslot. Voor F-serie Direct Drive.", oemNumbers: ["6601EN1003D"], compatibleBrands: ["LG"], color: "9f1c1c" },
  { sku: "WF-LOCK-13", name: "Deurslot Whirlpool/Bitron 16302000", category: "LOCK", brand: "Whirlpool", priceEur: 29.00, stock: 22, isOriginal: false, description: "Bitron 1630200x serie. Universeel voor Whirlpool, Indesit, Hotpoint. Mechanisch slot met PTC.", oemNumbers: ["481228058044", "C00094128"], compatibleBrands: ["Whirlpool", "Indesit", "Hotpoint"], color: "0064bf" },
  { sku: "WF-LOCK-14", name: "Deurslot AEG/Electrolux Metalflex", category: "LOCK", brand: "AEG", priceEur: 27.00, stock: 18, isOriginal: false, description: "Metalflex deurslot voor AEG L-serie en Electrolux. Universele vervanger.", oemNumbers: ["1249434114"], compatibleBrands: ["AEG", "Electrolux", "Zanussi"], color: "353535" },

  // ── Heaters & NTC ─────────────────────────────────────────────────
  { sku: "WF-HEAT-03", name: "Verwarmingselement 1800W met NTC", category: "HEATER", brand: "Universeel", priceEur: 36.50, stock: 28, isOriginal: false, description: "Universeel verwarmingselement 1800W, U-vorm, met geïntegreerde NTC-sensor en thermische beveiliging. Past op de meeste 6kg machines.", oemNumbers: ["482000022116"], compatibleBrands: ["Bosch", "Siemens", "Whirlpool", "Indesit"], color: "5d97ff" },
  { sku: "WF-HEAT-04", name: "Verwarmingselement 1900W (8kg)", category: "HEATER", brand: "Universeel", priceEur: 39.50, stock: 25, isOriginal: false, description: "Universeel element 1900W voor 8kg wasmachines. Inclusief NTC en pakking.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-HEAT-05", name: "Verwarmingselement 2000W AEG", category: "HEATER", brand: "AEG", priceEur: 45.00, stock: 18, isOriginal: true, description: "Origineel AEG element 2000W. Voor L7 / LR8 series.", oemNumbers: ["1327242017"], compatibleBrands: ["AEG", "Electrolux"], color: "353535" },
  { sku: "WF-HEAT-06", name: "Verwarmingselement 2300W Samsung", category: "HEATER", brand: "Samsung", priceEur: 48.00, stock: 14, isOriginal: true, description: "Samsung 2300W element voor 9-12kg WW-series.", oemNumbers: ["DC47-00006R"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-NTC-15", name: "NTC temperatuursensor Bosch", category: "NTC", brand: "Bosch", priceEur: 8.50, stock: 50, isOriginal: false, description: "Universele NTC-sensor voor Bosch/Siemens. 6mm korte sonde, 2-pins connector. Weerstand 10K Ohm bij 25°C.", oemNumbers: ["00170961"], compatibleBrands: ["Bosch", "Siemens"], color: "5d97ff" },
  { sku: "WF-NTC-16", name: "NTC sensor Miele", category: "NTC", brand: "Miele", priceEur: 18.00, stock: 30, isOriginal: true, description: "Originele Miele NTC voor W1-serie.", oemNumbers: ["6611630"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-NTC-17", name: "NTC sensor Samsung", category: "NTC", brand: "Samsung", priceEur: 9.20, stock: 45, isOriginal: true, description: "Samsung NTC voor WW-serie. 2-pins JST connector.", oemNumbers: ["DC32-00007A"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-NTC-18", name: "NTC sensor universeel 10K", category: "NTC", brand: "Universeel", priceEur: 6.50, stock: 80, isOriginal: false, description: "Universele NTC 10K @ 25°C. Voor onderbouw met multimeter te testen.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },

  // ── Door seals ────────────────────────────────────────────────────
  { sku: "WF-DOOR-04", name: "Deurpakking Bosch Serie 6", category: "DOOR", brand: "Bosch", priceEur: 64.00, stock: 15, isOriginal: true, description: "Originele Bosch deurmanchet voor Serie 6 (2018+). EPDM rubber, gevulkaniseerd.", oemNumbers: ["00772658"], compatibleBrands: ["Bosch"], color: "1a6b6b" },
  { sku: "WF-DOOR-05", name: "Deurpakking Miele Classic", category: "DOOR", brand: "Miele", priceEur: 89.00, stock: 12, isOriginal: true, description: "Miele deurmanchet voor W1 Classic. Met geïntegreerde water-strip.", oemNumbers: ["7138400"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-DOOR-06", name: "Deurpakking Samsung EcoBubble", category: "DOOR", brand: "Samsung", priceEur: 54.00, stock: 18, isOriginal: true, description: "Samsung deurmanchet voor WW-serie EcoBubble.", oemNumbers: ["DC97-15309A"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-DOOR-07", name: "Deurpakking LG Direct Drive", category: "DOOR", brand: "LG", priceEur: 49.50, stock: 20, isOriginal: true, description: "LG deurmanchet voor F-serie DD.", oemNumbers: ["MDS47123604"], compatibleBrands: ["LG"], color: "9f1c1c" },
  { sku: "WF-DOOR-08", name: "Deurpakking AEG L-serie", category: "DOOR", brand: "AEG", priceEur: 56.00, stock: 16, isOriginal: true, description: "AEG/Electrolux deurmanchet voor L7/L8 series.", oemNumbers: ["1108580702"], compatibleBrands: ["AEG", "Electrolux"], color: "353535" },

  // ── Dampers / shock absorbers ─────────────────────────────────────
  { sku: "WF-DAMP-16", name: "Schokdemper Bosch 120N (set 2)", category: "DAMPER", brand: "Bosch", priceEur: 38.00, stock: 25, isOriginal: false, description: "Set van 2 schokdempers 120N voor Bosch/Siemens. Vervang altijd als paar.", oemNumbers: ["00673541"], compatibleBrands: ["Bosch", "Siemens"], color: "5d97ff" },
  { sku: "WF-DAMP-17", name: "Schokdemper Miele 80N (set 2)", category: "DAMPER", brand: "Miele", priceEur: 64.00, stock: 18, isOriginal: true, description: "Origineel Miele schokdemper-paar voor W1.", oemNumbers: ["8027811"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-DAMP-18", name: "Schokdemper Samsung (set 2)", category: "DAMPER", brand: "Samsung", priceEur: 32.00, stock: 28, isOriginal: true, description: "Set Samsung schokdempers WW-serie.", oemNumbers: ["DC66-00343F"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-DAMP-19", name: "Schokdemper AEG (set 2)", category: "DAMPER", brand: "AEG", priceEur: 34.50, stock: 22, isOriginal: false, description: "Universeel schokdemper-paar voor AEG/Electrolux L-serie.", oemNumbers: ["1322553605"], compatibleBrands: ["AEG", "Electrolux"], color: "353535" },
  { sku: "WF-DAMP-20", name: "Schokdemper Whirlpool (set 4)", category: "DAMPER", brand: "Whirlpool", priceEur: 48.00, stock: 16, isOriginal: false, description: "Set van 4 schokdempers voor Whirlpool/Indesit FFD-serie.", oemNumbers: ["480111100174"], compatibleBrands: ["Whirlpool", "Indesit"], color: "0064bf" },

  // ── Valves ────────────────────────────────────────────────────────
  { sku: "WF-VALVE-08", name: "Magneetventiel enkel (1-weg)", category: "VALVE", brand: "Universeel", priceEur: 18.50, stock: 40, isOriginal: false, description: "Universeel 1-weg waterinlaatventiel. 90° aansluiting, 12mm slang-uitgang.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-VALVE-09", name: "Magneetventiel 2-weg Bosch", category: "VALVE", brand: "Bosch", priceEur: 28.50, stock: 22, isOriginal: true, description: "Origineel Bosch 2-weg ventiel voor scheiding warm/koud water.", oemNumbers: ["00606001"], compatibleBrands: ["Bosch", "Siemens"], color: "1a6b6b" },
  { sku: "WF-VALVE-10", name: "Magneetventiel 3-weg Miele", category: "VALVE", brand: "Miele", priceEur: 42.00, stock: 12, isOriginal: true, description: "Miele 3-weg verdelerventiel voor W1.", oemNumbers: ["6261820"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-VALVE-11", name: "Aquastop slang complete", category: "HOSE", brand: "Universeel", priceEur: 24.50, stock: 35, isOriginal: false, description: "Aquastop-slang 1,5m met magneetventiel-aansluiting. Voorkomt waterschade bij slangbreuk.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-VALVE-12", name: "Magneetventiel 4-weg AEG", category: "VALVE", brand: "AEG", priceEur: 38.00, stock: 14, isOriginal: true, description: "AEG/Electrolux 4-weg ventiel voor L8-serie met automatische dispensering.", oemNumbers: ["1325186404"], compatibleBrands: ["AEG", "Electrolux"], color: "353535" },

  // ── Filters ───────────────────────────────────────────────────────
  { sku: "WF-FILTER-10", name: "Pluizenfilter Bosch", category: "FILTER", brand: "Bosch", priceEur: 12.50, stock: 60, isOriginal: true, description: "Origineel pluizenfilter Bosch met knipsluiting.", oemNumbers: ["00614351"], compatibleBrands: ["Bosch", "Siemens"], color: "1a6b6b" },
  { sku: "WF-FILTER-11", name: "Pluizenfilter Samsung", category: "FILTER", brand: "Samsung", priceEur: 11.00, stock: 55, isOriginal: true, description: "Samsung origineel pluizenfilter WW-serie.", oemNumbers: ["DC97-09928B"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-FILTER-12", name: "Pluizenfilter LG DD", category: "FILTER", brand: "LG", priceEur: 13.50, stock: 45, isOriginal: true, description: "LG origineel pluizenfilter voor F-serie.", oemNumbers: ["MCK62791001"], compatibleBrands: ["LG"], color: "9f1c1c" },
  { sku: "WF-FILTER-13", name: "Inlaatslang-filter (set 3)", category: "FILTER", brand: "Universeel", priceEur: 4.50, stock: 100, isOriginal: false, description: "Set van 3 mini-filters voor wateraansluiting (kraan-kant). Past in 3/4&apos;&apos; aansluiting.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },

  // ── Knobs & panels ────────────────────────────────────────────────
  { sku: "WF-KNOB-01", name: "Programmaknop Bosch chrome", category: "KNOB", brand: "Bosch", priceEur: 16.50, stock: 40, isOriginal: true, description: "Bosch programma-keuze-knop, chrome-look.", oemNumbers: ["00606445"], compatibleBrands: ["Bosch"], color: "1a6b6b" },
  { sku: "WF-KNOB-02", name: "Knop wasprogramma Miele", category: "KNOB", brand: "Miele", priceEur: 24.00, stock: 25, isOriginal: true, description: "Miele bedienings-draaiknop.", oemNumbers: ["7378892"], compatibleBrands: ["Miele"], color: "1a6b6b" },
  { sku: "WF-KNOB-03", name: "Aan/uit-knop AEG", category: "KNOB", brand: "AEG", priceEur: 9.50, stock: 50, isOriginal: false, description: "AEG aan/uit drukknop. Vervangbaar zonder demontage paneel.", oemNumbers: [], compatibleBrands: ["AEG", "Electrolux"], color: "353535" },
  { sku: "WF-KNOB-04", name: "Knop set universeel (3 stuks)", category: "KNOB", brand: "Universeel", priceEur: 14.50, stock: 30, isOriginal: false, description: "Universele knoppen-set voor diverse merken (3 maten).", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-PANEL-01", name: "Display-LCD Bosch", category: "PANEL", brand: "Bosch", priceEur: 78.50, stock: 12, isOriginal: true, description: "Display-LCD voor Bosch Serie 6 wasmachine. Inclusief flatcable.", oemNumbers: ["00640923"], compatibleBrands: ["Bosch"], color: "1a6b6b" },
  { sku: "WF-PANEL-02", name: "Display Samsung WW-serie", category: "PANEL", brand: "Samsung", priceEur: 72.00, stock: 10, isOriginal: true, description: "Samsung display + touch-overlay WW80/90T-serie.", oemNumbers: ["DC97-19612A"], compatibleBrands: ["Samsung"], color: "1f4e9c" },
  { sku: "WF-PANEL-03", name: "Touchpanel LG F4-serie", category: "PANEL", brand: "LG", priceEur: 68.50, stock: 9, isOriginal: true, description: "LG capacitive touchpanel voor F4-serie. Inclusief montage-clip.", oemNumbers: ["EBR89004001"], compatibleBrands: ["LG"], color: "9f1c1c" },

  // ── Hoses & accessories ───────────────────────────────────────────
  { sku: "WF-HOSE-01", name: "Aanvoerslang 1,5m 3/4 inch", category: "HOSE", brand: "Universeel", priceEur: 9.50, stock: 80, isOriginal: false, description: "Universele aanvoerslang 1,5m, 3/4&apos;&apos; aansluiting. Drukbestendig tot 70 bar.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-HOSE-02", name: "Aanvoerslang 2,5m", category: "HOSE", brand: "Universeel", priceEur: 12.00, stock: 60, isOriginal: false, description: "Aanvoerslang 2,5m voor verder van kraan staande machines.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-HOSE-03", name: "Afvoerslang flexibel 1,5m", category: "HOSE", brand: "Universeel", priceEur: 11.50, stock: 70, isOriginal: false, description: "Universele afvoerslang. 22mm aansluiting met sifon-bocht.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-HOSE-04", name: "Aquastop-slang met magneetventiel", category: "HOSE", brand: "Universeel", priceEur: 32.50, stock: 30, isOriginal: false, description: "Aquastop slang met geïntegreerd magneetventiel. Sluit watertoevoer bij slangbreuk.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-HOSE-05", name: "Manchet slang trommel-pomp", category: "HOSE", brand: "Universeel", priceEur: 14.50, stock: 35, isOriginal: false, description: "Verbindingsslang trommel naar pomp.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },

  // ── Misc / wear parts ─────────────────────────────────────────────
  { sku: "WF-MISC-01", name: "Transport-bouten set", category: "SEAL", brand: "Universeel", priceEur: 7.50, stock: 80, isOriginal: false, description: "Set transportbouten met dop. Voor verhuizing — borgt trommel.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-MISC-02", name: "Stelvoet (set 4) anti-vibratie", category: "DAMPER", brand: "Universeel", priceEur: 19.50, stock: 50, isOriginal: false, description: "Set van 4 anti-vibratie stelvoeten. Past op de meeste wasmachines. Reduceert geluid met 3-5dB.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-MISC-03", name: "Wasmachine-ontkalker (1L)", category: "FILTER", brand: "Universeel", priceEur: 8.50, stock: 100, isOriginal: false, description: "1L ontkalker speciaal voor wasmachines. 1x per 6 maanden gebruiken.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-MISC-04", name: "Reinigingstabletten (12 stuks)", category: "FILTER", brand: "Universeel", priceEur: 11.50, stock: 80, isOriginal: false, description: "Wasmachine-reinigingstabletten — verwijdert kalk, vet en geur. 1 per maand.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
  { sku: "WF-MISC-05", name: "Lager-trekker (gereedschap)", category: "MOTOR", brand: "Universeel", priceEur: 49.50, stock: 10, isOriginal: false, description: "Lager-trekkerset voor wasmachine-reparatie. Voor demontage van lagers uit trommellade.", oemNumbers: [], compatibleBrands: ["Universeel"], color: "5d97ff" },
];

// ─── Build output ─────────────────────────────────────────────────────
const existingSkus = new Set(EXISTING_PARTS.map((p) => p.sku));
const emitted = [...EXISTING_PARTS];
const emittedPm = [...EXISTING_PM];

for (const p of PARTS) {
  if (existingSkus.has(p.sku)) continue;
  const id = makeId(`part-${p.sku}`);
  emitted.push({
    id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    brand: p.brand,
    priceEur: p.priceEur,
    stock: p.stock,
    isOriginal: p.isOriginal,
    description: p.description,
    imageUrl: img(p.name, p.color),
    oemNumbers: p.oemNumbers.join("|") || "",
    weightGrams: null,
  });

  // attach part to compatible machines
  for (const brand of p.compatibleBrands) {
    if (brand === "Universeel") {
      // attach to all
      for (const m of MACHINES) {
        emittedPm.push({ partId: id, machineId: m.id });
      }
    } else {
      for (const m of (machinesByBrand[brand] ?? [])) {
        emittedPm.push({ partId: id, machineId: m.id });
      }
    }
  }
}

// dedupe partMachine
function dedupePm(arr) {
  const seen = new Set();
  return arr.filter((r) => {
    const k = `${r.partId}|${r.machineId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

writeFileSync("src/data/parts.json", JSON.stringify(emitted, null, 2));
writeFileSync("src/data/part-machine.json", JSON.stringify(dedupePm(emittedPm), null, 2));

console.error(`Emitted ${emitted.length} parts (${emitted.length - EXISTING_PARTS.length} new), ${emittedPm.length} part-machine rels.`);
