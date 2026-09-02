/**
 * The anonymous visitor id, shared by referral attribution and usage metering.
 *
 * Lives in its own module (with no server-only marker) so plain Node scripts
 * and tests can import the constant without pulling in a server component.
 */
export const VISITOR_COOKIE = "wasfix-vid";
