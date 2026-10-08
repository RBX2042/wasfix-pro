/**
 * CSV for the Dutch spreadsheet user: writer and parser, no dependencies.
 *
 * WRITER (toCsv)
 *   - UTF-8 with a BOM, ";" between cells, CRLF between rows. Excel with a Dutch
 *     locale splits on ";" and only reads UTF-8 when the BOM is there; "," would
 *     put 28,50 in two columns.
 *   - Numbers are written with a decimal COMMA ("-34,45") for the same reason.
 *   - CSV/formula injection: a TEXT cell that starts with = + - @ tab or CR is
 *     prefixed with an apostrophe. Customer names and addresses are
 *     customer-controlled and an admin opens these files in Excel. Cells given as
 *     a number are not text and are never prefixed, which is why a credit note
 *     can be exported as -34,45 without turning into "'-34,45".
 *
 * PARSER (parseCsv)
 *   - Detects ";" / "," / tab from the header line, strips the BOM, understands
 *     quoted cells with doubled quotes and line breaks inside quotes.
 *   - Undoes the writer's injection guard (one leading apostrophe before = + - @),
 *     so an export that is edited and imported again does not grow apostrophes.
 *   - parseMoney / parseIntStrict read Dutch and plain notation ("28,50", "28.50",
 *     "1.234,50", "EUR 28,50") and REFUSE what is ambiguous or has more than two
 *     decimals instead of guessing.
 */

export type CsvCell = string | number | null | undefined;

const INJECTION_START = /^[=+\-@\t\r]/;

/** Dutch decimal notation, no thousands separator: 1234.5 -> "1234,50". */
export function formatDecimalNl(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace(".", ",");
}

export function csvCell(value: CsvCell, sep = ";"): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    text = Number.isInteger(value) ? String(value) : formatDecimalNl(value);
  } else {
    text = INJECTION_START.test(value) ? `'${value}` : value;
  }
  return text.includes(sep) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A complete CSV document: BOM, header, rows, CRLF. */
export function toCsv(header: string[], rows: CsvCell[][], sep = ";"): string {
  const lines = [header.map((h) => csvCell(h, sep)).join(sep), ...rows.map((r) => r.map((c) => csvCell(c, sep)).join(sep))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

export type ParsedCsv = { header: string[]; rows: string[][]; delimiter: string };

function detectDelimiter(headerLine: string): string {
  const counts = [";", ",", "\t"].map((d) => ({ d, n: headerLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ";";
}

/** Split text into records of cells, honouring quotes. Empty trailing lines are dropped. */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      i++;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const [header = [], ...rows] = nonEmpty;
  return { header: header.map((h) => h.trim()), rows: rows.map((r) => r.map(unguardCell)), delimiter };
}

/** Remove the apostrophe csvCell() put in front of = + - @. */
function unguardCell(cell: string): string {
  return /^'[=+\-@]/.test(cell) ? cell.slice(1) : cell;
}

/**
 * "28,50" "28.50" "1.234,50" "€ 28,50" "EUR 28,50" -> 28.5 / 1234.5.
 * Returns null for anything else, including more than two decimals and a lone
 * "1.234" (is that 1234 or 1,234? we do not guess).
 */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/^(eur|€)\s*/i, "").replace(/\s+/g, "");
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let frac = "";
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the later one is the decimal separator, the other groups thousands.
    const decIdx = Math.max(lastComma, lastDot);
    const thousands = decIdx === lastComma ? "." : ",";
    intPart = s.slice(0, decIdx);
    frac = s.slice(decIdx + 1);
    if (!new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})*$`).test(intPart)) return null;
    intPart = intPart.split(thousands).join("");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sepChar = lastComma >= 0 ? "," : ".";
    const parts = s.split(sepChar);
    if (parts.length > 2) return null;
    intPart = parts[0];
    frac = parts[1];
    // "1.234" is ambiguous; "1.23" and "1.2" are not.
    if (frac.length === 3 && sepChar === ".") return null;
  } else {
    intPart = s;
  }
  if (!/^\d+$/.test(intPart) || (frac !== "" && !/^\d{1,2}$/.test(frac))) return null;
  const value = Number(`${intPart}.${frac || "0"}`);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** A whole number >= 0 or negative with a sign; no decimals, no thousands separators. */
export function parseIntStrict(raw: string): number | null {
  const s = raw.trim();
  if (!/^-?\d{1,9}$/.test(s)) return null;
  return Number(s);
}
