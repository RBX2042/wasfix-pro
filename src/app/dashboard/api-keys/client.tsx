"use client";

import * as React from "react";
import { toast } from "sonner";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  usageCount: number;
};

export function ApiKeysClient({ userPlan: _userPlan, apiCallLimit: _apiCallLimit }: { userPlan: string; apiCallLimit: number }) {
  const [keys, setKeys] = React.useState<ApiKey[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showNewKey, setShowNewKey] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [keyName, setKeyName] = React.useState("");

  // Load existing keys from the server (empty list in demo mode without DB).
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/api-keys")
      .then((r) => (r.ok ? r.json() : { keys: [] }))
      .then((data) => { if (!cancelled) setKeys(data.keys ?? []); })
      .catch(() => { /* keep empty list */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setCreating(true);

    try {
      const res = await fetch("/api/dashboard/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Kon key niet aanmaken");
        return;
      }
      setShowNewKey(data.fullKey);
      setKeys((k) => [data.key, ...k]);
      if (data.demo) toast.info("Demo key gegenereerd — wordt niet opgeslagen zonder database");
      setKeyName("");
    } catch {
      toast.error("Kon key niet aanmaken");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Deze key wordt direct gerevoceerd. Alle integraties die hem gebruiken stoppen met werken. Doorgaan?")) return;
    try {
      const res = await fetch(`/api/dashboard/api-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Revoke mislukt");
        return;
      }
      setKeys((k) => k.filter((x) => x.id !== id));
      toast.success("Key gerevoceerd");
    } catch {
      toast.error("Revoke mislukt");
    }
  }

  return (
    <>
      {/* New-key reveal */}
      {showNewKey && (
        <div className="border-2 border-emerald-500 rounded-lg p-5 bg-emerald-50 dark:bg-emerald-950/30 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-2xl">🔑</div>
            <div className="flex-1">
              <p className="font-semibold mb-1">Nieuwe API key — kopieer NU</p>
              <p className="text-sm text-muted-foreground mb-3">
                Dit is de enige keer dat we de volledige key tonen. Sla &apos;m veilig op (bv. in een password manager).
              </p>
              <div className="flex gap-2 items-stretch">
                <code className="flex-1 px-3 py-2 bg-background border rounded font-mono text-xs overflow-auto whitespace-nowrap">
                  {showNewKey}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(showNewKey); toast.success("Gekopieerd"); }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium"
                >
                  Kopieer
                </button>
              </div>
              <button onClick={() => setShowNewKey(null)} className="text-xs text-muted-foreground mt-3 hover:underline">
                Ik heb &apos;m bewaard, sluit melding
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={createKey} className="border rounded-lg p-5 mb-6">
        <h2 className="font-heading text-base font-semibold mb-3">Nieuwe API key</h2>
        <div className="flex gap-2 items-stretch">
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Label (bv. 'Production app', 'Planning-tool integratie')"
            required
            maxLength={60}
            className="flex-1 px-3 py-2 border rounded text-sm"
          />
          <button type="submit" disabled={creating} className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50">
            {creating ? "..." : "Genereer key"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Geef je key een herkenbaar label — bij compromise kun je de juiste revoken zonder alles te breken.
        </p>
      </form>

      {/* Keys list */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left p-3 font-medium">Label</th>
              <th className="text-left p-3 font-medium">Prefix</th>
              <th className="text-left p-3 font-medium">Aangemaakt</th>
              <th className="text-left p-3 font-medium">Laatst gebruikt</th>
              <th className="text-right p-3 font-medium">Calls</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Laden…</td></tr>
            ) : keys.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                Nog geen API keys. Maak je eerste key hierboven aan.
              </td></tr>
            ) : keys.map((k) => (
              <tr key={k.id} className="border-t">
                <td className="p-3 font-medium">{k.name}</td>
                <td className="p-3 font-mono text-xs">{k.prefix}...</td>
                <td className="p-3 text-muted-foreground text-xs">{new Date(k.createdAt).toLocaleDateString("nl-NL")}</td>
                <td className="p-3 text-muted-foreground text-xs">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString("nl-NL") : "Nooit"}</td>
                <td className="p-3 text-right tabular-nums">{k.usageCount.toLocaleString("nl-NL")}</td>
                <td className="p-3 text-right">
                  <button onClick={() => revoke(k.id)} className="text-xs text-rose-600 hover:underline">
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
