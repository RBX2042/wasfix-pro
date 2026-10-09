/**
 * Go-live check. Run it BEFORE a deploy against the production variables and AFTER a
 * deploy against the live address:
 *
 *   npm run preflight                                          the variables in this shell, offline
 *   npm run preflight -- --env-file .env.production.local      e.g. from `vercel env pull .env.production.local --environment=production`
 *   npm run preflight -- --env-file .env.production.local --live-checks
 *   npm run preflight -- --env-file .env.production.local --live-checks --url https://wasfix.nl     after the deploy
 *
 * Flags
 *   --env-file <path>   check exactly the variables in that file instead of this shell's environment
 *   --live-checks       also do the checks that need the network: database and migrations, Stripe,
 *                       Resend, Clerk, Upstash, Gemini. Without it nothing leaves this machine.
 *   --url <https://..>  also probe the DEPLOYED site (implies --live-checks)
 *   --target staging    a preview/staging environment: test keys and *.vercel.app are accepted
 *                       (default: production)
 *   --strict            warnings also give a non-zero exit code
 *   --json              machine-readable report
 *   --only a,b          only these groups (core,database,company,auth,stripe,email,owner,ai,ops,catalog,live)
 *
 * Verdict: READY (exit 0), READY WITH WARNINGS (exit 0, exit 1 with --strict), NOT READY (exit 1;
 * at least one BLOCK). Exit 2: the script itself crashed. Every BLOCK and WARN carries the exact
 * next step. It never creates, changes or sends anything: network calls are reads, and the only
 * database access is SELECT. Secrets are never printed.
 *
 * Run through `npm run preflight`: it needs `tsx --conditions=react-server` because it loads the
 * same modules the application uses (company rules, Stripe readiness, notification channels), so it
 * cannot disagree with the code it is checking.
 *
 * What it cannot know: the Vercel environment SCOPE of a variable (Production vs Preview), what the
 * Clerk/Stripe/Resend dashboards show beyond what their APIs return, and whether DNS has propagated
 * for a domain you have not pointed at the project yet.
 */
import fs from "node:fs";
import path from "node:path";

export type Level = "ok" | "info" | "warn" | "block" | "skip";
export type Check = { group: string; level: Level; message: string; fix?: string };
export type Report = { verdict: "READY" | "READY WITH WARNINGS" | "NOT READY"; blockers: number; warnings: number; skipped: number; checks: Check[] };

// Every variable the application or its scripts read; with --env-file everything else in this shell is ignored.
const KNOWN_VARS = [
  "NODE_ENV", "DEMO_MODE", "NEXT_PUBLIC_APP_URL", "DATABASE_URL", "DIRECT_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SECRET", "CLERK_WEBHOOK_SIGNING_SECRET", "CLERK_WEBHOOK_ALLOW_UNSIGNED",
  "ADMIN_EMAILS", "GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_MODEL",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_PRICE_PARTICULIER", "STRIPE_PRICE_MONTEUR", "STRIPE_PRICE_BEDRIJF",
  "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_AUDIENCE_ID", "SLACK_WEBHOOK_URL", "DISCORD_WEBHOOK_URL", "ORDER_NOTIFY_EMAIL",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "API_DEMO_KEY", "CRON_SECRET",
  "COMPANY_NAME", "COMPANY_STREET", "COMPANY_POSTAL_CODE", "COMPANY_CITY", "COMPANY_KVK", "COMPANY_VAT", "COMPANY_IBAN", "COMPANY_EMAIL", "COMPANY_PHONE",
  "NEXT_PUBLIC_FEATURE_REFERRAL", "NEXT_PUBLIC_FEATURE_I18N", "NEXT_PUBLIC_FEATURE_EXIT_INTENT", "NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST", "NEXT_PUBLIC_GA_ID",
  "VERCEL", "VERCEL_ENV",
];

/**
 * ADMIN_EMAILS as the application reads it: src/lib/auth.ts parseAdminEmails splits on
 * comma, semicolon and whitespace. (Copied, not imported: auth.ts is server-only.)
 * qa-preflight compares the two on the same inputs.
 */
export function adminList(raw: string | undefined | null): string[] {
  return (raw ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v.replace(/\\n/g, "\n").trim();
  }
  return out;
}

type Args = { envFile?: string; live: boolean; url?: string; target: "production" | "staging"; strict: boolean; json: boolean; only?: string[] };

export function parseArgs(argv: string[]): Args {
  const a: Args = { live: false, target: "production", strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--env-file") a.envFile = argv[++i];
    else if (t === "--live-checks") a.live = true;
    else if (t === "--url") { a.url = argv[++i]; a.live = true; }
    else if (t === "--target") { const v = argv[++i]; if (v !== "production" && v !== "staging") throw new Error(`--target must be production or staging, got ${v}`); a.target = v; }
    else if (t === "--strict") a.strict = true;
    else if (t === "--json") a.json = true;
    else if (t === "--only") a.only = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (t === "--help" || t === "-h") { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*\*\n?/, "").replace(/^ \* ?/gm, "")); process.exit(0); }
    else throw new Error(`Unknown argument: ${t}`);
  }
  return a;
}

const get = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

async function http(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms), redirect: init.redirect ?? "manual" });
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

export async function runPreflight(args: Args): Promise<Report> {
  const checks: Check[] = [];
  const production = args.target === "production";
  const add = (group: string, level: Level, message: string, fix?: string) => checks.push({ group, level, message, fix });
  const ok = (g: string, m: string) => add(g, "ok", m);
  const block = (g: string, m: string, fix: string) => add(g, "block", m, fix);
  const warn = (g: string, m: string, fix: string) => add(g, "warn", m, fix);
  const skipped = (g: string, m: string) => add(g, "skip", `${m} (niet gecontroleerd: gebruik --live-checks)`);

  // ── environment under test ───────────────────────────────────────────
  if (args.envFile) {
    const parsed = parseEnvFile(fs.readFileSync(args.envFile, "utf8"));
    for (const k of KNOWN_VARS) delete process.env[k];
    for (const [k, v] of Object.entries(parsed)) process.env[k] = v;
  } else {
    // Same lookup as scripts/make-admin.ts: variables already in the shell win.
    for (const name of [".env.local", ".env"]) {
      const file = path.join(process.cwd(), name);
      if (!fs.existsSync(file)) continue;
      for (const [k, v] of Object.entries(parseEnvFile(fs.readFileSync(file, "utf8")))) if (process.env[k] === undefined) process.env[k] = v;
    }
  }
  // A deployed build runs with NODE_ENV=production whatever the file says; the libraries below read it.
  (process.env as Record<string, string>).NODE_ENV = "production";

  const { checkAppUrl } = await import("../src/lib/site-url");
  const { buildCsp, clerkKeyInfo } = await import("../src/lib/csp");
  const { companyReadiness, PLANS, BILLABLE_PLANS } = await import("../src/lib/plans");
  const { hasNotifyChannel } = await import("../src/lib/notify");
  const { isValidIban } = await import("../src/lib/company-validate");

  // ── core ─────────────────────────────────────────────────────────────
  {
    const g = "core";
    const url = checkAppUrl(get("NEXT_PUBLIC_APP_URL"));
    if (url.url) ok(g, `NEXT_PUBLIC_APP_URL = ${url.url}`);
    else for (const e of url.errors) block(g, e, "Zet NEXT_PUBLIC_APP_URL op het publieke https-adres, bijvoorbeeld https://wasfix.nl (alleen het domein), in de Production-omgeving van de host en bouw OPNIEUW: de waarde wordt tijdens de build ingebakken.");
    for (const w of url.warnings) add(g, production ? "warn" : "info", w, "Zet NEXT_PUBLIC_APP_URL op het eigen domein zodra dat naar het project wijst.");
    if (get("DEMO_MODE") === "true") warn(g, "DEMO_MODE=true staat in deze omgeving. In productie heeft het geen effect (demo-modus bestaat daar niet), maar het hoort er niet te staan.", "Verwijder DEMO_MODE uit de productie-omgeving.");
    else ok(g, "DEMO_MODE staat niet aan");
    if (get("API_DEMO_KEY")) warn(g, "API_DEMO_KEY staat aan: de publieke API-sandbox (alleen onderdelen lezen) is open voor iedereen die de sleutel kent.", "Verwijder API_DEMO_KEY als je de sandbox niet wilt aanbieden.");
    if (get("NEXT_PUBLIC_FEATURE_REFERRAL") === "true") warn(g, "Het verwijsprogramma staat aan (NEXT_PUBLIC_FEATURE_REFERRAL=true): daarmee beloof je klanten een beloning.", "Laat het uit tot de uitbetaling is uitgewerkt, zie BLOCKED.md. Verwijder de variabele om het uit te zetten.");
  }

  // ── database ─────────────────────────────────────────────────────────
  {
    const g = "database";
    const dbUrl = get("DATABASE_URL");
    let parsed: URL | null = null;
    if (!dbUrl) block(g, "DATABASE_URL ontbreekt: zonder database kan niets worden opgeslagen en blokkeert het bestellen.", "Zet DATABASE_URL op de pooler-verbinding van de productiedatabase (zie BLOCKED.md stap 3).");
    else if (!/^postgres(ql)?:\/\//i.test(dbUrl) || /\[YOUR-PASSWORD\]|<your-password-here>|\[password\]/i.test(dbUrl)) block(g, "DATABASE_URL is geen Postgres-adres of bevat nog het voorbeeldwachtwoord.", "Kopieer de verbindingsstring opnieuw uit Supabase en vul het echte wachtwoord in (speciale tekens URL-encoden).");
    else {
      try { parsed = new URL(dbUrl); } catch { block(g, "DATABASE_URL is niet te lezen als URL (speciale tekens in het wachtwoord?).", "URL-encode het wachtwoord (@ wordt %40, # wordt %23)."); }
    }
    if (parsed) {
      ok(g, `DATABASE_URL wijst naar ${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`);
      const host = parsed.hostname;
      const pooled = parsed.port === "6543" || parsed.searchParams.get("pgbouncer") === "true";
      if (/\.pooler\.supabase\.com$/i.test(host)) {
        if (parsed.port !== "6543") warn(g, `DATABASE_URL gebruikt de Supabase-pooler op poort ${parsed.port || "5432"} (session-modus). Elke serverless-instantie houdt dan verbindingen vast en de pool raakt snel vol.`, "Gebruik de Transaction pooler: poort 6543 met ?pgbouncer=true&connection_limit=1.");
        else if (parsed.searchParams.get("pgbouncer") !== "true" || parsed.searchParams.get("connection_limit") !== "1") warn(g, "DATABASE_URL (poort 6543) mist pgbouncer=true en/of connection_limit=1: Prisma gebruikt dan voorbereide statements die de pooler niet aankan en opent per instantie te veel verbindingen.", "Voeg ?pgbouncer=true&connection_limit=1 toe aan DATABASE_URL.");
        else ok(g, "DATABASE_URL gebruikt de Supabase transaction pooler met pgbouncer=true en connection_limit=1");
      } else if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(host)) {
        warn(g, "DATABASE_URL is de directe Supabase-verbinding (db.<project>.supabase.co): die is alleen IPv6 en heeft geen pooling, dus ongeschikt voor serverless.", "Gebruik voor DATABASE_URL de Transaction pooler (poort 6543) en bewaar deze directe string als DIRECT_URL.");
      } else if (!pooled) {
        add(g, "info", "DATABASE_URL is geen Supabase-adres; pooling niet beoordeeld.");
      }
      if (/localhost|127\.0\.0\.1/.test(host)) block(g, "DATABASE_URL wijst naar de eigen machine (localhost): een gehoste site kan die niet bereiken.", "Gebruik de verbindingsstring van de gehoste database.");
    }
    const direct = get("DIRECT_URL");
    if (!direct) add(g, parsed && (parsed.port === "6543" || parsed.searchParams.get("pgbouncer") === "true") ? "warn" : "info", "DIRECT_URL ontbreekt. Migraties lopen vast via de transaction pooler; npm run db:migrate:deploy gebruikt DIRECT_URL zodra die is ingesteld.", "Zet DIRECT_URL (Supabase: directe verbinding of session pooler, poort 5432) op de plek waar je migreert; de hosting zelf heeft hem niet nodig.");
    else ok(g, "DIRECT_URL is ingesteld (voor migraties)");
    if (get("VERCEL_ENV") === "preview" || args.target === "staging") add(g, "info", "Preview/staging: gebruik een APARTE database en een Stripe-testaccount, nooit de productiedatabase.");
  }

  // ── company ──────────────────────────────────────────────────────────
  {
    const g = "company";
    const readiness = companyReadiness();
    // "ok" is reported only when NOTHING below objects: this check used to print "compleet en geldig" and then
    // block the very same fields as test numbers in the next lines (rehearsal D9).
    let objections = 0;
    for (const p of readiness.problems) {
      objections++;
      block(
        g,
        p.message,
        p.field === "email"
          ? "Zet COMPANY_EMAIL op het adres waarop klanten je bereiken (het staat op de contact-, privacy-, voorwaarden- en retourpagina's en is ook het standaardadres voor meldingen aan jou) en deploy opnieuw."
          : `Zet ${p.envVar} op de echte waarde uit je KvK-uittreksel / bankrekening en deploy opnieuw.`,
      );
    }
    for (const w of readiness.warnings) {
      objections++;
      (production ? block : warn)(g, w, "Dit is een bekend testnummer: zet de echte waarde uit je KvK-uittreksel of bankgegevens (COMPANY_* in de Production-omgeving).");
    }
    const iban = get("COMPANY_IBAN");
    if (iban && !isValidIban(iban) && !readiness.problems.some((p) => p.field === "iban")) {
      objections++;
      block(g, "COMPANY_IBAN is geen geldige IBAN", "Controleer het rekeningnummer.");
    }
    if (objections === 0) ok(g, "Bedrijfsgegevens (naam, adres, KvK, btw-nummer, IBAN) en het contactadres (COMPANY_EMAIL) zijn compleet, geldig en geen testnummers");
  }

  // ── auth (Clerk) ─────────────────────────────────────────────────────
  let clerkHost: string | null = null;
  {
    const g = "auth";
    const pk = get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    const sk = get("CLERK_SECRET_KEY");
    if (!pk || !sk) block(g, `Clerk-sleutels ontbreken (${!pk ? "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" : ""}${!pk && !sk ? " en " : ""}${!sk ? "CLERK_SECRET_KEY" : ""}): niemand kan inloggen, ook jij niet in /admin.`, "Clerk Dashboard, API keys: kopieer beide sleutels van de PRODUCTIE-instantie naar de Production-omgeving en bouw opnieuw.");
    else {
      const info = clerkKeyInfo(pk);
      const skMode = sk.startsWith("sk_live_") ? "live" : sk.startsWith("sk_test_") ? "test" : null;
      if (!info) block(g, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY heeft niet de vorm pk_live_… of pk_test_… (of is afgekapt).", "Kopieer de sleutel opnieuw uit het Clerk Dashboard.");
      else {
        clerkHost = info.host;
        if (skMode && skMode !== info.mode) block(g, `De publiceerbare Clerk-sleutel is ${info.mode}, de geheime is ${skMode}: ze horen bij dezelfde instantie.`, "Gebruik beide sleutels van dezelfde Clerk-instantie.");
        else if (info.mode === "test") (production ? block : warn)(g, "Clerk staat op een TESTinstantie (pk_test_): echte klanten kunnen daar niet mee registreren.", "Maak in Clerk een Production-instantie aan (met je eigen domein) en gebruik die sleutels.");
        else ok(g, `Clerk-productiesleutels, frontend-adres ${info.host}`);
        const csp = buildCsp({ production: true, clerkPublishableKey: pk });
        const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src ")) ?? "";
        const connectSrc = csp.split("; ").find((d) => d.startsWith("connect-src ")) ?? "";
        if (scriptSrc.includes(`https://${info.host}`) && connectSrc.includes(`https://${info.host}`) && csp.includes("worker-src 'self' blob:")) ok(g, `De Content-Security-Policy staat ${info.host} toe (anders laadt inloggen niet)`);
        else block(g, `De Content-Security-Policy staat ${info.host} niet toe.`, "Dit hoort niet te gebeuren: controleer src/lib/csp.ts.");
        const appHost = (() => { try { return new URL(get("NEXT_PUBLIC_APP_URL") ?? "").hostname.replace(/^www\./, ""); } catch { return null; } })();
        if (info.mode === "live" && appHost && info.host !== `clerk.${appHost}`) warn(g, `Het Clerk-frontendadres is ${info.host}, niet clerk.${appHost}. Dat is toegestaan, maar controleer dat de DNS-records van Clerk voor dit domein zijn aangemaakt.`, "Clerk Dashboard, Domains: voeg de getoonde CNAME-records toe bij je DNS-provider.");
      }
    }
    if (!(get("CLERK_WEBHOOK_SECRET") ?? get("CLERK_WEBHOOK_SIGNING_SECRET"))?.startsWith("whsec_")) warn(g, "CLERK_WEBHOOK_SECRET ontbreekt of begint niet met whsec_: gebruikers worden niet gesynchroniseerd en verwijderde accounts worden niet opgeruimd.", "Clerk Dashboard, Webhooks: endpoint <APP_URL>/api/webhooks/clerk (events user.*), kopieer het Signing Secret.");
    else ok(g, "CLERK_WEBHOOK_SECRET is ingesteld");
    if (get("CLERK_WEBHOOK_ALLOW_UNSIGNED")) warn(g, "CLERK_WEBHOOK_ALLOW_UNSIGNED staat aan (alleen voor lokaal gebruik; in productie wordt het genegeerd).", "Verwijder de variabele.");
    const admins = adminList(get("ADMIN_EMAILS"));
    if (admins.length === 0) warn(g, "ADMIN_EMAILS ontbreekt: er is geen automatische weg naar /admin. Zonder beheerder kun je geen bestelling als betaald markeren.", "Zet ADMIN_EMAILS=<jouw e-mail> (komma-gescheiden lijst), of voer eenmalig uit: npx tsx scripts/make-admin.ts <e-mail>.");
    // Any malformed entry blocks, although the app would just skip it: a typo in a list of two means one person
    // silently never becomes admin, and that is cheaper to fix before launch than to debug after.
    else if (admins.some((a) => !EMAIL_RE.test(a))) block(g, `ADMIN_EMAILS bevat een ongeldig adres (${admins.filter((a) => !EMAIL_RE.test(a)).length} van ${admins.length}).`, "Een lijst van volledige e-mailadressen, gescheiden door komma, puntkomma of spatie.");
    else ok(g, `ADMIN_EMAILS bevat ${admins.length} adres(sen); alleen een door Clerk BEVESTIGD adres wordt beheerder`);
  }

  // ── stripe ───────────────────────────────────────────────────────────
  {
    const g = "stripe";
    const sk = get("STRIPE_SECRET_KEY");
    if (!sk) warn(g, "STRIPE_SECRET_KEY ontbreekt: kaart/iDEAL en alle abonnementen staan uit. Alleen betalen op rekening (bankoverschrijving) werkt.", "Stripe Dashboard, Ontwikkelaars, API-sleutels (zie BLOCKED.md stap 8).");
    else {
      const mode = /^(sk|rk)_live_/.test(sk) ? "live" : /^(sk|rk)_test_/.test(sk) ? "test" : null;
      const pub = get("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
      const pubMode = pub ? (pub.startsWith("pk_live_") ? "live" : pub.startsWith("pk_test_") ? "test" : null) : null;
      if (!mode) block(g, "STRIPE_SECRET_KEY begint niet met sk_live_, sk_test_ of rk_.", "Kopieer de sleutel opnieuw uit het Stripe Dashboard.");
      else if (pub && pubMode !== mode) block(g, `De geheime Stripe-sleutel is ${mode}, de publiceerbare is ${pubMode ?? "onbekend"}.`, "Zet beide sleutels uit dezelfde modus.");
      else if (mode === "test") (production ? block : warn)(g, "STRIPE_SECRET_KEY is een testsleutel: er komt geen echt geld binnen.", production ? "Zet de live-sleutels in de Production-omgeving (testsleutels horen bij Preview/staging)." : "Prima voor staging.");
      else ok(g, "Stripe-sleutel is een livesleutel");
      if (!get("STRIPE_WEBHOOK_SECRET")?.startsWith("whsec_")) block(g, "STRIPE_WEBHOOK_SECRET ontbreekt of begint niet met whsec_: elke webhook wordt geweigerd en betaalde bestellingen blijven op PENDING staan. De webshop biedt iDEAL en kaart daarom niet aan zolang dit ontbreekt (src/lib/cart-gate.ts: beide Stripe-sleutels zijn nodig), alleen betalen per bankoverschrijving.", "Stripe Dashboard, Webhooks, het endpoint, Signing secret (test en live hebben elk een eigen).");
      else ok(g, "STRIPE_WEBHOOK_SECRET is ingesteld");
      const prices = BILLABLE_PLANS.map((p) => ({ plan: p, env: p === "PARTICULIER" ? "STRIPE_PRICE_PARTICULIER" : p === "MONTEUR_PRO" ? "STRIPE_PRICE_MONTEUR" : "STRIPE_PRICE_BEDRIJF", id: get(p === "PARTICULIER" ? "STRIPE_PRICE_PARTICULIER" : p === "MONTEUR_PRO" ? "STRIPE_PRICE_MONTEUR" : "STRIPE_PRICE_BEDRIJF") }));
      for (const p of prices) {
        const cfg = PLANS[p.plan];
        if (!p.id) block(g, `${p.env} ontbreekt: het abonnement ${cfg.name} (€ ${(cfg.priceCents / 100).toFixed(2).replace(".", ",")} per maand) kan niet worden afgesloten.`, `Maak in Stripe een maandelijkse EUR-prijs aan en zet het id (price_…) in ${p.env}.`);
        else if (!p.id.startsWith("price_")) block(g, `${p.env} begint niet met price_ (een product-id of ander id?).`, "Gebruik het prijs-id (price_…), niet het product-id (prod_…).");
      }
      const ids = prices.map((p) => p.id).filter(Boolean);
      if (new Set(ids).size !== ids.length) block(g, "Twee abonnementen delen hetzelfde Stripe-prijs-id.", "Elk abonnement heeft een eigen prijs in Stripe.");
      else if (ids.length === 3 && ids.every((i) => i!.startsWith("price_"))) ok(g, "Drie verschillende prijs-id's zijn ingesteld");
    }
  }

  // ── e-mail ───────────────────────────────────────────────────────────
  let resendFromDomain: string | null = null;
  {
    const g = "email";
    const key = get("RESEND_API_KEY");
    if (!key) block(g, "RESEND_API_KEY ontbreekt: klanten krijgen geen bestelbevestiging en geen betaalinstructies (bij betalen op rekening is dat mail de enige plek met het IBAN en het factuurnummer).", "Resend: maak een API-key aan en verifieer je verzenddomein (zie BLOCKED.md stap 7).");
    else if (!key.startsWith("re_")) block(g, "RESEND_API_KEY begint niet met re_.", "Kopieer de sleutel opnieuw uit Resend.");
    else ok(g, "RESEND_API_KEY is ingesteld");
    const from = get("RESEND_FROM_EMAIL");
    const addr = from ? (/<([^>]+)>/.exec(from)?.[1] ?? from) : "noreply@wasfix.nl";
    if (!EMAIL_RE.test(addr)) block(g, `RESEND_FROM_EMAIL (${from}) bevat geen geldig afzenderadres.`, 'Gebruik de vorm  WasFix Pro <noreply@jouwdomein.nl>.');
    else {
      resendFromDomain = addr.split("@")[1].toLowerCase();
      if (!from) warn(g, `RESEND_FROM_EMAIL is niet ingesteld; de standaardafzender noreply@wasfix.nl wordt gebruikt. Dat werkt alleen als wasfix.nl in Resend is geverifieerd.`, "Zet RESEND_FROM_EMAIL op een adres van het domein dat je in Resend hebt geverifieerd.");
      else ok(g, `Afzender: ${addr}`);
    }
  }

  // ── owner notifications ──────────────────────────────────────────────
  {
    const g = "owner";
    if (hasNotifyChannel()) ok(g, "Er is minstens één kanaal waarlangs je bericht krijgt over bestellingen en fouten");
    else (production ? block : warn)(g, "Er is geen meldingskanaal: nieuwe bestellingen, betalingen en fouten bereiken je niet. (RESEND_API_KEY alleen is geen kanaal; er moet ook een adres zijn.)", "Zet SLACK_WEBHOOK_URL of DISCORD_WEBHOOK_URL, of ORDER_NOTIFY_EMAIL (of COMPANY_EMAIL) samen met RESEND_API_KEY.");
    for (const name of ["SLACK_WEBHOOK_URL", "DISCORD_WEBHOOK_URL"] as const) {
      const v = get(name);
      if (v && !/^https:\/\//.test(v)) block(g, `${name} is geen https-adres.`, "Kopieer de webhook-URL opnieuw.");
    }
  }

  // ── ai ───────────────────────────────────────────────────────────────
  {
    const g = "ai";
    const key = get("GEMINI_API_KEY") ?? get("GOOGLE_AI_API_KEY");
    if (!key) warn(g, "GEMINI_API_KEY ontbreekt: de diagnose werkt op trefwoorden en zegt dat ook (zonder verzonnen zekerheid). Dat is acceptabel, maar het is niet de AI-diagnose die je verkoopt.", "Maak een sleutel in Google AI Studio en zet GEMINI_API_KEY; zet een budgetmelding in Google Cloud.");
    else if (!/^AIza/.test(key)) warn(g, "GEMINI_API_KEY begint niet met AIza: mogelijk een verkeerde sleutel.", "Kopieer de sleutel opnieuw uit Google AI Studio.");
    else ok(g, "GEMINI_API_KEY is ingesteld");
  }

  // ── ops ──────────────────────────────────────────────────────────────
  {
    const g = "ops";
    const cron = get("CRON_SECRET");
    if (!cron) block(g, "CRON_SECRET ontbreekt: ALLE geplande taken weigeren te draaien (verlopen bestellingen annuleren, betaalherinneringen, Stripe-afstemming, bewaartermijnen).", "Zet CRON_SECRET op een lange willekeurige tekst (bijv. openssl rand -hex 32) in de Production-omgeving; Vercel stuurt hem dan zelf mee.");
    else if (cron.length < 24) warn(g, "CRON_SECRET is korter dan 24 tekens.", "Gebruik minstens 32 willekeurige tekens (openssl rand -hex 32).");
    else ok(g, "CRON_SECRET is ingesteld");
    const u = get("UPSTASH_REDIS_REST_URL");
    const t = get("UPSTASH_REDIS_REST_TOKEN");
    if (u && t) ok(g, "Upstash is ingesteld: de rate limits gelden over alle serverinstanties");
    else if (u || t) block(g, "Van UPSTASH_REDIS_REST_URL en UPSTASH_REDIS_REST_TOKEN is er maar één ingesteld.", "Zet beide of geen van beide.");
    else warn(g, "Upstash ontbreekt (verminderde modus, toegestaan): de rate limits (bijv. 10 bestellingen per uur per IP) tellen per serverinstantie en beginnen bij elke koude start opnieuw. Op een serverless host is de echte grens dus de ingestelde grens maal het aantal instanties. De maandquota in de database (diagnoses, API-aanroepen) blijven wel exact.", "Optioneel maar aanbevolen: maak een gratis Upstash Redis-database in de EU en zet UPSTASH_REDIS_REST_URL en _TOKEN.");
  }

  // ── network checks ───────────────────────────────────────────────────
  if (args.live) await liveChecks(args, checks, { clerkHost, resendFromDomain, production });
  else {
    for (const [g, m] of [["database", "Databaseverbinding en migraties"], ["catalog", "Beheerder, kostprijzen en voorraad in de database"], ["stripe", "Stripe-account, prijzen, webhook, Stripe Tax en klantportaal"], ["email", "Resend-domeinstatus"], ["auth", "Clerk-instantie bereikbaar"]] as const) skipped(g, m);
  }

  const filtered = args.only ? checks.filter((c) => args.only!.includes(c.group)) : checks;
  const blockers = filtered.filter((c) => c.level === "block").length;
  const warnings = filtered.filter((c) => c.level === "warn").length;
  return { verdict: blockers ? "NOT READY" : warnings ? "READY WITH WARNINGS" : "READY", blockers, warnings, skipped: filtered.filter((c) => c.level === "skip").length, checks: filtered };
}

async function liveChecks(args: Args, checks: Check[], ctx: { clerkHost: string | null; resendFromDomain: string | null; production: boolean }) {
  const add = (group: string, level: Level, message: string, fix?: string) => checks.push({ group, level, message, fix });
  const { production } = ctx;

  // database
  const dbUrl = get("DATABASE_URL");
  if (dbUrl && /^postgres(ql)?:\/\//i.test(dbUrl)) {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasourceUrl: dbUrl, log: [] });
    try {
      await prisma.$queryRaw`SELECT 1`;
      add("database", "ok", "De database is bereikbaar");
      const folders = fs.readdirSync(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      try {
        const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
        const done = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
        const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
        const pending = folders.filter((f) => !done.has(f));
        if (failed.length) add("database", "block", `Een migratie is mislukt en niet opgelost: ${failed.join(", ")}.`, "Zoek de oorzaak (npm run db:migrate:status), herstel de database en los het op met: npx prisma migrate resolve --rolled-back <naam>, daarna npm run db:migrate:deploy.");
        else if (pending.length) add("database", "block", `${pending.length} migratie(s) zijn nog niet toegepast: ${pending.join(", ")}.`, "Draai vanaf een machine met DIRECT_URL: npm run db:migrate:deploy");
        else add("database", "ok", `Alle ${folders.length} migraties zijn toegepast`);
      } catch {
        add("database", "block", "De tabel _prisma_migrations ontbreekt of is onleesbaar: de database is nooit gemigreerd.", "Draai vanaf een machine met DIRECT_URL: npm run db:migrate:deploy en daarna eenmalig npm run db:seed.");
      }

      // catalog and people (read-only)
      try {
        const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true, id: true, clerkId: true } });
        const allowed = new Set(adminList(get("ADMIN_EMAILS")).map((s) => s.toLowerCase()));
        const demo = admins.filter((a) => (["demo@wasfixpro.nl", "klant@wasfixpro.nl", "monteur@wasfixpro.nl"].includes(a.email.toLowerCase()) || a.id === "jdahoe-superadmin") && !allowed.has(a.email.toLowerCase()));
        if (demo.length) add("catalog", "block", `De database bevat ${demo.length} demo-beheerdersaccount(s) (${demo.map((d) => d.email).join(", ")}): de database is met demodata gevuld.`, "Gebruik een lege productiedatabase: de seed maakt in productiemodus geen gebruikers. Verwijder deze rijen of begin met een verse database.");
        if (admins.length === 0 && allowed.size === 0) add("catalog", "block", "Er is geen beheerder en ADMIN_EMAILS is leeg: niemand kan /admin openen.", "Zet ADMIN_EMAILS of voer uit: npx tsx scripts/make-admin.ts <e-mail>.");
        else if (admins.length === 0) add("catalog", "info", "Er is nog geen beheerder; de eerste bevestigde inlog met een adres uit ADMIN_EMAILS wordt beheerder.");
        else add("catalog", "ok", `${admins.length} beheerder(s) in de database`);

        const total = await prisma.part.count();
        const estimate = await prisma.part.count({ where: { costSource: "ESTIMATE" } });
        const inStock = await prisma.part.count({ where: { stock: { gt: 0 } } });
        if (total === 0) add("catalog", "block", "De catalogus is leeg: er is niets te verkopen.", "Draai eenmalig npm run db:seed (productiemodus zet de voorraad op 0) en voer voorraad in via /admin/onderdelen.");
        else {
          if (inStock === 0) add("catalog", "block", `Alle ${total} onderdelen staan op voorraad 0: er is niets te bestellen.`, "Voer de echte voorraad in via /admin/onderdelen (of de CSV-import).");
          else add("catalog", "ok", `${inStock} van ${total} onderdelen hebben voorraad`);
          if (estimate > 0) add("catalog", "warn", `${estimate} van ${total} onderdelen hebben nog een GESCHATTE kostprijs (costSource ESTIMATE). De marge in /admin telt alleen offerte-kostprijzen; de rest heet 'schatting'.`, "Vraag offertes aan en zet de kostprijs met bron QUOTE in /admin/onderdelen voor de onderdelen die je echt gaat verkopen.");
          else add("catalog", "ok", "Alle kostprijzen zijn offerte-prijzen (QUOTE)");
        }
      } catch (err) {
        add("catalog", "warn", `Catalogus/beheerders niet te lezen: ${(err as Error).message.split("\n")[0].slice(0, 120)}`, "Los eerst de databaseproblemen hierboven op.");
      }
    } catch (err) {
      add("database", "block", `De database is niet bereikbaar: ${(err as Error).message.split("\n").pop()?.slice(0, 140) ?? "onbekende fout"}`, "Controleer DATABASE_URL (wachtwoord, host, poort) en of het project niet gepauzeerd is (Supabase pauzeert gratis projecten).");
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  // stripe (the application's own readiness check: same rules as the code that sells)
  if (get("STRIPE_SECRET_KEY")) {
    try {
      const { checkStripeReadiness } = await import("../src/lib/stripe-readiness");
      const result = await checkStripeReadiness({ production, appUrl: checkAppUrlSafe() ?? undefined });
      for (const c of result.checks) {
        if (c.ok) add("stripe", "ok", `${c.label}: ${c.detail}`);
        else add("stripe", c.level === "block" ? "block" : "warn", `${c.label}: ${c.detail}`, c.fix);
      }
      add("stripe", "info", "Niet te controleren via de API en dus aan jou: iDEAL voor abonnementen (volgens Stripe's documentatie via SEPA, niet getest), je btw-nummer bij Stripe voor door Stripe gemaakte facturen, en de opzegbaarheid 'aan het einde van de periode' in het klantportaal als dat hierboven niet als gecontroleerd staat.");
    } catch (err) {
      add("stripe", "block", `Stripe-controle mislukt: ${(err as Error).message.slice(0, 140)}`, "Controleer STRIPE_SECRET_KEY en de internetverbinding.");
    }
  }

  // resend
  const rk = get("RESEND_API_KEY");
  if (rk && ctx.resendFromDomain) {
    try {
      const res = await http("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${rk}` } });
      if (res.status === 401 || res.status === 403) add("email", "info", "De Resend-sleutel mag alleen versturen (niet de domeinen lezen): de domeinstatus is niet te controleren. Controleer in Resend dat het domein 'Verified' is.");
      else if (!res.ok) add("email", "warn", `Resend antwoordde HTTP ${res.status} op de domeinlijst.`, "Controleer de API-sleutel in Resend.");
      else {
        const body = (await res.json()) as { data?: Array<{ name: string; status: string }> };
        const dom = body.data?.find((d) => d.name.toLowerCase() === ctx.resendFromDomain || ctx.resendFromDomain!.endsWith(`.${d.name.toLowerCase()}`));
        if (!dom) add("email", "block", `Het afzenderdomein ${ctx.resendFromDomain} staat niet in je Resend-account: mails worden geweigerd.`, "Voeg het domein toe in Resend (Domains) en zet de getoonde DNS-records (SPF, DKIM) bij je DNS-provider.");
        else if (dom.status !== "verified") add("email", "block", `Het Resend-domein ${dom.name} heeft status '${dom.status}', niet 'verified'.`, "Zet de DNS-records van Resend (SPF, DKIM) bij je DNS-provider en druk op Verify. Dit staat NIET al klaar: eerdere documentatie beweerde dat, zonder het te controleren.");
        else add("email", "ok", `Het Resend-domein ${dom.name} is geverifieerd`);
      }
    } catch (err) {
      add("email", "warn", `Resend niet bereikbaar: ${(err as Error).message.slice(0, 100)}`, "Probeer het later opnieuw.");
    }
  }

  // clerk
  if (ctx.clerkHost) {
    try {
      const res = await http(`https://${ctx.clerkHost}/v1/environment`);
      if (res.ok) add("auth", "ok", `Het Clerk-frontendadres ${ctx.clerkHost} antwoordt`);
      else add("auth", "warn", `Het Clerk-frontendadres ${ctx.clerkHost} antwoordde HTTP ${res.status}. (Dit eindpunt is niet tegen een echte Clerk-instantie getest.)`, "Controleer in Clerk Dashboard, Domains, dat de DNS-records zijn gecontroleerd en het certificaat is uitgegeven.");
    } catch {
      add("auth", "warn", `Het Clerk-frontendadres ${ctx.clerkHost} is niet bereikbaar.`, "Clerk Dashboard, Domains: voeg de CNAME-records toe en wacht op verificatie.");
    }
  }

  // upstash
  const uu = get("UPSTASH_REDIS_REST_URL");
  const ut = get("UPSTASH_REDIS_REST_TOKEN");
  if (uu && ut) {
    try {
      const res = await http(`${uu.replace(/\/+$/, "")}/ping`, { headers: { Authorization: `Bearer ${ut}` } });
      const body = (await res.text()).slice(0, 80);
      if (res.ok && /PONG/i.test(body)) add("ops", "ok", "Upstash antwoordt PONG");
      else add("ops", "warn", `Upstash antwoordde HTTP ${res.status}.`, "Controleer URL en token (Upstash console, REST API). Zolang dit niet klopt valt de rate limit terug op het geheugen.");
    } catch {
      add("ops", "warn", "Upstash is niet bereikbaar.", "Controleer UPSTASH_REDIS_REST_URL.");
    }
  }

  // gemini
  const gk = get("GEMINI_API_KEY") ?? get("GOOGLE_AI_API_KEY");
  if (gk) {
    const model = get("GEMINI_MODEL") ?? "gemini-2.0-flash";
    try {
      const res = await http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(gk)}`);
      if (res.ok) add("ai", "ok", `Gemini-model ${model} bestaat en de sleutel werkt (lijst-aanroep, er is niets gegenereerd)`);
      else add("ai", "warn", `Gemini antwoordde HTTP ${res.status} voor model ${model}.`, res.status === 404 ? "Het model bestaat niet (meer): zet GEMINI_MODEL op een bestaand model." : "Controleer de sleutel en of de Generative Language API aan staat.");
    } catch {
      add("ai", "warn", "Gemini is niet bereikbaar.", "Probeer het later opnieuw.");
    }
  }

  if (args.url) await probeDeployed(args.url.replace(/\/+$/, ""), checks, ctx);
}

function checkAppUrlSafe(): string | null {
  const raw = get("NEXT_PUBLIC_APP_URL");
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Which stand-in values appear in a page. Matched as whole tokens: "12345678" is a
 * placeholder KvK, but it is also a substring of the perfectly real IBAN
 * NL44RABO0123456789, and a substring test blocked a correct deployment.
 */
function placeholdersIn(rawHtml: string, values: readonly string[]): string[] {
  // Form hints ("1234 AB", "06 12345678", "NL123456789B01") are meant to look like examples.
  const html = rawHtml.replace(/\splaceholder="[^"]*"/gi, "");
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  return values.filter((v) => new RegExp(`(?<![A-Za-z0-9])${esc(v)}(?![A-Za-z0-9])`, "i").test(html));
}

/** The deployed site, as a visitor sees it. Read-only requests (one POST with a bad signature, which must be refused). */
async function probeDeployed(base: string, checks: Check[], ctx: { clerkHost: string | null; production: boolean }) {
  const g = "live";
  const add = (level: Level, message: string, fix?: string) => checks.push({ group: g, level, message, fix });
  const expectedOrigin = checkAppUrlSafe();
  const baseOrigin = new URL(base).origin;
  if (expectedOrigin && expectedOrigin !== baseOrigin) add("warn", `--url (${baseOrigin}) is niet hetzelfde als NEXT_PUBLIC_APP_URL (${expectedOrigin}).`, "Controleer of je het juiste adres test.");

  const attempt = async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      add("block", `${name}: niet bereikbaar (${(err as Error).message.slice(0, 80)})`, "Controleer dat de site online is en het domein naar het project wijst.");
      return null;
    }
  };

  const health = await attempt("/api/v1/health", () => http(`${base}/api/v1/health`, { redirect: "follow" }));
  if (health) {
    const body = (await health.json().catch(() => null)) as { status?: string; checks?: { database?: string; migrations?: string } } | null;
    if (health.status === 200 && body?.checks?.database === "ok" && body.checks.migrations !== "pending") add("ok", `/api/v1/health: database ${body.checks.database}, migraties ${body.checks.migrations}`);
    else add("block", `/api/v1/health antwoordt HTTP ${health.status} (database: ${body?.checks?.database ?? "?"}, migraties: ${body?.checks?.migrations ?? "?"}).`, "Los de database/migratie-melding op: npm run db:migrate:deploy, of controleer DATABASE_URL in de hostingomgeving.");
  }

  const home = await attempt("homepage", () => http(`${base}/`, { redirect: "follow" }));
  if (home) {
    const csp = home.headers.get("content-security-policy");
    if (csp) add("ok", "Content-Security-Policy wordt afgedwongen (niet 'Report-Only')");
    else add("block", "Er is geen afgedwongen Content-Security-Policy (alleen Report-Only of niets).", "Controleer dat dit een productiebuild is (NODE_ENV=production).");
    if (ctx.clerkHost && csp && !csp.includes(`https://${ctx.clerkHost}`)) add("block", `De live CSP noemt ${ctx.clerkHost} niet: inloggen wordt door de browser geblokkeerd.`, "Bouw opnieuw met de juiste NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.");
    if ((home.headers.get("strict-transport-security") ?? "").length === 0) add("warn", "Geen Strict-Transport-Security header.", "Controleer de headers in next.config.ts en de hosting.");
    const html = await home.text();
    if (/Demo modus/i.test(html)) add("block", "De homepage bevat 'Demo modus'.", "Dit is een demo-build; bouw opnieuw zonder DEMO_MODE.");
  }

  const login = await attempt("/inloggen", () => http(`${base}/inloggen`, { redirect: "follow" }));
  if (login) {
    const html = await login.text();
    if (/Demo modus/i.test(html)) add("block", "/inloggen toont 'Demo modus': inloggen is uitgeschakeld in deze build.", "Controleer dat de Clerk-sleutels bij de BUILD beschikbaar waren en bouw opnieuw.");
    else if (ctx.clerkHost && !html.includes(ctx.clerkHost)) add("warn", `/inloggen verwijst niet naar ${ctx.clerkHost}; Clerk lijkt niet geladen.`, "Controleer de Clerk-sleutels in de Production-omgeving en bouw opnieuw.");
    else if (ctx.clerkHost) add("ok", `/inloggen verwijst naar het Clerk-adres ${ctx.clerkHost} (geen demo-kaart)`);
    else add("info", "/inloggen toont geen demo-kaart; zonder Clerk-sleutels in deze omgeving is niet te beoordelen of het inlogscherm echt laadt.");
  }

  for (const p of ["/dashboard", "/admin", "/monteur/dashboard"]) {
    const r = await attempt(p, () => http(`${base}${p}`));
    if (r) {
      const loc = r.headers.get("location") ?? "";
      if ([302, 303, 307, 308].includes(r.status) && /inloggen|sign-in|clerk/i.test(loc)) add("ok", `${p} zonder sessie stuurt door naar inloggen`);
      else add("block", `${p} zonder sessie antwoordt HTTP ${r.status}${loc ? ` -> ${loc}` : ""}: de pagina is niet afgeschermd.`, "Controleer de Clerk-configuratie en DEMO_MODE; zie /inloggen hierboven.");
    }
  }

  const robots = await attempt("robots.txt", () => http(`${base}/robots.txt`, { redirect: "follow" }));
  if (robots) {
    const txt = await robots.text();
    const sm = /^Sitemap:\s*(\S+)/im.exec(txt)?.[1];
    if (!sm) add("block", "robots.txt noemt geen Sitemap.", "NEXT_PUBLIC_APP_URL is niet bruikbaar in deze build; zet hem en bouw opnieuw.");
    else if (/localhost/.test(sm) || (expectedOrigin && new URL(sm).origin !== expectedOrigin)) add("block", `robots.txt wijst naar ${sm}, niet naar ${expectedOrigin ?? "het publieke adres"}.`, "Zet NEXT_PUBLIC_APP_URL correct en bouw opnieuw.");
    else add("ok", `robots.txt noemt ${sm}`);
  }

  const sitemap = await attempt("sitemap.xml", () => http(`${base}/sitemap.xml`, { redirect: "follow" }));
  if (sitemap) {
    const xml = await sitemap.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (locs.length === 0) add("block", "sitemap.xml bevat geen URL's.", "Controleer NEXT_PUBLIC_APP_URL en de databaseverbinding.");
    else if (locs.some((l) => /localhost/.test(l)) || (expectedOrigin && locs.some((l) => new URL(l).origin !== expectedOrigin))) add("block", "sitemap.xml bevat URL's op een ander adres dan NEXT_PUBLIC_APP_URL.", "Zet NEXT_PUBLIC_APP_URL correct en bouw opnieuw.");
    else add("ok", `sitemap.xml bevat ${locs.length} URL's op ${new URL(locs[0]).origin}`);
  }

  const part = await attempt("onderdeelpagina", () => http(`${base}/onderdelen/WF-PUMP-01`, { redirect: "follow" }));
  if (part && part.ok) {
    const html = await part.text();
    const canon = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    if (canon && expectedOrigin && new URL(canon).origin === expectedOrigin) add("ok", "De canonical van een onderdeelpagina staat op het publieke adres");
    else add("warn", `Canonical van een onderdeelpagina is ${canon ?? "afwezig"}.`, "Controleer NEXT_PUBLIC_APP_URL.");
  }

  if (expectedOrigin) {
    const host = new URL(expectedOrigin).hostname;
    const other = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    // fetch cannot spoof Host; ask the other host name directly (DNS must exist for it).
    try {
      const r = await http(`https://${other}/`);
      const loc = r.headers.get("location") ?? "";
      if ([301, 307, 308].includes(r.status) && loc.startsWith(expectedOrigin)) add("ok", `${other} stuurt door naar ${expectedOrigin}`);
      else add("warn", `${other} antwoordt HTTP ${r.status}${loc ? ` -> ${loc}` : ""}, geen doorverwijzing naar ${expectedOrigin}.`, `Laat ${other} naar hetzelfde project wijzen (de app verwijst het zelf door), of zet de doorverwijzing in de domeininstellingen van de host.`);
    } catch {
      add("info", `${other} is niet bereikbaar (geen DNS-record of certificaat); alleen een probleem als je dat adres ook wilt laten werken.`);
    }
    try {
      const r = await http(`http://${host}/`);
      if ([301, 307, 308].includes(r.status) && (r.headers.get("location") ?? "").startsWith("https://")) add("ok", "http:// wordt doorgestuurd naar https://");
      else add("warn", `http://${host} antwoordt HTTP ${r.status} in plaats van door te sturen naar https.`, "Zet HTTPS-redirect aan bij de host.");
    } catch {
      add("info", `http://${host} is niet bereikbaar (poort 80 dicht); acceptabel.`);
    }
  }

  const hook = await attempt("Stripe-webhook", () => http(`${base}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" }, body: "{}" }));
  if (hook) {
    if (hook.status === 400) add("ok", "Stripe-webhook weigert een ongeldige handtekening (400)");
    else add("block", `Stripe-webhook antwoordt HTTP ${hook.status} op een ongeldige handtekening (verwacht 400).`, "Controleer STRIPE_WEBHOOK_SECRET in de Production-omgeving.");
  }

  const cron = await attempt("cron-route", () => http(`${base}/api/cron/orders`));
  if (cron) {
    if (cron.status === 401) add("ok", "Geplande taken weigeren aanroepen zonder geheim (401): CRON_SECRET staat in de hosting");
    else if (cron.status === 503) add("block", "Geplande taken antwoorden 503 cron_not_configured: CRON_SECRET staat NIET in de hostingomgeving.", "Zet CRON_SECRET in de Production-omgeving en deploy opnieuw.");
    else add("block", `Een cron-route zonder geheim antwoordt HTTP ${cron.status} (verwacht 401).`, "De route hoort zonder 'Authorization: Bearer <CRON_SECRET>' niet te draaien; controleer de deploy.");
  }

  const checkout = await attempt("/checkout", () => http(`${base}/checkout`, { redirect: "follow" }));
  if (checkout) {
    const html = await checkout.text();
    const { COMPANY_PLACEHOLDER_VALUES } = await import("../src/lib/company-validate");
    const bad = placeholdersIn(html, COMPANY_PLACEHOLDER_VALUES);
    if (bad.length) add("block", `/checkout bevat voorbeeldgegevens: ${bad.join(", ")}.`, "Zet de echte COMPANY_* waarden en deploy opnieuw.");
    else add("ok", "/checkout bevat geen voorbeeld-KvK, -btw-nummer of -IBAN");
  }
  // The legal pages are prerendered at BUILD time with the COMPANY_* values of that build (rehearsal R2-19:
  // a build made without them and started later with them printed correct invoices but a /voorwaarden that still
  // said "in oprichting"). So compare what the live pages say with the variables under test.
  const { COMPANY_PLACEHOLDER_VALUES, canonicalCompanyValue } = await import("../src/lib/company-validate");
  const { companyReadiness } = await import("../src/lib/plans");
  const configured = companyReadiness().ready
    ? { name: canonicalCompanyValue("name", get("COMPANY_NAME")), kvk: canonicalCompanyValue("kvk", get("COMPANY_KVK")), email: (get("COMPANY_EMAIL") ?? "").trim() }
    : null;
  const REDEPLOY = "De bedrijfsgegevens worden bij de build in de pagina's gebakken: deploy opnieuw (bouw opnieuw, niet alleen herstarten) na elke wijziging van COMPANY_*.";
  for (const p of ["/", "/contact", "/privacy", "/prijzen", "/voorwaarden"]) {
    const r = await attempt(p, () => http(`${base}${p}`, { redirect: "follow" }));
    if (!r) continue;
    const html = await r.text();
    const bad = placeholdersIn(html, COMPANY_PLACEHOLDER_VALUES);
    if (bad.length) add("block", `${p} bevat voorbeeldgegevens: ${bad.join(", ")}.`, `Zet de echte COMPANY_* waarden en deploy opnieuw. ${REDEPLOY}`);
    if (configured && (p === "/voorwaarden" || p === "/contact")) {
      const text = visibleText(html);
      const missing: string[] = [];
      if (p === "/voorwaarden" && !text.includes(configured.name)) missing.push("de bedrijfsnaam");
      if (!new RegExp(`(?<![0-9])${configured.kvk}(?![0-9])`).test(text)) missing.push("het KvK-nummer");
      if (p === "/contact" && configured.email && !text.includes(configured.email)) missing.push("het contactadres");
      if (missing.length) add("block", `De live ${p} toont ${missing.join(" en ")} uit COMPANY_* niet: de pagina is gebouwd met andere (of geen) bedrijfsgegevens dan nu zijn ingesteld.`, REDEPLOY);
      else add("ok", `De live ${p} toont de ingestelde bedrijfsgegevens`);
    }
  }
}

/** The text a visitor reads: scripts and styles dropped, tags stripped, the common entities decoded. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&(?:#39|#x27|apos);/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

export function render(report: Report): string {
  const out: string[] = [];
  const groups = [...new Set(report.checks.map((c) => c.group))];
  const tag: Record<Level, string> = { ok: "  ok   ", info: "  info ", warn: "  WARN ", block: "  BLOCK", skip: "  skip " };
  for (const g of groups) {
    out.push(`\n[${g}]`);
    for (const c of report.checks.filter((x) => x.group === g)) {
      out.push(`${tag[c.level]} ${c.message}`);
      if (c.fix && (c.level === "block" || c.level === "warn")) for (const line of c.fix.split("\n")) out.push(`         -> ${line}`);
    }
  }
  out.push("");
  // The JSON keeps the English verdict values (READY / READY WITH WARNINGS / NOT READY) for scripts; the text report is Dutch like the rest of it.
  const verdictNl: Record<Report["verdict"], string> = { READY: "KLAAR", "READY WITH WARNINGS": "KLAAR MET WAARSCHUWINGEN", "NOT READY": "NIET KLAAR" };
  out.push(`UITSLAG: ${verdictNl[report.verdict]} (${report.blockers} blokkerend, ${report.warnings} waarschuwing(en))`);
  const skippedCount = report.checks.filter((c) => c.level === "skip").length;
  if (skippedCount > 0) out.push(`LET OP: offline gedraaid, ${skippedCount} controle(s) overgeslagen. Draai opnieuw met --live-checks (database, Stripe, Resend, Clerk) voordat je op dit oordeel vertrouwt, en met --url <adres> na de deploy.`);
  const first = report.checks.find((c) => c.level === "block");
  if (first) out.push(`\nVOLGENDE STAP: [${first.group}] ${first.fix ?? first.message}\n(Alle ${report.blockers} blokkerende punten staan hierboven met hun oplossing; begin bovenaan.)`);
  return out.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runPreflight(args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(render(report));
  process.exit(report.blockers > 0 ? 1 : args.strict && report.warnings > 0 ? 1 : 0);
}

if (process.argv[1] && /preflight\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error("preflight crashed:", err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
