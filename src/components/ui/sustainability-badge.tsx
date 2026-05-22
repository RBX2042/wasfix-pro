import { Leaf, Recycle, ShieldCheck } from "lucide-react";

interface Props {
  variant?: "co2" | "right-to-repair" | "circular";
  co2Saved?: number;
  className?: string;
}

export function SustainabilityBadge({ variant = "co2", co2Saved = 80, className = "" }: Props) {
  if (variant === "right-to-repair") {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/30 text-xs ${className}`}>
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        <span className="text-emerald-900 dark:text-emerald-100">
          <strong>EU Right to Repair</strong> · u heeft recht op reparatie t/m 2031
        </span>
      </div>
    );
  }
  if (variant === "circular") {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/30 text-xs ${className}`}>
        <Recycle className="h-3.5 w-3.5 text-emerald-600" />
        <span className="text-emerald-900 dark:text-emerald-100">
          <strong>Circulair</strong> · onderdeel hergebruik bespaart grondstoffen
        </span>
      </div>
    );
  }
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/30 text-xs ${className}`}>
      <Leaf className="h-3.5 w-3.5 text-emerald-600" />
      <span className="text-emerald-900 dark:text-emerald-100">
        <strong>{co2Saved}kg CO₂ bespaard</strong> · door te repareren i.p.v. nieuw kopen
      </span>
    </div>
  );
}
