# WasFix Pro

AI-gestuurde wasmachine diagnose + onderdelen platform.

## Stack
- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + custom shadcn/ui componenten
- Prisma + SQLite (dev) / PostgreSQL (prod)
- Anthropic Claude API (claude-sonnet-4-5) met intelligente fallback
- Clerk (auth) — uitschakelbaar via `DEMO_MODE=true`
- Stripe (subscriptions + one-time orders)
- Resend (transactionele emails)
- Zustand (cart state)

## Quick start

```bash
npm install
npx prisma db push
npx prisma db seed   # of: npx tsx prisma/seed.ts
npm run dev
```

Open http://localhost:3000

In demo mode (default) werkt alles zonder externe services. De seed maakt:
- 18 wasmachines (10 merken)
- 20 onderdelen
- 26 foutcodes
- 6 reparatiegidsen
- 1 demo admin user (`demo@wasfixpro.nl`)

## Architectuur

```
src/
├── app/
│   ├── api/             # Server endpoints (diagnose, checkout, stripe)
│   ├── (public pages)/  # Landing, diagnose, parts, guides, brands
│   ├── dashboard/       # User dashboard
│   ├── monteur/         # Technician dashboard
│   └── admin/           # Admin panel
├── components/
│   ├── ui/              # Button, card, badge, dialog, ...
│   └── (composite)/     # SiteHeader, CartDrawer, PartCard, ...
└── lib/
    ├── prisma.ts        # DB client
    ├── auth.ts          # User resolution + plan limits
    ├── anthropic.ts     # AI diagnosis + demo fallback
    ├── stripe.ts        # Stripe client
    ├── email.ts         # Resend templates
    └── utils.ts
```

## Production setup

1. **Database**: Switch `prisma/schema.prisma` provider to `postgresql` and set `DATABASE_URL` to a Supabase / Neon / Railway URL.
2. **Auth**: Set `CLERK_*` env vars and `DEMO_MODE=false`.
3. **AI**: Set `ANTHROPIC_API_KEY`.
4. **Payments**: Create Stripe products/prices, set `STRIPE_*` env vars and webhook secret.
5. **Email**: Set `RESEND_API_KEY`.
6. **Deploy**: `vercel deploy` (Vercel-friendly).

## Demo mode

Als `DEMO_MODE=true` (default):
- Authentication is uitgeschakeld; gebruikers worden auto-ingelogd als demo user (admin)
- AI diagnose gebruikt een keyword-based fallback die echte diagnose imiteert
- Stripe checkouts worden direct als "betaald" gemarkeerd zonder echte transacties
- Emails worden niet verzonden (silent no-op)

Zo kun je de hele flow demonstreren zonder API keys.

## Routes overview

| Path | Beschrijving |
|---|---|
| `/` | Landing page |
| `/diagnose` | AI chat met diagnose JSON output + onderdelen/gidsen suggesties |
| `/onderdelen` | Parts shop met filters per categorie en merk |
| `/onderdelen/[sku]` | Onderdeel detail + cart |
| `/checkout` | Cart & afrekenen |
| `/bestelling/[id]` | Bestelling bevestiging |
| `/foutcodes` | Foutcode database (zoeken, filters per merk) |
| `/foutcodes/[code]` | Foutcode detail met oorzaken, gidsen, onderdelen |
| `/gidsen` | Reparatiegids browser |
| `/gidsen/[slug]` | Stap-voor-stap interactieve gids |
| `/merken` | Brand directory |
| `/merken/[brand]` | Modellen per merk |
| `/merken/[brand]/[model]` | Model detail |
| `/prijzen` | Subscription tiers |
| `/dashboard` | User dashboard |
| `/dashboard/diagnoses` | Diagnose history |
| `/dashboard/bestellingen` | Order history |
| `/dashboard/wasmachines` | Saved machines |
| `/dashboard/profiel` | Profile + subscription |
| `/monteur` | Technician Pro dashboard |
| `/admin` | Admin overview |
| `/admin/onderdelen` | CRUD onderdelen |
| `/admin/gidsen` | CRUD gidsen |
| `/admin/foutcodes` | CRUD foutcodes |
| `/admin/gebruikers` | User management |

## API endpoints

- `POST /api/diagnose` — Chat completion + onderdelen matching
- `POST /api/checkout` — Cart → Order (Stripe als configured, anders demo)
- `POST /api/stripe/subscribe` — Subscription upgrade
- `POST /api/stripe/webhook` — Stripe events handler
