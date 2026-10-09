/**
 * Format checks for the company's fiscal identity. Pure functions, no
 * environment access, safe to import anywhere (including client bundles) and
 * trivially unit-testable.
 *
 * CONTRACT
 *   isValidKvk(v)        8 digits.
 *   isValidVatNumber(v)  NL + 9 digits + B + 2 digits (spaces and dots ignored).
 *   isValidIban(v)       ISO 13616 mod-97 checksum; NL additionally needs 18 chars.
 *   isValidPostalCode(v) Dutch "1234 AB".
 *   canonicalCompanyValue(field, raw)
 *                        the ONE canonical spelling of a field: trimmed, inner
 *                        whitespace collapsed, KvK digits only, btw-nummer and
 *                        IBAN compact upper case, postcode "1234 AB". Readiness
 *                        is judged on this value and COMPANY stores this value, so
 *                        what was validated is what an invoice prints.
 *   evaluateCompany(raw) -> CompanyReadiness: which of the seven fiscal fields
 *                        (and, when the caller passes the `email` key, the contact
 *                        e-mail, decision D15) are missing, malformed or still a
 *                        placeholder.
 *   companyTradeName(n)  the name without a trailing "(in oprichting)".
 *
 * What this CANNOT do: tell a real registration from a well-formed test value.
 * The values used in local production runs (KvK 90000001, NL900000010B01,
 * NL02ABNA0123456789) pass every check here on purpose, because the same
 * checks guard the CI production build. They are reported in `warnings` so the
 * launch preflight can refuse them, but they do not make `ready` false.
 */

export type CompanyField = "name" | "street" | "postalCode" | "city" | "kvk" | "vatNumber" | "iban";

/**
 * `email` is the customer-facing contact address (COMPANY_EMAIL). Decision D15: it is
 * part of readiness, because every legal page, the invoice footer and the reply-to
 * of customer mail print it and there is no built-in address to fall back to.
 *
 * It is judged only when the key is PRESENT in the input. companyInputFromEnv()
 * (src/lib/plans.ts), which the running shop, the checkout gate and the preflight
 * use, always passes the key, so for the real environment a missing address is a
 * problem. Callers that evaluate the seven fiscal fields on their own (tests,
 * a dry run of a registration form) can leave it out.
 */
export type CompanyInput = Partial<Record<CompanyField | "email", string | null | undefined>>;

/** The seven fiscal fields plus the contact address. */
export type CompanyProblemField = CompanyField | "email";

export type CompanyProblem = {
  field: CompanyProblemField;
  /** The environment variable that sets this field. */
  envVar: string;
  reason: "ontbreekt" | "ongeldig" | "voorbeeldwaarde";
  /** Human-readable, Dutch. */
  message: string;
};

export type CompanyReadiness = {
  /** True only when ALL seven fiscal fields (and, when judged, the contact e-mail) are real. */
  ready: boolean;
  /** Fields that are absent, malformed or a placeholder. Empty when ready. */
  missing: CompanyProblemField[];
  problems: CompanyProblem[];
  /** Well-formed values that are known test/example numbers. Not blocking. */
  warnings: string[];
};

export const COMPANY_ENV_VARS: Record<CompanyField, string> = {
  name: "COMPANY_NAME",
  street: "COMPANY_STREET",
  postalCode: "COMPANY_POSTAL_CODE",
  city: "COMPANY_CITY",
  kvk: "COMPANY_KVK",
  vatNumber: "COMPANY_VAT",
  iban: "COMPANY_IBAN",
};

/** The environment variable of the contact address (not one of the seven fiscal fields). */
export const COMPANY_EMAIL_ENV_VAR = "COMPANY_EMAIL";

/** Same pattern the preflight uses for owner-facing addresses: something@host.tld, no spaces or angle brackets. */
export const CONTACT_EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

/** Name shown while the company is not registered. Claims no legal form. */
export const DEFAULT_COMPANY_NAME = "WasFix Pro (in oprichting)";

/**
 * The name without its "(in oprichting)" suffix, for sentences that add their
 * own "is nog in oprichting" ("WasFix Pro (in oprichting) is nog in oprichting"
 * is what the default name produced there).
 */
export function companyTradeName(name: string): string {
  return name.replace(/\s*\(in oprichting\)\s*$/i, "").trim() || name;
}

/** Stand-ins that were once defaults. Never real, in any field. */
export const COMPANY_PLACEHOLDER_VALUES: readonly string[] = [
  DEFAULT_COMPANY_NAME,
  "Hoofdstraat 1",
  "1234 AB",
  "12345678",
  "NL123456789B01",
  "NL00ABCD0123456789",
  "085 - 123 45 67",
];

/** Well-formed numbers that exist for testing, not for trading. */
const KNOWN_TEST_VALUES: Record<string, string> = {
  "90000001": "COMPANY_KVK is een testnummer",
  NL900000010B01: "COMPANY_VAT is een testnummer",
  NL02ABNA0123456789: "COMPANY_IBAN is een testrekening",
  NL91ABNA0417164300: "COMPANY_IBAN is het IBAN-voorbeeld uit de documentatie",
};

const compact = (v: string) => v.replace(/[\s.]/g, "").toUpperCase();

/**
 * The canonical spelling of one field, "" when empty. Pasting into a hosting
 * dashboard routinely adds a trailing newline or space, and people write an IBAN
 * in groups or a btw-nummer in lower case; the permanent invoice seller block
 * must not inherit any of that, and neither may the readiness check disagree
 * with what is stored. Values that are not valid keep their (trimmed) text so
 * the problem message can quote them.
 */
export function canonicalCompanyValue(field: CompanyField, raw: string | null | undefined): string {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  switch (field) {
    case "kvk":
      return v.replace(/[\s.]/g, "");
    case "vatNumber":
    case "iban":
      return compact(v);
    case "postalCode": {
      const m = /^([1-9]\d{3})\s?([A-Za-z]{2})$/.exec(v);
      return m ? `${m[1]} ${m[2].toUpperCase()}` : v;
    }
    default:
      return v;
  }
}

/** Is this one of the stand-in values, ignoring case and spacing ("1234AB" is "1234 AB")? */
export function isPlaceholderValue(value: string): boolean {
  const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
  return COMPANY_PLACEHOLDER_VALUES.some((p) => norm(p) === norm(value));
}

export function isValidKvk(value: string): boolean {
  return /^\d{8}$/.test(value.replace(/\s/g, ""));
}

export function isValidVatNumber(value: string): boolean {
  return /^NL\d{9}B\d{2}$/.test(compact(value));
}

export function isValidPostalCode(value: string): boolean {
  return /^[1-9]\d{3}\s?[A-Za-z]{2}$/.test(value.trim());
}

/** ISO 13616: move the first four characters to the end, letters to 10..35, mod 97 === 1. */
export function isValidIban(value: string): boolean {
  const iban = compact(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("NL") && iban.length !== 18) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

const VALIDATORS: Record<CompanyField, (v: string) => boolean> = {
  name: (v) => v.trim().length >= 2,
  // A Dutch address always carries a house number.
  street: (v) => v.trim().length >= 3 && /\d/.test(v),
  postalCode: isValidPostalCode,
  city: (v) => v.trim().length >= 2,
  kvk: isValidKvk,
  vatNumber: isValidVatNumber,
  iban: isValidIban,
};

const LABELS: Record<CompanyField, string> = {
  name: "bedrijfsnaam",
  street: "straat en huisnummer",
  postalCode: "postcode",
  city: "plaats",
  kvk: "KvK-nummer (8 cijfers)",
  vatNumber: "btw-nummer (NL + 9 cijfers + B + 2 cijfers)",
  iban: "IBAN (geldig controlegetal)",
};

export function evaluateCompany(input: CompanyInput): CompanyReadiness {
  const problems: CompanyProblem[] = [];
  const warnings: string[] = [];
  for (const field of Object.keys(COMPANY_ENV_VARS) as CompanyField[]) {
    const raw = canonicalCompanyValue(field, input[field]);
    const envVar = COMPANY_ENV_VARS[field];
    if (!raw) {
      problems.push({ field, envVar, reason: "ontbreekt", message: `${envVar} ontbreekt (${LABELS[field]})` });
      continue;
    }
    if (isPlaceholderValue(raw)) {
      problems.push({ field, envVar, reason: "voorbeeldwaarde", message: `${envVar} bevat nog de voorbeeldwaarde "${raw}"` });
      continue;
    }
    if (!VALIDATORS[field](raw)) {
      problems.push({ field, envVar, reason: "ongeldig", message: `${envVar} is geen geldige ${LABELS[field]}` });
      continue;
    }
    const test = KNOWN_TEST_VALUES[compact(raw)];
    if (test) warnings.push(test);
  }
  // The contact address (decision D15). It is not a fiscal field, but every legal
  // page, the invoice footer and the reply-to of customer mail print it, and the
  // shop used to invent support@wasfix.nl when it was missing: a mailbox nothing
  // proves exists. So a shop without it is not ready. Judged only when the caller
  // passes the key (see CompanyInput).
  if ("email" in input) {
    const email = (input.email ?? "").trim();
    if (!email) {
      problems.push({ field: "email", envVar: COMPANY_EMAIL_ENV_VAR, reason: "ontbreekt", message: "COMPANY_EMAIL ontbreekt (e-mailadres waarop klanten je bereiken)" });
    } else if (!CONTACT_EMAIL_RE.test(email)) {
      problems.push({ field: "email", envVar: COMPANY_EMAIL_ENV_VAR, reason: "ongeldig", message: "COMPANY_EMAIL is geen geldig e-mailadres" });
    }
  }
  return { ready: problems.length === 0, missing: problems.map((p) => p.field), problems, warnings };
}
