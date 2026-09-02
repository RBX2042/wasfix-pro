"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/components/cart-provider";
import { toast } from "sonner";
import { Icon } from "./SharedLayout";

type Message = { role: "user" | "assistant"; content: string };

type Diagnosis = {
  errorCode: string | null;
  confidence: number;
  mainCause: string;
  alternativeCauses: string[];
  diyFriendly: boolean;
  urgency: "low" | "medium" | "high";
  recommendedAction: string;
  brand?: string;
  model?: string;
};

type RecommendedPart = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  priceEur: number;
  imageUrl: string | null;
  stock: number;
};

type RecommendedGuide = {
  id: string;
  slug: string;
  title: string;
  difficulty: string;
  timeMinutes: number;
};

export function DiagnoseDark() {
  const searchParams = useSearchParams();
  const prefill = searchParams.get("prefill") ?? "";
  const add = useCart((s) => s.add);

  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState(prefill);
  const [loading, setLoading] = React.useState(false);
  const [quotaReached, setQuotaReached] = React.useState<"anon" | "user" | null>(null);
  const [diagnosis, setDiagnosis] = React.useState<Diagnosis | null>(null);
  const [parts, setParts] = React.useState<RecommendedPart[]>([]);
  const [guides, setGuides] = React.useState<RecommendedGuide[]>([]);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, loading]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      if (!res.ok) {
        const details = (data.details ?? {}) as { code?: string; signedIn?: boolean };
        if (res.status === 429 && details.code === "limit_reached") {
          // The free tier is used up. Show the choice in the thread itself so
          // the answer they were waiting for is replaced by the way to get it.
          setQuotaReached(details.signedIn ? "user" : "anon");
          setMessages([...newMessages, {
            role: "assistant",
            content: details.signedIn
              ? "Je hebt je 3 gratis diagnoses van deze maand gebruikt. Met Particulier stel je onbeperkt vragen — de eerste 14 dagen gratis."
              : "Je hebt je 3 gratis diagnoses van deze maand gebruikt. Maak een gratis account om je diagnoses te bewaren, of ga voor onbeperkt met Particulier — de eerste 14 dagen gratis.",
          }]);
        } else {
          toast.error(data.error ?? "AI-fout — probeer opnieuw");
        }
        setLoading(false);
        return;
      }
      // Strip the <diagnosis> JSON block from the assistant text for display
      const clean = (data.message ?? "").replace(/<diagnosis>[\s\S]*?<\/diagnosis>/, "").trim();
      setMessages([...newMessages, { role: "assistant", content: clean || "Diagnose ontvangen." }]);
      setDiagnosis(data.diagnosis ?? null);
      setParts(data.recommendedParts ?? []);
      setGuides(data.recommendedGuides ?? []);
    } catch {
      toast.error("Verbindingsfout — probeer opnieuw");
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send();
  };

  const handleQuickStart = (text: string) => {
    setInput(text);
    send(text);
  };

  const handleAdd = (p: RecommendedPart) => {
    add({
      partId: p.id,
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      priceEur: p.priceEur,
      imageUrl: p.imageUrl,
    }, 1);
    toast.success(`${p.name} toegevoegd aan winkelmand`);
  };

  const quickStarts = [
    { brand: "Bosch", code: "E18", text: "Mijn Bosch wasmachine geeft foutcode E18 — water staat in de trommel" },
    { brand: "Miele", code: "F11", text: "Miele wasmachine met foutcode F11, pomp werkt niet" },
    { brand: "Samsung", code: "dE", text: "Samsung deur sluit niet, dE foutcode" },
    { brand: "LG", code: "OE", text: "LG wasmachine pompt water niet weg, foutcode OE" },
  ];

  return (
    <section className="section" style={{ paddingTop: 56 }}>
      <div className="container">
        <div className="pill pill-acc" style={{ marginBottom: 16 }}>
          <Icon name="sparkle" size={12} /> Powered by Google Gemini · 60s diagnose
        </div>
        <h1 className="h-display" style={{ fontSize: "clamp(32px, 4.8vw, 56px)" }}>
          AI <em>diagnose</em> voor je wasmachine
        </h1>
        <p className="lead" style={{ marginBottom: 32 }}>
          Beschrijf je probleem, plak een foutcode, of upload een foto van het display. Onze AI vertelt je wat er mis is + welk onderdeel je nodig hebt.
        </p>

        {messages.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
            <span className="dim mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", alignSelf: "center", marginRight: 4 }}>
              Snel starten
            </span>
            {quickStarts.map((q) => (
              <button
                key={q.code}
                className="hero-popular-tag"
                onClick={() => handleQuickStart(q.text)}
                disabled={loading}
                style={{ background: "transparent", cursor: loading ? "not-allowed" : "pointer" }}
              >
                {q.brand} <b style={{ color: "var(--acc-2)" }}>{q.code}</b>
              </button>
            ))}
          </div>
        )}

        <div className="diagnose-grid">
          {/* Chat */}
          <div className="chat">
            <div className="chat-hd">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                <span className="live-dot" />
                <span>WasFix AI</span>
                <span className="muted" style={{ fontSize: 11.5 }}>· Gemini 2.0 Flash</span>
              </div>
              {messages.length > 0 && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => { setMessages([]); setDiagnosis(null); setParts([]); setGuides([]); }}
                >
                  <Icon name="repeat" size={12} /> Reset
                </button>
              )}
            </div>
            <div className="chat-body" ref={bodyRef}>
              {messages.length === 0 && (
                <div className="msg msg-ai">
                  <div className="msg-avatar">AI</div>
                  <div className="msg-body">
                    Hoi! Ik ben WasFix AI. Welk merk wasmachine heb je en wat is er aan de hand?
                    <br /><br />
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      Voorbeeld: &ldquo;Bosch WAT286H0NL, geeft E18, water blijft staan in de trommel&rdquo;
                    </span>
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`msg msg-${m.role === "assistant" ? "ai" : "user"}`}>
                  <div className="msg-avatar">{m.role === "assistant" ? "AI" : "JD"}</div>
                  <div className="msg-body" style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                </div>
              ))}
              {loading && (
                <div className="msg msg-ai">
                  <div className="msg-avatar">AI</div>
                  <div className="msg-body"><span className="typing"><span /><span /><span /></span></div>
                </div>
              )}
            </div>
            {quotaReached && (
              <div style={{
                margin: "0 12px 12px", padding: "14px 16px", borderRadius: 12,
                border: "1px solid rgba(79,140,255,0.35)",
                background: "linear-gradient(135deg, rgba(79,140,255,0.10), rgba(0,212,255,0.06))",
              }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 4 }}>
                  Je gratis diagnoses zijn op
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, marginBottom: 12 }}>
                  {quotaReached === "anon"
                    ? "Maak een gratis account om je diagnoses te bewaren, of ga onbeperkt met Particulier."
                    : "Met Particulier stel je onbeperkt vragen, inclusief alle premium reparatiegidsen."}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="btn btn-primary btn-sm" href="/upgrade?plan=PARTICULIER">
                    14 dagen gratis proberen
                  </Link>
                  {quotaReached === "anon" && (
                    <Link className="btn btn-sm" href="/registreren">Gratis account</Link>
                  )}
                  <Link className="btn btn-sm" href="/prijzen">Bekijk plannen</Link>
                </div>
              </div>
            )}
            <form className="chat-input" onSubmit={handleSubmit}>
              <Icon name="plus" size={14} className="dim" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={messages.length === 0 ? "Bv. Bosch E18 — water staat in de trommel..." : "Stel een vervolgvraag..."}
                disabled={loading || quotaReached !== null}
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={loading || !input.trim() || quotaReached !== null} style={{ padding: "6px 10px" }}>
                <Icon name="send" size={13} />
              </button>
            </form>
          </div>

          {/* Result side */}
          <div className="diag-result">
            {!diagnosis && messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
                <Icon name="sparkle" size={32} className="dim" />
                <p style={{ fontSize: 14, marginTop: 16, lineHeight: 1.55 }}>
                  Begin met chatten links. Zodra ik je probleem begrijp zie je hier de diagnose met:
                </p>
                <ul style={{ textAlign: "left", maxWidth: 280, margin: "16px auto 0", paddingLeft: 20, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.8 }}>
                  <li>Hoofdoorzaak + confidence %</li>
                  <li>Alternatieve oorzaken</li>
                  <li>Aanbevolen onderdelen</li>
                  <li>Stap-voor-stap reparatiegids</li>
                </ul>
              </div>
            )}

            {!diagnosis && messages.length > 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
                <span className="typing"><span /><span /><span /></span>
                <p style={{ fontSize: 13, marginTop: 12 }}>AI analyseert je probleem...</p>
              </div>
            )}

            {diagnosis && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}>
                      Diagnose
                    </div>
                    <div style={{ fontWeight: 500, fontSize: 16, marginTop: 2 }}>{diagnosis.mainCause}</div>
                    {diagnosis.brand && (
                      <div className="muted mono" style={{ fontSize: 11.5, marginTop: 2 }}>
                        {diagnosis.brand}{diagnosis.errorCode ? ` · ${diagnosis.errorCode}` : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>VERTROUWEN</div>
                    <div style={{ fontSize: 22, fontWeight: 500, color: diagnosis.confidence > 80 ? "var(--acc-2)" : diagnosis.confidence > 60 ? "var(--warn)" : "var(--danger)" }}>
                      {diagnosis.confidence}%
                    </div>
                  </div>
                </div>

                {diagnosis.alternativeCauses?.length > 0 && (
                  <div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                      Alternatieve oorzaken
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {diagnosis.alternativeCauses.slice(0, 4).map((c, i) => (
                        <div key={i} style={{ fontSize: 13, color: "var(--text-2)", display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--acc)", flexShrink: 0 }} />
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {diagnosis.recommendedAction && (
                  <div style={{ padding: 14, background: "rgba(79,140,255,0.06)", border: "1px solid var(--border-ac)", borderRadius: 10 }}>
                    <div className="mono" style={{ fontSize: 11, color: "var(--acc-2)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                      Aanbevolen actie
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{diagnosis.recommendedAction}</div>
                  </div>
                )}

                {parts.length > 0 && (
                  <div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
                      Aanbevolen onderdelen
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {parts.slice(0, 3).map((p) => (
                        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                            <div className="muted mono" style={{ fontSize: 11 }}>{p.sku} · € {p.priceEur.toFixed(2).replace(".", ",")}</div>
                          </div>
                          <button className="btn btn-sm btn-primary" onClick={() => handleAdd(p)} style={{ marginLeft: 10, flexShrink: 0 }}>
                            <Icon name="cart" size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {guides.length > 0 && (
                  <div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
                      Reparatiegidsen
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {guides.slice(0, 2).map((g) => (
                        <Link
                          key={g.id}
                          href={`/gidsen/${g.slug}`}
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                        >
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{g.title}</div>
                            <div className="muted mono" style={{ fontSize: 11 }}>
                              {g.timeMinutes} min · {g.difficulty}
                            </div>
                          </div>
                          <Icon name="chevron" size={14} className="dim" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
