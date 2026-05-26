"use client";

import * as React from "react";

// Registers /sw.js — only in production + when consent allows.
// Show install-prompt after user's 3rd visit.
export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Register sw
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[wasfix] SW registration failed", err);
    });

    // Visit-count tracking for install prompt
    const visitCount = parseInt(localStorage.getItem("wasfix-visits") ?? "0", 10) + 1;
    localStorage.setItem("wasfix-visits", String(visitCount));

    let deferredPrompt: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null = null;
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as unknown as typeof deferredPrompt;
      // Trigger install banner if user has visited 3+ times and not dismissed before
      if (visitCount >= 3 && !localStorage.getItem("wasfix-install-dismissed")) {
        showInstallBanner(deferredPrompt);
      }
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  return null;
}

function showInstallBanner(prompt: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null) {
  if (!prompt) return;
  const banner = document.createElement("div");
  banner.id = "wasfix-install-banner";
  banner.style.cssText = `
    position: fixed; bottom: 16px; left: 16px; right: 16px; z-index: 9500;
    max-width: 460px; margin: 0 auto;
    background: linear-gradient(135deg, #0b1224, #1a1f3a);
    border: 1px solid rgba(79,140,255,0.3);
    border-radius: 14px;
    padding: 16px 18px;
    color: #e8eefb;
    font-family: var(--font-geist), system-ui, sans-serif;
    box-shadow: 0 16px 40px -12px rgba(0,0,0,0.5);
    display: flex; align-items: center; gap: 12px;
  `;
  banner.innerHTML = `
    <div style="font-size: 24px;">📱</div>
    <div style="flex: 1; min-width: 0;">
      <div style="font-size: 14px; font-weight: 500; margin-bottom: 2px;">Installeer WasFix Pro</div>
      <div style="font-size: 12.5px; color: rgba(232,238,251,0.7); line-height: 1.45;">Snellere toegang + werkt offline voor foutcodes lookup.</div>
    </div>
    <button id="wasfix-install-yes" style="background: linear-gradient(180deg, #5d97ff, #3b7aff); color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 500; font-size: 13px; cursor: pointer; font-family: inherit;">Installeer</button>
    <button id="wasfix-install-no" aria-label="Sluit" style="background: transparent; border: 0; color: rgba(232,238,251,0.5); font-size: 20px; cursor: pointer; padding: 4px 8px; line-height: 1;">×</button>
  `;
  document.body.appendChild(banner);
  document.getElementById("wasfix-install-yes")?.addEventListener("click", async () => {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") localStorage.setItem("wasfix-install-dismissed", "accepted");
    banner.remove();
  });
  document.getElementById("wasfix-install-no")?.addEventListener("click", () => {
    localStorage.setItem("wasfix-install-dismissed", String(Date.now()));
    banner.remove();
  });
}
