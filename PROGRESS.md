# PROGRESS.md — Autonomous Upgrade

Branch: `autonomous-upgrade-20260526` · Started: 2026-05-26

## REQUIRED_SECRETS (env vars user must provide to fully activate)

| Env var | Where used | Without it |
|---|---|---|
| `POSTHOG_API_KEY` + `POSTHOG_HOST` | Analytics dashboard, events | Falls back to Vercel Analytics + GA4 only |
| `NEXT_PUBLIC_GA_ID` | GA4 client-side | No second analytics source |
| `GA_MEASUREMENT_PROTOCOL_API_SECRET` | Server-side conversion tracking | Conversions ad-block-vulnerable |
| `STRIPE_SECRET_KEY` (live `sk_live_*`) | Real payments | Demo checkout fallback |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | Webhook handler rejects events |
| `RESEND_API_KEY` | Order/RMA/newsletter emails | Email functions no-op silently |
| `RESEND_AUDIENCE_ID` | Newsletter signups | Newsletter form fails |
| `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` | Error monitoring | No error tracking |
| `SENTRY_AUTH_TOKEN` | Source-map uploads | Source maps not uploaded on build |
| `GEMINI_API_KEY` (with quota) | Real AI diagnose | Demo fallback (currently active) |
| `DATABASE_URL` (real password) | All persistence (orders, users, reviews) | Static-data fallback for public pages |
| `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (live) | Real auth | DEMO_MODE=true |
| `KVK_API_KEY` | Auto-verify monteur KVK numbers | Manual approval queue only |
| `GSC_OAUTH_CLIENT_ID` + `GSC_OAUTH_CLIENT_SECRET` + `GSC_REFRESH_TOKEN` | GSC API for top-keyword sync | "Connect GSC" button placeholder |
| `EXCHANGERATE_API_KEY` | FX rates cron | Hardcoded fallback rates |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` | Rate limiting | In-memory map (single-instance only) |
| `SLACK_WEBHOOK_URL` or `DISCORD_WEBHOOK_URL` | Key-event alerts | Console.log only |
| `CRISP_WEBSITE_ID` or `INTERCOM_APP_ID` | Live chat | No chat widget |

## Mission status

| # | Mission | Status | Files | Notes |
|---|---|---|---|---|
| 1 | Audit & Foundation | ⏳ | - | - |
| 2 | SEO Technical Foundation | ⏳ | - | - |
| 3 | SEO Content Engine | ⏳ | - | - |
| 4 | Internationalization (i18n) | ⏳ | - | - |
| 5 | Analytics & Admin Dashboard | ⏳ | - | - |
| 6 | Conversion Optimization | ⏳ | - | - |
| 7 | Performance & Mobile | ⏳ | - | - |
| 8 | Monteur Pro Marketplace | ⏳ | - | - |
| 9 | Trust, Legal & GDPR | ⏳ | - | - |
| 10 | AI Diagnose Quality Loop | ⏳ | - | - |
| 11 | Growth & Distribution | ⏳ | - | - |
| 12 | Observability, CI/CD & Polish | ⏳ | - | - |
