import { ClerkProvider } from "@clerk/nextjs";
import { CLERK_ENABLED } from "@/lib/clerk-flag";

/**
 * Wraps the app in ClerkProvider only when real auth is configured.
 * In demo mode this is a transparent pass-through.
 */
export function AuthProviders({ children }: { children: React.ReactNode }) {
  if (!CLERK_ENABLED) return <>{children}</>;
  return (
    <ClerkProvider
      signInUrl="/inloggen"
      signUpUrl="/registreren"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      appearance={{ variables: { colorPrimary: "#1a6b6b" } }}
    >
      {children}
    </ClerkProvider>
  );
}
