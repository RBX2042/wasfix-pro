# ARCHITECTURE.md

WasFix Pro — production architecture as of 2026-05-26.

## Tech stack

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js 22 | LTS |
| Framework | Next.js (App Router) | 15.5.18 |
| Language | TypeScript (strict) | 5.7.2 |
| Styling | Tailwind CSS 4 + custom CSS (`wasfix-design.css`) | latest |
| UI primitives | shadcn/ui + custom dark-theme components | — |
| Auth | Clerk (DEMO_MODE fallback) | — |
| Database | Supabase Postgres via Prisma | Prisma 6.1.0 |
| Public data | Static JSON fallback (`src/data/*.json`) | — |
| AI | Google Gemini 2.0 Flash | — |
| Payments | Stripe (iDEAL, Bancontact, card) | — |
| Email | Resend + react-email templates | — |
| Hosting | Vercel | Production |
| Analytics | Vercel Analytics + Speed Insights | active |
| Domain | wasfix.nl (TransIP DNS) | live |

## Routing (App Router)

### Public pages
- `/` — homepage (dark theme with interactive SVG)
- `/diagnose` — AI diagnose chat
- `/foutcodes` — error code index
- `/foutcodes/[code]` — error code detail (FAQPage + TechArticle JSON-LD)
- `/gidsen` — repair guide index
- `/gidsen/[slug]` — guide detail (HowTo JSON-LD)
- `/onderdelen` — part catalog
- `/onderdelen/[sku]` — part detail (Product + Offer JSON-LD)
- `/merken` — brand index
- `/merken/[brand]` — brand page
- `/merken/[brand]/[model]` — model page
- `/prijzen` — pricing
- `/monteur` — B2B landing (public)
- `/help` — help center
- `/help/[slug]` — help article
- `/contact` — contact form
- `/over` — about
- `/api-info` — API documentation
- `/tools/repareren-of-vervangen` — repair-or-replace calc
- `/tools/garantie-check` — warranty timeline tool

### Legal
- `/privacy` `/voorwaarden` `/cookies` `/garantie` `/klachten` `/disclaimer` `/retourvoorwaarden`

### Checkout flow
- `/checkout` (multi-step) → Stripe Checkout → `/bestelling/[id]?success=1`
- `/retour/start` (RMA self-service)

### Auth-gated
- `/dashboard` + sub: `/diagnoses`, `/bestellingen`, `/wasmachines`, `/profiel`
- `/monteur/dashboard` + sub: `/klanten`, `/onderdelen`, `/werkorders`
- `/admin` + sub: `/gebruikers`, `/foutcodes`, `/gidsen`, `/onderdelen`

### Auth pages
- `/inloggen` `/registreren` `/upgrade`

## API endpoints

### Public
- `POST /api/diagnose` — Gemini chat (streaming)
- `POST /api/diagnose/image` — Vision diagnose
- `GET /api/parts` `GET /api/parts/[sku]` — catalog
- `GET /api/errorcodes` `GET /api/errorcodes/[code]` — codes
- `GET /api/guides` `GET /api/guides/[id]` — guides
- `GET /api/stats` — homepage counters
- `POST /api/checkout` — Stripe session create
- `POST /api/retour` — RMA submission

### Auth
- `GET /api/orders` `GET /api/orders/[id]`
- `GET /api/user/plan`

### Webhooks
- `POST /api/stripe/webhook`
- `POST /api/stripe/portal`
- `POST /api/stripe/subscribe`
- `POST /api/webhooks/clerk`

## Database (Prisma)

```
User             — id, email, name, role, plan, clerkId
WashingMachine   — id, brand, model, yearFrom, yearTo, imageUrl
SavedMachine     — user-saved machines
ErrorCode        — id, code, machineId, title, description, causes, severity, diy
RepairGuide      — id, slug, title, steps (JSON), tools, premium
Part             — id, sku, name, category, brand, priceEur, stock, isOriginal
PartMachine      — M-N: parts ↔ machines
ErrorCodeParts   — M-N: codes ↔ parts
ErrorCodeGuides  — M-N: codes ↔ guides
GuideParts       — M-N: guides ↔ parts
Diagnosis        — saved AI diagnoses
Order            — id, userId, items, total, status, stripePaymentId
OrderItem        — line items
StripeEvent      — webhook event log
```

## Static data fallback

Public pages read from `src/data/*.json` (machines, parts, error-codes, guides + relations).
Generated via `scripts/dump-static-data.mjs`, `generate-error-codes.mjs`, `generate-parts.mjs`, `generate-guides.mjs`.

This enables full functionality (catalog, detail pages, sitemap) without DATABASE_URL configured.

Auth/orders/admin still require DB — they degrade to demo-mode gracefully.

## External services

| Service | Status | env var(s) |
|---|---|---|
| Vercel | ✅ live (wasfix.nl) | auto |
| Vercel Analytics | ✅ active | auto |
| Supabase | ⚠️ DATABASE_URL set but password placeholder | `DATABASE_URL` |
| Clerk | ⚠️ DEMO_MODE | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| Stripe | ⚠️ code-ready, no live key | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Resend | ⚠️ DNS DKIM ready, no API key | `RESEND_API_KEY` |
| Gemini | ⚠️ quota=0 key, demo fallback active | `GEMINI_API_KEY` |
| TransIP DNS | ✅ live via API | — |
| Sentry | ❌ not yet | `SENTRY_DSN` |
| PostHog | ❌ not yet | `POSTHOG_API_KEY` |
| Upstash Redis | ❌ rate-limit fallback to in-memory | `UPSTASH_REDIS_REST_URL` |

## Folder structure

```
wasfix-pro/
├── src/
│   ├── app/                  Next.js App Router
│   │   ├── api/              REST endpoints
│   │   ├── (public)/         Marketing pages
│   │   ├── admin/            Admin dashboard
│   │   ├── dashboard/        Customer dashboard
│   │   └── monteur/          B2B dashboard
│   ├── components/
│   │   ├── ui/               shadcn primitives
│   │   ├── redesign/         dark-theme custom components
│   │   └── ...               feature components
│   ├── lib/                  utilities
│   │   ├── prisma.ts         DB client
│   │   ├── static-db.ts      JSON fallback
│   │   ├── ai/               Gemini integration
│   │   ├── email.ts          Resend templates
│   │   ├── stripe.ts         Stripe client
│   │   └── utils.ts
│   └── data/                 Static JSON catalog
├── prisma/
│   ├── schema.prisma         DB schema
│   ├── seed.ts               Seed script
│   └── dev.db                Local SQLite (legacy)
├── scripts/                  Build/generate scripts
├── public/                   Static assets
└── (root configs)
```

## Build & deploy

- `npm run dev` — local dev on :3000
- `npm run build` — Next.js production build
- `npm run start` — serve production build
- `vercel --prod` — deploy to wasfix.nl
- CI: GitHub Actions on push (set up in Mission 12)

## Performance baseline (2026-05-26)

- Homepage TTFB: ~280ms
- /diagnose TTFB: ~200ms
- /foutcodes/[code] TTFB: ~250ms (static)
- Sitemap: 513 URLs
- Bundle size shared: ~102 kB First Load JS
