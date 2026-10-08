"use client";
import * as React from "react";
import { formatEur } from "@/lib/utils";
import { memberLineTotal } from "@/lib/member-discount";

// The parts discount of the signed-in visitor's plan (0.05 / 0.10 / 0.15), or 0.
//
// It used to be visible only on /checkout, so a paying subscriber never saw the
// benefit while shopping. The catalogue and product pages are cached and shared
// by everybody, so the discount cannot be rendered on the server; it is fetched
// once per page load from /api/user/plan and shared by every price on the page.
// Every signed-in catalogue view used to cost an uncached Clerk call plus a
// database write behind that route, so the answer is also kept for two minutes
// in sessionStorage (this tab only), keyed by Clerk's __client_uat cookie so a
// sign-in or sign-out drops it. A signed-out visitor sees nothing extra.

let pending: Promise<number> | null = null;

function signedOutForSure(): boolean {
  // With Clerk on, __client_uat is "0" (or absent) for a signed-out browser.
  // Skipping the request then avoids a 401 on every catalogue view. In demo
  // mode there is no such cookie and everybody is "signed in".
  if (process.env.NEXT_PUBLIC_CLERK_ENABLED !== "true") return false;
  try {
    const m = document.cookie.split("; ").find((c) => c.startsWith("__client_uat="));
    return !m || m.split("=")[1] === "0";
  } catch {
    return true;
  }
}

const CACHE_KEY = "wasfix-member-discount";
const CACHE_MS = 2 * 60 * 1000;

function sessionStamp(): string {
  try {
    return document.cookie.split("; ").find((c) => c.startsWith("__client_uat="))?.split("=")[1] ?? "";
  } catch {
    return "";
  }
}

function readCached(): number | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { d: number; at: number; s: string };
    if (Date.now() - v.at > CACHE_MS || v.s !== sessionStamp()) return null;
    return Number.isFinite(v.d) ? v.d : null;
  } catch {
    return null;
  }
}

function writeCached(d: number) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ d, at: Date.now(), s: sessionStamp() }));
  } catch {
    // Storage blocked: the next page just asks again.
  }
}

function loadDiscount(): Promise<number> {
  if (!pending) {
    const cached = readCached();
    pending =
      cached !== null
        ? Promise.resolve(cached)
        : signedOutForSure()
          ? Promise.resolve(0)
          : fetch("/api/user/plan", { credentials: "same-origin" })
              .then((r) => (r.ok ? r.json() : null))
              .then((j) => {
                const d = Number(j?.partsDiscount ?? 0);
                const value = Number.isFinite(d) && d > 0 && d < 1 ? d : 0;
                writeCached(value);
                return value;
              })
              .catch(() => 0);
  }
  return pending;
}

export function useMemberDiscount(): number {
  const [discount, setDiscount] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    loadDiscount().then((d) => alive && setDiscount(d));
    return () => {
      alive = false;
    };
  }, []);
  return discount;
}

/** "Jouw prijs € 27,07 (5% korting)" - renders nothing when the viewer has no discount. */
export function MemberPrice({ priceEur, className = "" }: { priceEur: number; className?: string }) {
  const discount = useMemberDiscount();
  if (discount <= 0) return null;
  // Same arithmetic as /api/checkout (see member-discount.ts), so the price shown is the price charged.
  const discounted = memberLineTotal(priceEur, discount);
  return (
    <p className={`text-sm font-medium text-emerald-700 dark:text-emerald-400 ${className}`}>
      Jouw prijs {formatEur(discounted)} <span className="font-normal">({Math.round(discount * 100)}% ledenkorting)</span>
    </p>
  );
}
