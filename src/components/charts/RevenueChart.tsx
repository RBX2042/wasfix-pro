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
              <stop offset="0%" stopColor="#1a6b6b" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#1a6b6b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
            }}
            formatter={(value, name) => {
              const num = typeof value === "number" ? value : parseFloat(String(value));
              return name === "revenue" ? [`€${num.toFixed(2)}`, "Omzet"] : [String(value), "Bestellingen"];
            }}
          />
          <Area type="monotone" dataKey="revenue" stroke="#1a6b6b" strokeWidth={2} fillOpacity={1} fill="url(#revGradient)" />
          <Line type="monotone" dataKey="orders" stroke="#c94b2a" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
