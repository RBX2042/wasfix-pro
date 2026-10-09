/**
 * A tiny standalone HTML answer for the few routes that a person reaches from a mail or a plain
 * <form> post (newsletter confirmation, a form submitted without JavaScript): there is no page of
 * ours to redirect to that would say what happened. No inline style or script (the CSP forbids it),
 * noindex, no referrer.
 */
import { NextResponse } from "next/server";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function htmlPage(title: string, message: string, status = 200, extraHtml = ""): NextResponse {
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(title)} - WasFix Pro</title></head><body><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${extraHtml}<p><a href="/">Terug naar WasFix Pro</a></p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "referrer-policy": "no-referrer", "cache-control": "no-store" },
  });
}
