// Dump SQLite data to JSON files in src/data/ for static fallback
// Run: node scripts/dump-static-data.mjs
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";

const DB = "prisma/dev.db";
const OUT_DIR = "src/data";
mkdirSync(OUT_DIR, { recursive: true });

function sqlite(query) {
  const out = execSync(`sqlite3 -json ${DB}`, { input: query }).toString().trim();
  return out ? JSON.parse(out) : [];
}

// Convert SQLite booleans (0/1) to JS booleans
function fixBooleans(row, keys) {
  for (const k of keys) {
    if (row[k] === 0 || row[k] === 1) row[k] = Boolean(row[k]);
  }
  return row;
}

const machines = sqlite(`SELECT * FROM "WashingMachine";`);
const parts = sqlite(`SELECT * FROM "Part";`).map((p) => fixBooleans(p, ["isOriginal"]));
const errorCodes = sqlite(`SELECT * FROM "ErrorCode";`).map((e) => fixBooleans(e, ["diyFriendly"]));
const guides = sqlite(`SELECT * FROM "RepairGuide";`).map((g) => fixBooleans(g, ["isPremium"]));

// M-N relations
const partMachine = sqlite(`SELECT * FROM "PartMachine";`);
const errorCodeParts = sqlite(`SELECT * FROM "ErrorCodeParts";`);
const errorCodeGuides = sqlite(`SELECT * FROM "ErrorCodeGuides";`);
const guideParts = sqlite(`SELECT * FROM "GuideParts";`);

// Write each as a JSON file
writeFileSync(`${OUT_DIR}/machines.json`, JSON.stringify(machines, null, 2));
writeFileSync(`${OUT_DIR}/parts.json`, JSON.stringify(parts, null, 2));
writeFileSync(`${OUT_DIR}/error-codes.json`, JSON.stringify(errorCodes, null, 2));
writeFileSync(`${OUT_DIR}/guides.json`, JSON.stringify(guides, null, 2));
writeFileSync(`${OUT_DIR}/part-machine.json`, JSON.stringify(partMachine, null, 2));
writeFileSync(`${OUT_DIR}/errorcode-parts.json`, JSON.stringify(errorCodeParts, null, 2));
writeFileSync(`${OUT_DIR}/errorcode-guides.json`, JSON.stringify(errorCodeGuides, null, 2));
writeFileSync(`${OUT_DIR}/guide-parts.json`, JSON.stringify(guideParts, null, 2));

console.error(
  `Dumped: ${machines.length} machines, ${parts.length} parts, ${errorCodes.length} codes, ${guides.length} guides + ${partMachine.length + errorCodeParts.length + errorCodeGuides.length + guideParts.length} relations`,
);
