/** "mail x@y.nl" or, without a configured address, a pointer to the contact page. Pure: safe in client components (no env import). */
export function supportHint(email: string | null | undefined): string {
  return email ? `mail ${email}` : "neem contact met ons op via de contactpagina (/contact)";
}
