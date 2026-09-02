"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { CLERK_ENABLED } from "@/lib/clerk-flag";

type Variant = "light" | "dark";

/**
 * Header auth controls.
 *  - Clerk enabled: avatar menu when signed in, "Inloggen" when signed out.
 *  - Demo mode: a plain link to the dashboard (auto-logged-in demo user).
 */
export function AuthButtons({ variant = "light", onNavigate }: { variant?: Variant; onNavigate?: () => void }) {
  const linkClass =
    variant === "dark"
      ? "btn btn-ghost btn-sm"
      : "inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground";

  if (!CLERK_ENABLED) {
    return (
      <Link href="/dashboard" className={linkClass} onClick={onNavigate}>
        Mijn account
      </Link>
    );
  }

  return (
    <>
      <SignedOut>
        <Link href="/inloggen" className={linkClass} onClick={onNavigate}>
          Inloggen
        </Link>
      </SignedOut>
      <SignedIn>
        <Link href="/dashboard" className={linkClass} onClick={onNavigate}>
          Dashboard
        </Link>
        <UserButton
          appearance={{ elements: { avatarBox: "h-8 w-8" } }}
          userProfileMode="navigation"
          userProfileUrl="/dashboard/profiel"
        />
      </SignedIn>
    </>
  );
}
