import { Leaf, Recycle, ShieldCheck } from "lucide-react";

interface Props {
  variant?: "co2" | "right-to-repair" | "circular";
  className?: string;
}

export function SustainabilityBadge({ variant = "co2", className = "" }: Props) {
  if (variant === "right-to-repair") {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/30 text-xs ${className}`}>
        <ShieldCheck className="h-3.5 w-3.5 text-success" />
        <span className="text-foreground">
          <strong>EU Right to Repair</strong> · onderdelen 10 jaar beschikbaar
        </span>
      </div>
    );
  }
  if (variant === "circular") {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/30 text-xs ${className}`}>
        <Recycle className="h-3.5 w-3.5 text-success" />
        <span className="text-foreground">
          <strong>Circulair</strong> · onderdeel hergebruik bespaart grondstoffen
        </span>
      </div>
    );
  }
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/30 text-xs ${className}`}>
      <Leaf className="h-3.5 w-3.5 text-success" />
      <span className="text-foreground">
        <strong>Repareren scheelt CO₂</strong> · een reparatie kost een fractie van een nieuwe machine
      </span>
    </div>
  );
}
