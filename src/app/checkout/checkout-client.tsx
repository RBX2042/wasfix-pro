"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useCart, cartTotal } from "@/components/cart-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatEur } from "@/lib/utils";
import { VAT_RATE, COMPANY, SHIPPING, shippingFor } from "@/lib/plans";
import { ShoppingBag, Truck, Lock, ArrowLeft, Landmark } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";

export function CheckoutClient({ stripeAvailable, partsDiscount = 0 }: { stripeAvailable: boolean; partsDiscount?: number }) {
  const items = useCart((s) => s.items);
  const clearCart = useCart((s) => s.clear);
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [paymentMethod, setPaymentMethod] = React.useState<"stripe" | "bank_transfer">(stripeAvailable ? "stripe" : "bank_transfer");
  React.useEffect(() => setMounted(true), []);

  // Mirrors /api/checkout exactly — same discount, same shipping rule, same
  // order of operations — so the summary never quotes a total the card will
  // not be charged.
  const round = (n: number) => Math.round(n * 100) / 100;
  const subtotal = round(cartTotal(items));
  const discount = round(subtotal * partsDiscount);
  const shipping = shippingFor(subtotal, discount);
  const total = round(subtotal - discount + shipping);
  // Catalog prices include 21% btw, so the btw is contained in the total.
  const vat = round(total * (VAT_RATE / (1 + VAT_RATE)));
  const toFreeShipping = round(SHIPPING.freeFromEur - (subtotal - discount));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (items.length === 0) return;

    const formData = new FormData(e.currentTarget);
    setSubmitting(true);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ partId: i.partId, sku: i.sku, quantity: i.quantity })),
          email: formData.get("email"),
          name: formData.get("name"),
          vatNumber: (formData.get("vatNumber") as string)?.trim() || undefined,
          paymentMethod,
          address: {
            street: formData.get("street"),
            houseNumber: formData.get("houseNumber"),
            postalCode: formData.get("postalCode"),
            city: formData.get("city"),
            country: formData.get("country") ?? "NL",
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = a part sold out between viewing and paying; 503 = we could not
        // record the order. Both mean nothing was charged, and saying so stops
        // the customer from trying to pay twice.
        toast.error(data.error ?? "Bestelling mislukt");
        return;
      }

      // If Stripe checkout URL: redirect
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      clearCart();
      if (data.paymentMethod === "bank_transfer") {
        // No "?success=1" — the order page itself shows the payment
        // instructions (IBAN, invoice number, due date) for this status.
        router.push(`/bestelling/${data.orderId}`);
        return;
      }

      // Demo mode — direct success
      router.push(`/bestelling/${data.orderId}?success=1`);
    } catch {
      toast.error("Er ging iets mis met afrekenen");
    } finally {
      setSubmitting(false);
    }
  }

  if (mounted && items.length === 0) {
    return (
      <div className="container py-20 text-center">
        <ShoppingBag className="mx-auto h-16 w-16 text-muted-foreground/30 mb-4" />
        <h2 className="font-heading text-2xl font-bold mb-2">Je winkelmand is leeg</h2>
        <p className="text-muted-foreground mb-6">Voeg eerst onderdelen toe voordat je afrekent.</p>
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

      <h1 className="font-heading text-3xl font-bold mb-8">Afrekenen</h1>

      <form onSubmit={handleSubmit} className="grid lg:grid-cols-[1fr_400px] gap-8">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="font-heading text-lg font-semibold">Contactgegevens</h2>
              <div>
                <Label htmlFor="email">E-mailadres</Label>
                <Input id="email" name="email" type="email" required placeholder="jouw@email.nl" />
              </div>
              <div>
                <Label htmlFor="name">Volledige naam</Label>
                <Input id="name" name="name" required placeholder="Jan de Vries" />
              </div>
              <div>
                <Label htmlFor="vatNumber">Btw-nummer <span className="text-muted-foreground font-normal">(optioneel, voor op de factuur)</span></Label>
                <Input id="vatNumber" name="vatNumber" placeholder="NL123456789B01" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="font-heading text-lg font-semibold">Verzendadres</h2>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <div>
                  <Label htmlFor="street">Straatnaam</Label>
                  <Input id="street" name="street" required placeholder="Hoofdstraat" />
                </div>
                <div>
                  <Label htmlFor="houseNumber">Huisnummer</Label>
                  <Input id="houseNumber" name="houseNumber" required placeholder="42a" />
                </div>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-3">
                <div>
                  <Label htmlFor="postalCode">Postcode</Label>
                  <Input id="postalCode" name="postalCode" required placeholder="1234 AB" />
                </div>
                <div>
                  <Label htmlFor="city">Plaats</Label>
                  <Input id="city" name="city" required placeholder="Amsterdam" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h2 className="font-heading text-lg font-semibold mb-3">Betaling</h2>

              {stripeAvailable ? (
                <div className="space-y-2">
                  <label className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer ${paymentMethod === "stripe" ? "border-primary bg-primary/5" : ""}`}>
                    <input type="radio" name="paymentMethodChoice" checked={paymentMethod === "stripe"} onChange={() => setPaymentMethod("stripe")} />
                    <Lock className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="text-sm">Direct betalen (iDEAL, Bancontact, kaart) via Stripe</span>
                  </label>
                  <label className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer ${paymentMethod === "bank_transfer" ? "border-primary bg-primary/5" : ""}`}>
                    <input type="radio" name="paymentMethodChoice" checked={paymentMethod === "bank_transfer"} onChange={() => setPaymentMethod("bank_transfer")} />
                    <Landmark className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm">Op rekening — betaal binnen 14 dagen per bankoverschrijving</span>
                  </label>
                </div>
              ) : (
                <div className="rounded-md border p-3 flex items-center gap-3">
                  <Landmark className="h-4 w-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Op rekening</p>
                    <p className="text-xs text-muted-foreground">
                      Je ontvangt direct een factuur met betaalinstructies ({COMPANY.name}, IBAN {COMPANY.iban}). Betaal binnen 14 dagen.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside>
          <Card className="sticky top-20">
            <CardContent className="p-6 space-y-4">
              <h2 className="font-heading text-lg font-semibold">Jouw bestelling</h2>

              <div className="max-h-72 overflow-y-auto space-y-3">
                {mounted && items.map((i) => (
                  <div key={i.partId} className="flex gap-3 text-sm">
                    {i.imageUrl && (
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-muted border">
                        <Image src={i.imageUrl} alt={i.name} fill sizes="56px" className="object-cover" />
                        <Badge className="absolute -top-1.5 -right-1.5 h-5 w-5 p-0 flex items-center justify-center text-[10px]">{i.quantity}</Badge>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium line-clamp-2 leading-tight">{i.name}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{i.sku}</p>
                    </div>
                    <span className="font-semibold whitespace-nowrap">{formatEur(i.priceEur * i.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotaal</span><span>{formatEur(subtotal)}</span></div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Ledenkorting ({Math.round(partsDiscount * 100)}%)</span>
                    <span>-{formatEur(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1"><Truck className="h-3 w-3" /> Verzending</span>
                  <span>{shipping === 0 ? "Gratis" : formatEur(shipping)}</span>
                </div>
                {toFreeShipping > 0 && (
                  <p className="text-xs text-muted-foreground">Voeg {formatEur(toFreeShipping)} toe voor gratis verzending</p>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Waarvan btw {Math.round(VAT_RATE * 100)}%</span>
                  <span>{formatEur(vat)}</span>
                </div>
              </div>

              <div className="border-t pt-3 flex justify-between items-baseline">
                <span className="font-semibold">Totaal</span>
                <span className="font-heading text-2xl font-bold">{formatEur(total)}</span>
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={submitting || !mounted || items.length === 0}>
                {submitting ? "Verwerken..." : "Bestelling plaatsen"}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Prijzen incl. btw. Je ontvangt een factuur met btw-specificatie. Door te bestellen ga je akkoord met onze voorwaarden.
              </p>
            </CardContent>
          </Card>
        </aside>
      </form>
    </div>
  );
}
