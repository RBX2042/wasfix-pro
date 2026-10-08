"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useCart, cartTotal, cartOverLimit, refreshCartFromServer, describeCartNotice, type CartNotice, type ServerCartLine } from "@/components/cart-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatEur, formatDate } from "@/lib/utils";
import { SHIPPING } from "@/lib/plans";
import { cartTotals } from "@/lib/cart-totals";
import { BANK_TRANSFER_TERM_DAYS, MAX_CUSTOMER_NOTE_LENGTH } from "@/lib/cart-limits";
import { CheckoutFormSchema, FORM_FIELD_KEYS, fieldErrorsOf, splitServerErrors, type FormFieldKey } from "@/lib/cart-schema";
import { clearSharedAttempt, newAttemptKey, readSharedAttempt, writeSharedAttempt } from "@/lib/cart-attempt";
import { ShoppingBag, Truck, Lock, ArrowLeft, Landmark, AlertTriangle } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

/**
 * What this component may show of the seller. COMPANY is built from server
 * environment variables, which do not exist in the browser: reading it here
 * rendered placeholders after hydration and mismatched the server HTML. The
 * server page passes publicCompany() instead, with placeholders already null.
 */
export type CheckoutCompany = { name: string; iban: string | null };

type FieldErrors = Partial<Record<FormFieldKey | "form" | "items", string>>;

export function CheckoutClient({
  stripeAvailable,
  partsDiscount: initialDiscount = 0,
  company,
  prefill = null,
}: {
  stripeAvailable: boolean;
  partsDiscount?: number;
  company: CheckoutCompany;
  prefill?: { email: string; name: string } | null;
}) {
  const storedItems = useCart((s) => s.items);
  const applyServerLines = useCart((s) => s.applyServerLines);
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [paymentMethod, setPaymentMethod] = React.useState<"stripe" | "bank_transfer">(stripeAvailable ? "stripe" : "bank_transfer");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [notices, setNotices] = React.useState<CartNotice[]>([]);
  const [partsDiscount, setPartsDiscount] = React.useState(initialDiscount);
  const [email, setEmail] = React.useState(prefill?.email ?? "");
  const noticeRef = React.useRef<HTMLDivElement>(null);
  const attempt = React.useRef<{ key: string; fingerprint: string } | null>(null);

  // The stored cart exists only in the browser. Rendering it before mount made the server HTML
  // (empty cart, "Totaal 5,95") differ from the first client render (React error #418), so
  // nothing derived from it is shown until after mount.
  const items = mounted ? storedItems : [];
  React.useEffect(() => setMounted(true), []);

  // Re-price the cart when the page opens: a cart can be days old. If anything changed the
  // customer is told and must confirm before the order button works again.
  React.useEffect(() => {
    if (!mounted) return;
    let alive = true;
    refreshCartFromServer({ force: true }).then((changes) => {
      if (alive && changes && changes.length > 0) setNotices(changes);
    });
    return () => {
      alive = false;
    };
  }, [mounted]);

  React.useEffect(() => {
    if (notices.length > 0) {
      noticeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      noticeRef.current?.focus({ preventScroll: true });
    }
  }, [notices]);

  // Same arithmetic as /api/checkout (see src/lib/cart-totals.ts), so the summary never
  // quotes a total the card will not be charged.
  const subtotal = cartTotal(items);
  const totals = cartTotals(subtotal, partsDiscount);
  const needsConfirmation = notices.length > 0;
  // A cart kept in the browser for days can exceed what the server accepts (50 units, 15 lines).
  // Say so here, where the button is, instead of letting the server refuse it.
  const overLimit = mounted ? cartOverLimit(items) : null;

  function dueDateLabel(): string {
    return formatDate(new Date(Date.now() + BANK_TRANSFER_TERM_DAYS * 24 * 60 * 60 * 1000));
  }

  /**
   * One key per attempt. The fingerprint covers EVERYTHING that makes up the order (lines, payment method
   * and every typed detail), so a customer who corrects the address after a lost response gets a new key
   * and a new order instead of the old one with the old address. The key is shared through localStorage
   * with other tabs that are about to submit the very same order (see cart-attempt.ts).
   */
  function attemptKey(values: unknown): string {
    const fingerprint = JSON.stringify([items.map((i) => [i.sku, i.quantity]), paymentMethod, values]);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = { key: readSharedAttempt(fingerprint) ?? newAttemptKey(), fingerprint };
    }
    writeSharedAttempt(fingerprint, attempt.current.key);
    return attempt.current.key;
  }

  // Focus has to move AFTER the message is in the page: the element does not exist yet at the moment
  // the errors are set, so focusing it right there silently did nothing.
  const focusAfterRender = React.useRef(false);
  React.useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    const first = FORM_FIELD_KEYS.find((k) => errors[k]);
    document.getElementById(first ?? "form-error")?.focus();
  }, [errors]);

  function showErrors(next: FieldErrors) {
    focusAfterRender.current = true;
    setErrors(next);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (items.length === 0 || submitting || needsConfirmation || cartOverLimit(items)) return;

    const form = new FormData(e.currentTarget);
    const str = (k: string) => String(form.get(k) ?? "").trim();
    const values = {
      email: str("email"),
      name: str("name"),
      phone: str("phone"),
      vatNumber: str("vatNumber") || undefined,
      customerNote: str("customerNote") || undefined,
      address: { street: str("street"), houseNumber: str("houseNumber"), postalCode: str("postalCode"), city: str("city") },
    };

    // The same schema the server uses: the mistake is shown under the field, nothing is sent.
    const checked = CheckoutFormSchema.safeParse(values);
    if (!checked.success) {
      showErrors(fieldErrorsOf(checked.error) as FieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attemptKey(values) },
        body: JSON.stringify({
          items: items.map((i) => ({ partId: i.partId, sku: i.sku, quantity: i.quantity })),
          ...values,
          paymentMethod,
          // What is on screen. If the server's numbers differ it refuses with 409 and creates nothing.
          expected: {
            totalEur: totals.totalEur,
            lines: items.map((i) => ({ sku: i.sku, unitPriceEur: i.priceEur, quantity: i.quantity })),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // Stay disabled while the browser navigates; the cart is emptied by the confirmation page, once.
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        if (data.redirectUrl) {
          router.push(data.redirectUrl);
          return;
        }
        showErrors({ form: "Er ging iets mis: we kregen geen vervolgadres terug. Er is niets betaald." });
        setSubmitting(false);
        return;
      }

      if (res.status === 409 && data.code === "cart_changed" && Array.isArray(data.lines)) {
        // Nothing was created. Update the cart to what the server says and ask again.
        const found = applyServerLines(data.lines as ServerCartLine[]);
        if (typeof data.partsDiscount === "number") setPartsDiscount(data.partsDiscount);
        const list: CartNotice[] = [...found];
        if (list.length === 0 && typeof data.previousTotalEur === "number" && data.totals) {
          list.push({ kind: "total", from: data.previousTotalEur, to: data.totals.totalEur });
        }
        if (list.length === 0) list.push({ kind: "total", from: totals.totalEur, to: data.totals?.totalEur ?? totals.totalEur });
        setNotices(list);
        setSubmitting(false);
        return;
      }

      // A closed or foreign attempt: start over with a fresh key.
      if (data.code === "attempt_closed" || data.code === "idempotency_conflict") {
        attempt.current = null;
        clearSharedAttempt();
      }

      if (res.status === 400) {
        // Field errors go under their input; anything else the server refused (too many units or lines,
        // a country, a payment method) goes above the button. Nothing is dropped.
        const { fields, form } = splitServerErrors(data?.details?.fieldErrors, data?.error);
        showErrors({ ...fields, form });
      } else {
        showErrors({ form: data.error ?? "Bestellen is mislukt. Er is niets afgeschreven." });
      }
      setSubmitting(false);
    } catch {
      // The request may or may not have reached the server. The same Idempotency-Key makes a retry safe.
      showErrors({ form: "De verbinding viel weg. Controleer je internet en probeer het opnieuw: er wordt nooit dubbel besteld." });
      setSubmitting(false);
    }
  }

  if (mounted && items.length === 0) {
    return (
      <div className="container py-20 text-center">
        <ShoppingBag className="mx-auto h-16 w-16 text-muted-foreground/30 mb-4" />
        <h1 className="font-heading text-2xl font-bold mb-2">Je winkelmand is leeg</h1>
        <p className="text-muted-foreground mb-6">Voeg eerst onderdelen toe voordat je afrekent.</p>
        {/* Why it is empty: a cart whose parts all sold out is emptied by the server check, and saying
            nothing made it look like a bug. */}
        {notices.length > 0 && (
          <div role="alert" className="mx-auto mb-6 max-w-lg rounded-lg border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4 text-left">
            <p className="font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> Je winkelmand is aangepast</p>
            <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
              {notices.map((n, i) => (
                <li key={i}>{describeCartNotice(n)}</li>
              ))}
            </ul>
          </div>
        )}
        <Button asChild>
          <Link href="/onderdelen"><ArrowLeft className="h-4 w-4" /> Terug naar shop</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container py-8 md:py-12">
      <Link href="/onderdelen" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-6">
        <ArrowLeft className="h-3 w-3" /> Verder winkelen
      </Link>

      <h1 className="font-heading text-3xl font-bold mb-3">Afrekenen</h1>
      {/* The terms of the sale, before the form instead of in the last step. */}
      <p className="text-sm text-muted-foreground mb-6" data-testid="checkout-terms">
        Prijzen zijn inclusief btw. Verzendkosten {formatEur(SHIPPING.rateEur)}, gratis vanaf {formatEur(SHIPPING.freeFromEur)}. We leveren alleen in Nederland.
      </p>

      {overLimit && (
        <div role="alert" data-testid="cart-over-limit" className="mb-6 rounded-lg border-2 border-red-400 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-900 dark:text-red-200">
          {overLimit}
        </div>
      )}

      {needsConfirmation && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          role="alert"
          className="mb-6 rounded-lg border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4 outline-none"
        >
          <p className="font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> Je winkelmand is aangepast</p>
          <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
            {notices.map((n, i) => (
              <li key={i}>{describeCartNotice(n)}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            Nieuw totaal: <strong>{formatEur(totals.totalEur)}</strong> (incl. btw en verzending). Er is nog niets besteld of betaald.
          </p>
          <Button type="button" className="mt-3 h-auto whitespace-normal py-2.5 text-center" onClick={() => setNotices([])}>
            Akkoord, ga verder met {formatEur(totals.totalEur)}
          </Button>
        </div>
      )}

      {/* min-w-0 on the grid children: a grid item's minimum width is its content, and the long
          button label used to widen the column past a 375px phone. */}
      <form onSubmit={handleSubmit} noValidate className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-8">
        <div className="space-y-6 min-w-0">
          <Card>
            <CardContent className="p-4 sm:p-6 space-y-4">
              <h2 className="font-heading text-lg font-semibold">Contactgegevens</h2>
              <Field id="email" label="E-mailadres" error={errors.email}>
                <Input
                  id="email" name="email" type="email" autoComplete="email" inputMode="email" required placeholder="jouw@email.nl"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="h-11 text-base" {...aria("email", errors.email)}
                />
              </Field>
              <Field id="name" label="Volledige naam" error={errors.name}>
                <Input id="name" name="name" autoComplete="name" required defaultValue={prefill?.name ?? ""} placeholder="Jan de Vries" className="h-11 text-base" {...aria("name", errors.name)} />
              </Field>
              <Field id="phone" label="Telefoonnummer" hint="Voor de bezorger, als er iets mis gaat met je pakket." error={errors.phone}>
                <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="06 12345678" className="h-11 text-base" {...aria("phone", errors.phone)} />
              </Field>
              <Field id="vatNumber" label={<>Btw-nummer <span className="text-muted-foreground font-normal">(optioneel, voor op de factuur)</span></>} error={errors.vatNumber}>
                <Input id="vatNumber" name="vatNumber" autoComplete="off" placeholder="NL123456789B01" className="h-11 text-base" {...aria("vatNumber", errors.vatNumber)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-6 space-y-4">
              <h2 className="font-heading text-lg font-semibold">Verzendadres</h2>
              {/* minmax(0,…) instead of 1fr: a 16px input reports a ~186px intrinsic
                  width, and an auto-min track will not shrink below that — the row
                  would push /checkout into horizontal scroll on a 390px phone. */}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,110px)] gap-3">
                <Field id="street" label="Straatnaam" error={errors.street}>
                  <Input id="street" name="street" autoComplete="address-line1" required placeholder="Hoofdstraat" className="h-11 text-base" {...aria("street", errors.street)} />
                </Field>
                <Field id="houseNumber" label="Huisnr." error={errors.houseNumber}>
                  {/* autocomplete off: address-line1 already fills street + number in one go on many phones. */}
                  <Input id="houseNumber" name="houseNumber" autoComplete="off" required placeholder="42a" className="h-11 text-base" {...aria("houseNumber", errors.houseNumber)} />
                </Field>
              </div>
              <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-3">
                <Field id="postalCode" label="Postcode" error={errors.postalCode}>
                  <Input id="postalCode" name="postalCode" autoComplete="postal-code" autoCapitalize="characters" required placeholder="1234 AB" className="h-11 text-base" {...aria("postalCode", errors.postalCode)} />
                </Field>
                <Field id="city" label="Plaats" error={errors.city}>
                  <Input id="city" name="city" autoComplete="address-level2" required placeholder="Amsterdam" className="h-11 text-base" {...aria("city", errors.city)} />
                </Field>
              </div>
              <Field id="customerNote" label={<>Opmerking voor de bezorger <span className="text-muted-foreground font-normal">(optioneel)</span></>} error={errors.customerNote}>
                <Textarea id="customerNote" name="customerNote" maxLength={MAX_CUSTOMER_NOTE_LENGTH} rows={2} placeholder="Bijvoorbeeld: bel aan bij de buren" className="text-base" {...aria("customerNote", errors.customerNote)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="font-heading text-lg font-semibold mb-3">Betaling</h2>

              {stripeAvailable ? (
                <div className="space-y-2" role="radiogroup" aria-label="Betaalmethode">
                  <label className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer ${paymentMethod === "stripe" ? "border-primary bg-primary/5" : ""}`}>
                    <input type="radio" name="paymentMethodChoice" className="mt-1" checked={paymentMethod === "stripe"} onChange={() => setPaymentMethod("stripe")} />
                    <Lock className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden />
                    <span className="text-sm min-w-0">
                      <span className="font-medium block">Direct betalen met iDEAL of kaart</span>
                      <span className="text-xs text-muted-foreground">Je betaalt veilig bij Stripe; we verzenden zodra de betaling is bevestigd.</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer ${paymentMethod === "bank_transfer" ? "border-primary bg-primary/5" : ""}`}>
                    <input type="radio" name="paymentMethodChoice" className="mt-1" checked={paymentMethod === "bank_transfer"} onChange={() => setPaymentMethod("bank_transfer")} />
                    <Landmark className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden />
                    <span className="text-sm min-w-0">
                      <span className="font-medium block">Vooruitbetalen per bankoverschrijving</span>
                      <BankTransferTerms mounted={mounted} dueLabel={dueDateLabel} total={totals.totalEur} companyName={company.name} />
                    </span>
                  </label>
                </div>
              ) : (
                <div className="rounded-md border p-3 flex items-start gap-3">
                  <Landmark className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden />
                  <div className="text-sm min-w-0">
                    <p className="font-medium">Vooruitbetalen per bankoverschrijving</p>
                    <BankTransferTerms mounted={mounted} dueLabel={dueDateLabel} total={totals.totalEur} companyName={company.name} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0">
          <Card className="sticky top-20">
            <CardContent className="p-4 sm:p-6 space-y-4">
              <h2 className="font-heading text-lg font-semibold">Jouw bestelling</h2>

              <div className="max-h-72 overflow-y-auto space-y-3">
                {items.map((i) => (
                  <div key={i.partId} className="flex gap-3 text-sm">
                    {i.imageUrl && (
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-muted border">
                        <Image src={i.imageUrl} alt={i.name} fill sizes="56px" className="object-cover" />
                        <Badge className="absolute -top-1.5 -right-1.5 h-5 w-5 p-0 flex items-center justify-center text-[10px]">{i.quantity}</Badge>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium line-clamp-2 leading-tight">{i.name}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{i.sku}{!i.imageUrl ? ` · ${i.quantity}x` : ""}</p>
                    </div>
                    <span className="font-semibold whitespace-nowrap">{formatEur(i.priceEur * i.quantity)}</span>
                  </div>
                ))}
                {!mounted && <p className="text-sm text-muted-foreground">Winkelmand laden…</p>}
              </div>

              <div className="border-t pt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotaal</span><span>{mounted ? formatEur(totals.subtotalEur) : "—"}</span></div>
                {totals.discountEur > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Ledenkorting ({Math.round(partsDiscount * 100)}%)</span>
                    <span>-{formatEur(totals.discountEur)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1"><Truck className="h-3 w-3" aria-hidden /> Verzending</span>
                  <span>{!mounted ? "—" : totals.shippingEur === 0 ? "Gratis" : formatEur(totals.shippingEur)}</span>
                </div>
                {mounted && totals.toFreeShippingEur > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Voeg {formatEur(totals.toFreeShippingEur)} toe voor gratis verzending.{" "}
                    <Link href="/onderdelen" className="text-primary underline">Meer onderdelen bekijken</Link>
                  </p>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Waarvan btw 21%</span>
                  <span>{mounted ? formatEur(totals.vatEur) : "—"}</span>
                </div>
              </div>

              <div className="border-t pt-3 flex justify-between items-baseline">
                <span className="font-semibold">Totaal <span className="text-xs font-normal text-muted-foreground">incl. btw</span></span>
                <span className="font-heading text-2xl font-bold">{mounted ? formatEur(totals.totalEur) : "—"}</span>
              </div>

              {errors.form && (
                <div id="form-error" tabIndex={-1} role="alert" className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-900 dark:text-red-200 outline-none">
                  {errors.form}
                </div>
              )}

              {/* Art. 6:230v lid 3 BW: the order button has to spell out the payment
                  obligation. Without those words the consumer is simply not bound by
                  the agreement, so "Bestelling plaatsen" alone is not enough. The label
                  wraps (whitespace-normal): nowrap made this button wider than a phone. */}
              <Button
                type="submit"
                size="lg"
                className="w-full h-auto min-h-12 whitespace-normal py-3 text-center leading-snug"
                disabled={submitting || !mounted || items.length === 0 || needsConfirmation || !!overLimit}
              >
                {submitting ? "Verwerken..." : "Bestelling met betalingsverplichting"}
              </Button>
              {needsConfirmation && <p className="text-xs text-amber-700 dark:text-amber-400 text-center">Bevestig eerst de wijzigingen hierboven.</p>}

              <p className="text-xs text-muted-foreground text-center">
                Door te bestellen ga je akkoord met onze <Link href="/voorwaarden" className="underline" target="_blank">algemene voorwaarden</Link>.
                Lees ook ons <Link href="/privacy" className="underline" target="_blank">privacybeleid</Link> en de <Link href="/retourvoorwaarden" className="underline" target="_blank">retourvoorwaarden</Link>.
                Je ontvangt een factuur met btw-specificatie.
              </p>
            </CardContent>
          </Card>
        </aside>
      </form>
    </div>
  );
}

/** What bank transfer means, said before the order is placed (not after). */
function BankTransferTerms({ mounted, dueLabel, total, companyName }: { mounted: boolean; dueLabel: () => string; total: number; companyName: string }) {
  return (
    <span className="block text-xs text-muted-foreground mt-0.5">
      Je bestelling wordt voor je gereserveerd en we verzenden pas <strong>nadat je betaling binnen is</strong> (een overboeking staat er meestal binnen 1 tot 2 werkdagen).
      Je krijgt direct een factuur{mounted ? <> en betaalt {formatEur(total)} uiterlijk op {dueLabel()}</> : ""} aan {companyName}, met het factuurnummer als betalingskenmerk.
      Het IBAN, het kenmerk en de datum staan na het bestellen op een pagina die je altijd opnieuw kunt openen.
    </span>
  );
}

/** aria wiring for an input that may carry an error message. */
function aria(id: string, error?: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

function Field({ id, label, hint, error, children }: { id: string; label: React.ReactNode; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && !error && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
