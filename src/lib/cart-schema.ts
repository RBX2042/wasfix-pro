/**
 * The checkout form, as one zod schema used twice: in the browser (so a mistake
 * is shown under the field before anything is sent) and in /api/checkout (the
 * only place that is actually trusted). Client-safe.
 *
 * Normalisation lives here too, so what the browser shows after validation is
 * what the invoice will print: e-mail trimmed and lower-cased (one person was
 * becoming three User rows), postcode as "1234 AB", city and street trimmed.
 */
import { z } from "zod";
import { MAX_CUSTOMER_NOTE_LENGTH, MAX_LINES_PER_ORDER, MAX_QTY_PER_LINE } from "./cart-limits";

/** "1234ab" / " 1234  Ab " -> "1234 AB"; anything else is returned trimmed and upper-cased. */
export function normalisePostalCode(raw: string): string {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  const m = /^([1-9][0-9]{3})([A-Z]{2})$/.exec(compact);
  return m ? `${m[1]} ${m[2]}` : raw.trim().replace(/\s+/g, " ").toUpperCase();
}

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

/** "den haag" -> "Den Haag"; a name that already has capitals ("'s-Hertogenbosch", "IJsselstein") is left alone. */
export function tidyPlaceName(raw: string): string {
  const s = collapse(raw);
  if (s !== s.toLowerCase()) return s;
  return s.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Digits (8 to 15) with an optional leading +, spaces, dashes and brackets. */
export function isPlausiblePhone(raw: string): boolean {
  if (!/^\+?[0-9 ()\-]+$/.test(raw.trim())) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

const required = (what: string) => `Vul ${what} in`;

/** An optional text input left empty arrives as "": treat it as absent. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const emailField = z
  .string({ required_error: required("je e-mailadres"), invalid_type_error: required("je e-mailadres") })
  .trim()
  .toLowerCase()
  .min(1, required("je e-mailadres"))
  .max(254, "Dit e-mailadres is te lang")
  .email("Dit e-mailadres lijkt niet te kloppen (bv. naam@voorbeeld.nl)");

export const CheckoutFormSchema = z.object({
  email: emailField,
  name: z
    .string({ required_error: required("je naam"), invalid_type_error: required("je naam") })
    .transform(collapse)
    .pipe(z.string().min(2, "Vul je volledige naam in").max(100, "Deze naam is te lang")),
  phone: z
    .string({ required_error: required("je telefoonnummer"), invalid_type_error: required("je telefoonnummer") })
    .transform(collapse)
    .pipe(
      z
        .string()
        .min(1, required("je telefoonnummer"))
        .max(30, "Dit telefoonnummer is te lang")
        .refine(isPlausiblePhone, "Dit telefoonnummer lijkt niet te kloppen (bv. 06 12345678)"),
    ),
  // Business buyers can supply their VAT number; it is printed on the invoice.
  vatNumber: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((s) => s.replace(/[\s.]/g, "").toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}[A-Z0-9+*]{2,13}$/, "Ongeldig btw-nummer (bv. NL123456789B01)"))
      .optional(),
  ),
  customerNote: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
      .pipe(z.string().max(MAX_CUSTOMER_NOTE_LENGTH, `Maximaal ${MAX_CUSTOMER_NOTE_LENGTH} tekens`))
      .optional(),
  ),
  address: z.object({
    street: z
      .string({ required_error: required("je straatnaam") })
      .transform(collapse)
      .pipe(z.string().min(2, required("je straatnaam")).max(100, "Deze straatnaam is te lang")),
    houseNumber: z
      .string({ required_error: required("je huisnummer") })
      .transform(collapse)
      .pipe(z.string().min(1, required("je huisnummer")).max(20, "Dit huisnummer is te lang")),
    postalCode: z
      .string({ required_error: required("je postcode") })
      .transform(normalisePostalCode)
      .pipe(z.string().regex(/^[1-9][0-9]{3} [A-Z]{2}$/, "Ongeldige postcode (bv. 1234 AB)")),
    city: z
      .string({ required_error: required("je plaats") })
      .transform(tidyPlaceName)
      .pipe(z.string().min(2, required("je plaats")).max(50, "Deze plaatsnaam is te lang")),
    // Netherlands only for now (decision D6). The form has no country field;
    // anything but NL in the API is refused instead of being printed on an invoice.
    country: z
      .string()
      .optional()
      .refine((c) => c === undefined || c === "" || c.toUpperCase() === "NL", "We leveren voorlopig alleen in Nederland")
      .transform(() => "NL" as const),
  }),
});

export type CheckoutFormValues = z.infer<typeof CheckoutFormSchema>;

const euro = z.number().finite().min(0).max(100_000);

export const CartItemSchema = z
  .object({
    partId: z.string().min(1).max(64).optional(),
    sku: z.string().min(1).max(64).optional(),
    quantity: z
      .number({ invalid_type_error: "Ongeldig aantal" })
      .int("Ongeldig aantal")
      .min(1, "Ongeldig aantal")
      .max(MAX_QTY_PER_LINE, `Maximaal ${MAX_QTY_PER_LINE} stuks per onderdeel`),
  })
  .refine((d) => d.partId || d.sku, { message: "partId of sku is verplicht" });

/** What the customer was shown, so the server can tell when it is no longer true. */
export const ExpectedCartSchema = z.object({
  totalEur: euro,
  lines: z
    .array(z.object({ sku: z.string().min(1).max(64), unitPriceEur: euro, quantity: z.number().int().min(1).max(1000) }))
    .max(MAX_LINES_PER_ORDER)
    .optional(),
});
export type ExpectedCart = z.infer<typeof ExpectedCartSchema>;

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const CheckoutRequestSchema = CheckoutFormSchema.extend({
  items: z.array(CartItemSchema).min(1, "Je winkelmand is leeg").max(MAX_LINES_PER_ORDER, `Maximaal ${MAX_LINES_PER_ORDER} verschillende onderdelen per bestelling`),
  // No default: the choice is explicit, so a missing Stripe configuration can
  // never turn into a bank-transfer order the customer did not ask for (D5).
  paymentMethod: z.enum(["stripe", "bank_transfer"], { errorMap: () => ({ message: "Kies een betaalmethode" }) }),
  expected: ExpectedCartSchema.optional(),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_RE, "Ongeldige sleutel").optional(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/** Flatten a zod error to {fieldName: first message}; "address.postalCode" becomes "postalCode". */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.filter((p) => typeof p === "string") as string[];
    const key = path[path.length - 1] ?? "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** The inputs the checkout form actually renders. An error for any other key has no place to be shown but the message above the button. */
export const FORM_FIELD_KEYS = ["email", "name", "phone", "vatNumber", "street", "houseNumber", "postalCode", "city", "customerNote"] as const;
export type FormFieldKey = (typeof FORM_FIELD_KEYS)[number];

/**
 * Sort a refused checkout (HTTP 400) into what belongs under an input and what has to be shown above
 * the order button. The server also refuses for reasons that are not a form field (too many units or
 * lines in the cart, a country, a payment method); the first version of the form dropped those, so the
 * customer pressed the button and nothing at all happened.
 *
 * `message` is the server's own sentence (`error`). It is never lost: with no rendered field it is the
 * form message; with both, it is used unless it is just the text of a field error.
 */
export function splitServerErrors(
  fieldErrors: Record<string, string> | undefined | null,
  message: string | undefined | null,
): { fields: Partial<Record<FormFieldKey, string>>; form: string | undefined } {
  const fields: Partial<Record<FormFieldKey, string>> = {};
  const unrendered: string[] = [];
  for (const [key, text] of Object.entries(fieldErrors ?? {})) {
    if ((FORM_FIELD_KEYS as readonly string[]).includes(key)) fields[key as FormFieldKey] = text;
    else unrendered.push(text);
  }
  const shownUnderInputs = Object.values(fields);
  const hasField = shownUnderInputs.length > 0;
  let form: string | undefined;
  if (!hasField) form = message || unrendered[0] || "Bestellen is mislukt. Er is niets afgeschreven.";
  else if (unrendered.length > 0) form = message && !shownUnderInputs.includes(message) ? message : unrendered[0];
  return { fields, form };
}
