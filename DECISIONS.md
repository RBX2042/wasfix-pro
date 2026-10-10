# DECISIONS.md — WasFix Pro

Engineering and product decisions. Each entry: date, decision, alternatives considered, reasoning.
**The newest block is first.** Older entries stay as history; where a later decision replaced one,
the old entry says so in a "Replaced by" line instead of being rewritten.

---

## 2026-10-09 — D21 The restock record is a column on the order line, not an annotation in the credit note (bundle R)

- **Decision.** `OrderItem.restockedQty` (migration `20261009120000_order_item_restocked_qty`: additive, with a
  backfill) counts the units of a line that refunds already put back on the shelf. The cap "ordered minus already
  restocked" is enforced with ONE conditional update on that column inside the refund's transaction (`applyRestock`
  in `src/lib/invoicing.ts`): `restockedQty <= quantity - units` in the WHERE, the increment in the SET, count 0 is
  the refusal, whether the request asked for too much or a concurrent refund took the units first. `checkRestock`
  still runs first, for the Dutch refusal texts; the update is the guarantee. Nothing writes the `restock`
  annotation into a credit note's linesJson any more, and `issueCreditNote` no longer knows about restocks at all.
- **Why.** Until now the units went on the first printed line of the credit note's linesJson and the cap parsed every
  note of the order: stock bookkeeping inside a fiscal document, a data export that had to strip it (and did not: the
  stripping tested `Array.isArray` on a JSON *string* and never fired), and a cap that depended on JSON parsing.
- **Backfill.** The migration sums the `restock` arrays of all existing notes per (order, part) and writes the sum,
  capped at the line's quantity, in plain SQL with `jsonb_typeof` guards and a tolerant cast (a note whose linesJson
  is not JSON or not an array, a line without the array, an entry with the wrong types, a quantity that is negative
  or beyond int4 (0..2147483647): each contributes nothing and aborts nothing; the sums are taken in numeric and the
  only cast to int comes after the cap, so no value in a note can raise "integer out of range"). The one cast of a
  quantity to numeric sits inside a `CASE` on its `jsonb_typeof`, not as a plain WHERE conjunct next to the typeof
  test: Postgres documents no evaluation order for WHERE conjuncts, and with the planner's cost of `jsonb_typeof`
  raised on a scratch copy the plain conjunct was evaluated first and aborted the backfill on a quantity `"abc"`;
  the `CASE` text ran clean under the same costs. Credit notes are not rewritten, because an issued document is
  immutable: old notes keep their annotation, the data export strips it (`stripLegacyRestock`), and nothing else
  reads it.
- **The parameter type of `applyRestock` is `TxOnly`**, `Prisma.TransactionClient & { $transaction?: never }`, not
  `Prisma.TransactionClient`: that type is an `Omit` of the full client, so the bare `prisma` satisfies it
  structurally and a plain `t: Tx` parameter stops nothing (proved: a probe passing `prisma` compiled against
  `t: Tx` and fails against `TxOnly`). A part that spans two lines is claimed line by line, and a conflict on the
  second must roll the first claim back, so running outside the refund's transaction may not compile.
- **The replay with a restock (the webhook books first).** The note no longer records what it restocked, so the
  form's idempotency key is the marker: the first replayed booking that brings a key claims the note (applies the
  ticked restock once, under the cap, and stores the key); the same form submitted again finds its key on the note
  and restocks nothing. A replay that brings no key restocks nothing (before, it restocked and only the annotation
  stopped a repeat). Every real caller (`performRefund`) brings a key.
- **Alternatives rejected.** A `restockJson` column on CreditNote (still bookkeeping on the document, and a second
  place to sum). Keeping the annotation next to the column (two truths that can disagree). Check-then-write under
  the order lock alone (correct today, because `recordRefund` locks the order row first, but then the cap depends
  on every future caller taking that lock; the conditional update depends on nothing read before it).
- **The two admin pages (closed in the integration pass).** `src/app/admin/retouren/page.tsx` and
  `src/app/admin/bestellingen/page.tsx` were outside the bundle and still computed "what can still go back" with the
  legacy reader `restockedFromNotes`: after a post-migration refund they offered the restocked units again, and the
  booking refused them with the Dutch cap message before Stripe was touched (`checkRestock` in `performRefund`),
  nothing moved. Applied since: `retouren/page.tsx` selects `restockedQty` on the items (no `creditNotes` any more)
  and builds the form with `quantity: Math.max(0, i.quantity - i.restockedQty)`; `bestellingen/page.tsx` computes
  `restockedOfItems(o.items)` (`ORDER_LIST_INCLUDE` loads the items with `include`, so the column is on every row) and
  `linesJson` left the `creditNotes` select in `src/app/admin/_lib/orders-query.ts`; `restockedFromNotes` and
  `restockOfLinesJson` are deleted from `src/lib/invoicing.ts` (only `stripLegacyRestock` still touches the
  annotation, for the data export). The pages are server components behind the admin login, so
  `scripts/qa-orders.ts` 12h pins their source (the column selected and subtracted, no legacy reader anywhere) rather
  than rendering them.
- **Not verified from here:** the migration against the production database (no network). It is proved on a
  scratch database by `scripts/qa-migration.ts` (old-format notes, exact and capped backfill, negative, out-of-range
  and non-number quantities skipped, no pre-existing value changed), and the cap, the race and the replay by
  `scripts/qa-orders.ts` section 12 (the lock test 12e hands over with promises and `pg_stat_activity`, not with a
  sleep: the second transaction starts only once the first holds the row, and the first commits only once Postgres
  reports the second waiting on a lock).

## 2026-10-09 — D20 Newsletter opt-out: our table is authoritative, the Resend audience follows, every broadcast carries our link (bundle N)

- **Decision.** Every address on the list has a signed opt-out link, `/api/newsletter/afmelden?token=…`: HMAC-SHA256
  over the address with the key already derived for the confirmation token (`CRON_SECRET`, else `CLERK_SECRET_KEY`,
  decision D10), a purpose string the confirmation token never signs, two parts instead of three, so neither token
  verifies as the other. It does not expire (an opt-out must keep working for as long as the address is on the list) and
  carries no secret, but cannot be derived from the address: it only travels in mail to that address. GET shows a
  button (mail scanners open links); POST (the button, or a mail client's RFC 8058 one-click POST with body
  `List-Unsubscribe=One-Click`, answered with a line of text) sets `unsubscribedAt` in `NewsletterSubscriber` FIRST and
  then PATCHes the Resend contact to `unsubscribed: true`, best effort within the existing 8 s deadline. Resend failing
  (500, timeout) never fails the opt-out; the page then says the opt-out is stored, in force and still being passed on
  (not "you receive nothing more", which only the owner's follow-up makes true), and the owner is told once per address
  and direction per process (an in-memory set: a serverless host repeats it per instance; reason and row id, never the
  address) AFTER the response, through next/server `after()` as notify.ts asks, so the reader never waits for a 3 s
  channel timeout. When our own table cannot be written the answer is an honest 503 ("Afmelden lukt nu niet"), never
  "afgemeld". A second click is still "afgemeld"; an unknown address gets the identical page and no row (no
  enumeration, and no re-storing of a purged or erased address), and its Resend contact is still flagged (the token
  proves we once mailed it); Resend's 404 for an address it does not know is an answer, not a failure, and raises no
  notice. A new sign-up plus a new click clears the opt-out and puts the contact back as subscribed; a confirmation
  link mailed BEFORE the opt-out does not: the link's issue time is in the token (expiry minus TTL), the clear is one
  conditional statement (`unsubscribedAt < issuedAt`), and the person who presses the button in an old mail is told the
  opt-out stands and can sign up again (AVG art. 21 lid 3: a later objection is never undone by an earlier mail).
  Rate limits, two buckets: a token that does NOT verify counts against the caller (30 per address and hour, the guard
  against guessing); a valid token never counts against the caller, only against the address it was signed for (10 per
  hour from any callers), because one-click POSTs come from the mail provider's servers, shared by all its readers (and
  readers behind a carrier NAT share one address), and a 429 there would be a refused opt-out for a request that can
  only ever unsubscribe its own address; past the per-address bucket the opt-out was recorded by the first POST. The
  body (a small form) is therefore read before anything is counted.
- **How the audience is kept in step.** Subscribe updates the contact (`PATCH {unsubscribed:false}`) and creates it
  when the update is refused with ANY non-2xx status, not only 404: an address that opted out earlier is still a
  contact flagged unsubscribed, and what Resend answers to a duplicate create could not be verified from here, while an
  update has one documented meaning; but what it answers for a contact it does not know could not be verified either,
  and a wrong guess about that status would have silently stopped the audience from growing while our table said the
  person subscribed (review finding, repaired the same day). When both calls fail the confirmation stands and the owner
  is told once per address and direction per process, like a failed opt-out; when the CREATE answered 404 the notice
  names `RESEND_AUDIENCE_ID` as the thing to check (a contact being created cannot be "not found", so that 404 is the
  audience path itself), which is the owner's only signal for a wrong id: an opt-out's single PATCH gets the same 404
  for an unknown contact and stays silent by design. Both calls share one deadline. The audience base URL honours
  `RESEND_BASE_URL` like the Resend SDK, so the QA suite runs a real local HTTP stand-in (200, 500, 422, hang, 404)
  instead of patching `fetch`.
- **Newsletters are Resend Broadcasts sent by the owner; the app sends no marketing mail.** The confirmation mail is the
  only mail this code sends to the list, and it carries the link, the sentence that every newsletter will, and the
  RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers from `listUnsubscribeHeaders()`. A broadcast is one
  body for all contacts, so a per-reader link can only reach it as a merge field. Chosen, as the simplest honest
  option within this bundle: `GET /api/newsletter/afmeldlinks` (admin only) gives every subscriber with its link as CSV
  `email,afmeldlink`; the owner loads that column into the audience as a contact property and uses the merge field in
  **every** broadcast, so our table sees the opt-out. The CSV is a snapshot, so it is re-imported right before every
  send (a contact confirmed after the last import would otherwise have an empty property and no link of ours in that
  newsletter), and Resend's own unsubscribe link ALWAYS stays in the template as the fallback for such a contact: a
  newsletter without a working opt-out is unlawful, so the fallback is not optional. **Known gap, named:** an opt-out
  through Resend's own link is not synced back to our table (whether Resend itself stops mailing that contact is not
  verified from here; our count stays too high and a later sign-up would read "already subscribed"); closing it needs
  a Resend webhook (`contact.updated`) that this bundle did not build.
- **Not built, and why.** Storing the link as a contact property from our own code (the property API and its merge
  syntax could not be verified from here, and a refused property would risk the subscribe call itself); an expiring
  opt-out token (would break old mails); a GET that unsubscribes (scanners); a row for unknown addresses (would
  re-store erased data). The custom-header passthrough in `sendMail`/`sendRaw` was outside this bundle's files; the
  integration pass added it (see below).
- **Repaired after review (same day).** The create now follows any refused update, not only a 404, and a confirmation
  whose update and create both fail is reported to the owner like a failed opt-out; the owner notice goes out after
  the response; the page and the one-click line say "stored and in force, still being passed on" when the Resend
  update failed; the rate limit runs before the body is read; the owner workflow says "re-import the CSV before every
  send, keep Resend's own link as the fallback". Section 5b now also pins the purpose string in the signature, the
  silent 404 on an opt-out (unknown address, never-confirmed row), the PATCH for an unknown address, the 422
  fall-through, the both-fail notice and its dedupe, the asynchronous notice and the 429 shapes.
- **Repaired after the second review (same day).** An old confirmation link no longer undoes a later opt-out (issue
  time in the token, conditional clear, "Je afmelding blijft staan" page); the rate limit became the two buckets above
  (before: 30 per caller for valid and forged tokens alike, which after a broadcast would have refused the 31st
  one-click reader behind one provider address); the subscribe notice names `RESEND_AUDIENCE_ID` on a 404 from the
  create; the docs say "per server instance" where they said "once per address". Section 5b now also pins the honest
  503 when the table cannot be written (button and one-click), the per-address-AND-direction dedupe, the old-link
  rule, the wrong-audience-id notice and the opt-out's silent 404 under it, a valid token from a caller whose
  forged-token bucket is exhausted, and the per-address bucket.
- **Integration pass (same day), the cross-file items.** `SendMailOptions.headers` and `RawMail.headers` exist and
  `sendMail` -> `sendRaw` hand them to the Resend SDK as given (`headers` in the `emails.send` payload, SDK 4.8.0), so
  the RFC 8058 pair is on the wire; section 5b sends one mail through the real `sendMail` to the local Resend stand-in
  and reads both headers back from the body the SDK posted (that a mail client turns them into its own button is not
  verifiable from here). An account erasure (`src/lib/erasure.ts`) flags the Resend contact unsubscribed after the
  commit (`forgetNewsletterContactAfterResponse`: the same PATCH as an opt-out, after the response, never a reason for
  the erasure to wait or fail; the contact itself stays in Resend, flagged; section 1 pins the PATCH for both doors).
  The one-click URL gets a line of text for every answer, 200 and 503 included, also on a bodiless POST (5b pins it).
  `/admin/aanvragen` links to the CSV export next to the subscriber count. BLOCKED step 7 and the README say that a
  `CRON_SECRET` rotation invalidates every opt-out link sent before it. **Edge named, not changed:** a repeated opt-out
  keeps the FIRST `unsubscribedAt` (the idempotent write), and the confirmation compares the link's issue time with
  that timestamp, so an opt-out repeated after a newer sign-up's link went out is undone by the button in that newer
  mail; that needs the mailbox owner's own press on "Ja, meld mij aan" (a consent act), and a later objection made
  through our link always stands against every link mailed before it.
- **Not verified from here:** anything against the real Resend API (no network): that the `headers` field of
  `emails.send` ends up on the delivered message (only what the SDK sends is seen); that `PATCH
  /audiences/{id}/contacts/{email}` accepts the address in the path (the Resend documentation and SDK say id or email),
  which status an unknown contact gets (the code no longer depends on it), what a duplicate create answers (the code
  only creates after a refused update), that an unknown audience id answers 404 on the create (the SDK maps `not_found`
  to 404; the hint in the notice rests on that), and that a broadcast can fill a contact property as a merge field. A key
  rotation (new `CRON_SECRET`) invalidates every opt-out link sent before it; the invalid-link page then points to the
  configured contact address. `scripts/qa-privacy.ts` section 5b proves the behaviour above against the local stand-in.

## 2026-10-09 — D19 Production deploys run from GitHub Actions, gated on CI and on the preflight (bundle D)

- **Decision.** `.github/workflows/deploy.yml` deploys `main` to Vercel with the Vercel CLI (`vercel pull`, `vercel build
  --prod`, `vercel deploy --prebuilt --prod`), triggered by a successful run of the CI workflow on `main`, or by hand from
  `main`. It never runs without the three repository secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`: a
  skip with a note, not a failure, so an unwired repository stays green), never deploys a commit that is no longer the tip
  of `main` (`scripts/deploy/check-ref.sh`: queued deploys finish in arbitrary order, and an older commit deployed after a
  newer one is a silent rollback), never deploys a commit whose most recent CI run is not a success
  (`scripts/deploy/check-ci.sh`, so a hand-started deploy obeys "no red main" too), and never runs two deploys at once
  (one concurrency group, `cancel-in-progress: false`: a deploy must not be cut off between the migration and the upload).
- **A run whose commit is no longer the tip deploys the tip instead of skipping.** GitHub keeps one waiting run per
  concurrency group and cancels the older waiting one; since CI runs finish in any order, the cancelled run can be the
  tip's own deploy run, and a green skip would leave `main` undeployed until the next push. So `check-ref.sh` outputs the
  commit to deploy (its own, or the tip), `check-ci.sh` must find the tip's newest CI run green (not green: the run steps
  aside with exit 0 and says what to do; the tip is then deployed by its next GREEN CI run, the running one when it
  finishes or the one after a fix, because a red CI run never triggers the workflow and a dispatch of a red commit is
  refused by the same gate), and `scripts/deploy/checkout-tip.sh` fetches the tip by sha into the shallow checkout and
  verifies HEAD before `npm ci`, the migrations and the build. The tip can be deployed twice this way (by the stand-in
  and by its own run when that one was not cancelled): harmless, the migrations are a no-op the second time and the
  deployment is identical.
- **Order: pull -> migrate -> preflight -> build -> deploy -> preflight --url.** Migrations run BEFORE the new code is live
  because every migration is additive and the new build expects the new schema from its first request (the health route
  answers 503 until then). `scripts/qa-deploy.ts` enforces the rule it can enforce: a migration fails the suite when it
  drops (table, column, index, constraint, type), renames, retypes or truncates, deletes rows, adds a `NOT NULL` column
  without a `DEFAULT` to an existing table, makes an existing column `NOT NULL`, or puts a unique index or a constraint
  (UNIQUE, PRIMARY KEY, FOREIGN KEY, CHECK) on columns the live code already writes; tables and columns created in the
  same migration are exempt (the live code never writes them: `20261008100000` relies on that for `Order.accessToken`,
  `Order.idempotencyKey` and `RmaRequest.linkedOrderId`). The scanner is textual and statement-anchored: it reads the
  spellings Postgres accepts for these at the start of a statement (`ADD` and `ALTER` without the `COLUMN` keyword,
  unnamed constraints such as `ADD UNIQUE (...)`, `IF NOT EXISTS`, schema-qualified tables) and is itself tested on
  SQL samples of each, in both directions, before it runs over the real migrations. Not scanned: the same DDL inside a
  `DO $$ ... $$` block, a function body or an `EXECUTE` string (only the DROP/RENAME/TYPE/TRUNCATE/DELETE words are
  seen there), a `--` inside a string literal (read as a comment), dropping a DEFAULT, removing enum values, the lock a
  new index takes on a very large table; those need a human reading the SQL. Without `DATABASE_URL` in the
  Production environment the pipeline stops before the build. The offline preflight must be READY or READY WITH WARNINGS
  before anything is built; its report prints no secret value (proved on a file of recognisable fake secrets). The live
  probe afterwards targets `NEXT_PUBLIC_APP_URL`, not the deployment's own `*.vercel.app` address: customers use the
  domain, the preflight compares every live check against it, and Vercel's deployment protection can put a login page in
  front of a generated address. A failing probe fails the job although the deploy has happened; the summary says so,
  with the URL. A failure inside `vercel deploy` itself (non-zero exit, or no URL on stdout) is reported as UNKNOWN,
  with the instruction to look at the dashboard's Deployments before deploying again: the CLI may have uploaded and
  promoted before it failed. Only a failure before that step is reported as "nothing deployed". No automatic rollback
  was built: promoting the previous deployment is one action in the dashboard, and the owner should look at the report
  first.
- **Shell scripts, not workflow steps.** The logic is `scripts/deploy/*.sh` (one script per gate and per step, `run.sh`
  for the order and the `.vercel/` cleanup on every exit), so `scripts/qa-deploy.ts` runs the whole pipeline in CI with a
  fake `vercel` and a fake `npm` on PATH, a fake GitHub API and a temporary git origin, without a token or a database.
  The pulled variables file is read by a small parser (`env_value` in `lib.sh`), never sourced and never printed; the
  scripts print names, counts, hosts and the deployment URL only. Every way a gate can fail ends in `fail()` (an error
  annotation, the job summary, exit 1), including a GitHub API answer that is not JSON (a maintenance page with HTTP
  200) or is JSON without the documented `workflow_runs` array (`{}`, `{"message": ...}`: never read as "no CI run",
  which the API did not say) and an unreachable `origin` for `git ls-remote`; a bare stack trace or a bare git error is
  not an owner-facing message. The "no CI run" hint says to wait for CI or re-run it, not to push: the job only runs
  for a commit that is on `main` already.
- **Alternatives rejected.** The Vercel Git integration (it may not be linked, GitHub shows no deployments or statuses
  from any host, and enabled next to this workflow it makes every push deploy twice: BLOCKED.md step 4b says to pick
  one). A marketplace GitHub Action for Vercel (one more unverifiable moving part; the CLI calls are three lines).
  Migrating after the deploy (a 503 window on every deploy). Deploying on `push` to `main` directly (that is before CI
  has judged the commit). Pinning a CLI version (none could be verified from here: `vercel@latest`, with the instruction
  to pin the version that worked after the first successful run).
- **Not verified from here:** the workflow against a real Vercel project (no network, no token); the exact format of the
  file `vercel pull` writes (the parser accepts `NAME="value"` and `NAME=value`); that `vercel deploy` prints the URL on
  stdout (the documented CI pattern); that `vercel deploy --prod` returns only after the production domain points at the
  new deployment (the CLI's documented default without `--no-wait`; the probe of `NEXT_PUBLIC_APP_URL` right after it
  relies on this, and README "Deployen" item (5) says what a wrong assumption looks like); that GitHub lets the runner
  fetch the tip by sha (`git fetch origin <sha>`, what `actions/checkout` itself does; tested here against a local bare
  origin only, from a shallow clone built the way `actions/checkout` builds it that did not yet have the tip, so the
  fetch itself is what the test exercises; not against github.com); the GitHub concurrency and `workflow_run` semantics
  the stand-in rule is built on (documented, not observed); that GitHub-hosted runners have no IPv6 (the reason the
  runbook asks for `DIRECT_URL` to be the session pooler, not the IPv6-only direct host).

## 2026-10-09 — D18 One daily schedule runs the four scheduled jobs (bundle C)

- **Decision.** `vercel.json` schedules exactly one route, `/api/cron/daily`, once a day (03:43 UTC). It runs the four
  jobs in a fixed order (orders -> retention -> stripe-subscriptions -> stripe-reconcile), each isolated, inside one
  function with `maxDuration = 60`. The job bodies moved out of the route files into `src/app/api/cron/_lib/jobs/*`
  (a route file may only export handlers and route config, so a job cannot be imported from one); the list and its order
  are `_lib/daily-jobs.ts`, the runner is `_lib/runner.ts`. The four single-job routes remain, unscheduled, with the same
  guard, the same JSON and the same `maxDuration`: for a hand run with curl, an external scheduler, or an owner whose
  plan allows more schedules.
- **Why one schedule.** According to Vercel's documentation (not verifiable from here: no network) the Hobby plan allows
  2 cron jobs per project, each at most once a day, and Pro allows 40. Four schedules would reject a Hobby deployment.
  Rather than rely on the exact number, the configuration is plan-agnostic: one schedule.
- **The budget trade-off.** 60 s is the lowest function limit of any plan; a higher `maxDuration` than the plan allows
  fails the build, so it is not raised. The runner uses 50 s of it and starts no job with less than 10 s left. What does
  not fit is skipped, recorded in the result, reported to the owner once (the notice says the jobs are not retried before
  the next day and gives the curl that runs them now), and the route answers 500 whenever a job failed or was skipped so
  the platform's cron log shows the day as failed, with the per-job detail in the body (never the error text: a Prisma or
  Stripe message can quote a connection string; that goes to the log and the owner notice). The price: four jobs share
  one minute instead of having one each. To keep one job from taking the others with it, every job gets a cap: what
  is left minus 10 s for each later job, never below 10 s (so the first of four may take 20 s, the last gets all that
  is left; a quick job leaves its share to the next). The runner gives up on a job still running at its cap (recorded
  as failed with `job_timed_out`, logged, the owner told by name, the next job started); without that, a backlog day
  in the orders job would run the function into the platform's 60 s kill with no response, no notice and the other
  three jobs lost for the day. A promise cannot be cancelled, so the abandoned job finishes or fails in the background
  (logged) and may be frozen with the function once the response is out; a job should therefore fit itself inside its
  cap. Which bounds each job has (repair after review): the **orders** job derives a deadline for each of its three
  steps from its cap (the bank-transfer sweep up to half of it, through the `deadlineMs` that `src/lib/cart-expiry.ts`
  already offered; the abandoned-order sweep its usual 15 s at most; the reminders the rest, stopping before the next
  claim, so a cut-off loses nothing, it delays) and reports a cut-short run as `truncated` to the result and to the
  owner, with the curl that drains the rest now; the **stripe-reconcile** job cuts its Stripe scan to what is left
  (20 s at most, as before); **retention** and **stripe-subscriptions** take no deadline and are bounded by row counts
  only (batches of 2000 rows; at most 100 Stripe cancellations per run), so for those two the runner's cut-off is the
  only time bound. On a backlog day the orders job therefore does about 20 s of work per daily run (a hand run of
  `/api/cron/orders` gets the whole 50 s); before this bundle it had a minute of its own. The order is the priority:
  money first (orders), then retention, then subscriptions and the reconcile safety net.
- **Alternatives rejected.** Keep four schedules and hope the plan allows them (the owner would find out at go-live from
  a rejected deployment). Two schedules (fits Hobby's documented limit exactly, leaving no room for a third job, ever).
  Raise `maxDuration` (fails the build on a plan that does not allow it). Let a job that failed be retried inside the
  same run (a job that crashes once will usually crash twice; the next day's run is the retry).
- **Reporting.** A failed job is logged with `report: false` and reported through `notifyError` by name once; the
  logger's sink would otherwise tell the owner a second time.
- **Not verified from here:** the plan limits and the deploy itself. `scripts/qa-platform.ts` section 8 holds the
  configuration to exactly one daily schedule pointing at the daily route whose job list covers the four jobs, and
  `scripts/qa-admin.ts` section 6 proves the runner (isolation, order, budget, one notice per failure, one notice for the
  skipped jobs) with fake jobs and a fake clock, and the daily route end to end against the database.

---

## 2026-10-09 — D14 to D17 (taken during the fix round; recorded here because the code cites them)

- **D14 No way back from CANCELLED.** A bank transfer that arrives after the order was cancelled (grace period
  over, units released, credit note issued) does not revive the order: the money is refunded and the customer told.
  `src/lib/order-status.ts`, `src/lib/invoicing.ts`; terms 7.1.
- **D15 `COMPANY_EMAIL` is the contact address and part of readiness.** Every page that names a contact address
  prints `COMPANY_EMAIL`; without it the pages say "volgt na inschrijving", no address is invented, and checkout
  stays closed like for a missing fiscal field. `src/lib/company-validate.ts`, `src/lib/cart-gate.ts`, `src/app/contact/page.tsx`.
- **D16 A guest order is attached to a real account only when the placer is signed in as it.** A guest who types
  the e-mail address of an existing account gets a guest order on the shared holder row, reachable by its token,
  never a row in a stranger's dashboard. `src/lib/checkout-user.ts`, `src/app/admin/_lib/economics.ts`.
- **D17 The per-address order cap is 10 per day, not 3.** An address is not a person (households, offices,
  carrier-grade NAT); the cap exists against abuse, not against customers. `src/lib/cart-limits.ts`.

---

## 2026-10-08 — Binding decisions D1 to D13 (taken by the project lead)

These govern the code and the documents. They were not re-argued while building to them.

- **D1 Owner notifications.** One module, `src/lib/notify.ts`. Channels: `SLACK_WEBHOOK_URL`,
  `DISCORD_WEBHOOK_URL`, and an e-mail to `ORDER_NOTIFY_EMAIL ?? COMPANY_EMAIL` through Resend. No other webhook variable
  exists. Messages carry order number, total, item count and an admin link, never a customer's name, address or e-mail.
  `RESEND_API_KEY` alone is not a channel (an e-mail needs an address too).
- **D2 Guest access to an order.** A random per-order token in `Order.accessToken`; URL `/bestelling/<id>?t=<token>`.
  Access is: a valid token (constant-time comparison), or the signed-in owner, or an admin. The token is never logged;
  pages that honour it send `noindex` and `no-referrer`.
- **D3 Order states.** PENDING (Stripe, unpaid) and OPENSTAAND (bank transfer, unpaid) -> PAID -> SHIPPED -> DELIVERED.
  CANCELLED is reachable from PENDING, OPENSTAAND and PAID, not from SHIPPED. `src/lib/order-status.ts` is the only place
  that defines transitions. Every transition is a conditional `updateMany` with the expected status in the WHERE clause,
  and a count of 0 means someone else won, so concurrent calls cannot both succeed.
- **D4 Credit notes.** Invoices are never edited or deleted. A cancellation or refund of an invoiced order issues a credit
  note (creditfactuur) from its own gapless per-year series (`CN-YYYY-NNNNN`, Europe/Amsterdam year) in the same transaction
  as the state change.
- **D5 No silent Stripe-to-bank-transfer fallback.** If Stripe fails, the customer stays on checkout with a clear message,
  no order, invoice or reservation is created, and the owner is notified. (A customer who asked for iDEAL used to receive
  a permanent invoice and a 21-day stock hold, and nobody was told.)
- **D6 Netherlands only, card and iDEAL.** Belgium and Bancontact claims are removed from code and copy; the owner can
  re-add them deliberately.
- **D7 Admin bootstrap.** `ADMIN_EMAILS` (comma list). Only an e-mail that Clerk reports as VERIFIED may be promoted or may
  claim an existing row. Production never seeds users. `npx tsx scripts/make-admin.ts <email>` is the direct route
  (it uses `DIRECT_URL`, else `DATABASE_URL`).
- **D8 Cost provenance.** `Part.costSource` is `ESTIMATE` or `QUOTE`. Every margin figure counts `QUOTE` only and labels
  the rest "schatting". In production the seed creates parts with stock 0.
- **D9 Honesty.** When the AI is unavailable the keyword fallback is labelled as such, with no invented confidence and no
  "Powered by Gemini". Fabricated UI (fake dashboards, fake numbers, fake popularity) is removed or clearly labelled as an
  example. Where a claim was removed instead of building the feature, the report says so.
- **D10 New environment variables:** `ADMIN_EMAILS`, `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `ORDER_NOTIFY_EMAIL`,
  `CRON_SECRET`, `DIRECT_URL`. Declared in `src/lib/env.ts`, documented in `.env.example`. No others without a reason in this file.
- **D11 No new paid third-party services.** New npm dependencies only when essential.
- **D12 Language.** User-facing text is Dutch in the existing tone. Code comments are English and explain why.
- **D13 Plan discount.** A plan's parts discount applies only while the subscription is paying, never during the trial
  period ("vanaf je eerste betaling", as the plan features say).

## 2026-10-08 — Platform decisions (bundle S6)

- **One Content-Security-Policy builder, `src/lib/csp.ts`, driven by the environment.** A production Clerk instance lives
  on the owner's own domain (`clerk.<domain>`); clerk-js, its XHRs, its Cloudflare bot challenge and a `blob:` worker all load
  from there, and the old fixed policy listed only `*.clerk.accounts.dev`, so sign-in could never have worked in
  production. The host is read from the publishable key (base64 of `<host>$`). `*.clerk.accounts.dev` is added only for test
  keys (previews); PostHog and Google Analytics hosts only when their keys are set. Alternative rejected: a wildcard for all
  of Clerk's domains (a wildcard on a domain anyone can register under is not tight).
  `scripts/qa-csp.ts` proves it in Chromium; it was not run against a real Clerk instance.
- **`NEXT_PUBLIC_APP_URL` has no localhost default in production.** A Vercel production build refuses to build without a
  usable value; anywhere else the build and boot print a loud warning, checkout answers 503 (`src/lib/cart-gate.ts`, which uses the same `checkAppUrl` test as the build, the sitemap and preflight: a value without `https://`, with a path, or local is refused everywhere),
  and sitemap.xml/robots.txt publish nothing rather than a wrong address. Alternative rejected: failing every production
  build everywhere, which would break every local `next build` + `next start` used for testing.
- **Sitemap `lastmod` only where a row has a date** (blog posts, guides). It used to be "now" on every entry, which with hourly regeneration made the whole sitemap look modified every hour. 404 pages carry no canonical or `og:url` (`src/app/not-found.tsx`): the root layout's relative canonical otherwise resolved to the internal `/_not-found` route.
- **Canonical host.** The www or apex variant that is not in `NEXT_PUBLIC_APP_URL` is redirected there with a 308
  (`next.config.ts`); every page gets a canonical that names itself (`alternates.canonical: "./"` in the root layout).
  `*.vercel.app` is not redirected because previews live there.
- **Two database connection strings.** `DATABASE_URL` = Supabase transaction pooler with `?pgbouncer=true&connection_limit=1`;
  `DIRECT_URL` = direct or session connection used only by `scripts/migrate.ts`. `directUrl` in `schema.prisma` was rejected: it
  makes `DIRECT_URL` mandatory for every Prisma command including `postinstall` (checked on a copy). Preview deployments use
  their own database and Stripe test keys.
- **Rate-limit identity.** `x-vercel-forwarded-for` is believed only when `VERCEL` is set (the platform overwrites it);
  elsewhere it is ignored and the last `x-forwarded-for` hop is used, which is only sound behind exactly one trusted proxy. Without
  Upstash the limiter is per instance; that is logged once in production and reported by `npm run preflight` as a degraded but
  allowed state. A database-backed fallback was not built here.
- **Error monitoring without a new service.** `src/instrumentation.ts` reports request errors and every `logger.error` through
  `notifyError` (D1), with a 15-minute cool-down per error signature and at most 20 messages per hour, and logs unhandled
  rejections. Only the first non-empty line of a message and the route pattern (never the query string) are sent; the error code (Prisma P2002, Stripe codes) is part of the signature, so two different failures on one route do not hide each other. A `logger.error` payload that is a plain object is sent as an allow-list of identifier fields (`REPORTABLE_FIELDS` in `src/lib/monitoring.ts`), never whole. The cap (20 an hour) and the cool-down are per process, and all owner error alerts share one gate. Sentry was not installed (D11).
- **Browser error reports (`/api/client-error`) never forward browser text.** The route is public, so the owner is told only an error name from a fixed list and a path matching a strict pattern, behind its own 3-an-hour gate in front of the shared one (a visitor must not be able to use up the cap meant for server errors), and the request must be same-origin. The browser's message goes to the server log. Alternative rejected: forwarding the message truncated and scrubbed: a link in it still auto-links in Slack.
- **Service worker removed.** The old one cached every HTML page including signed-in ones, and registered before any consent.
  `public/sw.js` is now a kill switch that deletes caches and unregisters itself. Offline use is lost; for a webshop it
  was worth less than the risk.
- **Scheduled jobs run once a day** in `vercel.json`, to be safe on every plan. The routes document the intended tighter schedule
  (hourly orders, 15-minute reconcile). Whether a given Vercel plan allows more frequent crons was not verified.
  *Replaced by D18 (2026-10-09): one schedule, `/api/cron/daily`, runs the four jobs; the number of schedules, not only their frequency, is plan-bound.*
- **`maxDuration` is set in the route files** (checkout, webhook, subscribe, portal, crons), not in a `vercel.json` `functions`
  block: a pattern that matches no function fails the deployment, and matching could not be verified without Vercel.
- **Health route is a readiness check.** `/api/v1/health` answers 503 when the database is unreachable or a migration from the
  build is missing, without details.
- **Region.** `vercel.json` pins `fra1` (Frankfurt) as a documented choice, not a fact about where the database is; change it to match.

---

## 2026-05-23 — Stay with Stripe instead of switching to Mollie

*Update 2026-10-08: Stripe stays; the payment methods are now iDEAL and card only (D6). Bancontact is removed from code and copy, so the "Bancontact" mentions below are history. There is no Mollie integration and no plan for one.*

**Audit prompt requested:** Mollie (iDEAL, Bancontact, kaarten).
**Decision:** Keep Stripe (already integrated in package.json).
**Reason:** Stripe Payments natively supports iDEAL, Bancontact, Cards, SEPA Direct Debit for EU customers. Switching payment providers mid-flow would require re-wiring checkout, webhook handlers, customer creation, subscription billing — multi-day rework with no functional benefit. Stripe also has equal or better DX, NL pricing competitive at 1.4% + €0.25 iDEAL.
**Trade-off:** B2B factuur-betaling iets minder native dan Mollie. Workaround: Stripe Invoicing met Net-30 terms voor MONTEUR/BEDRIJF rollen.

## 2026-05-23 — Keep npm, not pnpm

**Audit prompt requested:** pnpm install / pnpm typecheck.
**Decision:** Stay on npm (`package-lock.json` present, no `pnpm-lock.yaml`).
**Reason:** Switching package managers mid-project = lockfile churn, CI changes, no benefit. npm runs the same scripts.

## 2026-05-23 — Static-data fallback as canonical data layer for public pages

**Audit prompt requested:** Full Prisma + Postgres with all content seeded.
**Decision:** Public-facing pages (foutcodes, gidsen, onderdelen, merken, homepage) read from `src/data/*.json` via `src/lib/static-db.ts`. Prisma-only for user-specific data (orders, subscriptions, reviews) which requires real DATABASE_URL.
**Reason:** DATABASE_URL contains a placeholder password (`<your-password-here>`) so Prisma cannot connect. Static-data fallback was already built and works perfectly for public content. Switching every detail page to require live Postgres = brittle. Static data is git-versioned, auditable, fast, zero DB calls.
**Trade-off:** Content updates require deploy. Acceptable for a catalogue that changes monthly, not minute-ly.

## 2026-05-23 — Generate content programmatically (TypeScript scripts)

**Audit prompt requested:** 20 guides + 250 codes + 80 parts.
**Decision:** Use `scripts/generate-content.mjs` style scripts to emit JSON into `src/data/`, not hand-write 350 MDX files.
**Reason:** Scale and consistency. A script gives every code/part the same shape, IDs follow a pattern, relations are computed correctly. MDX-per-guide for the 20 guides only (those need narrative content).

## 2026-05-23 — Use Tailwind for new pages, not migrate everything to design system

**Audit prompt requested:** Consistent shadcn/Tailwind throughout.
**Decision:** New pages (cookie banner, /klachten, /garantie, /404) get Tailwind utility classes matching dark-theme tokens from `wasfix-design.css`. Existing legacy light-theme pages (admin, dashboard inner) are NOT migrated wholesale — only critical user-flow pages are dark-themed.
**Reason:** Time. Full design migration is ~30+ hours. User-facing flows (homepage → diagnose → checkout) are the priority.

## 2026-05-23 — Stripe Checkout (hosted) instead of Elements

**Audit prompt requested:** Multi-step custom checkout.
**Decision:** Use Stripe Checkout Sessions (hosted page) for payment step.
**Reason:** Lower PCI scope (no card data touches our servers), one-line iDEAL/Bancontact support, mobile-optimized OOTB, Stripe handles 3DS/SCA. Our `/checkout` page handles address collection, then redirects to Stripe-hosted page for payment.

## 2026-05-23 — Skip Sentry / Plausible install (env-blocked)

*Replaced by D1 and the 2026-10-08 monitoring decision: owner notifications and `src/instrumentation.ts` instead of Sentry.*

**Audit prompt requested:** Sentry + Plausible.
**Decision:** Vercel Analytics + Speed Insights already wired. Add Sentry/Plausible env vars and **structure** to README — actual signup is out of scope without user keys.
**Reason:** Avoid silent failures from unset env. Vercel Analytics covers basic page-view + Web Vitals without external service.
**BLOCKED:** see BLOCKED.md.

## 2026-05-23 — Skip Clerk production for now

*Replaced: demo mode no longer exists in production, so there is nothing to keep on; a deployment needs Clerk keys (see BLOCKED.md, step 6).*

**Audit prompt requested:** Clerk productie (DEMO_MODE=false).
**Decision:** Keep DEMO_MODE=true until user provides real CLERK_SECRET_KEY for production. Code is already structured to work in both modes.
**Reason:** Without real keys, switching DEMO_MODE off would break login/registration immediately.
**BLOCKED:** see BLOCKED.md.

## 2026-05-23 — i18n deferred (NL-only)

**Audit prompt requested:** NL + EN minimaal.
**Decision:** Defer to next iteration. Current audience = NL consumers. EN would mostly serve EU monteurs (small segment).
**Reason:** Lower ROI than fixing /monteur, building content, completing checkout flow.

## 2026-05-23 — Blog deferred

**Audit prompt requested:** 15 SEO blog articles.
**Decision:** Defer P2 blog content. Existing /gidsen + /foutcodes already give SEO surface area. 250+ new foutcodes + 20 guides is a higher-priority SEO lift.

## 2026-05-23 — Postgres FTS for search (when DB online)

**Audit prompt requested:** Algolia or Postgres FTS or Meilisearch.
**Decision:** Postgres FTS when DATABASE_URL is live. Until then: simple client-side filter on static-db JSON.
**Reason:** No external service dependency, no extra cost, fast enough for our catalog size.

## 2026-09-02 — Database optioneel, maar één bron van waarheid

**Probleem:** de seed (`prisma/seed.ts`) bevatte een oude subset (18/20/26) met random IDs, terwijl checkout onderdelen uit de statische catalogus resolveert. Met een echte DB zou elke order een FK-fout geven.
**Decision:** `src/data/*.json` is de canonieke catalogus; de seed upsert die 1-op-1 (zelfde IDs) en raakt gebruikersdata nooit aan. Alles wat een DB nodig heeft, checkt `isDatabaseConfigured()` en degradeert anders naar demo.
**Trade-off:** content-updates vereisen een deploy + `npm run db:seed`. Acceptabel; admin CRUD-formulieren komen later.

## 2026-09-02 — Clerk alleen actief als volledig geconfigureerd

*Aangepast 2026-10-08: in een productiebuild telt `DEMO_MODE` niet meer mee; `CLERK_ENABLED` hangt daar alleen van beide sleutels af (`next.config.ts`).*

**Decision:** `CLERK_ENABLED = DEMO_MODE!=="true" && secret && publishable key`, berekend in `next.config.ts` en als `NEXT_PUBLIC_CLERK_ENABLED` aan de client gegeven. ClerkProvider, SignIn/SignUp en clerkMiddleware bestaan alleen in die stand.
**Reason:** een half-geconfigureerde omgeving (één key) mag nooit de site of het dashboard blokkeren.

## 2026-09-02 — Upstash via REST zonder extra dependency

*Aanvulling 2026-10-08: zonder Upstash telt de limiter per instantie; dat wordt eenmalig gelogd en door `npm run preflight` gemeld.*

**Decision:** `fetch` naar de Upstash pipeline-API (INCR + EXPIRE NX) in plaats van `@upstash/ratelimit`.
**Reason:** nul extra packages, werkt op edge en node, fail-open naar de in-memory limiter bij storing.

## 2026-09-02 — Ratings alleen uit echte reviews

**Probleem:** home, prijzen en de onderdeelpagina publiceerden `AggregateRating` met
verzonnen aantallen (1247, 892, 234, 47) plus drie verzonnen `Review`-objecten.
**Decision:** alle hardgecodeerde rating-markup verwijderd. `src/lib/reviews.ts` berekent
rating en aantal uit de echte reviews (seed + goedgekeurde DB-rijen) en geeft `undefined`
terug als er geen zijn, zodat er dan niets wordt gepubliceerd.
**Reason:** Google's structured-data-beleid verbiedt ratings die niet op de pagina staan of
niet echt zijn (manual action als sanctie), en de EU Omnibus-richtlijn verplicht dat als
consumentenreviews gepresenteerde content ook echt van consumenten komt.
**Open:** de zichtbare testimonial-blokken bevatten nog verzonnen personen. Dat is
marketingcopy van de eigenaar, dus gemeld in TODO.md in plaats van eenzijdig verwijderd.

## 2026-09-02 — Constanten buiten "use server"-modules

**Probleem:** `WORK_ORDER_STATUSES` en de categorie-arrays werden geëxporteerd uit bestanden
met `"use server"`. Next.js staat daar alleen async functies toe; de admin- en
werkorderpagina's gaven daardoor een 500.
**Decision:** constanten in aparte modules (`_lib/constants.ts`, `_lib/catalog-constants.ts`)
die zowel de server actions als de client-formulieren importeren.

## 2026-09-02 — Tenant-scoping op elke monteur-mutatie

**Decision:** iedere update/delete van `Customer` en `WorkOrder` gaat via `updateMany`/
`deleteMany` met `{ id, ownerId }` in de where-clause, niet via `update({ where: { id } })`.
**Reason:** met alleen het id zou een monteur met een gegokt id een klant van een ander
kunnen bewerken. Nu levert dat `count: 0` op in plaats van een wijziging; er is een test
voor in `scripts/qa-db.ts`.
