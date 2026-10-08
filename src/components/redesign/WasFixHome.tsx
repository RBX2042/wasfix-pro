"use client";

import * as React from "react";
import Link from "next/link";
import { useCart, cartCount } from "@/components/cart-provider";
import { CartDrawer } from "@/components/cart-drawer";
import { toast } from "sonner";
import "@/app/wasfix-design.css";
import { WasFixFooter } from "@/components/redesign/SharedLayout";
import { PLANS, PLAN_ORDER, formatPlanPrice, planPriceSuffix } from "@/lib/plans";

// Headline numbers come from the server (page.tsx reads the real catalogue) and
// reach the components through this context. They used to be computed here by
// importing catalog-stats, which imports the whole catalogue JSON: that put every
// part - purchase price and supplier included - into this component's JS chunk
// (330 KB, shipped to every visitor of the home page).
export type HomeStats = { errorCodes: number; parts: number; guides: number; brands: number };
const StatsContext = React.createContext<HomeStats>({ errorCodes: 0, parts: 0, guides: 0, brands: 0 });
const useStats = () => React.useContext(StatsContext);
const formatCount = (n: number) => new Intl.NumberFormat("nl-NL").format(n);

// ─── Icon helper ────────────────────────────────────────────────────────
type IconName =
  | "arrow" | "sparkle" | "check" | "play" | "search" | "bolt" | "chart" | "package"
  | "shield" | "code" | "book" | "leaf" | "co2" | "repeat" | "camera" | "qr" | "user"
  | "cart" | "pulse" | "close" | "chevron" | "star" | "plus" | "mic" | "send";

function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    sparkle: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    play: <path d="M6 4v16l14-8z" fill="currentColor" stroke="none" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
    bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
    chart: <><path d="M3 3v18h18" /><path d="m7 14 4-4 4 4 5-5" /></>,
    package: <><path d="m3 7 9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
    shield: <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3z" />,
    code: <><path d="m9 8-4 4 4 4" /><path d="m15 8 4 4-4 4" /></>,
    book: <><path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3z" /><path d="M4 4v17" /></>,
    leaf: <path d="M21 3c-9 0-18 7-18 18 0-9 9-9 12-12 1-1 3-1 4-2s2-3 2-4z" />,
    co2: <><circle cx="8" cy="12" r="4" /><circle cx="16" cy="12" r="4" /></>,
    repeat: <><path d="M17 1 21 5l-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
    camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="4" /></>,
    qr: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M20 14v3M14 20h3M20 17v4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
    cart: <><path d="M3 4h2l3 12h11l3-8H6" /><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /></>,
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    star: <path d="M12 2.5 14.5 9h6.5l-5.3 4 2 6.5L12 16l-5.7 3.5 2-6.5L3 9h6.5z" fill="currentColor" strokeWidth={0} />,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    send: <path d="m22 2-7 20-4-9-9-4z" />,
  };
  return <svg {...props}>{paths[name]}</svg>;
}

// ─── Machine parts data ─────────────────────────────────────────────────
type Part = {
  id: string;
  name: string;
  code: string;
  hint: string;
  /** Shop category this machine part is sold under, and its Dutch plural for the link text. */
  category: string;
  categoryLabel: string;
  hot: { cx: number; cy: number; r: number };
};

const MACHINE_PARTS: Part[] = [
  { id: "door-lock", category: "LOCK", categoryLabel: "deursloten", name: "Deurslot", code: "dE / F34", hint: "Vergrendelt de deur tijdens een programma.", hot: { cx: 393, cy: 218, r: 26 } },
  { id: "gasket", category: "DOOR", categoryLabel: "deuren & pakkingen", name: "Manchet (rubber)", code: "—", hint: "Voorkomt waterlekkage rondom de deur.", hot: { cx: 300, cy: 158, r: 24 } },
  { id: "drum", category: "BEARING", categoryLabel: "lagers", name: "Trommel + lagers", code: "F11 / d07", hint: "Roterende trommel — lagers vervangen na ±10 jaar.", hot: { cx: 300, cy: 300, r: 38 } },
  { id: "heater", category: "HEATING", categoryLabel: "verwarming", name: "Verwarmingselement", code: "tE / F19", hint: "Verwarmt het water. Kalkaanslag is een bekende oorzaak van uitval.", hot: { cx: 300, cy: 412, r: 22 } },
  { id: "ntc", category: "NTC", categoryLabel: "temperatuursensoren", name: "Temperatuursensor", code: "F19 / tE", hint: "NTC meet watertemperatuur.", hot: { cx: 224, cy: 412, r: 14 } },
  { id: "pump", category: "PUMP", categoryLabel: "pompen", name: "Afvoerpomp", code: "E18 / OE", hint: "Pompt vuil water af. Een veelvoorkomende oorzaak bij afvoerstoringen (E18).", hot: { cx: 156, cy: 472, r: 22 } },
  { id: "filter", category: "FILTER", categoryLabel: "filters", name: "Vuilfilter", code: "E18 / 5E", hint: "Vang muntjes en haren op. Maandelijks legen.", hot: { cx: 396, cy: 472, r: 20 } },
  { id: "valve", category: "VALVE", categoryLabel: "ventielen", name: "Inlaatventiel", code: "E12 / 4E", hint: "Regelt watertoevoer. Filter zit erachter verstopt.", hot: { cx: 478, cy: 100, r: 14 } },
  { id: "pcb", category: "BOARD", categoryLabel: "moederborden", name: "Besturingsprint", code: "F63 / UE", hint: "Het brein. Reset-poging vóór vervangen.", hot: { cx: 372, cy: 78, r: 14 } },
  { id: "motor", category: "MOTOR", categoryLabel: "motoren", name: "Motor + koolborstels", code: "F11 / 8E", hint: "Koolborstels verslijten na ±8 jaar.", hot: { cx: 196, cy: 300, r: 22 } },
];

// ─── Hotspot ────────────────────────────────────────────────────────────
function Hotspot({ part, active, hover, predict, onHover, onClick, local = false, ox = 0, oy = 0 }: {
  part: Part | undefined;
  active: boolean;
  hover: boolean;
  predict: boolean;
  onHover: (id: string | null) => void;
  onClick: (p: Part) => void;
  local?: boolean;
  ox?: number;
  oy?: number;
}) {
  if (!part) return null;
  const cx = part.hot.cx - (local ? ox : 0);
  const cy = part.hot.cy - (local ? oy : 0);
  const r = part.hot.r;
  const show = active || hover;
  return (
    <g
      onMouseEnter={() => onHover(part.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(part)}
      style={{ cursor: "pointer" }}
    >
      {predict && !active && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f5b643" strokeWidth="1" opacity="0.5">
          <animate attributeName="r" values={`${r};${r + 8};${r}`} dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={cx} cy={cy} r={r}
        fill={show ? "rgba(0,212,255,0.10)" : "transparent"}
        stroke={show ? "#00d4ff" : "rgba(255,255,255,0.18)"}
        strokeWidth={show ? 1.4 : 1}
        strokeDasharray={show ? "0" : "3 4"} />
      <circle cx={cx} cy={cy} r={show ? 3 : 2} fill={show ? "#00d4ff" : "rgba(255,255,255,0.35)"} />
      {active && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#00d4ff" strokeWidth="1">
          <animate attributeName="r" values={`${r};${r + 10};${r}`} dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={cx} cy={cy} r={r + 8} fill="transparent" />
    </g>
  );
}

// ─── Washing machine SVG ────────────────────────────────────────────────
function WashingMachine({ activeId, onSelect, scanning = false, highlight = [], displayText = "E 1 8" }: {
  activeId?: string;
  onSelect?: (p: Part) => void;
  scanning?: boolean;
  highlight?: string[];
  displayText?: string;
}) {
  const [hover, setHover] = React.useState<string | null>(null);
  const [drumAngle, setDrumAngle] = React.useState(0);

  React.useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      setDrumAngle(((t - t0) / 60) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const isActive = (id: string) => activeId === id;
  const isHover = (id: string) => hover === id;
  const isPredict = (id: string) => highlight.includes(id);
  const handleSelect = (p: Part) => { if (onSelect) onSelect(p); };

  const CABINET = { x: 50, y: 50, w: 500, h: 510, r: 22 };
  const DOOR_CX = 300, DOOR_CY = 300, DOOR_R = 130;
  const DRUM_R = 110;

  return (
    <svg viewBox="0 0 600 600" width="100%" style={{ display: "block", maxWidth: 580, margin: "0 auto" }}>
      <defs>
        <linearGradient id="cabFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1c2540" />
          <stop offset="0.5" stopColor="#141a30" />
          <stop offset="1" stopColor="#0f1426" />
        </linearGradient>
        <linearGradient id="panelFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1d2748" />
          <stop offset="1" stopColor="#161e3a" />
        </linearGradient>
        <radialGradient id="glassFill" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#1c2747" stopOpacity="0.7" />
          <stop offset="0.6" stopColor="#0a0f1f" stopOpacity="0.9" />
          <stop offset="1" stopColor="#040712" stopOpacity="0.95" />
        </radialGradient>
        <radialGradient id="drumFill" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0" stopColor="#1f2a4a" />
          <stop offset="0.7" stopColor="#0d1326" />
          <stop offset="1" stopColor="#070a18" />
        </radialGradient>
        <linearGradient id="seal" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2a3559" />
          <stop offset="1" stopColor="#161d36" />
        </linearGradient>
        <linearGradient id="hiLight" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="accGrad" x1="0" x2="1">
          <stop offset="0" stopColor="#4f8cff" />
          <stop offset="1" stopColor="#00d4ff" />
        </linearGradient>
        <pattern id="drumHoles" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="7" r="1.3" fill="rgba(255,255,255,0.10)" />
        </pattern>
        <linearGradient id="scanSweep" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#00d4ff" stopOpacity="0" />
          <stop offset="0.4" stopColor="#00d4ff" stopOpacity="0.7" />
          <stop offset="0.6" stopColor="#00d4ff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#00d4ff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="scanClip">
          <rect x="50" y="50" width="500" height="510" rx="22" />
        </clipPath>
      </defs>

      <ellipse cx="300" cy="320" rx="280" ry="240" fill="url(#accGrad)" opacity="0.05" />
      <rect x={CABINET.x} y={CABINET.y} width={CABINET.w} height={CABINET.h} rx={CABINET.r}
        fill="url(#cabFill)" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
      <rect x={CABINET.x + 8} y={CABINET.y + 8} width={CABINET.w - 16} height={CABINET.h - 16} rx={CABINET.r - 6}
        fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
      <rect x={CABINET.x + 4} y={CABINET.y + 4} width={CABINET.w - 8} height={120} rx={20} fill="url(#hiLight)" />

      <g transform="translate(70 72)">
        <rect width="460" height="78" rx="12" fill="url(#panelFill)" stroke="rgba(255,255,255,0.07)" />
        <rect x="16" y="14" width="148" height="50" rx="8" fill="#040712" stroke="rgba(0,212,255,0.25)" />
        <text x="90" y="36" textAnchor="middle" fontFamily="var(--font-geist-mono), ui-monospace, monospace" fontSize="11" fill="#00d4ff" opacity="0.55" letterSpacing="0.12em">ERROR</text>
        <text x="90" y="56" textAnchor="middle" fontFamily="var(--font-geist-mono), ui-monospace, monospace" fontSize="20" fontWeight="500" fill="#00d4ff" letterSpacing="0.2em">{displayText}</text>
        <circle cx="156" cy="22" r="1.6" fill="#00d4ff" />
        <circle cx="156" cy="28" r="1.6" fill="#00d4ff" opacity="0.5" />
        <circle cx="220" cy="39" r="22" fill="#1a2240" stroke="rgba(255,255,255,0.10)" />
        <circle cx="220" cy="39" r="16" fill="#0e1424" stroke="rgba(255,255,255,0.06)" />
        <line x1="220" y1="39" x2="220" y2="25" stroke="#00d4ff" strokeWidth="1.5" strokeLinecap="round" />
        <text x="220" y="76" textAnchor="middle" fontFamily="var(--font-geist-mono), ui-monospace, monospace" fontSize="8" fill="rgba(255,255,255,0.35)" letterSpacing="0.1em">PROGRAMMA</text>
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${260 + i * 44} 24)`}>
            <rect width="32" height="32" rx="7" fill="#10172c" stroke="rgba(255,255,255,0.06)" />
            <circle cx="16" cy="16" r="3" fill={i === 1 ? "#00d4ff" : "rgba(255,255,255,0.20)"} />
          </g>
        ))}
        <Hotspot part={MACHINE_PARTS.find(p => p.id === "pcb")} local
          active={isActive("pcb")} hover={isHover("pcb")} predict={isPredict("pcb")}
          onHover={setHover} onClick={handleSelect} ox={70} oy={72} />
        <Hotspot part={MACHINE_PARTS.find(p => p.id === "valve")} local
          active={isActive("valve")} hover={isHover("valve")} predict={isPredict("valve")}
          onHover={setHover} onClick={handleSelect} ox={70} oy={72} />
      </g>

      <g transform="translate(70 168)">
        <rect width="80" height="60" rx="6" fill="#0e1424" stroke="rgba(255,255,255,0.08)" />
        <rect x="6" y="6" width="22" height="48" rx="3" fill="#08101e" />
        <rect x="32" y="6" width="22" height="48" rx="3" fill="#08101e" />
        <rect x="58" y="6" width="18" height="48" rx="3" fill="#08101e" />
        <circle cx="40" cy="56" r="2" fill="rgba(255,255,255,0.20)" />
      </g>

      <g>
        <circle cx={DOOR_CX} cy={DOOR_CY} r={DOOR_R + 14} fill="url(#seal)" stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
        <circle cx={DOOR_CX} cy={DOOR_CY} r={DOOR_R + 7} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="2 3" />
        <circle cx={DOOR_CX} cy={DOOR_CY} r={DOOR_R} fill="url(#glassFill)" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
        <g transform={`rotate(${drumAngle} ${DOOR_CX} ${DOOR_CY})`}>
          <circle cx={DOOR_CX} cy={DOOR_CY} r={DRUM_R} fill="url(#drumFill)" />
          <circle cx={DOOR_CX} cy={DOOR_CY} r={DRUM_R} fill="url(#drumHoles)" />
          {[0, 120, 240].map((a) => (
            <g key={a} transform={`rotate(${a} ${DOOR_CX} ${DOOR_CY})`}>
              <rect x={DOOR_CX - 5} y={DOOR_CY - DRUM_R + 18} width="10" height="38" rx="3" fill="#1a2240" stroke="rgba(255,255,255,0.10)" />
            </g>
          ))}
        </g>
        <circle cx={DOOR_CX} cy={DOOR_CY} r={DRUM_R - 4} fill="none" stroke="rgba(255,255,255,0.04)" />
        <ellipse cx={DOOR_CX - 40} cy={DOOR_CY - 60} rx="32" ry="14" fill="rgba(255,255,255,0.06)" transform={`rotate(-25 ${DOOR_CX - 40} ${DOOR_CY - 60})`} />
        <circle cx={DOOR_CX - DOOR_R - 14} cy={DOOR_CY} r="3" fill="rgba(255,255,255,0.15)" />
        <circle cx={DOOR_CX + DOOR_R + 14} cy={DOOR_CY - 76} r="4" fill="#00d4ff" opacity="0.7" />
        <circle cx={DOOR_CX + DOOR_R + 14} cy={DOOR_CY - 76} r="4" fill="none" stroke="#00d4ff" opacity="0.4">
          <animate attributeName="r" values="4;9;4" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0;0.4" dur="2.4s" repeatCount="indefinite" />
        </circle>
      </g>

      <g>
        <rect x="65" y="448" width="470" height="80" rx="10" fill="#0c1324" stroke="rgba(255,255,255,0.05)" />
        <circle cx="396" cy="472" r="14" fill="#0e1424" stroke="rgba(255,255,255,0.10)" />
        <line x1="386" y1="472" x2="406" y2="472" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeLinecap="round" />
      </g>

      <rect x="70" y="540" width="40" height="14" rx="2" fill="#0a0f1c" />
      <rect x="490" y="540" width="40" height="14" rx="2" fill="#0a0f1c" />

      {scanning && (
        <g clipPath="url(#scanClip)">
          <rect x="50" y="0" width="500" height="80" fill="url(#scanSweep)">
            <animate attributeName="y" values="50;560;50" dur="2.6s" repeatCount="indefinite" />
          </rect>
        </g>
      )}

      {MACHINE_PARTS.filter(p => p.id !== "pcb" && p.id !== "valve").map((p) => (
        <Hotspot key={p.id} part={p}
          active={isActive(p.id)} hover={isHover(p.id)} predict={isPredict(p.id)}
          onHover={setHover} onClick={handleSelect} />
      ))}

      {(hover || activeId) && (() => {
        const id = hover || activeId!;
        const p = MACHINE_PARTS.find(x => x.id === id);
        if (!p) return null;
        const offsetX = p.hot.cx < 300 ? -1 : 1;
        const labelX = p.hot.cx < 300 ? 56 : 544;
        const labelY = Math.max(70, Math.min(540, p.hot.cy));
        const anchor = p.hot.cx < 300 ? "end" : "start";
        return (
          <g pointerEvents="none">
            <line x1={p.hot.cx} y1={p.hot.cy} x2={labelX - offsetX * 8} y2={labelY}
              stroke="#00d4ff" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
            <circle cx={p.hot.cx} cy={p.hot.cy} r="2.5" fill="#00d4ff" />
            <g transform={`translate(${labelX} ${labelY - 12})`}>
              <rect x={anchor === "end" ? -180 : 0} y="0" width="180" height="24" rx="6"
                fill="#0b1224" stroke="rgba(0,212,255,0.45)" />
              <text x={anchor === "end" ? -10 : 10} y="15" textAnchor={anchor}
                fontFamily="var(--font-geist-mono), monospace" fontSize="11" fill="#e8eefb" letterSpacing="0.02em">
                {p.name}
              </text>
            </g>
            <g transform={`translate(${labelX} ${labelY + 14})`}>
              <text x={anchor === "end" ? -10 : 10} y="0" textAnchor={anchor}
                fontFamily="var(--font-geist-mono), monospace" fontSize="10" fill="#00d4ff" opacity="0.7" letterSpacing="0.08em">
                {p.code}
              </text>
            </g>
          </g>
        );
      })()}
    </svg>
  );
}

// ─── Nav ────────────────────────────────────────────────────────────────
function Nav() {
  const items = useCart((s) => s.items);
  const setOpen = useCart((s) => s.setOpen);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const count = mounted ? cartCount(items) : 0;

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <Link href="/" className="brand" aria-label="WasFix Pro, naar de startpagina" style={{ minHeight: 44 }}>
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
          </div>
          <div className="brand-name"><b>WasFix</b><span>Pro</span></div>
        </Link>
        <div className="nav-links">
          <Link className="nav-link" href="/diagnose">AI Diagnose</Link>
          <Link className="nav-link" href="/foutcodes">Foutcodes</Link>
          <Link className="nav-link" href="/onderdelen">Onderdelen</Link>
          <a className="nav-link" href="#predict">Predictive</a>
          <a className="nav-link" href="#monteur">Voor monteurs</a>
          <Link className="nav-link" href="/prijzen">Prijzen</Link>
        </div>
        <div className="nav-cta">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen(true)}
            aria-label="Winkelmand openen"
            style={{ position: "relative" }}
          >
            <Icon name="cart" size={14} />
            {count > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "linear-gradient(180deg, #5d97ff, #3b7aff)",
                color: "#fff", fontSize: 10, fontWeight: 600,
                minWidth: 16, height: 16, borderRadius: 8,
                display: "grid", placeItems: "center", padding: "0 4px",
                boxShadow: "0 0 12px rgba(79,140,255,0.6)",
              }}>{count}</span>
            )}
          </button>
          <Link className="btn btn-ghost btn-sm" href="/inloggen">Inloggen</Link>
          <Link className="btn btn-primary btn-sm" href="/diagnose">
            Start gratis <Icon name="arrow" size={14} />
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────
function Hero() {
  const STATS = useStats();
  const [activePart, setActivePart] = React.useState("pump");
  const part = MACHINE_PARTS.find(p => p.id === activePart);

  // A fixed list of well-known codes to start from, not a measurement.
  const popular = [
    { brand: "Bosch", code: "E18", part: "Afvoer" },
    { brand: "Miele", code: "F11", part: "Pomp" },
    { brand: "Samsung", code: "dE", part: "Deur" },
    { brand: "LG", code: "OE", part: "Afvoer" },
    { brand: "AEG", code: "E20", part: "Lozing" },
    { brand: "Whirlpool", code: "F08", part: "Verwarming" },
  ];

  return (
    <section className="hero">
      <div className="container">
        <div className="hero-grid">
          <div>
            <div className="pill pill-acc hero-eyebrow">
              <Icon name="sparkle" size={12} /> AI-diagnose met foutcode of foto · gratis proberen
            </div>
            <h1 className="h-display">
              Wasmachine kapot?<br />
              Wij helpen je de <em>oorzaak</em> te vinden.
            </h1>
            {/* Hier stond "gemiddeld €140 bespaard per reparatie". Dat bedrag is
                nooit gemeten — net als de CO2-teller en de testimonials die om
                dezelfde reden uit deze pagina zijn gehaald. Wat een reparatie in
                een concreet geval scheelt, rekent de calculator uit. */}
            <p className="lead">
              Foto of foutcode → een eerste diagnose, het waarschijnlijke onderdeel en stap-voor-stap reparatie. Een indicatie, geen zekerheid. Geen voorrijkosten, en vooraf zie je wat het onderdeel kost.
            </p>
            <div className="hero-cta">
              <Link className="btn btn-primary btn-lg" href="/diagnose">
                <Icon name="sparkle" size={14} /> Start gratis diagnose
              </Link>
              <a className="btn btn-lg" href="#diagnose">
                <Icon name="play" size={12} /> Bekijk een voorbeeld
              </a>
            </div>
            <div className="hero-popular">
              <span className="dim mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>Of begin met een code</span>
              {popular.map(p => (
                <Link key={p.brand + p.code} className="hero-popular-tag"
                  href={`/diagnose?prefill=${encodeURIComponent(`Mijn ${p.brand} ${p.code}`)}`}>
                  {p.brand} <b style={{ color: "var(--acc-2)" }}>{p.code}</b> · {p.part}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <div className="machine-wrap">
              <div className="machine-hd">
                <div className="machine-hd-l">
                  <span className="pill"><span className="pill-dot" /> Interactief schema</span>
                  <span className="pill pill-mono">Voorbeeld · foutcode E18</span>
                </div>
              </div>
              <WashingMachine activeId={activePart} onSelect={(p) => setActivePart(p.id)} displayText="E 1 8" />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, position: "relative", zIndex: 2, marginTop: 4, alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Klik op een onderdeel voor uitleg en de bijbehorende foutcodes
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <span className="pill pill-mono" style={{ fontSize: 10.5, padding: "4px 8px" }}>{MACHINE_PARTS.length} onderdelen</span>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              <div className="card" style={{ padding: "14px 16px" }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--acc-2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Geselecteerd</div>
                <div style={{ fontWeight: 500, marginTop: 4 }}>{part?.name}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{part?.hint}</div>
              </div>
              <div className="card" style={{ padding: "14px 16px" }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--acc-2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Veelvoorkomende foutcodes</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
                  <span style={{ fontWeight: 500 }} className="mono">{part?.code}</span>
                </div>
                {/* The hard-coded prices that used to sit here (pump 38,50, drum 146,00 ...)
                    matched no catalogue price, so the card now links to the real listing. */}
                {part?.category && (
                  <Link href={`/onderdelen?cat=${part.category}`} className="muted" style={{ fontSize: 12, marginTop: 2, display: "inline-block", textDecoration: "underline", padding: "6px 0" }}>
                    Bekijk {part.categoryLabel} in de winkel →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 48 }}>
          <div className="stat-strip">
            <div className="stat"><div className="stat-n">{formatCount(STATS.errorCodes)}</div><div className="stat-l">Foutcodes in database</div></div>
            <div className="stat"><div className="stat-n">{formatCount(STATS.parts)}</div><div className="stat-l">Onderdelen in de catalogus</div></div>
            <div className="stat"><div className="stat-n">{formatCount(STATS.guides)}</div><div className="stat-l">Reparatiegidsen</div></div>
            <div className="stat"><div className="stat-n">{formatCount(STATS.brands)}</div><div className="stat-l">Merken gedekt</div></div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="brand-strip">
            <div>Bosch</div><div>Miele</div><div>Samsung</div><div>LG</div><div>AEG</div><div>Whirlpool</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── AI Diagnose demo ───────────────────────────────────────────────────
// Bewust zonder percentage. De demo hieronder is een script, geen opgenomen
// diagnose: elk cijfer erin zou verzonnen zijn. /pers draagt om precies die
// reden een notitie over een weggehaalde "73%"-bewering. De echte diagnose
// geeft wél een zekerheidspercentage — dat komt uit het model, niet uit deze
// animatie.
type ChatProb = { name: string; part: string; price?: string; diff: string };
type ChatMsg = {
  role: "user" | "ai";
  text: React.ReactNode;
  t: number;
  scan?: boolean;
  focus?: string[];
  probs?: ChatProb[];
};

function DiagnoseDemo({ filterPart }: { filterPart?: PartItem }) {
  const add = useCart((s) => s.add);
  const handleAddFilter = () => {
    if (!filterPart) return;
    add({
      partId: filterPart.id,
      sku: filterPart.sku,
      name: filterPart.name,
      brand: filterPart.brand,
      priceEur: filterPart.priceEur,
      imageUrl: null,
    }, 1);
    toast.success(`${filterPart.name} toegevoegd aan winkelmand`);
  };
  const SCRIPT: ChatMsg[] = [
    { role: "user", text: "Mijn Bosch wasmachine geeft foutcode E18. Water staat in de trommel.", t: 0 },
    { role: "ai", text: "Ik scan jouw Bosch model nu...", t: 700, scan: true },
    {
      role: "ai",
      text: (
        <>
          E18 = <code>afvoer geblokkeerd</code>. Bij Bosch wijst dit meestal op een verstopt vuilfilter of een defecte afvoerpomp. Een geknikte afvoerslang of een defecte drukschakelaar komt ook voor.
        </>
      ),
      t: 2400,
      focus: ["pump", "filter"],
      // Example causes only. The invented SKUs and prices that stood here (WF-PUMP-12,
      // WF-PSW-04, "€ 38,50") do not exist in the catalogue; only the filter below
      // is a real part with a real price, taken from the catalogue.
      probs: [
        { name: "Vuilfilter verstopt", part: "Filter", price: filterPart ? `€ ${filterPart.priceEur.toFixed(2).replace(".", ",")}` : undefined, diff: "Makkelijk" },
        { name: "Afvoerpomp defect", part: "Pomp", diff: "Gemiddeld" },
        { name: "Afvoerslang geknikt", part: "Slang", diff: "Makkelijk" },
        { name: "Drukschakelaar defect", part: "Sensor", diff: "Gemiddeld" },
      ],
    },
    { role: "ai", text: "Begin met het vuilfilter — onderaan rechts achter het paneeltje. 5 min werk, geen gereedschap. Zal ik de stap-voor-stap gids openen?", t: 3800 },
  ];

  const [step, setStep] = React.useState(0);
  const [input, setInput] = React.useState("");
  const [running, setRunning] = React.useState(true);

  React.useEffect(() => {
    if (!running) return;
    if (step >= SCRIPT.length) return;
    const t = setTimeout(() => setStep(s => s + 1), SCRIPT[step].t + 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, running]);

  const visible = SCRIPT.slice(0, step + 1);
  const latest = visible.slice().reverse().find(m => m.probs);
  const focusIds = visible.slice().reverse().find(m => m.focus)?.focus || [];
  const scanning = visible.length > 0 && !!visible[visible.length - 1].scan && step < SCRIPT.length - 1;
  const restart = () => { setStep(0); setRunning(true); };

  return (
    <section className="section" id="diagnose">
      <div className="container">
        <div className="eyebrow">AI Diagnose · live demo</div>
        <h2 className="h-section">Niet één antwoord. Een <em>rangschikking</em>.</h2>
        <p className="lead">Onze diagnose toont elke mogelijke oorzaak op volgorde van waarschijnlijkheid, met onderdeel, prijs en moeilijkheidsgraad — niet één gok. Het gesprek hieronder is een voorbeeld, geen opgenomen sessie.</p>

        <div className="diagnose-grid" style={{ marginTop: 36 }}>
          <div className="chat">
            <div className="chat-hd">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                <span className="live-dot" />
                <span>WasFix AI</span>
                <span className="muted" style={{ fontSize: 11.5 }}>· voorbeeldgesprek</span>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={restart}>
                <Icon name="repeat" size={12} /> Reset
              </button>
            </div>
            <div className="chat-body">
              {visible.map((m, i) => (
                <div key={i} className={`msg msg-${m.role}`}>
                  <div className="msg-avatar">{m.role === "ai" ? "AI" : "JD"}</div>
                  <div className="msg-body">{m.text}</div>
                </div>
              ))}
              {step < SCRIPT.length - 1 && step >= 0 && (
                <div className="msg msg-ai">
                  <div className="msg-avatar">AI</div>
                  <div className="msg-body"><span className="typing"><span /><span /><span /></span></div>
                </div>
              )}
            </div>
            {/* The box, camera, microphone and send buttons used to do nothing at all.
                The box now hands what you typed to the real diagnose page; the voice
                button is gone (there is no voice input). */}
            <form className="chat-input" action="/diagnose" method="get">
              <Icon name="plus" size={14} className="dim" />
              <input name="prefill" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Beschrijf je storing" placeholder="Beschrijf de storing…" />
              <Link className="btn btn-sm" href="/diagnose" aria-label="Foto uploaden in de diagnose" style={{ padding: "6px 8px" }}><Icon name="camera" size={13} /></Link>
              <button type="submit" className="btn btn-sm btn-primary" aria-label="Start de diagnose met deze tekst" style={{ padding: "6px 10px" }}><Icon name="send" size={13} /></button>
            </form>
          </div>

          <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 14 }}>
            <div className="card card-glow" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                <div className="mono" style={{ fontSize: 11.5, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}>Diagnose visual</div>
                <div className="pill pill-acc"><Icon name="bolt" size={11} /> {scanning ? "Scanning…" : (focusIds.length ? `${focusIds.length} verdachte onderdelen` : "Idle")}</div>
              </div>
              <div style={{ padding: "8px 0" }}>
                <div style={{ maxWidth: 380, margin: "0 auto" }}>
                  <WashingMachine activeId={focusIds[0]} highlight={focusIds.slice(1)} scanning={scanning}
                    displayText={latest ? "E 1 8" : "- - -"} />
                </div>
              </div>
            </div>

            <div className="diag-result">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}>Top oorzaken</div>
                  <div style={{ fontWeight: 500, fontSize: 15, marginTop: 2 }}>Bosch · foutcode E18</div>
                </div>
                <span className="pill pill-mono">Voorbeeld</span>
              </div>

              {(latest?.probs || []).map((p, i) => (
                <div key={p.name} className="prob-bar">
                  <div className="prob-name" style={{ width: "auto", flex: 1 }}>
                    <span className="mono" style={{ color: "var(--muted)", marginRight: 7 }}>{i + 1}</span>
                    {p.name}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.part} · {p.diff}</div>
                  <div className="prob-pct" style={{ width: 52 }}>{p.price ?? ""}</div>
                </div>
              ))}

              {latest && filterPart && (
                <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>Uit de winkel: {filterPart.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>€ {filterPart.priceEur.toFixed(2).replace(".", ",")} · verzending op werkdagen</div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={handleAddFilter}>
                    <Icon name="cart" size={13} /> Toevoegen
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── How it works ───────────────────────────────────────────────────────
function HowItWorks() {
  const steps: Array<{ n: string; icon: IconName; title: string; text: string }> = [
    { n: "01", icon: "sparkle", title: "Beschrijf of fotografeer", text: "Typ de foutcode of beschrijf het probleem, of upload een foto van de display. De AI geeft binnen een minuut een eerste indicatie — geen zekerheid." },
    { n: "02", icon: "pulse", title: "Diagnose met kansen", text: "Niet één gok — een rangschikking met waarschijnlijkheid, prijs en moeilijkheid." },
    { n: "03", icon: "package", title: "Onderdeel onderweg", text: "We verzenden op werkdagen en je krijgt een track & trace-code zodra je bestelling is verzonden. Origineel óf voordelig alternatief." },
  ];
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="eyebrow">Hoe het werkt</div>
        <h2 className="h-section">Van foutcode tot werkende machine in <em>één avond</em>.</h2>
        <div className="steps" style={{ marginTop: 36 }}>
          {steps.map(s => (
            <div key={s.n} className="card step-card">
              <div className="step-icon"><Icon name={s.icon} size={18} /></div>
              <div className="step-n">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Part glyph ─────────────────────────────────────────────────────────
function PartGlyph({ sku }: { sku: string }) {
  if (sku.includes("FILTER")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <circle cx="40" cy="30" r="22" fill="none" stroke="rgba(79,140,255,0.6)" />
      <circle cx="40" cy="30" r="14" fill="none" stroke="rgba(0,212,255,0.5)" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = i * Math.PI / 4;
        return <line key={i} x1={40 + Math.cos(a) * 8} y1={30 + Math.sin(a) * 8} x2={40 + Math.cos(a) * 22} y2={30 + Math.sin(a) * 22} stroke="rgba(255,255,255,0.18)" />;
      })}
    </svg>);
  if (sku.includes("PUMP")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <circle cx="38" cy="30" r="18" fill="none" stroke="rgba(0,212,255,0.6)" />
      <circle cx="38" cy="30" r="6" fill="rgba(79,140,255,0.6)" />
      <rect x="56" y="24" width="14" height="12" rx="2" fill="none" stroke="rgba(255,255,255,0.25)" />
      <path d="M38 12v-4M38 52v-4M20 30h-4" stroke="rgba(255,255,255,0.4)" />
    </svg>);
  if (sku.includes("CARBON")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <rect x="14" y="22" width="10" height="20" fill="rgba(0,212,255,0.5)" rx="1" />
      <rect x="14" y="14" width="10" height="6" fill="rgba(255,255,255,0.3)" rx="1" />
      <rect x="56" y="22" width="10" height="20" fill="rgba(0,212,255,0.5)" rx="1" />
      <rect x="56" y="14" width="10" height="6" fill="rgba(255,255,255,0.3)" rx="1" />
      <line x1="24" y1="50" x2="56" y2="50" stroke="rgba(255,255,255,0.3)" />
    </svg>);
  if (sku.includes("BELT")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <ellipse cx="40" cy="30" rx="28" ry="14" fill="none" stroke="rgba(79,140,255,0.6)" strokeWidth="3" />
      <ellipse cx="40" cy="30" rx="22" ry="8" fill="none" stroke="rgba(0,212,255,0.4)" />
    </svg>);
  if (sku.includes("NTC")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <circle cx="30" cy="30" r="10" fill="rgba(79,140,255,0.4)" stroke="rgba(255,255,255,0.3)" />
      <rect x="40" y="27" width="28" height="6" fill="none" stroke="rgba(255,255,255,0.3)" />
      <line x1="42" y1="22" x2="68" y2="22" stroke="rgba(0,212,255,0.6)" />
      <line x1="42" y1="38" x2="68" y2="38" stroke="rgba(0,212,255,0.6)" />
    </svg>);
  if (sku.includes("LOCK") || sku.includes("DOOR")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <rect x="22" y="18" width="36" height="24" rx="3" fill="rgba(79,140,255,0.4)" stroke="rgba(255,255,255,0.3)" />
      <circle cx="40" cy="30" r="5" fill="rgba(0,212,255,0.7)" />
      <path d="M22 30h-6M58 30h6" stroke="rgba(255,255,255,0.3)" />
    </svg>);
  if (sku.includes("HEAT")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <path d="M10 30 Q18 18 26 30 T42 30 T58 30 T74 30" fill="none" stroke="rgba(255,122,60,0.7)" strokeWidth="2" />
      <rect x="6" y="36" width="68" height="6" fill="rgba(255,255,255,0.2)" />
    </svg>);
  if (sku.includes("GASKET") || sku.includes("DAMP")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <circle cx="40" cy="30" r="22" fill="none" stroke="rgba(79,140,255,0.6)" strokeWidth="6" />
      <circle cx="40" cy="30" r="22" fill="none" stroke="rgba(0,212,255,0.3)" strokeWidth="14" />
    </svg>);
  if (sku.includes("VALVE") || sku.includes("HOSE")) return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <rect x="14" y="24" width="16" height="12" rx="2" fill="rgba(79,140,255,0.4)" />
      <path d="M30 30 Q44 30 50 22 Q56 14 66 14" fill="none" stroke="rgba(0,212,255,0.6)" strokeWidth="3" />
      <circle cx="66" cy="14" r="3" fill="rgba(255,255,255,0.3)" />
    </svg>);
  // Default: generic gear
  return (
    <svg viewBox="0 0 80 60" width="100%" height="100%">
      <circle cx="40" cy="30" r="14" fill="none" stroke="rgba(79,140,255,0.5)" strokeWidth="2" />
      <circle cx="40" cy="30" r="5" fill="rgba(0,212,255,0.5)" />
    </svg>
  );
}

// ─── Parts catalog ──────────────────────────────────────────────────────
type PartItem = { id: string; sku: string; name: string; brand: string; priceEur: number; stock: number; isOriginal?: boolean };

function PartsCatalog({ parts }: { parts: PartItem[] }) {
  const add = useCart((s) => s.add);

  const handleAdd = (e: React.MouseEvent, p: PartItem) => {
    e.preventDefault();
    e.stopPropagation();
    add({
      partId: p.id,
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      priceEur: p.priceEur,
      imageUrl: null,
    }, 1);
    toast.success(`${p.name} toegevoegd aan winkelmand`);
  };

  return (
    <section className="section" id="parts">
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div className="eyebrow">Onderdelen</div>
            <h2 className="h-section">Origineel of voordelig, <em>jij kiest</em>.</h2>
            <p className="lead">We verzenden op werkdagen en je krijgt een track &amp; trace-code zodra je bestelling is verzonden. 30 dagen bedenktijd — ook als je dacht dat het dít onderdeel was.</p>
          </div>
          <Link className="btn" href="/onderdelen">Alle onderdelen <Icon name="arrow" size={14} /></Link>
        </div>

        <div className="parts-grid" style={{ marginTop: 36 }}>
          {parts.map(p => (
            <Link key={p.sku} className="part-card" href={`/onderdelen/${p.sku}`}>
              <div className="part-thumb"><PartGlyph sku={p.sku} /></div>
              <div>
                <div className="part-tag">{p.isOriginal ? "Origineel" : "Universeel"} · {p.brand}</div>
                <div className="part-name" style={{ marginTop: 2 }}>{p.name}</div>
              </div>
              <div className="part-meta">
                <div>
                  <div className="part-tag">SKU {p.sku}</div>
                  <div className="part-price">€ {p.priceEur.toFixed(2).replace(".", ",")}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="part-tag" style={{ color: p.stock > 0 ? "var(--ok)" : "var(--warn)" }}>● {p.stock > 0 ? "Op voorraad" : "Uitverkocht"}</div>
                  {p.stock > 0 && (
                    <button className="btn btn-sm" style={{ marginTop: 6, minHeight: 44 }} onClick={(e) => handleAdd(e, p)}>
                      <Icon name="cart" size={11} /> In winkelmand
                    </button>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Code explorer ──────────────────────────────────────────────────────
type CodeItem = { id: string; brand: string; desc: string; part: string; url: string };

function CodeVisual({ code }: { code: CodeItem }) {
  return (
    <div className="code-visual">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>{code.brand}</div>
          <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 2 }}>{code.id}</div>
          <div style={{ color: "var(--text-2)", marginTop: 4 }}>{code.desc}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="pill pill-mono">Risico: matig</div>
        </div>
      </div>

      <svg viewBox="0 0 380 220" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "#070b18" }}>
        <defs>
          <linearGradient id="water" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#00d4ff" stopOpacity="0.7" />
            <stop offset="1" stopColor="#4f8cff" stopOpacity="0.5" />
          </linearGradient>
          <clipPath id="drumClip"><circle cx="160" cy="110" r="70" /></clipPath>
        </defs>
        <circle cx="160" cy="110" r="74" fill="#0d1326" stroke="rgba(255,255,255,0.10)" />
        <g clipPath="url(#drumClip)">
          <rect x="86" y="80" width="148" height="80" fill="url(#water)">
            <animate attributeName="y" values="120;80;80" dur="3.4s" repeatCount="indefinite" />
          </rect>
          {[0, 1, 2, 3].map(i => (
            <circle key={i} cx={120 + i * 15} cy={140} r="2.5" fill="rgba(255,255,255,0.5)">
              <animate attributeName="cy" values="160;90;160" dur={`${3 + i * 0.5}s`} begin={`${i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;1;0" dur={`${3 + i * 0.5}s`} begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
        <circle cx="160" cy="110" r="70" fill="none" stroke="rgba(0,212,255,0.4)" strokeDasharray="2 3" />

        <path d="M226 130 Q280 130 280 170 Q280 200 320 200" fill="none" stroke="rgba(255,99,99,0.6)" strokeWidth="3" strokeLinecap="round" />
        <path d="M226 130 Q280 130 280 170 Q280 200 320 200" fill="none" stroke="rgba(255,99,99,1)" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 8">
          <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.5s" repeatCount="indefinite" />
        </path>
        <g transform="translate(280 200)">
          <circle r="12" fill="#1a0f0f" stroke="#ff6363" strokeWidth="1.5" />
          <line x1="-5" y1="-5" x2="5" y2="5" stroke="#ff6363" strokeWidth="2" />
          <line x1="-5" y1="5" x2="5" y2="-5" stroke="#ff6363" strokeWidth="2" />
        </g>
        <text x="280" y="226" textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="10" fill="#ff6363">BLOK</text>
        <text x="160" y="40" textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="10" fill="rgba(255,255,255,0.55)">TROMMEL</text>
        <text x="160" y="200" textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="10" fill="rgba(0,212,255,0.7)">water blijft staan</text>
      </svg>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Vermoedelijk onderdeel</div>
          <div style={{ fontWeight: 500, marginTop: 2 }}>{code.part}</div>
        </div>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Reparatieduur</div>
          <div style={{ fontWeight: 500, marginTop: 2 }}>~ 15 min</div>
        </div>
      </div>

      <Link className="btn btn-primary" href={code.url}>Open foutcode detail <Icon name="arrow" size={14} /></Link>
    </div>
  );
}

function CodeExplorer({ codes }: { codes: CodeItem[] }) {
  const STATS = useStats();
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState<CodeItem>(codes[0] ?? { id: "E18", brand: "Bosch", desc: "Afvoer geblokkeerd", part: "Vuilfilter / pomp", url: "/foutcodes" });
  const filtered = codes.filter(c => (c.id + c.brand + c.desc).toLowerCase().includes(q.toLowerCase()));

  return (
    <section className="section" id="codes">
      <div className="container">
        <div className="eyebrow">Foutcode database</div>
        <h2 className="h-section">{formatCount(STATS.errorCodes)} codes. <em>Eén</em> zoekbalk.</h2>
        <p className="lead">Zoek per merk, code of symptoom. Krijg meteen de visuele uitleg van wat er fout gaat — niet alleen tekst.</p>

        <div className="codes-grid" style={{ marginTop: 36 }}>
          <div className="code-list">
            <div className="code-search">
              <Icon name="search" size={14} className="dim" />
              <input aria-label="Zoek een foutcode, merk of symptoom" placeholder="Zoek code, merk, symptoom…" value={q} onChange={(e) => setQ(e.target.value)} />
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{filtered.length}/{codes.length}</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", maxHeight: 480 }}>
              {filtered.map(c => (
                <div key={c.id + c.brand} className={`code-row ${sel.id === c.id && sel.brand === c.brand ? "active" : ""}`} onClick={() => setSel(c)}>
                  <div className="code-id">{c.id}</div>
                  <div>
                    <div className="code-desc">{c.desc}</div>
                    <div className="code-brand">{c.brand} · {c.part}</div>
                  </div>
                  <Icon name="chevron" size={14} className="dim" />
                </div>
              ))}
            </div>
          </div>

          <CodeVisual code={sel} />
        </div>
      </div>
    </section>
  );
}

// ─── Predictive ─────────────────────────────────────────────────────────
function FeatureRow({ icon, title, desc }: { icon: IconName; title: string; desc: string }) {
  return (
    <div className="card" style={{ display: "flex", gap: 14, padding: "18px 20px" }}>
      <div style={{ width: 38, height: 38, borderRadius: 9, background: "rgba(79,140,255,0.10)", border: "1px solid var(--border-ac)", display: "grid", placeItems: "center", color: "var(--acc-2)", flexShrink: 0 }}>
        <Icon name={icon} size={18} />
      </div>
      <div>
        <div style={{ fontWeight: 500, fontSize: 14.5, letterSpacing: "-0.01em" }}>{title}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
}

function Predictive() {
  const items: Array<{ name: string; pct: number; eta: string; status: "ok" | "warn" | "danger" }> = [
    { name: "Koolborstels motor", pct: 22, eta: "~ 8 maanden", status: "warn" },
    { name: "Lagers trommel", pct: 64, eta: "~ 2,5 jaar", status: "ok" },
    { name: "Verwarmingselement", pct: 12, eta: "binnen 6 mnd", status: "danger" },
    { name: "V-snaar", pct: 78, eta: "~ 4 jaar", status: "ok" },
    { name: "Drukschakelaar", pct: 88, eta: "OK", status: "ok" },
    { name: "Magneetventiel (inlaat)", pct: 41, eta: "~ 18 maanden", status: "warn" },
  ];

  return (
    <section className="section" id="predict">
      <div className="container">
        <div className="eyebrow">Onderhoudsindicatie · gratis tool</div>
        <h2 className="h-section">Weet wanneer iets <em>gaat</em> stuk, niet pas als het stuk is.</h2>
        {/* Geen "1,2M reparatiedata uit Europa": die dataset bestaat niet.
            src/lib/predictive.ts rekent met vuistregels over levensduur per
            onderdeelcategorie en een merkfactor — pure rekenkunde, geen model en
            geen meetdata. De tool zelf zegt dat ook; deze tekst moet dat volgen. */}
        <p className="lead">Voer model + bouwjaar in. We combineren je merk en de leeftijd van je machine met de gebruikelijke levensduur per onderdeelcategorie — vuistregels uit de praktijk, geen metingen aan jouw machine.</p>

        <div className="lifetime-grid" style={{ marginTop: 40 }}>
          <div className="card card-hi">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12 }}>
              <div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Voorbeeld · fictieve machine</div>
                <div style={{ fontWeight: 500, fontSize: 17 }}>Bosch, geïnstalleerd in 2018</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>HEALTH SCORE</div>
                <div style={{ fontSize: 24, fontWeight: 500, color: "var(--warn)" }}>62/100</div>
              </div>
            </div>
            <div className="health-bar-wrap">
              {items.map(i => (
                <div key={i.name} className="health-row">
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{i.name}</div>
                    <div className="health-eta">{i.eta}</div>
                  </div>
                  <div className="health-track">
                    <div className={`health-fill health-${i.status}`} style={{ width: `${i.pct}%` }} />
                  </div>
                  <div className="health-pct">{i.pct}%</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Voorbeeldweergave met fictieve gegevens, geen meting van een echte machine.
              </div>
              {/* A "Bestel preventief pakket · € 52,80" button stood here with no link,
                  no handler and no such product. The tool itself is real. */}
              <Link href="/tools/predictive" className="btn btn-primary btn-sm">Probeer met jouw machine</Link>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <FeatureRow icon="qr" title="QR-sticker op je machine"
                desc="Scan de sticker met je telefoon en open meteen de diagnose, foutcodes, onderdelen en gidsen. Zonder zoeken of typen." />
              <FeatureRow icon="camera" title="Foto-diagnose van de display"
                desc="Upload een foto van het display; de AI probeert de foutcode eruit te lezen. Lukt dat niet, dan typ je de code zelf in." />
              <FeatureRow icon="user" title="Eerlijk over wat je zelf kunt"
                desc="Bij elke foutcode staat of het een klus voor thuis is. Netspanning, motor of besturingsmodule? Dan zeggen we: bel een monteur." />
              <FeatureRow icon="shield" title="Garantie-check tool"
                desc="Vul merk en aankoopdatum in en zie welke garantie en consumentenrechten waarschijnlijk nog gelden. Dit is een losse tool, geen stap in het bestelproces." />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Impact ─────────────────────────────────────────────────────────────
/**
 * Every number in this section is either an EU figure with a citation or a
 * count of our own catalogue. We deliberately show no "diagnoses so far" or
 * "CO2 saved by the community" counter: we do not publish platform totals we
 * cannot substantiate, and an animated counter reading a hard-coded target is
 * not a measurement.
 */
function Impact() {
  const STATS = useStats();
  return (
    <section className="section" id="impact">
      <div className="container">
        <div className="eyebrow">Waarom repareren</div>
        <h2 className="h-section">Repareren is <em>klimaatactie</em>.</h2>
        <p className="lead">
          De Europese Commissie rekende het uit voor haar Right to Repair-voorstel: doordat Europeanen
          apparaten weggooien die nog te repareren zijn, ontstaat er elk jaar onnodig 261 miljoen ton
          CO&#8322;-equivalent, 30 miljoen ton grondstofgebruik en 35 miljoen ton afval — en verliezen
          consumenten samen zo&#39;n &euro;12 miljard.
        </p>

        <div className="impact-grid" style={{ marginTop: 36 }}>
          <div className="impact-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.3)", display: "grid", placeItems: "center", color: "#34d399" }}>
                <Icon name="leaf" size={18} />
              </div>
              <span className="pill" style={{ borderColor: "rgba(52,211,153,0.3)", color: "#34d399", background: "rgba(52,211,153,0.06)" }}>EU-cijfer</span>
            </div>
            <div className="impact-n mono" style={{ marginTop: 18 }}>261 Mt</div>
            <div className="impact-l">CO&#8322;-equivalent per jaar onnodig uitgestoten in de EU</div>
            <div className="impact-sub">Door apparaten te vervangen die nog te repareren waren</div>
          </div>

          <div className="impact-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(79,140,255,0.10)", border: "1px solid var(--border-ac)", display: "grid", placeItems: "center", color: "var(--acc-2)" }}>
                <Icon name="chart" size={18} />
              </div>
              <span className="pill pill-acc">EU-cijfer</span>
            </div>
            <div className="impact-n mono" style={{ marginTop: 18 }}>&euro; 12 mld</div>
            <div className="impact-l">Wat Europese consumenten per jaar verliezen</div>
            <div className="impact-sub">Door te vervangen in plaats van te repareren</div>
          </div>

          <div className="impact-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(245,182,67,0.10)", border: "1px solid rgba(245,182,67,0.3)", display: "grid", placeItems: "center", color: "#f5b643" }}>
                <Icon name="repeat" size={18} />
              </div>
              <span className="pill" style={{ borderColor: "rgba(245,182,67,0.3)", color: "#f5b643", background: "rgba(245,182,67,0.06)" }}>Onze catalogus</span>
            </div>
            <div className="impact-n mono" style={{ marginTop: 18 }}>{formatCount(STATS.guides)}</div>
            <div className="impact-l">Reparatiegidsen die je zelf kunt volgen</div>
            <div className="impact-sub">Plus {formatCount(STATS.parts)} onderdelen en {formatCount(STATS.errorCodes)} foutcodes</div>
          </div>
        </div>

        <p className="small" style={{ marginTop: 20, opacity: 0.7 }}>
          Bron:{" "}
          <a href="https://commission.europa.eu/system/files/2023-03/SWD_2023_59_1_EN_impact_assessment_part1_v5.pdf" target="_blank" rel="noopener noreferrer">
            Impact assessment SWD(2023) 59 van de Europese Commissie
          </a>{" "}
          bij het Right to Repair-voorstel. Wat één reparatie in jouw situatie oplevert hangt af van je
          machine — reken het door met onze{" "}
          <a href="/tools/repareren-of-vervangen">repareren-of-vervangen calculator</a>.
        </p>
      </div>
    </section>
  );
}

// ─── Monteur Pro ────────────────────────────────────────────────────────
function MonteurPro() {
  return (
    <section className="section" id="monteur">
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 48, alignItems: "center" }} className="monteur-grid">
          <div>
            <div className="eyebrow">Voor monteurs</div>
            <h2 className="h-section">De pro-tool waarmee je het <em>juiste</em> onderdeel meeneemt.</h2>
            {/* Geen "bezoek halveert" (nooit gemeten), geen service-handleidingen
                (we serveren er geen — we citeren ze alleen als bron bij een
                foutcode) en geen witlabel (niet gebouwd, zie plans.ts). */}
            <p className="lead">Klanten-CRM, werkorders met factuur, B2B API en 10% korting op onderdelen. Doe de diagnose vóór je vertrekt, zodat je het juiste onderdeel meeneemt.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 24 }}>
              <span className="pill"><Icon name="check" size={11} /> API toegang</span>
              <span className="pill"><Icon name="check" size={11} /> Klantenbeheer</span>
              <span className="pill"><Icon name="check" size={11} /> Werkorder naar factuur</span>
              <span className="pill"><Icon name="check" size={11} /> Foutcodes met bronvermelding</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
              <Link className="btn btn-primary" href="/prijzen">Word Monteur Pro · € 29/mnd</Link>
              <Link className="btn" href="/api-docs">Bekijk API docs</Link>
            </div>
          </div>

          {/* Voorbeeldweergave. The browser-chrome mock that stood here showed a
              domain that does not exist (dashboard.wasfix.nl/pro), four invented
              customers, a "Pro-fee" column, planning times and a "+22%" repairs
              chart - none of it labelled, and the real /monteur/dashboard has four
              counts and no chart or fee. It is now a plainly labelled example of
              what the dashboard shows. */}
          <div className="card" style={{ padding: 0, overflow: "hidden", background: "var(--surf-1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div className="pill pill-acc">Voorbeeld</div>
              <div className="muted" style={{ fontSize: 12 }}>Voorbeeldweergave met fictieve gegevens</div>
            </div>

            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                {[
                  { l: "Open werkorders", v: "12" },
                  { l: "Klanten", v: "38" },
                  { l: "Facturen", v: "7" },
                ].map(s => (
                  <div key={s.l} style={{ padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{s.l}</div>
                    <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4, letterSpacing: "-0.02em" }}>{s.v}</div>
                  </div>
                ))}
              </div>

              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }} className="mono">
                  <div>Klant · machine</div><div>Status</div><div>Foutcode</div>
                </div>
                {[
                  { c: "Klant A · Bosch", st: "In behandeling", dot: "#f5b643", diag: "E18" },
                  { c: "Klant B · Miele", st: "Onderdeel besteld", dot: "#4f8cff", diag: "F11" },
                  { c: "Klant C · Samsung", st: "Afgerond", dot: "#34d399", diag: "dE" },
                ].map((j, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, padding: "12px 14px", borderBottom: i < 2 ? "1px solid var(--border)" : "0", alignItems: "center", fontSize: 13 }}>
                    <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>{j.c}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-2)" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: j.dot }}></span>{j.st}
                    </div>
                    <div className="mono" style={{ color: "var(--acc-2)", fontSize: 12 }}>{j.diag}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── What the diagnose actually covers ─────────────────────────────────
// This slot used to carry testimonials from people who do not exist
// ("Marieke V., Rotterdam, bespaarde €280") next to a 4.8/5 rating over 1.247
// reviews that were never collected. Presenting invented customers as real is
// a misleading commercial practice under the EU Omnibus directive, so the
// section now shows what the product verifiably does, drawn from the catalog.
function WhatYouGet() {
  const STATS = useStats();
  const items = [
    {
      tag: "Diagnose",
      n: formatCount(STATS.errorCodes),
      title: "foutcodes met oorzaak en oplossing",
      body: `Van ${STATS.brands} merken, gekoppeld aan de onderdelen en gidsen die erbij horen. Voer je code in en je ziet meteen wat het kan zijn.`,
    },
    {
      tag: "Zelf repareren",
      n: formatCount(STATS.guides),
      title: "stap-voor-stap reparatiegidsen",
      body: "Met benodigd gereedschap, tijdsindicatie en veiligheidswaarschuwingen. Geschreven om te volgen met de machine open voor je.",
    },
    {
      tag: "Onderdelen",
      n: formatCount(STATS.parts),
      title: "onderdelen in de catalogus",
      body: "Origineel en universeel, met vermelding waar ze op passen. Verzending in Nederland is gratis vanaf €50.",
    },
    {
      tag: "Kosten",
      n: "€ 0",
      title: "om te beginnen",
      body: `Drie diagnoses per maand zonder account. Genoeg om één storing helemaal uit te zoeken, inclusief het onderdeel dat je nodig hebt.`,
    },
  ];
  return (
    <section className="section-sm">
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="eyebrow">Wat je krijgt</div>
            <h2 className="h-section" style={{ fontSize: "clamp(24px,3vw,32px)" }}>Geen praatjes, <em>gewoon</em> de inhoud.</h2>
          </div>
        </div>
      </div>
      <div className="row-scroll">
        <div className="row-scroll-inner">
          {items.map((it, i) => (
            <div key={i} className="card" style={{ width: 380, padding: 24, flexShrink: 0 }}>
              <span className="pill pill-mono">{it.tag}</span>
              <div style={{ fontSize: 32, fontWeight: 600, marginTop: 14, letterSpacing: "-0.02em" }}>{it.n}</div>
              <div style={{ fontSize: 14.5, fontWeight: 500, marginTop: 2 }}>{it.title}</div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginTop: 10 }}>{it.body}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ────────────────────────────────────────────────────────────
function Pricing() {
  const tiers = PLAN_ORDER.map((id) => {
    const plan = PLANS[id];
    return {
      name: plan.name,
      price: formatPlanPrice(plan),
      per: planPriceSuffix(plan),
      featured: plan.highlight ?? false,
      badge: plan.highlight ? "Populair" : (undefined as string | undefined),
      feats: plan.features,
      cta: plan.priceCents === 0
        ? "Probeer gratis"
        : plan.trialDays > 0
          ? `Start ${plan.trialDays} dagen gratis`
          : `Word ${plan.name}`,
      href: plan.priceCents === 0 ? "/diagnose" : `/upgrade?plan=${plan.id}`,
    };
  });
  return (
    <section className="section" id="pricing">
      <div className="container">
        <div style={{ textAlign: "center" }}>
          <div className="eyebrow" style={{ justifyContent: "center" }}>Tarieven</div>
          <h2 className="h-section">Voor iedereen het juiste plan.</h2>
          <p className="lead" style={{ margin: "0 auto" }}>Begin gratis. Upgrade als je het merkt. Annuleer wanneer je wilt.</p>
        </div>

        <div className="pricing-grid" style={{ marginTop: 48 }}>
          {tiers.map(t => (
            <div key={t.name} className={`price-card ${t.featured ? "featured" : ""}`}>
              {t.badge && <div className="price-tag">{t.badge}</div>}
              <div>
                <div className="price-name">{t.name}</div>
                <div className="price-n" style={{ marginTop: 6 }}>
                  <b>{t.price}</b><span>{t.per}</span>
                </div>
              </div>
              <ul className="price-feats">
                {t.feats.map(f => (
                  <li key={f}><Icon name="check" size={14} /> {f}</li>
                ))}
              </ul>
              <Link className={`btn ${t.featured ? "btn-primary" : ""} btn-lg`} style={{ justifyContent: "center" }} href={t.href}>{t.cta}</Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA + Footer ─────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section className="section-sm">
      <div className="container">
        <div className="cta-block">
          <div className="eyebrow" style={{ justifyContent: "center", marginBottom: 16 }}>Klaar?</div>
          <h2 className="h-section" style={{ fontSize: "clamp(28px,4vw,48px)" }}>Geen creditcard. <em>Geen drempel</em>. Geen voorrijkosten.</h2>
          <p className="lead" style={{ margin: "8px auto 24px" }}>Start nu met een gratis diagnose. We wachten op je wasmachine.</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link className="btn btn-primary btn-lg" href="/diagnose"><Icon name="sparkle" size={14} /> Start gratis diagnose</Link>
            <Link className="btn btn-lg" href="/contact?onderwerp=monteur-demo">Vraag een demo aan voor mijn bedrijf</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Top-level page ─────────────────────────────────────────────────────
export default function WasFixHome({ parts, codes, stats }: { parts: PartItem[]; codes: CodeItem[]; stats: HomeStats }) {
  const filterPart = parts.find((p) => p.sku.includes("FILTER")) ?? parts[0];
  const isOpen = useCart((s) => s.isOpen);
  const setOpen = useCart((s) => s.setOpen);
  return (
    <StatsContext.Provider value={stats}>
    <div className="wasfix-design">
      <div className="app-bg" />
      <div className="shell">
        <Nav />
        <Hero />
        <DiagnoseDemo filterPart={filterPart} />
        <HowItWorks />
        <CodeExplorer codes={codes} />
        <PartsCatalog parts={parts} />
        <Predictive />
        <Impact />
        <MonteurPro />
        <WhatYouGet />
        <Pricing />
        <FinalCTA />
        <WasFixFooter />
      </div>
      <CartDrawer open={isOpen} onOpenChange={setOpen} />
    </div>
    </StatsContext.Provider>
  );
}
