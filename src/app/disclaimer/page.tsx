import { LegalPage } from "@/components/redesign/LegalPage";
import Link from "next/link";

export const metadata = {
  title: "DIY Disclaimer · WasFix Pro",
  description: "Veiligheidsinstructies en disclaimer voor zelf-reparatie van wasmachines.",
};

export default function DisclaimerPage() {
  return (
    <LegalPage title="DIY" emphasis="disclaimer">
      <p>
        Onze reparatiegidsen, AI-diagnose en YouTube-content zijn bedoeld om je te helpen je wasmachine zelf te repareren. Dit kan veel geld en tijd besparen — maar het brengt ook risico&apos;s met zich mee. Lees onderstaande veiligheidsinstructies <strong>altijd</strong> vóór je begint.
      </p>

      <div className="callout" style={{ background: "rgba(255,160,0,0.06)", borderColor: "var(--warn)" }}>
        <strong>⚠️ Veiligheid eerst.</strong> Wasmachines werken op 230V netspanning en bevatten water. Bij verkeerd gebruik kan dit leiden tot elektrocutie, brand, waterschade of letsel. <strong>Twijfel je? Bel een vakman.</strong>
      </div>

      <h2>1. Algemene veiligheidsregels</h2>
      <ol>
        <li><strong>Stekker eruit</strong> — Altijd. Eerst de stekker uit het stopcontact, dan pas beginnen.</li>
        <li><strong>Waterkraan dicht</strong> — Sluit beide watertoevoer-kranen.</li>
        <li><strong>Restwater leeg</strong> — Plaats een bak onder het pluizenfilter en laat het leeglopen voordat je iets demonteert.</li>
        <li><strong>Geen werk onder spanning</strong> — Test met een spanningstester of er écht geen stroom op staat.</li>
        <li><strong>Gebruik isolerend gereedschap</strong> — Bij twijfel: koop schroevendraaiers met VDE-keurmerk.</li>
        <li><strong>Werk droog</strong> — Geen natte handen, geen plassen water op de vloer.</li>
        <li><strong>Til niet alleen</strong> — Een wasmachine weegt 60-80 kg. Vraag iemand om hulp.</li>
        <li><strong>Foto&apos;s maken</strong> — Voor je iets loskoppelt: maak foto&apos;s van bedrading. Bespaart frustratie bij het terugbouwen.</li>
      </ol>

      <h2>2. Wanneer NIET zelf doen</h2>
      <p>Bel een professionele monteur als:</p>
      <ul>
        <li>Je twijfelt over je elektrische kennis</li>
        <li>Het probleem zit in de besturingsprint (PCB) en je weet niet welke component faalt</li>
        <li>De wasmachine onder fabrieksgarantie staat (zelf repareren kan garantie verlopen)</li>
        <li>Er rook of brandlucht uit de machine komt — direct stekker eruit, niet repareren</li>
        <li>De machine in een huurwoning staat — meld het bij de verhuurder</li>
        <li>Het werk vereist gas-aansluiting (sommige droogcombinaties)</li>
      </ul>

      <h2>3. Beperking van aansprakelijkheid</h2>
      <p>
        WasFix Pro stelt informatie beschikbaar &ldquo;as is&rdquo;, zonder garantie op volledigheid of geschiktheid voor jouw specifieke situatie. Door onze gidsen of AI-diagnose te gebruiken accepteer je dat:
      </p>
      <ul>
        <li>Reparaties op eigen risico zijn</li>
        <li>WasFix Pro niet aansprakelijk is voor schade, letsel of garantieverlies door zelf uitgevoerde reparaties</li>
        <li>AI-diagnose een hulpmiddel is, geen vervanging voor professioneel advies</li>
        <li>Jij verantwoordelijk bent voor het correct toepassen van veiligheidsmaatregelen</li>
      </ul>
      <p>
        Deze beperkingen gelden niet voor schade die voortkomt uit opzet of bewuste roekeloosheid van WasFix Pro (zoals aantoonbaar foutieve instructies). Consumentenrechten conform Boek 6/7 BW worden niet aangetast.
      </p>

      <h2>4. Garantie op eigen-werk</h2>
      <p>
        Reparaties die je zelf uitvoert vallen niet onder fabrieksgarantie. Maar:
      </p>
      <ul>
        <li>De wettelijke conformiteitsgarantie op het apparaat als geheel kan onder bepaalde omstandigheden blijven gelden — zie EU Right-to-Repair.</li>
        <li>Onderdelen die je via WasFix Pro koopt hebben hun eigen garantie (24 mnd origineel, 12 mnd universeel). Zie <Link href="/garantie">garantievoorwaarden</Link>.</li>
      </ul>

      <h2>5. Wat als het misgaat?</h2>
      <p>Geen paniek. Maak het volgende veilig:</p>
      <ol>
        <li>Stekker eruit (als dat veilig kan)</li>
        <li>Waterkraan dicht</li>
        <li>Bel een monteur of stuur ons een bericht via <Link href="/contact">contact</Link> — we helpen waar mogelijk verder</li>
        <li>Maak foto&apos;s voor je verzekering / claim</li>
      </ol>

      <h2>6. Nood-situaties</h2>
      <ul>
        <li><strong>Brand:</strong> 112 bellen. Niet zelf blussen tenzij begin van smeulrook.</li>
        <li><strong>Elektrocutie:</strong> 112. Persoon NIET aanraken voordat stroom uit is.</li>
        <li><strong>Forse waterlekkage:</strong> hoofdkraan water dicht (vaak in de meterkast)</li>
      </ul>

      <p style={{ marginTop: 32, padding: "14px 16px", background: "rgba(79,140,255,0.06)", border: "1px solid var(--border-ac)", borderRadius: 10 }}>
        <strong>Onthoud:</strong> veel wasmachinestoringen — een verstopt filter, een versleten pomp, een kapot deurslot — zijn goed te doen door iemand met basis-technisch inzicht. Zodra het om netspanning, de motor of de besturingsmodule gaat, is een monteur bellen de verstandige keuze. Wij bemiddelen niet in monteurs en houden geen netwerk van vakmensen bij; die keuze is aan jou.
      </p>
    </LegalPage>
  );
}
