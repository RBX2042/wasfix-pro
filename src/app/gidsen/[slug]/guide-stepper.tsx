"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = { stepNum: number; title: string; description: string; warning?: string; imageUrl?: string };

export function GuideStepper({ steps }: { steps: Step[] }) {
  const [completed, setCompleted] = React.useState<Set<number>>(new Set());
  const [activeIdx, setActiveIdx] = React.useState(0);

  function toggle(stepNum: number) {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(stepNum)) next.delete(stepNum);
      else next.add(stepNum);
      return next;
    });
  }

  const progress = (completed.size / steps.length) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading text-xl font-semibold">Stappen</h2>
        <span className="text-sm text-muted-foreground">{completed.size}/{steps.length} voltooid</span>
      </div>

      <div className="h-2 bg-muted rounded-full overflow-hidden mb-6">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => {
          const isComplete = completed.has(s.stepNum);
          const isActive = i === activeIdx;
          return (
            <Card
              key={s.stepNum}
              className={cn(
                "transition-all",
                isActive && "border-primary shadow-md",
                isComplete && "bg-emerald-50/50 dark:bg-emerald-950/20"
              )}
            >
              <CardContent className="p-5">
                <button
                  onClick={() => setActiveIdx(i)}
                  className="w-full flex items-start gap-4 text-left"
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(s.stepNum); }}
                    className={cn(
                      "h-8 w-8 shrink-0 rounded-full flex items-center justify-center font-heading font-bold text-sm transition-colors mt-0.5",
                      isComplete ? "bg-emerald-500 text-white" : "bg-primary/10 text-primary"
                    )}
                  >
                    {isComplete ? <CheckCircle2 className="h-4 w-4" /> : s.stepNum}
                  </button>
                  <div className="flex-1">
                    <h3 className={cn("font-heading font-semibold", isComplete && "line-through text-muted-foreground")}>
                      Stap {s.stepNum}: {s.title}
                    </h3>
                    {(isActive || !isComplete) && (
                      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{s.description}</p>
                    )}
                    {s.warning && isActive && (
                      <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <span className="text-amber-900 dark:text-amber-200">{s.warning}</span>
                      </div>
                    )}
                  </div>
                </button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
          disabled={activeIdx === 0}
        >
          <ChevronLeft className="h-4 w-4" /> Vorige stap
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const cur = steps[activeIdx];
            if (cur) setCompleted((p) => new Set([...p, cur.stepNum]));
            setActiveIdx(Math.min(steps.length - 1, activeIdx + 1));
          }}
          disabled={activeIdx === steps.length - 1}
        >
          Markeer & volgende <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {progress === 100 && (
        <Card className="mt-6 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-500/30">
          <CardContent className="p-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
            <p className="font-heading font-bold text-lg">Klus geklaard! 🎉</p>
            <p className="text-sm text-muted-foreground mt-1">Hopelijk werkt je wasmachine weer als nieuw.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
