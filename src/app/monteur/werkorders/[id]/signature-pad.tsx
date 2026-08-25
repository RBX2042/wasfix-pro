"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function SignaturePad({ workOrderId, existingSignatureUrl }: { workOrderId: string; existingSignatureUrl: string | null }) {
  const router = useRouter();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const hasStroke = React.useRef(false);
  const [saving, setSaving] = React.useState(false);
  const [editing, setEditing] = React.useState(!existingSignatureUrl);

  function getContext() {
    const canvas = canvasRef.current;
    return canvas?.getContext("2d") ?? null;
  }

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    hasStroke.current = true;
    const ctx = getContext();
    const { x, y } = pointerPos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  }

  function draw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = getContext();
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endDraw() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke.current = false;
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke.current) {
      toast.error("Laat de klant eerst tekenen");
      return;
    }
    setSaving(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch(`/api/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureUrl: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Handtekening opslaan mislukt");
        return;
      }
      toast.success("Handtekening opgeslagen");
      setEditing(false);
      router.refresh();
    } catch {
      toast.error("Er ging iets mis");
    } finally {
      setSaving(false);
    }
  }

  if (!editing && existingSignatureUrl) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Klant handtekening</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not a static asset */}
          <img src={existingSignatureUrl} alt="Handtekening klant" className="bg-white rounded border max-w-full h-24 object-contain" />
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Opnieuw laten tekenen</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-medium">Klant handtekening</p>
        <canvas
          ref={canvasRef}
          width={400}
          height={140}
          className="w-full max-w-md bg-white rounded border touch-none"
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={clear} type="button">Wissen</Button>
          <Button size="sm" onClick={save} disabled={saving} type="button">{saving ? "Bezig..." : "Opslaan"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
