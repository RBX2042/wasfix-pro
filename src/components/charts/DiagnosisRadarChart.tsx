"use client";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";

interface Props {
  causes: Array<{ name: string; probability: number }>;
}

export default function DiagnosisRadarChart({ causes }: Props) {
  const data = causes.map((c) => ({
    subject: c.name.length > 22 ? c.name.substring(0, 22) + "…" : c.name,
    probability: c.probability,
    fullMark: 100,
  }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <Radar
            name="Waarschijnlijkheid"
            dataKey="probability"
            stroke="#1a6b6b"
            fill="#1a6b6b"
            fillOpacity={0.35}
            strokeWidth={2}
          />
          <Tooltip
            formatter={(value) => [`${value}%`, "Kans"]}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
