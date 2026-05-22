"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Calculator, Leaf, ArrowRight, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type EnergyLabel = "A+++" | "A++" | "A+" | "A" | "B" | "C";

interface CalcInput {
  machineAge: number;
  purchasePrice: number;
  repairCost: number;
  energyLabel: EnergyLabel;
  issueFrequency: number;
}

interface CalcResult {
  recommendation: "REPAIR" | "REPLACE" | "BORDERLINE";
  score: number;
  reasoning: string[];
  co2Saved: number;
  costComparison: { repairTotal: number; replaceTotal: number; breakEvenMonths: number };
}

function calculate(input: CalcInput): CalcResult {
  let score = 50;

  if (input.machineAge <= 3) score += 25;
  else if (input.machineAge <= 6) score += 10;
  else if (input.machineAge <= 10) score -= 5;
  else score -= 25;

  const repairPct = (input.repairCost / input.purchasePrice) * 100;
  if (repairPct <= 20) score += 20;
  else if (repairPct <= 35) score += 5;
  else if (repairPct <= 50) score -= 10;
  else score -= 25;

  score -= input.issueFrequency * 8;

  const labelScore: Record<EnergyLabel, number> = { "A+++": 5, "A++": 3, "A+": 1, A: 0, B: -5, C: -10 };
  score += labelScore[input.energyLabel];

  score = Math.max(0, Math.min(100, score));

  const recommendation = score >= 60 ? "REPAIR" : score >= 40 ? "BORDERLINE" : "REPLACE";

  const lifeExtensionYears = Math.max(1, 12 - input.machineAge);
  const co2Saved = Math.round(80 * (lifeExtensionYears / 10));

  const newAvg = 650;
  const energySavingsPerYear = input.energyLabel === "C" || input.energyLabel === "B" ? 40 : 0;
  const repairTotal = input.repairCost + (input.issueFrequency > 1 ? input.repairCost * 0.3 : 0);
  const replaceTotal = newAvg - energySavingsPerYear * 3;
  const breakEvenMonths = Math.max(1, Math.round((replaceTotal - repairTotal) / Math.max(1, energySavingsPerYear / 12 + 1)));

  const reasoning: string[] = [];
  if (input.machineAge <= 5) reasoning.push(`Machine is pas ${input.machineAge} jaar oud — nog veel levensduur`);
  if (input.machineAge > 10) reasoning.push(`Machine is ${input.machineAge} jaar — verhoogd risico op nieuwe storingen`);
  if (repairPct <= 25) reasoning.push(`Reparatiekosten zijn slechts ${Math.round(repairPct)}% van aankoopprijs`);
  if (repairPct > 50) reasoning.push(`Reparatie kost ${Math.round(repairPct)}% van aankoopprijs — vervanging overwegen`);
  if (input.issueFrequency >= 3) reasoning.push(`${input.issueFrequency}x storing in 2 jaar wijst op structureel probleem`);
  if (co2Saved > 20) reasoning.push(`Repareren bespaart ±${co2Saved}kg CO₂ vs. nieuwe machine produceren`);
  if (energySavingsPerYear > 0) reasoning.push(`Een nieuwe A+++ machine bespaart €${energySavingsPerYear}/jaar aan energie`);

  return {
    recommendation,
    score,
    reasoning,
    co2Saved,
    costComparison: { repairTotal: Math.round(repairTotal), replaceTotal: Math.round(replaceTotal), breakEvenMonths },
  };
}

export default function RepairOrReplaceCalculator() {
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<CalcInput>({
    machineAge: 5,
    purchasePrice: 500,
    repairCost: 120,
    energyLabel: "A+",
    issueFrequency: 0,
  });
  const [result, setResult] = useState<CalcResult | null>(null);

  function next() {
    if (step === 1) {
      setResult(calculate(input));
      setStep(2);
    } else {
      setStep((s) => s + 1);
    }
  }

  function reset() {
    setResult(null);
    setStep(0);
  }

  if (result && step === 2) {
    const isRepair = result.recommendation === "REPAIR";
    const isBorderline = result.recommendation === "BORDERLINE";
    const verdictColor = isRepair ? "emerald" : isBorderline ? "amber" : "red";

    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
        <Card className={`border-2 border-${verdictColor}-500/40 bg-${verdictColor}-50 dark:bg-${verdictColor}-950/30`}>
          <CardContent className="p-6 text-center">
            <div className="text-5xl mb-2">{isRepair ? "🔧" : isBorderline ? "⚖️" : "🛒"}</div>
            <h3 className="font-heading text-xl font-bold mb-1">
              {isRepair ? "Repareer uw machine" : isBorderline ? "Twijfelgeval — bekijk redenering" : "Overweeg vervanging"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isRepair
                ? `Repareren is de slimste keuze. Besparing: ±€${Math.max(0, result.costComparison.replaceTotal - result.costComparison.repairTotal)}`
                : isBorderline
                ? "Het kan beide kanten op — lees de redenering hieronder"
                : `Een nieuwe machine loont op de lange termijn — break-even: ${result.costComparison.breakEvenMonths} maanden`}
            </p>

            <div className="mt-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Vervangen</span>
                <span>Repareren</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${result.score}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full rounded-full ${isRepair ? "bg-emerald-500" : isBorderline ? "bg-amber-500" : "bg-red-500"}`}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Score: {result.score}/100</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30">
          <CardContent className="p-4 flex items-center gap-3">
            <Leaf className="h-6 w-6 text-emerald-600 shrink-0" />
            <div>
              <p className="font-semibold text-sm text-emerald-900 dark:text-emerald-100">Milieu-impact</p>
              <p className="text-xs text-emerald-800 dark:text-emerald-200">
                Repareren bespaart ±{result.co2Saved}kg CO₂ — gelijk aan {Math.round(result.co2Saved / 0.21)} km autorijden.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Reparatiekosten</p>
              <p className="font-heading text-2xl font-bold text-primary">€{result.costComparison.repairTotal}</p>
              <p className="text-xs text-muted-foreground">eenmalig</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Nieuw gemiddeld</p>
              <p className="font-heading text-2xl font-bold text-accent">€{result.costComparison.replaceTotal}</p>
              <p className="text-xs text-muted-foreground">aankoopprijs</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Redenering</p>
            <ul className="space-y-2">
              {result.reasoning.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-primary mt-0.5 shrink-0">→</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          {(isRepair || isBorderline) && (
            <Button asChild className="flex-1">
              <Link href="/diagnose">
                Start diagnose <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" /> Opnieuw
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-1">
        {[0, 1].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${step >= i ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>

      <h3 className="font-heading text-lg font-semibold">{step === 0 ? "Over uw machine" : "Over de reparatie"}</h3>

      {step === 0 && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Hoe oud is uw wasmachine?</label>
            <input type="range" min={0} max={20} value={input.machineAge} onChange={(e) => setInput({ ...input, machineAge: Number(e.target.value) })} className="w-full accent-primary" />
            <div className="text-center text-primary font-bold mt-1">{input.machineAge} jaar</div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Originele aankoopprijs</label>
            <input type="range" min={200} max={2000} step={50} value={input.purchasePrice} onChange={(e) => setInput({ ...input, purchasePrice: Number(e.target.value) })} className="w-full accent-primary" />
            <div className="text-center text-primary font-bold mt-1">€{input.purchasePrice}</div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Energielabel</label>
            <div className="flex flex-wrap gap-2">
              {(["A+++", "A++", "A+", "A", "B", "C"] as EnergyLabel[]).map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setInput({ ...input, energyLabel: label })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    input.energyLabel === label ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Geschatte reparatiekosten</label>
            <input type="range" min={0} max={600} step={10} value={input.repairCost} onChange={(e) => setInput({ ...input, repairCost: Number(e.target.value) })} className="w-full accent-primary" />
            <div className="text-center text-primary font-bold mt-1">€{input.repairCost}</div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Aantal storingen afgelopen 2 jaar</label>
            <input type="range" min={0} max={5} value={input.issueFrequency} onChange={(e) => setInput({ ...input, issueFrequency: Number(e.target.value) })} className="w-full accent-primary" />
            <div className="text-center text-primary font-bold mt-1">{input.issueFrequency}x</div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        {step > 0 && (
          <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
            Terug
          </Button>
        )}
        <Button onClick={next} className="flex-1" variant={step === 1 ? "accent" : "default"}>
          {step === 1 ? (
            <>
              <Calculator className="h-4 w-4" /> Bereken advies
            </>
          ) : (
            <>
              Volgende <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
