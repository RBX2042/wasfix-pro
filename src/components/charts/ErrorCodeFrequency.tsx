"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface Props {
  data: Array<{ code: string; count: number; severity: string }>;
}

// Theme tokens (globals.css), so the bars keep their meaning in both themes: green, amber, rust, red.
const SEVERITY_COLORS: Record<string, string> = {
  LOW: "hsl(var(--success))",
  MEDIUM: "hsl(var(--warning))",
  HIGH: "hsl(var(--accent))",
  CRITICAL: "hsl(var(--destructive))",
};

export default function ErrorCodeFrequency({ data }: Props) {
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="code" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--input))" }} tickLine={{ stroke: "hsl(var(--input))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--input))" }} tickLine={{ stroke: "hsl(var(--input))" }} />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted-foreground) / 0.15)" }}
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              color: "hsl(var(--popover-foreground))",
              border: "1px solid hsl(var(--input))",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
            }}
            labelStyle={{ color: "hsl(var(--popover-foreground))" }}
            itemStyle={{ color: "hsl(var(--popover-foreground))" }}
            formatter={(value) => [`${value} keer`, "Frequentie"]}
          />
          <Bar dataKey="count" radius={[8, 8, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={SEVERITY_COLORS[d.severity] ?? "hsl(var(--muted-foreground))"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
