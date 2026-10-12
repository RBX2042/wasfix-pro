"use client";
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart } from "recharts";

interface Props {
  data: Array<{ date: string; revenue: number; orders: number }>;
}

export default function RevenueChart({ data }: Props) {
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--input))" }} tickLine={{ stroke: "hsl(var(--input))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--input))" }} tickLine={{ stroke: "hsl(var(--input))" }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              color: "hsl(var(--popover-foreground))",
              border: "1px solid hsl(var(--input))",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
            }}
            labelStyle={{ color: "hsl(var(--popover-foreground))" }}
            itemStyle={{ color: "hsl(var(--popover-foreground))" }}
            formatter={(value, name) => {
              const num = typeof value === "number" ? value : parseFloat(String(value));
              return name === "revenue" ? [`€${num.toFixed(2)}`, "Omzet"] : [String(value), "Facturen"];
            }}
          />
          <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#revGradient)" />
          <Line type="monotone" dataKey="orders" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--accent))" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
