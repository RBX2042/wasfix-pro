"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  confidence: number;
  label?: string;
}

export default function ConfidenceGauge({ confidence, label = "Zekerheid diagnose" }: Props) {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(confidence), 200);
    return () => clearTimeout(timer);
  }, [confidence]);

  const color = confidence >= 85 ? "#22c55e" : confidence >= 65 ? "#eab308" : "#ef4444";
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (animated / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-40 h-40">
        <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
          <motion.circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.4, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-3xl font-heading font-bold"
            style={{ color }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            {animated}%
          </motion.span>
          <span className="text-xs text-muted-foreground text-center px-2 mt-0.5">{label}</span>
        </div>
      </div>
    </div>
  );
}
