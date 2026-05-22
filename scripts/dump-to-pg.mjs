// Dump SQLite data to PostgreSQL INSERTs (wasfix schema)
// Uses sqlite3 CLI (no npm deps needed)
// Usage: node scripts/dump-to-pg.mjs > /tmp/wasfix-seed.sql

import { execSync } from "child_process";

const DB = "prisma/dev.db";

// Order matters for foreign keys (parents first)
const tables = [
  "User",
  "WashingMachine",
  "Part",
  "RepairGuide",
  "ErrorCode",
  "PartMachine",
  "ErrorCodeParts",
  "ErrorCodeGuides",
  "GuideParts",
  "SavedMachine",
  "Diagnosis",
  "Order",
  "OrderItem",
  "StripeEvent",
];

// Columns that should be true/false (SQLite stores 0/1)
const booleanColumns = {
  ErrorCode: new Set(["diyFriendly"]),
  RepairGuide: new Set(["isPremium"]),
  Part: new Set(["isOriginal"]),
};

const timestampColumns = new Set([
  "createdAt",
  "updatedAt",
  "processedAt",
  "diagnosesResetAt",
]);

function escapeSql(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function formatValue(table, column, value) {
  if (value === null || value === undefined) return "NULL";
  if (booleanColumns[table]?.has(column)) {
    return value === 1 || value === "1" || value === true ? "true" : "false";
  }
  if (timestampColumns.has(column)) {
    if (typeof value === "string" && value.length > 0) {
      return "'" + value.replace(/'/g, "''") + "'::timestamp";
    }
    if (typeof value === "number" && value > 0) {
      return `to_timestamp(${value / 1000})`;
    }
    return "NULL";
  }
  return escapeSql(value);
}

function sqlite(query) {
  // Use stdin to avoid shell escaping problems
  const out = execSync(`sqlite3 -json ${DB}`, { input: query }).toString().trim();
  if (!out) return [];
  return JSON.parse(out);
}

console.log("SET search_path TO wasfix, public;");
console.log("BEGIN;");
console.log("");

let totalRows = 0;
for (const table of tables) {
  let rows;
  try {
    rows = sqlite(`SELECT * FROM "${table}";`);
  } catch (e) {
    console.error(`-- skipping ${table}: ${e.message}`);
    continue;
  }
  if (rows.length === 0) {
    console.log(`-- ${table}: empty`);
    continue;
  }
  totalRows += rows.length;
  console.log(`-- ${table}: ${rows.length} rows`);
  const columns = Object.keys(rows[0]);
  for (const row of rows) {
    const values = columns.map((c) => formatValue(table, c, row[c]));
    const cols = columns.map((c) => `"${c}"`).join(", ");
    console.log(
      `INSERT INTO wasfix."${table}" (${cols}) VALUES (${values.join(", ")}) ON CONFLICT DO NOTHING;`
    );
  }
  console.log("");
}

console.log("COMMIT;");
console.error(`\nDumped ${totalRows} rows across ${tables.length} tables`);
