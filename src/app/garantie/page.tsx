import { LegalPage } from "@/components/redesign/LegalPage";
import Link from "next/link";

export const metadata = {
  title: "Garantievoorwaarden · WasFix Pro",
  description: "Garantie op originele en universele wasmachine-onderdelen + EU Right-to-Repair.",
};

export default function GarantiePage() {
  return (
    <LegalPage title="Garantie" emphasis="voorwaarden">
      <p>
        Op alle onderdelen die je bij WasFix Pro koopt geldt de wettelijke conformiteitsgarantie. Aanvullend bieden we langere fabrieksgarantie op originele onderdelen en onze WasFix-garantie op universele onderdelen. Dit document legt uit wat je rechten zijn, hoe je een garantieclaim indient, en wat er buiten de garantie valt.
      </p>

      <h2>1. Wettelijke garantie (altijd geldig)</h2>
      <p>
        Volgens artikel 7:17 BW moet een gekocht product voldoen aan wat je redelijkerwijs mag verwachten. Voor een wasmachine-onderdeel betekent dit dat het moet werken zoals beschreven, voor een redelijke periode (bij ons minimaal 2 jaar voor originele onderdelen, 1 jaar voor universele).
      </p>
      <p>
        Deze wettelijke garantie kan <strong>nooit</strong> worden uitgesloten of beperkt door fabrikant- of WasFix-voorwaarden.
      </p>

      <h2>2. WasFix garantieperiodes</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--surf-2)" }}>
            <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Categorie</th>
            <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Periode</th>
            <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Dekking</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}><strong>Origineel onderdeel</strong></td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>24 maanden</td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Materiaal + fabricage</td></tr>
          <tr><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}><strong>Universeel/compatibel</strong></td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>12 maanden</td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Materiaal + fabricage</td></tr>
          <tr><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}><strong>Verbruiksartikel</strong> (filter, dichting)</td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>6 maanden</td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Materiaal</td></tr>
          <tr><td style={{ padding: "10px 12px" }}><strong>Elektronica</strong> (PCB, display)</td><td style={{ padding: "10px 12px" }}>24 maanden</td><td style={{ padding: "10px 12px" }}>Materiaal + fabricage</td></tr>
        </tbody>
      </table>

      <h2>3. EU Right-to-Repair</h2>
      <p>
        Verordening (EU) 2019/2023 (bijlage II) verplicht fabrikanten van wasmachines en was-droogcombinaties om reserve-onderdelen nog <strong>10 jaar</strong> beschikbaar te houden nadat het laatste exemplaar van een model op de markt is gebracht. Die eis geldt sinds 1 maart 2021 en rust op de <strong>fabrikant</strong>, niet op WasFix: wij kunnen dus niet beloven dat elk onderdeel uit onze catalogus tien jaar leverbaar blijft. Wat je precies mag verwachten, en van wie, staat op <Link href="/right-to-repair">right to repair</Link>.
      </p>

      <h2>4. Wat valt buiten de garantie?</h2>
      <ul>
        <li>Schade door onjuiste installatie of montage</li>
        <li>Schade door extern geweld (water, brand, bliksem, valschade)</li>
        <li>Slijtage door normaal gebruik (bv. koolborstels)</li>
        <li>Onderdelen die zijn aangepast of gemodificeerd</li>
        <li>Indirecte schade (bv. waterschade door verkeerd geïnstalleerde slang)</li>
      </ul>

      <h2>5. Hoe dien je een garantieclaim in?</h2>
      <ol>
        <li>Stuur een mail naar <a href="mailto:garantie@wasfix.nl">garantie@wasfix.nl</a> met je bestelnummer, foto&apos;s van het defect, en korte beschrijving.</li>
        <li>Wij beoordelen binnen 5 werkdagen.</li>
        <li>Bij goedkeuring: wij sturen een retour-label. Stuur het onderdeel retour.</li>
        <li>Na ontvangst: vervanging, reparatie, of volledige restitutie binnen 14 dagen.</li>
      </ol>

      <h2>6. Tip: bewaar je factuur</h2>
      <p>
        Een geldige garantieclaim vereist een bewijs van aankoop (factuur of orderbevestiging). Je kunt deze altijd opvragen via je <Link href="/dashboard/bestellingen">dashboard</Link>.
      </p>

      <p style={{ marginTop: 32, padding: "14px 16px", background: "rgba(79,140,255,0.06)", border: "1px solid var(--border-ac)", borderRadius: 10 }}>
        <strong>Twijfel je of je iets onder garantie kan claimen?</strong> Stuur een mail naar <a href="mailto:garantie@wasfix.nl">garantie@wasfix.nl</a> — we kijken graag met je mee, zonder verplichting.
      </p>
    </LegalPage>
  );
}
