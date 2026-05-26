import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import { RmaForm } from "./rma-form";

export const metadata = {
  title: "Retour aanvragen · WasFix Pro",
  description: "Start hier je retour-aanvraag bij WasFix Pro. 30 dagen bedenktijd, gratis bij defecten.",
};

export default function RetourStartPage() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <div className="eyebrow">Service</div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 14 }}>
            Retour <em>aanvragen</em>
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Vul onderstaand formulier in om je retour te starten. Je ontvangt binnen 24u op werkdagen je RMA-nummer + instructies per e-mail.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 32 }}>
            {[
              { icon: "shield" as const, title: "30 dagen", desc: "Bedenktijd vanaf ontvangst" },
              { icon: "package" as const, title: "Gratis", desc: "Bij defect of fout van ons" },
              { icon: "repeat" as const, title: "Snelle restitutie", desc: "Binnen 14 dagen na retour" },
            ].map((b, i) => (
              <div key={i} className="step-card">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(79,140,255,0.1)", display: "grid", placeItems: "center", color: "var(--acc-2)" }}>
                    <Icon name={b.icon} size={14} />
                  </span>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{b.title}</div>
                </div>
                <div className="step-text" style={{ fontSize: 12.5 }}>{b.desc}</div>
              </div>
            ))}
          </div>

          <RmaForm />
        </div>
      </section>
    </WasFixShell>
  );
}
