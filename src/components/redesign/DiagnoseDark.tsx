"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/components/cart-provider";
import { toast } from "sonner";
import { Icon } from "./SharedLayout";
import { SafeMarkdown } from "@/components/diagnose/SafeMarkdown";
import { PhotoError, preparePhoto } from "@/components/diagnose/photo";
import { EVT, track } from "@/lib/analytics";

type Message = {
  role: "user" | "assistant";
  content: string;
  /** Shown in the thread but never sent to the model (photo notes, wall messages). */
  local?: boolean;
  /** An assistant message that came from the keyword lookup, not from a model. */
  fallback?: boolean;
};

type Diagnosis = {
  errorCode: string | null;
  /** The model's own estimate. Absent for a fallback answer. */
  confidence?: number;
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
  category?: string;
};

type RecommendedGuide = {
  id: string;
  slug: string;
  title: string;
  difficulty: string;
  timeMinutes: number;
};

type Quota = { limit: number; used: number; remaining: number };

const FALLBACK_LABEL = "Snelle zoekhulp op foutcodes - geen AI-analyse";
const DEFAULT_NOTICE =
  "Dit is een indicatie op basis van jouw omschrijving, geen garantie. Haal altijd eerst de stekker uit het stopcontact en draai de waterkraan dicht. Bij werk aan netspanning, de motor of de elektronische module: laat het aan een monteur over.";

const newSessionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const eur = (n: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

// Overrides that belong to this page only (the shared stylesheet is another bundle's file):
//  - grid items default to min-width:auto, so a long word in the result stretched the grid past a 375px
//    screen and clipped the send button;
//  - iOS Safari zooms into any input under 16px when it gets focus.
const PAGE_CSS = `
.wasfix-design .diagnose-grid > * { min-width: 0; }
@media (max-width: 980px) { .wasfix-design .diagnose-grid { grid-template-columns: minmax(0, 1fr); } }
.wasfix-design .chat-input .dz-input { font-size: 16px; min-height: 44px; }
.wasfix-design .dz-tap { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }
.wasfix-design .dz-part { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--surf-2); border: 1px solid var(--border); border-radius: 8px; }
.wasfix-design .dz-part-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.wasfix-design .dz-add { min-height: 44px; padding: 8px 14px; font-size: 13px; }
.wasfix-design .dz-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; border: 1px solid var(--border); color: var(--text-2); }
.wasfix-design .dz-chip-warn { border-color: rgba(255,170,60,0.5); color: var(--warn); }
.wasfix-design .msg-body { min-width: 0; overflow-wrap: anywhere; }
`;

export function DiagnoseDark() {
  const searchParams = useSearchParams();
  const prefill = searchParams.get("prefill") ?? "";
  const add = useCart((s) => s.add);

  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState(prefill);
  const [loading, setLoading] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [quotaReached, setQuotaReached] = React.useState<"anon" | "user" | null>(null);
  const [tooLong, setTooLong] = React.useState(false);
  const [diagnosis, setDiagnosis] = React.useState<Diagnosis | null>(null);
  const [mode, setMode] = React.useState<"ai" | "fallback" | null>(null);
  const [parts, setParts] = React.useState<RecommendedPart[]>([]);
  const [guides, setGuides] = React.useState<RecommendedGuide[]>([]);
  const [notice, setNotice] = React.useState<string>(DEFAULT_NOTICE);
  const [quota, setQuota] = React.useState<Quota | null>(null);
  const [aiAvailable, setAiAvailable] = React.useState<boolean | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const resultRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  // One id per conversation: the server counts a diagnosis per conversation, not per message.
  const sessionRef = React.useRef<string>("");
  const completedRef = React.useRef(false);

  React.useEffect(() => {
    sessionRef.current = newSessionId();
    let cancelled = false;
    fetch("/api/diagnose", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setAiAvailable(Boolean(d.aiAvailable));
        if (d.quota) setQuota(d.quota);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, loading]);

  const hasResult = Boolean(diagnosis) || parts.length > 0 || guides.length > 0;
  React.useEffect(() => {
    // On a phone the result sits below the chat; without this the answer arrives off-screen.
    if (!hasResult || !resultRef.current || window.innerWidth > 980) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    resultRef.current.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }, [hasResult, diagnosis, parts]);

  function applyResult(data: {
    diagnosis?: Diagnosis | null;
    recommendedParts?: RecommendedPart[];
    recommendedGuides?: RecommendedGuide[];
    notice?: string;
    quota?: Quota | null;
    mode?: "ai" | "fallback";
  }) {
    if (data.mode) setMode(data.mode);
    if (data.notice) setNotice(data.notice);
    if (data.quota) setQuota(data.quota);
    setDiagnosis(data.diagnosis ?? null);
    setParts(data.recommendedParts ?? []);
    setGuides(data.recommendedGuides ?? []);
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || loading || photoBusy || tooLong) return;

    const apiHistory = messages.filter((m) => !m.local);
    const next: Message[] = [...messages, { role: "user", content: text }];
    if (apiHistory.length === 0) track(EVT.DIAGNOSE_STARTED, { source: "text" });
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...apiHistory, { role: "user", content: text }].map(({ role, content }) => ({ role, content })), sessionId: sessionRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = (data.details ?? {}) as { code?: string; signedIn?: boolean };
        if (res.status === 429 && details.code === "limit_reached") {
          // The allowance is used up. Show the choice in the thread itself so the answer they were
          // waiting for is replaced by the way to get it.
          setQuotaReached(details.signedIn ? "user" : "anon");
          setQuota((q) => (q ? { ...q, used: q.limit, remaining: 0 } : q));
          setMessages([...next, { role: "assistant", content: data.error ?? "Je gratis diagnoses van deze maand zijn op.", local: true }]);
        } else if (details.code === "conversation_too_long") {
          setTooLong(true);
          setMessages([...next, { role: "assistant", content: data.error ?? "Dit gesprek is erg lang geworden. Start een nieuwe diagnose.", local: true }]);
        } else {
          toast.error(data.error ?? "Er ging iets mis, probeer het opnieuw");
        }
        return;
      }
      const fallback = data.mode === "fallback";
      setMessages([...next, { role: "assistant", content: data.message || "Diagnose ontvangen.", fallback }]);
      applyResult(data);
      if (data.diagnosis && !completedRef.current) {
        completedRef.current = true;
        track(EVT.DIAGNOSE_COMPLETED, { mode: data.mode, error_code: data.diagnosis.errorCode ?? undefined });
      }
    } catch {
      toast.error("Verbindingsfout, probeer het opnieuw");
    } finally {
      setLoading(false);
    }
  }

  async function sendPhoto(file: File) {
    if (loading || photoBusy || tooLong) return;
    setPhotoBusy(true);
    const apiHistory = messages.filter((m) => !m.local);
    if (apiHistory.length === 0) track(EVT.DIAGNOSE_STARTED, { source: "photo" });
    const note: Message = { role: "user", content: "Foto van het display of de machine verstuurd.", local: true };
    setMessages((m) => [...m, note]);
    try {
      let blob: Blob;
      try {
        blob = await preparePhoto(file);
      } catch (err) {
        const msg =
          err instanceof PhotoError && err.reason === "not_image"
            ? "Dat bestand is geen foto."
            : "Deze foto kon niet worden verkleind. Probeer een JPEG- of PNG-foto, of typ de foutcode.";
        setMessages((m) => [...m, { role: "assistant", content: msg, local: true }]);
        return;
      }
      const form = new FormData();
      form.append("image", blob, "foto.jpg");
      form.append("sessionId", sessionRef.current);
      const res = await fetch("/api/diagnose/image", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = (data.details ?? {}) as { code?: string; signedIn?: boolean };
        if (res.status === 429 && details.code === "limit_reached") {
          setQuotaReached(details.signedIn ? "user" : "anon");
        }
        setMessages((m) => [...m, { role: "assistant", content: data.error ?? "De foto kon niet worden beoordeeld. Typ de foutcode of je klacht.", local: true }]);
        return;
      }
      if (data.quota) setQuota(data.quota);
      if (data.notice) setNotice(data.notice);
      if (data.recognised) {
        const match = data.matchedErrorCode
          ? `\n\nIn onze database: **Foutcode ${data.matchedErrorCode.code} (${data.matchedErrorCode.brand}): ${data.matchedErrorCode.title}**`
          : "";
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `${data.description}${match}\n\nKlopt dat? Verstuur de vraag hieronder om de diagnose te starten, of pas hem eerst aan.`, local: true },
        ]);
        if (data.suggestedQuery) setInput(data.suggestedQuery);
        setParts(data.recommendedParts ?? []);
        setGuides(data.recommendedGuides ?? []);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: `${data.description}\n\nOp deze foto kon ik niets betrouwbaar aflezen. Maak een scherpe foto van het display, of typ de foutcode.`, local: true }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "De foto kon niet worden verstuurd. Controleer je verbinding of typ de foutcode.", local: true }]);
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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

  function reset() {
    sessionRef.current = newSessionId();
    completedRef.current = false;
    setMessages([]);
    setDiagnosis(null);
    setParts([]);
    setGuides([]);
    setMode(null);
    setTooLong(false);
    fetch("/api/diagnose", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setAiAvailable(Boolean(d.aiAvailable));
        if (d.quota) setQuota(d.quota);
        if (d.quota && d.quota.limit !== -1 && d.quota.remaining > 0) setQuotaReached(null);
      })
      .catch(() => undefined);
  }

  const handleAdd = (p: RecommendedPart) => {
    // add() returns how many were really added; 0 means the cart refused and has already said why.
    const added = add({ partId: p.id, sku: p.sku, name: p.name, brand: p.brand, priceEur: p.priceEur, imageUrl: p.imageUrl, stock: p.stock }, 1);
    if (added <= 0) return;
    track(EVT.PART_ADDED_TO_CART, { sku: p.sku, category: p.category, source: "diagnose" });
    toast.success(`${p.name} toegevoegd aan winkelmand`);
  };

  const quickStarts = [
    { brand: "Bosch", code: "E18", text: "Mijn Bosch wasmachine geeft foutcode E18, water staat in de trommel" },
    { brand: "Miele", code: "F11", text: "Miele wasmachine met foutcode F11, pomp werkt niet" },
    { brand: "Samsung", code: "dE", text: "Samsung deur sluit niet, foutcode dE" },
    { brand: "LG", code: "OE", text: "LG wasmachine pompt water niet weg, foutcode OE" },
  ];

  // What the header says is what is true: the last answer's mode wins, else what the server reported on load.
  const showFallbackLabel = mode === "fallback" || (mode === null && aiAvailable === false);
  const showAiLabel = mode === "ai" || (mode === null && aiAvailable === true);
  const inputLocked = loading || photoBusy || quotaReached !== null || tooLong;
  // A photo can only be assessed by the AI. When no AI will answer (not configured, switched off, or the last
  // answer was the lookup fallback) the button would just upload ~1 MB to get a refusal, so it is not offered.
  const photoPossible = mode === "ai" || (mode === null && aiAvailable === true);

  return (
    <section className="section" style={{ paddingTop: 56 }}>
      <style>{PAGE_CSS}</style>
      <div className="container">
        <div className="pill pill-acc" style={{ marginBottom: 16 }}>
          <Icon name="sparkle" size={12} /> Een eerste indicatie, geen zekerheid
        </div>
        <h1 className="h-display" style={{ fontSize: "clamp(32px, 4.8vw, 56px)" }}>
          AI <em>diagnose</em> voor je wasmachine
        </h1>
        <p className="lead" style={{ marginBottom: 20 }}>
          {photoPossible ? "Beschrijf je probleem, typ een foutcode of voeg een foto van het display toe." : "Beschrijf je probleem of typ een foutcode."} Je krijgt een eerste indicatie van de waarschijnlijke oorzaak en de onderdelen die je mogelijk nodig hebt.
        </p>
        {quota && quota.limit !== -1 && (
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 20 }} data-testid="quota-line">
            {quota.remaining > 0
              ? `Nog ${quota.remaining} van ${quota.limit} gratis diagnoses deze maand. Een diagnose is één gesprek, ook als de AI eerst een vraag stelt.`
              : `Je ${quota.limit} gratis diagnoses van deze maand zijn gebruikt.`}
          </p>
        )}

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
                disabled={loading || quotaReached !== null}
                style={{ background: "transparent", cursor: loading ? "not-allowed" : "pointer", minHeight: 44 }}
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, flexWrap: "wrap", minWidth: 0 }}>
                <span className="live-dot" />
                <span>WasFix</span>
                {showAiLabel && <span className="muted" style={{ fontSize: 11.5 }} data-testid="mode-ai">· AI-assistent (Google Gemini)</span>}
                {showFallbackLabel && <span className="dz-chip dz-chip-warn" data-testid="mode-fallback">{FALLBACK_LABEL}</span>}
              </div>
              {messages.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={reset}>
                  <Icon name="repeat" size={12} /> Nieuwe diagnose
                </button>
              )}
            </div>
            <div className="chat-body" ref={bodyRef} aria-live="polite">
              {messages.length === 0 && (
                <div className="msg msg-ai">
                  <div className="msg-avatar">AI</div>
                  <div className="msg-body">
                    Hoi! Welk merk wasmachine heb je en wat is er aan de hand?
                    <br /><br />
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      Voorbeeld: &ldquo;Bosch WAT286H0NL, geeft E18, water blijft staan in de trommel&rdquo;
                    </span>
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`msg msg-${m.role === "assistant" ? "ai" : "user"}`}>
                  <div className="msg-avatar" aria-hidden="true">
                    {m.role === "assistant" ? (m.fallback ? <Icon name="search" size={13} /> : "AI") : <Icon name="user" size={13} />}
                  </div>
                  <div className="msg-body">
                    {m.fallback && <div className="dz-chip dz-chip-warn" style={{ marginBottom: 8 }}>Zoekhulp, geen AI</div>}
                    {m.role === "assistant" ? <SafeMarkdown text={m.content} /> : <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>}
                  </div>
                </div>
              ))}
              {(loading || photoBusy) && (
                <div className="msg msg-ai">
                  <div className="msg-avatar">AI</div>
                  <div className="msg-body">
                    <span className="typing"><span /><span /><span /></span>
                    {photoBusy && <span className="muted" style={{ fontSize: 12.5, marginLeft: 8 }}>Foto wordt bekeken...</span>}
                  </div>
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
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                data-testid="photo-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void sendPhoto(f);
                }}
              />
              {photoPossible && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost dz-tap"
                  aria-label="Foto van het display of de machine toevoegen"
                  title="Foto toevoegen"
                  disabled={inputLocked}
                  onClick={() => fileRef.current?.click()}
                >
                  <Icon name="camera" size={16} />
                </button>
              )}
              <input
                className="dz-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={messages.length === 0 ? "Bv. Bosch E18, water staat in de trommel..." : "Stel een vervolgvraag..."}
                aria-label="Je bericht"
                maxLength={4000}
                enterKeyHint="send"
                autoComplete="off"
                disabled={inputLocked}
              />
              <button type="submit" className="btn btn-sm btn-primary dz-tap" aria-label="Verstuur" disabled={inputLocked || !input.trim()}>
                <Icon name="send" size={14} />
              </button>
            </form>
          </div>

          {/* Result side */}
          <div className="diag-result" ref={resultRef}>
            {!hasResult && messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
                <Icon name="sparkle" size={32} className="dim" />
                <p style={{ fontSize: 14, marginTop: 16, lineHeight: 1.55 }}>
                  Begin met chatten. Zodra er genoeg informatie is zie je hier:
                </p>
                <ul style={{ textAlign: "left", maxWidth: 280, margin: "16px auto 0", paddingLeft: 20, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.8 }}>
                  <li>De waarschijnlijke oorzaak</li>
                  <li>Alternatieve oorzaken</li>
                  <li>Onderdelen die je mogelijk nodig hebt</li>
                  <li>Een stap-voor-stap reparatiegids</li>
                </ul>
              </div>
            )}

            {!hasResult && messages.length > 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
                {loading || photoBusy ? (
                  <>
                    <span className="typing"><span /><span /><span /></span>
                    <p style={{ fontSize: 13, marginTop: 12 }}>{mode === "fallback" || aiAvailable === false ? "Foutcode wordt opgezocht..." : "Je probleem wordt geanalyseerd..."}</p>
                  </>
                ) : (
                  <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>Zodra er genoeg informatie is verschijnt hier de indicatie van de oorzaak.</p>
                )}
              </div>
            )}

            {diagnosis && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}>
                      {mode === "fallback" ? "Uit de foutcodedatabase" : "Waarschijnlijke oorzaak"}
                    </div>
                    <div style={{ fontWeight: 500, fontSize: 16, marginTop: 2, overflowWrap: "anywhere" }}>{diagnosis.mainCause}</div>
                    {diagnosis.brand && (
                      <div className="muted mono" style={{ fontSize: 11.5, marginTop: 2 }}>
                        {diagnosis.brand}{diagnosis.errorCode ? ` · ${diagnosis.errorCode}` : ""}
                      </div>
                    )}
                  </div>
                  {mode !== "fallback" && typeof diagnosis.confidence === "number" && (
                    <div style={{ textAlign: "right" }}>
                      <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>INSCHATTING AI</div>
                      <div style={{ fontSize: 22, fontWeight: 500 }}>{diagnosis.confidence}%</div>
                      <div className="muted" style={{ fontSize: 11 }}>geen meting</div>
                    </div>
                  )}
                </div>

                {!diagnosis.diyFriendly && (
                  <div className="dz-chip dz-chip-warn" style={{ alignSelf: "flex-start" }} data-testid="monteur-flag">
                    Laat dit door een monteur beoordelen
                  </div>
                )}

                {diagnosis.alternativeCauses?.length > 0 && (
                  <div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                      {mode === "fallback" ? "Mogelijke oorzaken" : "Alternatieve oorzaken"}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {diagnosis.alternativeCauses.slice(0, 6).map((c, i) => (
                        <div key={i} style={{ fontSize: 13, color: "var(--text-2)", display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--acc)", flexShrink: 0 }} />
                          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {diagnosis.recommendedAction && (
                  <div style={{ padding: 14, background: "rgba(79,140,255,0.06)", border: "1px solid var(--border-ac)", borderRadius: 10 }}>
                    <div className="mono" style={{ fontSize: 11, color: "var(--acc-2)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                      {mode === "fallback" ? "Toelichting" : "Voorgestelde eerste stap"}
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.55, overflowWrap: "anywhere" }}>{diagnosis.recommendedAction}</div>
                  </div>
                )}
              </>
            )}

            {parts.length > 0 && (
              <div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
                  Onderdelen die je mogelijk nodig hebt
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {parts.slice(0, 4).map((p) => (
                    <div key={p.id} className="dz-part" data-testid="rec-part">
                      <div style={{ minWidth: 0 }}>
                        <Link href={`/onderdelen/${p.sku}`} style={{ fontWeight: 500, fontSize: 13.5, color: "var(--text)", overflowWrap: "anywhere" }}>{p.name}</Link>
                        <div className="muted mono" style={{ fontSize: 11, overflowWrap: "anywhere" }}>{p.brand} · {p.sku}</div>
                      </div>
                      <div className="dz-part-actions">
                        <div>
                          <div style={{ fontWeight: 500 }}>{eur(p.priceEur)}</div>
                          <div style={{ fontSize: 11.5, color: p.stock > 0 ? "var(--acc-2)" : "var(--danger)" }}>
                            {p.stock > 0 ? "Op voorraad" : "Uitverkocht"}
                          </div>
                        </div>
                        {p.stock > 0 ? (
                          <button className="btn btn-primary dz-add" onClick={() => handleAdd(p)} aria-label={`${p.name} in winkelmand`}>
                            <Icon name="cart" size={14} /> In winkelmand
                          </button>
                        ) : (
                          <Link className="btn dz-add" href={`/onderdelen/${p.sku}`}>Bekijk onderdeel</Link>
                        )}
                      </div>
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
                  {guides.slice(0, 3).map((g) => (
                    <Link
                      key={g.id}
                      href={`/gidsen/${g.slug}`}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", minHeight: 44, background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, overflowWrap: "anywhere" }}>{g.title}</div>
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

            {hasResult && (
              <p className="muted" style={{ fontSize: 12, lineHeight: 1.55, margin: 0 }} data-testid="result-notice">
                {notice} <Link href="/disclaimer" style={{ textDecoration: "underline" }}>Lees de disclaimer</Link>.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
