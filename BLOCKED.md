# BLOCKED.md: draaiboek voor de livegang van WasFix Pro

Stand 8 oktober 2026. Dit is de volgorde waarin jij, de eigenaar, de winkel live krijgt.
Alles wat code kon oplossen is opgelost; wat hieronder staat kan alleen jij: een bedrijf
inschrijven, accounts aanmaken bij leveranciers, DNS aanpassen, prijzen en voorraad
invullen. Na elke stap laat `npm run preflight` zien of het klopt (zie stap 10).

## 0. Lees dit eerst

**Hoe lang duurt het echt?** Eerdere versies van dit bestand zeiden "ongeveer anderhalve dag". Dat klopt
niet: het zijn ongeveer twaalf aparte leverancier- en DNS-stappen, een leveranciers- en prijsbeslissing en
een boekhoudkundige keuze. Dit is een schatting, niet gemeten:

| Onderdeel | Eigen werk | Wachttijd erbij |
|---|---|---|
| Bedrijf inschrijven (KvK, btw-nummer, zakelijke rekening) | 2 uur | **1 tot 4 weken**, het btw-nummer bepaalt de datum |
| Domein en DNS, mailadressen | 1 uur | tot 24 uur voor DNS |
| Supabase, Vercel, Upstash, meldingen | 2 uur | |
| Clerk (productie-instantie) | 1 uur | DNS-controle, uren |
| Resend (verzenddomein) | 45 minuten | DNS-controle, uren |
| Stripe (verificatie, betaalmethoden, belasting, prijzen, webhook, portal) | 2 tot 3 uur | **1 tot 3 dagen** verificatie |
| Preflight draaien en herstellen | 1 tot 2 uur | |
| Catalogus: voorraad, inkoopprijzen, foto's | uren tot dagen | offertes van leveranciers: dagen tot weken |
| Proefbestelling op test-accounts | 1 tot 2 uur | |
| Boekhouder (btw-regime, creditnota's) en juridische controle | enkele uren | **1 tot 2 weken** |

Realistisch is dus **2 tot 3 werkdagen eigen werk, verspreid over 2 tot 4 weken**, waarvan de
wachttijd op KvK/btw-nummer en Stripe de kritieke lijn is. Leveranciersoffertes en foto's komen daar
bovenop en bepalen of de winkel geld verdient (stap 11).

**Wat is er getest, en waartegen?** De code is gedraaid tegen een echte Postgres en tegen nagemaakte
Stripe-, Slack- en Resend-servers. Er is nooit iets gedraaid tegen echte Clerk, Stripe, Resend, Gemini,
Supabase, Upstash of Vercel: er waren geen sleutels. Dat betekent dat de eerste echte bestelling de eerste
keer is dat die koppelingen in het echt lopen. Vandaar de proefbestelling in stap 12. Wat een
leverancier in zijn eigen documentatie belooft staat hieronder steeds als zodanig aangeduid.

## 1. Wat er nu is en wat niet

Er is nu: een bestelbureau in `/admin/bestellingen` (betaald markeren met bedrag, verzenden met
track & trace, annuleren, terugbetalen, picklijst en pakbon), creditnota's uit een eigen doorlopende
reeks (CN-JJJJ-NNNNN), retouren in `/admin/retouren`, een CSV-import van onderdelen, een
contributietabel per onderdeel in `/admin/economie`, meldingen aan jou (Slack, Discord en/of e-mail),
geplande taken, en een controlescript (`npm run preflight`).

Er is niet, en daar helpt geen sleutel tegen:

- **Geen werkbon voor monteurs** (servicebon, handtekening, foto's), **geen planning** (agenda, route),
  **geen organisatiemodel** (teams, rollen). Daarom staat "tot 20 gebruikers" niet bij Bedrijf.
- **Geen btw-regime anders dan 21%.** `VAT_RATE` staat vast op 21%. Valt jouw bedrijf onder de
  kleineondernemersregeling (KOR), dan mag je geen btw tonen en klopt elke factuur van deze winkel niet.
  Vraag dit aan je boekhouder voordat je live gaat (stap 13). Verleggen naar EU-klanten (VIES) is niet gebouwd.
- **Monteur-facturen:** het datamodel (`MonteurInvoice`) heeft geen "betaald"-status. Versturen per mail en een factuuroverzicht ontbraken op 3 september 2026 en zijn sindsdien niet opnieuw nagekeken.
- **Het verwijsprogramma staat uit** en dat is met opzet; zie de uitleg in `.env.example`.
- **De inkoopprijzen in de database zijn schattingen** (zie stap 11). Geen enkel margecijfer in `/admin`
  is een echte marge totdat jij offerteprijzen hebt ingevuld.
- **Alle bestellingen worden met de hand afgehandeld**: picken, inpakken, verzenden en terugbetalen
  gebeuren door jou in `/admin`. De software boekt en mailt, ze verstuurt niets.

## 2. De stappen, in volgorde

### Stap 1. Bedrijfsgegevens (blokkeert alles wat geld kost)

- **Nodig:** KvK-nummer, btw-nummer, zakelijke bankrekening (IBAN), vestigingsadres en **een e-mailadres
  waarop klanten je bereiken** (een brievenbus die bestaat en die je leest).
- **Doen:** zet in de hostingomgeving `COMPANY_NAME`, `COMPANY_STREET`, `COMPANY_POSTAL_CODE`,
  `COMPANY_CITY`, `COMPANY_KVK`, `COMPANY_VAT`, `COMPANY_IBAN` en **`COMPANY_EMAIL` (verplicht, net als de
  zes andere)**, en liefst `COMPANY_PHONE`.
- **Gevolg zolang ze ontbreken:** checkout geeft **503 voor beide betaalwegen**, Stripe-bestellingen
  ook. (Een eerdere versie van dit bestand zei dat Stripe-bestellingen daar geen last van hadden. Dat was
  fout.) Op de publieke pagina's staat "volgt na inschrijving" in plaats van een nummer of adres. Ook zonder
  `COMPANY_EMAIL` blijft de winkel dicht: de site had daarvoor een ingebouwd adres (`support@wasfix.nl`) dat
  op de contact-, privacy-, voorwaarden-, retour-, garantie-, klachten- en perspagina stond, op het
  modelformulier voor herroeping en onder de factuur, terwijl niemand heeft gecontroleerd dat die brievenbus
  bestaat. Dat adres is weg; elk adres dat een klant te zien krijgt (ook in foutmeldingen, de uitleg bij
  accountverwijdering en de helpartikelen) komt nu uit `COMPANY_EMAIL`. (Eén bestand noemt het oude adres nog:
  `src/lib/emails/templates.ts`, maar niets importeert dat bestand; het hoort bij de mailbundel en moet daar worden
  opgeruimd voordat iemand het in gebruik neemt.) Er zijn dus geen aparte brievenbussen
  `privacy@`, `klachten@`, `monteur@` of `garantie@` nodig.
- **Na elke wijziging van een `COMPANY_*`-waarde moet je opnieuw deployen (opnieuw bouwen), niet alleen
  herstarten.** De juridische pagina's (gemeten voor `/voorwaarden`; hetzelfde geldt voor de andere pagina's die niet per
  verzoek worden opgebouwd) worden bij de build klaargemaakt met de waarden van dat moment. Een build zonder
  bedrijfsgegevens die later met bedrijfsgegevens wordt gestart, maakt wel kloppende facturen, maar de pagina
  `/voorwaarden` bleef "in oprichting" zeggen (gemeten in de generale repetitie). `npm run preflight -- --url
  https://<domein>` leest daarom de live `/voorwaarden` en `/contact` en vergelijkt bedrijfsnaam, KvK-nummer en
  contactadres met je `COMPANY_*`; wijkt het af, dan staat er een BLOCK met de opdracht opnieuw te bouwen.
- **Controle:** een goed gevormd maar fictief nummer (zoals de testwaarden van CI) komt door de controle in
  de webshop; `npm run preflight` weigert die voor productie. De preflight meldt het bedrijfsblok pas als "ok"
  als geen enkel punt daarna blokkeert.

### Stap 2. Domein en DNS

- **Beslis eenmaal:** `https://wasfix.nl` (kaal domein) of `https://www.wasfix.nl`. Dat wordt
  `NEXT_PUBLIC_APP_URL`. De andere variant stuurt de app door naar jouw keuze (308). Laat **beide** namen naar
  het Vercel-project wijzen, anders werkt die doorverwijzing niet.
- `NEXT_PUBLIC_APP_URL` is **verplicht in productie**: alleen het domein, `https://`, geen pad, geen
  slash achteraan. Op Vercel weigert de productie-build zonder bruikbare waarde te bouwen (gebaseerd op
  Vercels `VERCEL_ENV`; die variabele is hier niet tegen een echte Vercel-build gecontroleerd). Elders
  geeft `next build` een duidelijke waarschuwing, antwoordt checkout 503 en blijft de sitemap leeg. "Bruikbaar" is overal
  dezelfde test (`src/lib/site-url.ts`): `wasfix.nl` zonder `https://`, `http://wasfix.nl` en `https://wasfix.nl/nl` zijn net zo
  onbruikbaar als een lege waarde of localhost. De waarde werkt op twee manieren: de CSP, CORS en de www-doorverwijzing in
  `next.config.ts` en alle client-code krijgen hem tijdens de build, terwijl sitemap, robots.txt en metadata hem ook tijdens
  het draaien lezen. Zet hem dus vóór de build én laat hem tijdens het draaien gezet staan (Vercel doet dat met de
  Production-scope), en deploy opnieuw na elke wijziging.
- Maak het ene mailadres aan dat op de site genoemd wordt: `COMPANY_EMAIL` (zie `/contact` en de juridische
  pagina's). Reactietijd: de pagina's /contact, /help, /klachten, /voorwaarden, /retourvoorwaarden en /garantie gebruiken `SUPPORT_RESPONSE_WORKDAYS` (nu 7 werkdagen) en
  `COMPLAINT_RESOLUTION_DAYS` (nu 30 dagen) in `src/lib/plans.ts`. Pas dat getal aan naar wat je kunt waarmaken;
  dan volgen die pagina's tegelijk. Niet gekoppeld: de bevestigingsmail van een retouraanvraag (`src/lib/email.ts`) noemt zelf nog
  "binnen 24 uur", en de aanmeldmelding voor monteurs belooft "1 werkdag" (`src/app/api/monteur/signup/route.ts`).
- Het adres `*.vercel.app` blijft bereikbaar. De app verwijst dat niet door (previews wonen daar);
  doe dat in de domeininstellingen van Vercel als je het wilt.

### Stap 3. Database (Supabase)

- **Nodig:** een eigen Supabase-project in een EU-regio (niet het gedeelde project uit eerdere notities), plan
  met dagelijkse back-ups. De aanbeveling is Pro; wat het gratis plan wel of niet bewaart is hier niet nagezocht.
- **Time-out:** de app geeft een databasevraag na 8 seconden op (`src/lib/prisma.ts`): een vraag, het starten van een
  transactie en het afronden (COMMIT) van een transactie krijgen elk hooguit 8 seconden, en een transactie als geheel
  hooguit 25 seconden (checkout mag 30). Bij een bevroren database antwoordt checkout dan met 503 en krijg jij een melding,
  in plaats van minutenlang niets. Dat is gemeten met een TCP-proxy die het verkeer bevriest, ook op het moment van de
  COMMIT (`scripts/qa-platform.ts`, sectie 12). Het annuleert het werk op de server niet: bij een bevriezing precies op de
  COMMIT kan de bestelling alsnog worden opgeslagen terwijl de klant een 503 kreeg. De klant probeert het dan opnieuw met
  dezelfde `Idempotency-Key` (de checkout-pagina stuurt er bij elke poging een mee, de route zoekt die sleutel eerst op),
  zodat er geen tweede bestelling ontstaat. De waarde `socket_timeout=10` wordt zelf aan `DATABASE_URL` toegevoegd (jij zet
  er niets bij).
- **Twee verbindingsstrings** (volgens Supabase's documentatie; de exacte tekst staat onder Project Settings,
  Database, Connection string):
  - `DATABASE_URL` is de **Transaction pooler** (poort 6543) met `?pgbouncer=true&connection_limit=1`. Zonder
    `connection_limit=1` opent elke serverless-instantie meerdere verbindingen (Prisma neemt standaard
    2 x aantal CPU's + 1; de reviewers zagen er negen bij één Next-proces) en raakt de pool vol.
  - `DIRECT_URL` is de directe verbinding of de session pooler (poort 5432). Alleen voor migraties, de seed en
    `scripts/make-admin.ts`. De transaction pooler kan geen migraties draaien. De hosting hoeft `DIRECT_URL` niet.
- **Eerste keer**, vanaf je eigen computer:

  ```bash
  export DIRECT_URL='postgresql://…:5432/postgres'
  npm run db:migrate:deploy      # past de migraties toe; scripts/migrate.ts gebruikt DIRECT_URL
  npm run db:seed                # productiemodus (database niet op deze machine): catalogus ZONDER gebruikers, voorraad 0
  ```

  De seed maakt in productie nooit gebruikers aan en zet de voorraad van elk onderdeel op 0, omdat niemand
  de echte voorraad heeft geteld.
- **Schemawijzigingen** gaan met `npm run db:migrate:deploy`. **Nooit `prisma db push` tegen productie**: dat
  schrijft zonder administratie en laat de migratiegeschiedenis en de echte database uit elkaar lopen; de
  volgende `migrate deploy` wil dan opnieuw beginnen, en dat betekent orders en facturen weggooien die je zeven
  jaar moet bewaren. Een bestaande database van vóór de migraties baseline je eenmalig met
  `npm run db:baseline`.
- **Preview-deployments krijgen een eigen database** (een apart Supabase-project of een branch) en Stripe
  **testsleutels**. Een eerdere versie zei: "zet `DATABASE_URL` voor Production + Preview". Dat laat previews
  echte bestellingen in de productiedatabase schrijven. Zet variabelen in Vercel per omgeving.

### Stap 4. Hosting (Vercel)

- Importeer de GitHub-repo. Node 22 (staat in `package.json`), build `npm run build`, install `npm ci`.
- **Regio:** `vercel.json` zet de functies op `fra1` (Frankfurt). Dat is een keuze, geen feit: kies de
  regio die bij jouw Supabase-regio past en pas `regions` aan. Staat Supabase in een andere regio, dan wordt
  elke databasevraag trager.
- **Variabelen** (alleen in de **Production**-omgeving; Preview krijgt een eigen, aparte set): zie
  `.env.example`. Minimaal: `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
  `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `ADMIN_EMAILS`, `COMPANY_*`, een meldingskanaal (stap 5),
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`; voor betalen en abonnementen de `STRIPE_*`.
  `NEXT_PUBLIC_*` en de Clerk-sleutels worden bij de build gebruikt (client-code, CSP, CORS, doorverwijzingen): na het wijzigen
  opnieuw deployen.
- **Geplande taken en `CRON_SECRET`.** `vercel.json` plant **één** route: `/api/cron/daily`, één keer per dag
  (03:43 UTC). Die draait vier taken na elkaar: `orders` (verlopen bankoverschrijvingen annuleren, verlaten
  Stripe-bestellingen afhandelen, betaalherinneringen), `retention` (bewaartermijnen), `stripe-subscriptions`
  (verlopen abonnementen, abonnementen van gewiste accounts) en `stripe-reconcile` (Stripe-bestellingen waarvan de
  webhook nooit aankwam). **Zet `CRON_SECRET`** in de hostingomgeving: zonder die waarde weigert elke route te
  draaien (503) en gebeurt er niets. Vercel stuurt de waarde zelf mee als `Authorization: Bearer <CRON_SECRET>`.
  - **Waarom één schema.** Volgens de documentatie van Vercel staat het Hobby-abonnement twee cron-taken per
    project toe (elk hoogstens één keer per dag) en Pro veertig; vier schema's zouden een deployment op Hobby laten
    afwijzen. Dat is hier niet te controleren (geen netwerk), dus de configuratie gaat niet uit van het aantal:
    één schema past op elk abonnement.
  - **Tijd.** Eén aanroep mag 60 s duren (`maxDuration`, de laagste grens van elk abonnement; hoger dan je plan
    toestaat laat de build falen). De dagrun gebruikt daarvan 50 s en begint geen taak meer als er minder dan 10 s
    over is: wat niet past wordt overgeslagen, jij krijgt daar **één** melding van, en de route antwoordt met
    HTTP 500 zodat het cronlog van Vercel de dag als mislukt toont. Overgeslagen taken worden pas de volgende dag
    weer geprobeerd (of door jou, zie hieronder). Elke taak krijgt bovendien een plafond: wat er over is min 10 s
    voor elke taak erna (de eerste van vier dus hoogstens 20 s, de laatste alles wat rest). Een taak die bij haar
    plafond nog bezig is wordt losgelaten (`job_timed_out`, gemeld met haar naam; de dagrun wacht er niet langer op en
    de volgende draait gewoon; wat al liep kan op de achtergrond nog afmaken en dan nog een eigen melding sturen);
    zonder dat plafond zou een achterstand in `orders` de functie in de 60 s-kill van Vercel laten lopen, zonder
    antwoord, zonder melding en zonder de andere drie taken. De `orders`-taak houdt zich zelf aan haar tijd
    (annuleringen, verlaten Stripe-bestellingen en herinneringen krijgen elk een deadline; een annulering of mail die
    al bezig is wordt nog afgemaakt, de rest wacht op de volgende run) en zegt in haar samenvatting wat er niet paste;
    `retention` en `stripe-subscriptions` kennen geen deadline (alleen een maximum aantal rijen), daar is het
    plafond de enige grens. Bij een achterstand doet de dagrun dus ongeveer 20 s annuleringen en herinneringen per
    dag; een losse aanroep van `/api/cron/orders` krijgt de volle 50 s. Een taak die een fout geeft (crasht) wordt
    net zo gemeld met haar naam; de volgende taak draait gewoon.
  - **Wat dagelijks betekent.** Een klant die betaalde terwijl de webhook uitviel staat maximaal een dag op
    `PENDING`; een bankoverschrijving verloopt maximaal een dag later; de eerste betaalherinnering gaat de dag na
    de vervaldatum.
  - **Handmatig of strakker.** De vier losse routes blijven bestaan, zonder schema (GET of POST). Nu draaien:
    `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://wasfix.nl/api/cron/stripe-reconcile`
    (`orders`, `retention` en `stripe-subscriptions` net zo; `daily` draait alle vier). Staat je plan meer schema's
    toe, dan kun je een losse route aan `vercel.json` toevoegen (bijvoorbeeld `stripe-reconcile` elke 15 minuten);
    een schema dat je plan niet toestaat laat de deployment falen, dus controleer dat eerst bij Vercel.
- **Looptijd van functies:** checkout, de Stripe-webhook, abonnement en de cron-routes zetten
  `maxDuration` in hun eigen bestand. Welke maximale duur jouw Vercel-plan toestaat is niet gecontroleerd.

### Stap 4b. Deployen: vanuit GitHub Actions, niet via de Git-integratie van Vercel

De repository heeft een workflow die `main` op productie zet: `.github/workflows/deploy.yml` (uitleg en instellen in
README.md onder "Deployen"). Hij start na een geslaagde CI-run op `main` (of met de hand, alleen vanaf `main`) en doet
in vaste volgorde: Production-variabelen ophalen (`vercel pull`), migreren (`npm run db:migrate:deploy`, vóór de nieuwe
code live gaat; elke migratie voegt alleen toe), `npm run preflight` offline (NIET KLAAR stopt alles vóór de build),
`vercel build`, `vercel deploy --prebuilt --prod`, en daarna `npm run preflight --url` tegen de live site. Faalt die
laatste controle, dan is de job rood terwijl de deploy al gedaan is; de samenvatting zegt dat, met de URL. Faalt de
stap `vercel deploy` zelf, dan zegt de samenvatting dat het onbekend is of er iets is gedeployed: kijk eerst in het
Vercel-dashboard. Is de commit van een run niet meer de top van `main`, dan deployt die run de top (als CI daarvoor
geslaagd is; anders slaat hij over en zegt wat te doen: bij rood CI herstellen, de eerstvolgende groene CI-run op
`main` deployt dan zelf), omdat de eigen deploy-run van de top door de wachtrij geannuleerd kan zijn.

- **Instellen:** drie repository-secrets in GitHub: `VERCEL_ORG_ID` en `VERCEL_PROJECT_ID` (uit `.vercel/project.json`
  na `npx vercel link`) en `VERCEL_TOKEN` (Vercel, Account Settings, Tokens; scope: jouw team). Zonder die drie slaat de
  workflow over en meldt dat; hij faalt niet. Zonder `DATABASE_URL` in de Production-omgeving stopt hij vóór de build.
- **Zet `DIRECT_URL` ook in de Production-omgeving van Vercel** (session pooler, poort 5432): de migratiestap draait op
  een GitHub-runner en gebruikt hem. Niet de directe host `db.<ref>.supabase.co`: die is alleen via IPv6 bereikbaar en
  GitHub-runners hebben voor zover bekend geen IPv6.
- **Kies één deploy-weg.** Staat de Git-integratie van Vercel óók aan voor deze repository, dan deployt elke push naar
  `main` twee keer (Vercel zelf, en deze workflow), met twee builds en twee migratiepogingen tegelijk. Koppel de
  repository dan los in Vercel (Settings, Git) of verwijder de workflow; dit draaiboek gaat uit van de workflow.
- **Niet gecontroleerd:** de workflow is nooit tegen een echt Vercel-project gedraaid (geen netwerk, geen token). De
  scripts eronder (`scripts/deploy/*.sh`) zijn getest met een nagemaakte `vercel` en `npm` (`scripts/qa-deploy.ts`).
  Kijk bij de eerste run naar: koppelt `vercel pull` zonder vraag en schrijft hij `.vercel/.env.production.local`;
  bereikt de migratiestap de database; geeft de preflight KLAAR; zet `vercel deploy` de URL op stdout; slaagt de
  live-controle tegen `NEXT_PUBLIC_APP_URL` (die gaat ervan uit dat `vercel deploy --prod` pas terugkeert als het
  domein naar de nieuwe deployment wijst, zoals de CLI-documentatie zegt). Pin daarna in `deploy.yml` de CLI-versie
  die werkte (nu `vercel@latest`).

### Stap 5. Meldingen aan jou (doe dit vóór de rest, zodat je de volgende stappen kunt volgen)

- Zonder kanaal weet je niet dat er iets besteld is of kapotgaat. Minstens één van:
  `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, of `ORDER_NOTIFY_EMAIL` (of `COMPANY_EMAIL`) samen met
  `RESEND_API_KEY`. **`RESEND_API_KEY` alleen is geen kanaal.**
- Meldingen bevatten ordernummer, totaalbedrag, aantal artikelen en een beheerlink, nooit naam, adres of
  e-mailadres van een klant. Server-fouten komen ook binnen (via `src/instrumentation.ts`), met een
  afkoelperiode van 15 minuten per soort fout en een maximum van 20 per uur (per serverinstantie, niet per site;
  op Vercel kunnen dat er meerdere zijn), zodat een storing je telefoon niet vol stuurt. Een melding noemt de plek, de soort
  fout en de ordernummers of codes die de code meegaf, nooit namen, adressen of e-mailadressen.
  Fouten uit de browser van een bezoeker (`/api/client-error`, openbaar) komen alleen binnen als foutsoort en paginapad, hooguit
  3 per uur; de tekst die de browser meestuurt staat in het serverlog en wordt nooit doorgestuurd. Een melding kan dubbel binnenkomen: een eigen melding van de code en de algemene
  foutmelding voor hetzelfde probleem.
- Zet bij een gratis uptime-monitor een controle op `https://<jouw-domein>/api/v1/health` (elke 1 tot 5 minuten).
  De route geeft **503** wanneer de database onbereikbaar is of een migratie uit deze build ontbreekt, en
  noemt daarbij geen details.

### Stap 6. Inloggen (Clerk)

- **Nodig:** een Clerk **Production-instantie** (aparte instantie naast de ontwikkelinstantie) op jouw domein.
- **Doen:** voeg de DNS-records toe die Clerk toont (Clerk noemt `clerk.`, `accounts.`, e-mail-CNAME's;
  het dashboard toont de exacte records), wacht op verificatie, zet `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  (`pk_live_…`), `CLERK_SECRET_KEY` (`sk_live_…`) en `CLERK_WEBHOOK_SECRET`. Maak een webhook
  `<APP_URL>/api/webhooks/clerk` met de gebeurtenissen `user.*`. **Deploy opnieuw.**
- **Je CSP verandert mee.** De Content-Security-Policy leest het Clerk-adres uit de publiceerbare sleutel
  (`src/lib/csp.ts`). Zonder dat blokkeerde de browser Clerk's scripts en zou niemand kunnen inloggen of
  betalen. `npx tsx scripts/qa-csp.ts` bewijst dat in Chromium met een sleutel van dezelfde vorm; het is **niet**
  gedraaid tegen een echte Clerk-instantie. Test na de deploy zelf een registratie en een login.
- **De eerste beheerder.** Zet `ADMIN_EMAILS=jouw@adres` (komma-gescheiden lijst). Het adres wordt beheerder bij
  de eerste inlog, **alleen als Clerk het adres als bevestigd (verified) meldt**; een ongeverifieerd adres
  krijgt niets en kan een bestaande rij niet overnemen. De seed maakt in productie geen gebruikers. Alternatief,
  vooraf, vanaf je computer: `npx tsx scripts/make-admin.ts jouw@adres` (gebruikt `DIRECT_URL`, anders `DATABASE_URL`).
  Eerdere teksten spraken van een "geseede superadmin" die je inlog overneemt: die bestaat in productie niet.
- `DEMO_MODE` hoort niet in een deployment. In productie is demo-modus altijd uit, en staat de variabele toch
  aan, dan geeft `npm run preflight` een waarschuwing.

### Stap 7. E-mail (Resend)

- **Nodig:** een Resend-account, het verzenddomein toevoegen en **verifiëren**: voeg de SPF- en DKIM-records toe
  die Resend toont bij je DNS-provider en druk op Verify. Zet `RESEND_API_KEY` en `RESEND_FROM_EMAIL`
  (`WasFix Pro <noreply@jouwdomein.nl>`, een adres op het geverifieerde domein).
- **Let op:** eerdere notities beweerden dat de DKIM/SPF-records van wasfix.nl "al bestaan". Dat is nooit
  gecontroleerd en moet je als **onbekend** behandelen: kijk in Resend of het domein "Verified" is. Zonder
  geverifieerd domein komt er geen enkele klantmail aan, ook de betaalinstructies voor bankoverschrijving niet.
  `npm run preflight -- --live-checks` leest de domeinstatus uit Resend (een sleutel die alleen mag verzenden kan
  dat niet lezen; dan meldt het script dat het niet te controleren is).
- Zet ook een DMARC-record. Het is niet vereist door de code, wel verstandig voor aflevering.
- **Nieuwsbrief (audience, afmelden).** Maak in Resend een Audience aan en zet `RESEND_AUDIENCE_ID`. Bevestigde
  aanmeldingen komen er als contact in; een afmelding via onze link (`/api/newsletter/afmelden`) zet het contact op
  `unsubscribed`. Onze tabel `NewsletterSubscriber` is leidend (`DECISIONS.md` D20). Verstuur je een broadcast, doe
  dan **vóór elke verzending** dit: haal ingelogd als beheerder `<APP_URL>/api/newsletter/afmeldlinks` op (CSV
  `email,afmeldlink`), laad die kolom **opnieuw** als contact-eigenschap in de audience en gebruik dat merge-veld in de
  broadcast. De CSV is een momentopname: wie zich ná de vorige import heeft bevestigd, heeft anders een lege
  eigenschap en dus geen link van ons in die nieuwsbrief. Laat daarom **altijd ook Resends eigen afmeldlink** in het
  sjabloon staan als vangnet voor een contact zonder (of met een lege) eigenschap: een nieuwsbrief zonder werkende
  afmeldlink is verboden (Telecommunicatiewet art. 11.7 lid 6). Bekend gat: een afmelding via Resends eigen link komt
  **niet** in onze tabel terecht; vergelijk na een verzending de audience met de tabel (of Resend zo'n contact zelf
  niet meer aanschrijft is niet vanaf hier gecontroleerd). Krijg je de melding "Afmelding niet doorgegeven aan Resend"
  of "Aanmelding niet doorgegeven aan Resend", zet dat contact dan zelf op unsubscribed respectievelijk in de audience
  vóór de volgende broadcast (de melding noemt de rij-id, niet het adres; ze komt één keer per adres en richting
  **per serverinstantie**, op Vercel dus mogelijk vaker voor hetzelfde adres). Staat er `http_404_then_http_404` in
  een "Aanmelding niet doorgegeven"-melding, dan klopt `RESEND_AUDIENCE_ID` vrijwel zeker niet (meer): controleer die
  eerst. Dat is je **enige** signaal daarvoor: een afmelding krijgt van Resend dezelfde 404 als voor een contact dat
  niet in de audience staat en meldt daarom niets; bevestig na het zetten of wijzigen van `RESEND_AUDIENCE_ID` dus
  zelf één proefadres en kijk of er géén melding komt. **Verander je `CRON_SECRET`** (de sleutel waarmee de
  afmeldlinks zijn ondertekend), dan werkt geen eerder verstuurde afmeldlink van ons meer (de pagina verwijst dan naar
  het contactadres; Resends eigen link in het sjabloon blijft werken): exporteer de CSV opnieuw en importeer hem vóór
  de volgende broadcast. Een accountverwijdering wist de rij in onze tabel en zet daarna het Resend-contact op
  `unsubscribed` (het contact zelf blijft bij Resend staan; verwijder het daar met de hand als je ook dat weg wilt).
  **Niet vanaf
  hier gecontroleerd:** dat Resend een contact-eigenschap als merge-veld in een broadcast kan invullen en in welke
  syntaxis; controleer dat in de broadcast-editor vóór de eerste verzending. Kan het niet, dan is er geen eerlijke
  manier om per lezer onze link in één broadcast te krijgen en moet de app zelf gaan versturen (open punt, niet
  gebouwd).

### Stap 8. Betalen (Stripe)

Zonder `STRIPE_SECRET_KEY` werkt alleen betalen per bankoverschrijving. Met Stripe kiest de klant iDEAL of
kaart (alleen Nederland, zie `DECISIONS.md`). Mislukt Stripe bij het afrekenen, dan blijft de klant op de
afrekenpagina met een duidelijke melding, er wordt niets aangemaakt en jij krijgt een melding: er is geen stille
terugval naar bankoverschrijving.

1. **Verificatie van het Stripe-account** afronden (bedrijfsgegevens, bankrekening). Duurt dagen.
2. **Betaalmethoden:** kaart en iDEAL activeren (Instellingen, Betaalmethoden). Voor iDEAL bij **abonnementen**
   vraagt Stripe volgens zijn documentatie ook SEPA-incasso; dat is niet in deze omgeving getest. Doe in testmodus
   één abonnement met iDEAL voordat je live gaat.
3. **Stripe Tax** activeren en het hoofdkantoor/vestigingsadres invullen. Zonder dit mislukt elke abonnementsbetaling.
4. **Je btw-nummer in Stripe** zetten, zodat door Stripe gemaakte facturen kloppen.
5. **Drie prijzen aanmaken**, maandelijks, in EUR, met het juiste `tax_behavior`:

   | Plan | Bedrag | Belastinggedrag |
   |---|---|---|
   | Particulier | € 4,99 | `inclusive` |
   | Monteur Pro | € 29 | `exclusive` |
   | Bedrijf | **€ 199** | `exclusive` |

   (Een oude versie van dit draaiboek noemde € 99 voor Bedrijf; dat is fout. Wie die prijs toen maakte, moet
   hem vervangen: een Stripe-prijs is niet te wijzigen, maak een nieuwe.) Zet de id's in `STRIPE_PRICE_PARTICULIER`,
   `STRIPE_PRICE_MONTEUR` en `STRIPE_PRICE_BEDRIJF`. `/api/stripe/subscribe` vergelijkt elke prijs met
   `src/lib/plans.ts` en weigert bij een afwijking.
6. **Webhook** op `<APP_URL>/api/stripe/webhook`, aangemaakt met API-versie **2024-12-18.acacia**, geabonneerd op
   **precies** de gebeurtenissen die de code afhandelt (`HANDLED_STRIPE_EVENTS` in `src/lib/stripe-events.ts`;
   `listWebhookEventsForDocs()` geeft de lijst):

   ```
   checkout.session.completed
   checkout.session.expired
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   invoice.paid
   invoice.payment_failed
   charge.refunded
   charge.dispute.created
   ```

   Een gebeurtenis die ontbreekt wordt door Stripe niet verstuurd, en dan draait de bijbehorende code nooit.
   Zet `STRIPE_WEBHOOK_SECRET` op het ondertekeningsgeheim van **dit** endpoint (test en live verschillen).
   **De webshop biedt iDEAL en kaart alleen aan als `STRIPE_SECRET_KEY` én `STRIPE_WEBHOOK_SECRET` allebei
   staan.** Met alleen de geheime sleutel zou elke betaling bij Stripe slagen terwijl de webhook wordt
   geweigerd en de bestelling tot de dagelijkse afstemming op PENDING blijft staan; dan blijft alleen betalen
   per bankoverschrijving over (`src/lib/cart-gate.ts`, `stripeCheckoutAvailable()`). `npm run preflight` blokkeert
   dezelfde configuratie.
7. **Klantportaal** opslaan met opzeggen **aan het einde van de factuurperiode** (Instellingen, Billing,
   Klantportaal). De voorwaarden beloven toegang tot het einde van de betaalde periode.
8. Zet de sleutels: `STRIPE_SECRET_KEY` (`sk_live_…`), optioneel `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
   Testsleutels horen alleen in Preview.

`npm run preflight -- --live-checks` controleert het account, kaart/iDEAL/SEPA, de drie prijzen (bedrag, valuta,
interval, belastinggedrag), het webhook-endpoint (adres, events, API-versie), Stripe Tax en het portaal met
`checkStripeReadiness()`. Dat zijn leesaanroepen; er wordt niets aangemaakt.

### Stap 9. AI en snelheidsbegrenzing

- `GEMINI_API_KEY` (Google AI Studio) met een budgetmelding in Google Cloud. Zonder sleutel draait de diagnose
  op trefwoorden en zegt dat ook; ze beweert dan geen zekerheid en toont geen "Powered by Gemini".
  Nergens belooft de site dat de diagnose klopt: het is een indicatie.
- `UPSTASH_REDIS_REST_URL` en `UPSTASH_REDIS_REST_TOKEN` (gratis Redis in de EU). **Optioneel, maar zonder
  tellen de snelheidslimieten per serverinstantie en beginnen ze bij elke koude start opnieuw**, dus op een
  serverless host is "10 bestellingen per uur per IP" in werkelijkheid 10 per instantie per uur. (Voor
  bestellingen per bankoverschrijving geldt daarnaast een maximum van **10 per adres per dag**, besluit D17; het
  stond op 3 en wees huishoudens, kantoren en mobiele netwerken af die één IP-adres delen. De echte bescherming
  zijn de limieten op het bedrag dat openstaat per koper en voor de hele winkel, `src/lib/cart-limits.ts`.) De maandquota
  in de database (gratis diagnoses, API-aanroepen) blijven exact. De app logt dit eenmalig per serverproces
  bij het eerste gebruik en `npm run preflight` meldt het als waarschuwing ("verminderde modus, toegestaan").
- **Welk IP-adres telt?** Op Vercel gebruikt de app `x-vercel-forwarded-for` (door het platform gezet). Elders
  wordt die header genegeerd en geldt het laatste adres in `x-forwarded-for`, dus de app hoort achter precies
  één reverse proxy te staan die dat adres toevoegt. Zonder proxy kan een bezoeker die header zelf kiezen; er
  bestaat in Next geen socketadres om beter te doen. Geen enkel adres is: alle bezoekers delen één emmer (en dat
  wordt eenmalig gelogd).

### Stap 10. Controleer alles: `npm run preflight`

De deploy-workflow (stap 4b) doet dit zelf vóór elke deploy: `vercel pull` haalt de Production-variabelen naar
`.vercel/.env.production.local` en de preflight draait daartegen, offline vóór de build en met `--url` erna. De
commando's hieronder zijn dezelfde controle vanaf je eigen computer (`vercel env pull` schrijft hetzelfde soort bestand
op een plek naar keuze).

```bash
vercel env pull .env.production.local --environment=production        # of zet de variabelen zelf in een bestand
npm run preflight -- --env-file .env.production.local                 # zonder netwerk
npm run preflight -- --env-file .env.production.local --live-checks   # database, Stripe, Resend, Clerk, Gemini, Upstash
npm run preflight -- --env-file .env.production.local --live-checks --url https://wasfix.nl   # na de deploy
```

Uitslag: **READY** (alles in orde), **READY WITH WARNINGS** (werkt, maar lees de waarschuwingen) of **NOT READY**
(minstens één blokkade; elk punt noemt de volgende stap; exitcode 1). Zonder `--live-checks` blijft alles op je
eigen computer; het script zegt dan ook welke controles het heeft overgeslagen. Met `--live-checks` leest het
alleen. `--target staging` laat testsleutels en `*.vercel.app` toe voor een Preview-omgeving, `--strict` maakt
waarschuwingen ook een foutcode.

Het script ziet niet in welke Vercel-omgeving (Production of Preview) een variabele staat; controleer dat in
Vercel zelf. Het kijkt wel naar: de variabelen per onderdeel met vormcontroles (testsleutel in productie,
live en test door elkaar, prijs-id's), de bedrijfsgegevens (ook de bekende testnummers), de databaseverbinding en
de toegepaste migraties, of er een beheerder is en geen demo-account, hoeveel onderdelen nog een geschatte
kostprijs of voorraad 0 hebben, `CRON_SECRET`, Upstash, het meldingskanaal, het Clerk-adres in de CSP, en met
`--url` de live site (health, afgedwongen CSP, inlogscherm zonder "Demo modus", afgeschermde pagina's,
sitemap en robots op het juiste adres, doorverwijzing van www, webhook weigert een ongeldige handtekening,
cron-routes weigeren aanroepen zonder geheim, geen voorbeeldgegevens op `/checkout`).

### Stap 11. Catalogus: voorraad, inkoopprijzen, foto's (hier zit je marge)

- De 96 onderdelen in de database hebben **geschatte** inkoopprijzen (`scripts/add-part-costs.mjs` rekent ze
  uit de verkoopprijs terug) en nog geen leverancier. Het veld `costSource` is `ESTIMATE` of `QUOTE`; elk
  margecijfer in de winkel telt alleen `QUOTE` en noemt de rest "schatting".
- Gemeten op de huidige gegevens (96 onderdelen, één stuk per bestelling, € 0,29 betaalkosten, geen retouren
  of verpakking, 21% btw eruit): bij een vervoerderstarief van € 5,20 is de gemiddelde bijdrage per bestelling
  € 11,00, bij € 6,50 is het € 9,70 en verliest 1 onderdeel geld. Met 15% korting (Bedrijf) is het € 3,98 en
  verliezen 13 onderdelen geld; zijn de echte inkoopprijzen 15% hoger dan geschat, dan is het ongeveer € 0 en
  verliezen 53 onderdelen geld; bij 30% hoger verliezen 34 onderdelen geld zonder enige korting. Deze
  cijfers volgen uit de schattingen en uit een vervoerderstarief dat niemand heeft opgevraagd.
  Je ziet het zelf in `/admin/economie`.
- **Doen:** vraag schriftelijke offertes voor de onderdelen die je het eerst gaat verkopen, en het tarief per
  gewichtsklasse bij je vervoerder. Zet de kostprijs met bron `QUOTE` in `/admin/onderdelen` (of via de
  CSV-import). Kies een ondergrens (bijvoorbeeld een bijdrage van minstens € 4 per onderdeel bij het hoogste kortingsniveau)
  en prijs onderdelen opnieuw of haal ze uit het aanbod als ze die niet halen.
- **Voorraad** invoeren: een nieuw onderdeel in productie staat op 0 en is dus niet te bestellen. Echte foto's
  vervangen de plaatshouders. Er is geen koppeling met een groothandel (ASWO en Reparatieshop bieden geen
  publieke API; dat vraagt een samenwerking).

### Stap 12. Proefbestelling, op een Preview met Stripe-testaccount

Doe dit **niet** in productie: facturen worden nooit gewijzigd of verwijderd en nummers lopen zonder gaten door.
Elke proefbestelling met je echte bedrijfsgegevens blijft als factuur bestaan, ook als je hem annuleert (dan
komt er een creditnota bij). Gebruik een Preview-deployment met een aparte database, Stripe-**test**-sleutels
en fictieve `COMPANY_*` (bijvoorbeeld de CI-waarden in `.github/workflows/ci.yml`).

Loop door: bestellen met iDEAL (testmodus), bestellen per bankoverschrijving, `Markeer betaald` met het exacte
bedrag, verzenden met track & trace, annuleren van een betaalde bestelling (creditnota), volledige en gedeeltelijke
terugbetaling, een abonnement met proefperiode en opzeggen via het portaal. Controleer mails, voorraad, facturen
en de meldingen in je kanaal. Eén echte bestelling met een klein bedrag naar jezelf, vlak voor de officiële start,
is verstandig; reken er dan op dat die factuur blijft staan.

### Stap 13. Boekhouder en juridisch (parallel, begin vroeg)

- **Boekhouder, drie vragen:** KOR of 21% (zie hierboven), factuurstelsel of kasstelsel, en de werkwijze voor
  creditnota's. De software geeft bij elke annulering of terugbetaling van een gefactureerde bestelling
  automatisch een creditnota uit een eigen reeks, in dezelfde databasehandeling als de statuswijziging; laat de
  boekhouder die reeks en de btw-aangifte over een kwartaal beoordelen (`/admin/economie` toont btw per kwartaal).
- **Juridisch:** privacy, voorwaarden, retour- en garantiepagina's zijn opgesteld op basis van gangbare
  e-commerce-sjablonen, niet door een jurist. Laat ze controleren vóór echte bestellingen.
- **Accountverwijdering (AVG art. 17)** loopt langs twee deuren en wist beide hetzelfde (`src/lib/erasure.ts`): de
  knop in het dashboard en het verwijderen van het account in Clerk zelf. Wat blijft staan: facturen en
  creditnota's (naam en adres op de factuur, 7 jaar), de bestelregels als administratie zonder e-mailadres,
  telefoonnummer, bezorgadres en bestellink, en de facturen die een monteur zelf verstuurde. De knop weigert
  zolang er een lopende bestelling is (betaald maar niet verzonden, wacht op overschrijving, onderweg, of
  bezorgd binnen 30 dagen); Clerk kan niet weigeren, dus daar blijven alleen die lopende bestellingen staan en
  krijg jij een melding; de dagelijkse opschoning (`/api/cron/retention`) wist ze zodra ze zijn afgerond.
  Een gast die het e-mailadres van een bestaand account intikt, krijgt een gastbestelling die niet op dat
  account komt en dus ook de verwijdering van dat account niet tegenhoudt.
- **Bewaartermijnen:** serverlogs volgen de bewaartermijn van je hostingprovider; tellers van anonieme bezoekers
  worden na 30 dagen zonder gebruik verwijderd (`IP_COUNTER_DAYS` in `src/lib/retention.ts`).

### Stap 14. Live en de eerste week

Draai `npm run preflight -- --env-file … --live-checks --url https://<domein>` opnieuw na de deploy. Kijk de
eerste week elke dag in je meldingenkanaal, in `/admin/bestellingen` (openstaande bankoverschrijvingen) en in de
Stripe-gebeurtenissen. Dien de sitemap in bij Google Search Console.

## 3. Naslag

**Kortingen op abonnementen (D13).** De korting op onderdelen van een abonnement geldt alleen terwijl het abonnement
wordt betaald, niet tijdens de proefperiode. Dat staat zo op de prijspagina ("vanaf je eerste betaling").

**Content Security Policy.** Eén bestand, `src/lib/csp.ts`. Voegt het Clerk-adres uit de publiceerbare sleutel
toe, de Cloudflare-uitdaging die Clerk gebruikt, `worker-src blob:`, en voor testsleutels (previews)
`*.clerk.accounts.dev`. Analytics-adressen (PostHog, Google Analytics) staan er alleen in als hun sleutel is gezet.
De header wordt bij de build vastgelegd; een andere Clerk-sleutel vraagt dus een nieuwe build.

**Afhankelijkheden.** Next.js staat op 15.5.27, de laagste 15.x-versie waarvoor `npm audit` de gepubliceerde Next-advisories
(waaronder de kritieke RCE in de beeldoptimalisatie) niet meer meldt. `npm audit` noemt `next` zelf nog wel, als matig,
vanwege het meegeleverde `postcss`; dat is pas in Next 16.4.0 opgelost. Na de upgrade meldt `npm audit --omit=dev` nog 14 punten (0 kritiek, 9 hoog, 4 matig, 1 laag): voornamelijk bouwgereedschap
(tailwind via `braces`/`micromatch`/`fast-glob`/`chokidar`, de Prisma-CLI via `deepmerge-ts`, `esbuild`) dat niet in de
draaiende site zit, en de `postcss` die in Next zelf is meegeleverd en pas met Next 16 verdwijnt. Een
hoofdversie-upgrade (Next 16, React, Prisma, Clerk) is jouw beslissing. CI draait `npm audit` informatief.

**Service worker.** Er is er geen meer. De oude cachete alle HTML, ook ingelogde pagina's, en registreerde zonder
toestemming. `public/sw.js` is nu een zelfverwijderend bestand dat bij bezoekers die de oude hebben alles
opruimt en zichzelf afmeldt; de pagina doet hetzelfde. Offline gebruik valt daarmee weg.

**Eenmalige opruimscripts** voor een database die vóór deze versies is geseed:

- Verzonnen kijkcijfers van gidsen wissen: `DATABASE_URL=… npx tsx scripts/reset-fabricated-guide-views.ts`
  (tweemaal draaien is veilig; later draaien vernietigt echte aantallen).
- Foutcodes opruimen die niet te bronnen zijn: `DATABASE_URL=… npx tsx scripts/prune-unsourceable-error-codes.ts --dry-run`
  en daarna zonder `--dry-run`. Het verwijdert alleen id's die `data/verification/*.json` als UNVERIFIED markeert.

**Overig, optioneel:** Google Search Console (`GSC_*`, stappen op `/admin/analytics/connect-gsc`), KvK-API
(`KVK_API_KEY`, zonder sleutel geeft `/api/monteur/kvk-lookup` een nepbedrijf terug), echte productfoto's.


---

## 4. Bijlage: foutcode-verificatie, wat nog een tweede blik verdient

The verification pass ran through `WebSearch`, which returns a synthesised
summary of pages rather than the pages themselves — this container's egress
proxy blocks the appliance-repair and manufacturer sites, so no source table
was read verbatim. Every `sourceUrl` in `data/verification/` is a real URL that
came back in results, and the attributed meaning is what those results reported,
but three things are worth a spot-check against an actual service manual before
you lean on them:

- **Whirlpool.** Our old table was a mixture of platforms and twelve of
  twenty-four entries were wrong, so the corrections are a clear improvement.
  But Whirlpool genuinely runs several incompatible Fxx tables (European
  Whirlpool/Laden/Bauknecht, 6th Sense, FSCR, US Duet), and the corrections
  rest on agreement between four or five sites rather than one authoritative
  document. Worth checking against an FFD-platform service manual.
- **Beko E08.** Deliberately not published. Two contradictory Beko E-code
  families circulate (one maps E01-E07 onto the H1-H7 service codes, the other
  gives E01 = door lock, E03 = drain, E04 = fill) and they disagree about E08.
  The eleven Beko codes that were added are ones both families agree on.
- **Bosch/Siemens E01.** Three sources, three meanings (door lock, heating
  circuit, fill). The row carries the best-sourced reading, says on the page
  that sources disagree, and stays REPORTED.

Three codes stay REPORTED because sources disagree about them, not because
nobody looked: Bosch E01, Siemens E01 and Miele F21. Their text carries the
best-sourced reading and the page says the sources conflict.

## 5. Bijlage: methode van de foutcode-verificatie

Every error code carries `provenance`, `sourceUrl` and `sourceName`. Of the 329
codes in `src/data/error-codes.json`, 326 are `VERIFIED` — each cites the page it
was checked against — and 3 are `REPORTED` (the Bosch/Siemens E01 and Miele F21
disagreements named above), which the public page states plainly rather than
implying we checked them.

To work the backlog:

1. `src/data/error-codes.json` is the source; `/admin/foutcodes` edits the same
   fields against the database (a code cannot be saved as VERIFIED without a
   source URL — enforced in `ErrorCodeSchema`).
2. Prefer the manufacturer's own support pages (samsung.com/nl/support,
   bosch-home.nl, lg.com/nl) over reseller blogs. Where two sources disagree,
   leave it `REPORTED` — a disagreement is exactly when we must not claim to
   have checked. Samsung `8E` (unbalance vs. inter-component communication) and
   LG `LE` (locked motor vs. door lock) are open cases of this.
3. Codes that cannot be sourced for that brand should be deleted, not kept.
   Suspicion falls hardest on the long sequential runs (Bosch/Siemens E01-E09,
   Miele F100-F105) where nothing distinguishes a real code from a filled gap.
4. `scripts/qa-money.ts` fails the build if a VERIFIED code has no source URL,
   or if a code marked DIY names the heating circuit, motor or control module
   in its title.

Note: this container's egress proxy blocks the appliance-repair sites, so the
research has to run through search rather than fetching those pages directly.
