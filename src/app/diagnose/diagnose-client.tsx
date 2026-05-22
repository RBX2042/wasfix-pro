"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  Bot, Send, RotateCcw, Sparkles, AlertTriangle, CheckCircle2,
  Wrench, ShoppingCart, BookOpen, Clock, ExternalLink, Zap,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/components/cart-provider";
import { formatEur } from "@/lib/utils";
import { toast } from "sonner";
import ConfidenceGauge from "@/components/diagnosis/ConfidenceGauge";
import DiagnosisRadarChart from "@/components/charts/DiagnosisRadarChart";
import ImageUpload from "@/components/diagnosis/ImageUpload";
import { SustainabilityBadge } from "@/components/ui/sustainability-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, MessageSquare } from "lucide-react";

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
};

type Part = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  priceEur: number;
  imageUrl: string | null;
  stock: number;
};

type Guide = {
  id: string;
  slug: string;
  title: string;
  difficulty: string;
  timeMinutes: number;
  summary: string;
};

const QUICK_PROMPTS = [
  { label: "Bosch foutcode E18", prompt: "Mijn Bosch wasmachine geeft foutcode E18" },
  { label: "Miele lekt water", prompt: "Mijn Miele wasmachine lekt water onder de deur" },
  { label: "Samsung trommel draait niet", prompt: "Mijn Samsung wasmachine geeft een UE foutcode en de trommel trilt sterk" },
  { label: "LG wast niet warm", prompt: "Mijn LG wasmachine wast niet meer warm, het water blijft koud" },
];

export function DiagnoseClient() {
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: "assistant",
      content: "👋 Welkom bij WasFix Pro! Ik help je je wasmachine te diagnosticeren. Welk merk heb je en wat is er aan de hand?",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [diagnosis, setDiagnosis] = React.useState<Diagnosis | null>(null);
  const [parts, setParts] = React.useState<Part[]>([]);
  const [guides, setGuides] = React.useState<Guide[]>([]);
  const [sessionId] = React.useState(() => `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const addToCart = useCart((s) => s.add);
  const [prefillSent, setPrefillSent] = React.useState(false);

  // Handle prefill from URL (?prefill=...)
  React.useEffect(() => {
    if (prefillSent) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("prefill");
    if (prefill) {
      setPrefillSent(true);
      send(prefill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, sessionId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          toast.error(data.message ?? "Limiet bereikt");
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "⚠️ Je hebt je gratis diagnoses voor deze maand bereikt. [Upgrade naar Particulier voor onbeperkte diagnoses](/prijzen) voor maar €4,99/maand.",
            },
          ]);
        } else {
          toast.error("Er ging iets mis. Probeer het opnieuw.");
        }
        return;
      }

      const data = await res.json();

      // Strip the diagnosis JSON from displayed message
      const cleanMessage = data.message.replace(/<diagnosis>[\s\S]*?<\/diagnosis>/g, "").trim();
      setMessages((prev) => [...prev, { role: "assistant", content: cleanMessage }]);

      if (data.diagnosis) {
        setDiagnosis(data.diagnosis);
        setParts(data.recommendedParts ?? []);
        setGuides(data.recommendedGuides ?? []);
      }
    } catch {
      toast.error("Verbindingsfout. Probeer het opnieuw.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function reset() {
    setMessages([{ role: "assistant", content: "👋 Welkom bij WasFix Pro! Welk merk wasmachine heb je en wat is er aan de hand?" }]);
    setDiagnosis(null);
    setParts([]);
    setGuides([]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="container py-6 md:py-10">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-heading text-2xl md:text-3xl font-bold flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-accent" /> AI Diagnose
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Beschrijf je probleem en krijg binnen seconden de meest waarschijnlijke oorzaak.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="h-3 w-3" /> Nieuwe diagnose
            </Button>
          </div>

          {/* Image upload */}
          <Card>
            <CardContent className="p-4">
              <Tabs defaultValue="text" className="w-full">
                <TabsList className="mb-3">
                  <TabsTrigger value="text"><MessageSquare className="h-3 w-3 mr-1" /> Beschrijven</TabsTrigger>
                  <TabsTrigger value="photo"><Camera className="h-3 w-3 mr-1" /> Foto uploaden</TabsTrigger>
                </TabsList>
                <TabsContent value="text" className="mt-0">
                  <p className="text-xs text-muted-foreground">Type je probleem hieronder in de chat. Onze AI analyseert direct.</p>
                </TabsContent>
                <TabsContent value="photo" className="mt-0">
                  <ImageUpload
                    onAnalysis={(result, previewUrl) => {
                      // Build a synthetic chat exchange describing the photo analysis
                      const userText = result.suggestedQuery || `Foto geanalyseerd: ${result.detectedCode ?? "onbekende foutcode"}`;
                      const aiText = `${result.description}\n\n${result.matchedErrorCode ? `**${result.matchedErrorCode.code} — ${result.matchedErrorCode.title}**` : ""}`;
                      setMessages((prev) => [
                        ...prev,
                        { role: "user", content: userText },
                        { role: "assistant", content: aiText },
                      ]);
                      if (result.detectedCode || result.matchedErrorCode) {
                        setDiagnosis({
                          errorCode: result.detectedCode,
                          confidence: result.confidence,
                          mainCause: result.matchedErrorCode?.title ?? result.description.split(".")[0],
                          alternativeCauses: [],
                          diyFriendly: true,
                          urgency: "medium",
                          recommendedAction: "Bekijk de aanbevolen onderdelen en gids voor de oplossing",
                          brand: result.detectedBrand ?? undefined,
                        });
                        setParts(result.recommendedParts ?? []);
                        setGuides(result.recommendedGuides ?? []);
                      }
                      // Acknowledge upload
                      void previewUrl;
                    }}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Chat */}
          <Card className="overflow-hidden">
            <div ref={scrollRef} className="h-[480px] overflow-y-auto p-4 space-y-4 bg-muted/20">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground mr-2 mt-0.5">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-card border rounded-tl-sm"
                    }`}
                  >
                    {renderMarkdown(m.content)}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground mr-2 mt-0.5">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-card border px-4 py-3">
                    <div className="flex gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="border-t p-3 flex gap-2">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Beschrijf het probleem of geef een foutcode..."
                className="resize-none min-h-[44px] max-h-32"
                disabled={loading}
                rows={1}
              />
              <Button type="submit" size="icon" disabled={!input.trim() || loading} className="h-11 w-11 shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </Card>

          {messages.length <= 1 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Snelle voorbeelden:</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((q) => (
                  <Button key={q.prompt} variant="outline" size="sm" onClick={() => send(q.prompt)}>
                    {q.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          {!diagnosis && (
            <Card>
              <CardContent className="p-5 space-y-4">
                <h3 className="font-heading font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4 text-accent" /> Snelle tips
                </h3>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" /> Geef altijd het merk én model door</li>
                  <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" /> Vermeld de foutcode als die er is</li>
                  <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" /> Beschrijf wanneer het probleem zich voordoet</li>
                  <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" /> Geef geluiden of zichtbare schade aan</li>
                </ul>
              </CardContent>
            </Card>
          )}

          {diagnosis && (
            <DiagnosisPanel diagnosis={diagnosis} />
          )}

          {parts.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <h3 className="font-heading font-semibold mb-3 flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" /> Aanbevolen onderdelen
                </h3>
                <div className="space-y-2.5">
                  {parts.slice(0, 4).map((p) => (
                    <div key={p.id} className="flex gap-3 rounded-md border p-2.5">
                      {p.imageUrl && (
                        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-muted">
                          <Image src={p.imageUrl} alt={p.name} fill sizes="56px" className="object-cover" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <Link href={`/onderdelen/${p.sku}`} className="text-sm font-medium hover:text-primary line-clamp-2 leading-tight">
                          {p.name}
                        </Link>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="font-bold text-primary">{formatEur(p.priceEur)}</span>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                            addToCart({ partId: p.id, sku: p.sku, name: p.name, brand: p.brand, priceEur: p.priceEur, imageUrl: p.imageUrl }, 1);
                            toast.success("Toegevoegd aan winkelmand");
                          }}>
                            + winkelmand
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {guides.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <h3 className="font-heading font-semibold mb-3 flex items-center gap-2">
                  <BookOpen className="h-4 w-4" /> Reparatiegidsen
                </h3>
                <div className="space-y-2">
                  {guides.map((g) => (
                    <Link key={g.id} href={`/gidsen/${g.slug}`} className="block rounded-md border p-3 hover:border-primary transition-colors group">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium group-hover:text-primary">{g.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{g.summary}</p>
                        </div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <DifficultyBadge difficulty={g.difficulty} />
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {g.timeMinutes} min</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function DiagnosisPanel({ diagnosis }: { diagnosis: Diagnosis }) {
  const urgencyColor = diagnosis.urgency === "high" ? "danger" : diagnosis.urgency === "medium" ? "warning" : "success";
  const urgencyLabel = diagnosis.urgency === "high" ? "Hoog" : diagnosis.urgency === "medium" ? "Gemiddeld" : "Laag";

  // Build radar chart data: main cause at full confidence, alternatives scaled down
  const radarData = [
    { name: diagnosis.mainCause, probability: diagnosis.confidence },
    ...(diagnosis.alternativeCauses ?? []).slice(0, 4).map((c, i) => ({
      name: c,
      probability: Math.max(20, diagnosis.confidence - (15 + i * 10)),
    })),
  ];

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" /> Diagnose
          </h3>
          <Badge variant={urgencyColor as "danger" | "warning" | "success"}>Urgentie: {urgencyLabel}</Badge>
        </div>

        {/* Animated confidence gauge */}
        <div className="flex justify-center">
          <ConfidenceGauge confidence={diagnosis.confidence} label={diagnosis.errorCode ?? "Match"} />
        </div>

        {diagnosis.errorCode && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Foutcode</p>
            <p className="font-heading font-bold text-2xl">{diagnosis.errorCode}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground">Hoofdoorzaak</p>
          <p className="font-medium">{diagnosis.mainCause}</p>
        </div>

        {radarData.length >= 3 && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground mb-2">Waarschijnlijkheidsverdeling</p>
            <DiagnosisRadarChart causes={radarData} />
          </div>
        )}

        <div className={`rounded-md p-3 text-sm ${diagnosis.diyFriendly ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
          {diagnosis.diyFriendly ? (
            <span className="flex items-center gap-2"><Wrench className="h-4 w-4" /> Zelf oplosbaar</span>
          ) : (
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Monteur aanbevolen</span>
          )}
        </div>

        {diagnosis.recommendedAction && (
          <div className="text-sm border-t pt-3">
            <p className="text-xs text-muted-foreground mb-1">Volgende stap</p>
            <p>{diagnosis.recommendedAction}</p>
          </div>
        )}

        <div className="border-t pt-3 flex flex-wrap gap-2">
          <SustainabilityBadge variant="co2" co2Saved={45} />
        </div>
      </CardContent>
    </Card>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    EASY: { label: "Makkelijk", variant: "success" },
    MEDIUM: { label: "Gemiddeld", variant: "warning" },
    HARD: { label: "Moeilijk", variant: "danger" },
    EXPERT: { label: "Expert", variant: "danger" },
  };
  const m = map[difficulty] ?? map.MEDIUM;
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}

// Tiny markdown renderer for **bold**, [links](url), and line breaks
function renderMarkdown(text: string) {
  const parts: React.ReactNode[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const boldRegex = /\*\*([^*]+)\*\*/g;

  // Process line by line
  text.split("\n").forEach((line, lineIdx) => {
    if (lineIdx > 0) parts.push(<br key={`br-${lineIdx}`} />);

    let lastIdx = 0;
    const segments: React.ReactNode[] = [];
    const matches: Array<{ start: number; end: number; node: React.ReactNode }> = [];

    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        node: <Link key={`${lineIdx}-l-${match.index}`} href={match[2]} className="underline text-accent">{match[1]}</Link>,
      });
    }
    while ((match = boldRegex.exec(line)) !== null) {
      // Avoid double processing
      if (matches.some((m) => match!.index >= m.start && match!.index < m.end)) continue;
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        node: <strong key={`${lineIdx}-b-${match.index}`}>{match[1]}</strong>,
      });
    }

    matches.sort((a, b) => a.start - b.start);
    matches.forEach((m) => {
      if (m.start > lastIdx) segments.push(line.slice(lastIdx, m.start));
      segments.push(m.node);
      lastIdx = m.end;
    });
    if (lastIdx < line.length) segments.push(line.slice(lastIdx));

    parts.push(<span key={`line-${lineIdx}`}>{segments.length ? segments : line}</span>);
  });

  return <>{parts}</>;
}
