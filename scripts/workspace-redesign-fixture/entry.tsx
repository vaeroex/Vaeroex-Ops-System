import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderScreen, wrapScreen, loadingScreen, routes, AS_OF } from "./screens";
import { usePathname, useSearchParams, navigate } from "./navigation";
import type { FixtureState, FixtureRole } from "./data";
import { classifyFixtureSubmission, preserveSyntheticNoteOnReset } from "./form-boundary";

// Same deterministic clock for both comparison roots. No credentials or environment are read.
const RealDate = Date;
const FixedDate = function(this: unknown, ...args: unknown[]) { return new.target ? Reflect.construct(RealDate, args.length ? args : [AS_OF], new.target) : new RealDate(AS_OF).toString(); };
FixedDate.prototype = RealDate.prototype;
Object.setPrototypeOf(FixedDate, RealDate);
Object.defineProperty(FixedDate, "now", { value: () => RealDate.parse(AS_OF) });
globalThis.Date = FixedDate as unknown as DateConstructor;

// The real search component can interact with a memory response, never a socket.
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname !== "/api/search" || init?.method && init.method !== "GET") throw new Error("Synthetic preview blocked an unreviewed network request");
  const q = (url.searchParams.get("q") || "").toLowerCase();
  return new Response(JSON.stringify({ query: q, groups: [{ label: "Synthetic destinations", results: routes.filter(route => route.label.toLowerCase().includes(q)).map(route => ({ id: route.href, title: route.label, sourceType: "Preview", href: route.href, preview: "Synthetic preview destination; no search API was contacted." })) }] }), { headers: { "Content-Type": "application/json" } });
};
for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"] as const) Object.defineProperty(window, name, { value: class { constructor() { throw new Error(`${name} is unavailable in the synthetic preview`); } } });
Object.defineProperty(navigator, "sendBeacon", { value: () => false });
document.addEventListener("click", event => {
  const anchor = (event.target as Element).closest?.("a");
  if (!anchor || event.defaultPrevented || !anchor.getAttribute("href")) return;
  const url = new URL(anchor.href, window.location.origin);
  if (url.origin === window.location.origin && (url.pathname === "/app" || url.pathname.startsWith("/app/"))) { event.preventDefault(); navigate(url.pathname + url.search + url.hash); }
  else if (!anchor.getAttribute("href")!.startsWith("#")) event.preventDefault();
});
document.addEventListener("submit", event => {
  const form = event.target as HTMLFormElement;
  const submission = classifyFixtureSubmission(form.getAttribute("method"), form.getAttribute("action"), window.location.origin);
  // Only explicit safe GET filters navigate. Function actions reach their inert
  // generated React stubs; all other native form submissions remain blocked.
  if (submission.kind === "get") {
    event.preventDefault(); event.stopImmediatePropagation();
    const url = submission.url;
    const data = new FormData(form);
    url.search = new URLSearchParams(Array.from(data.entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
    navigate(url.pathname + url.search);
  } else if (submission.kind === "react-action") {
    preserveSyntheticNoteOnReset(form);
  } else {
    event.preventDefault(); event.stopImmediatePropagation();
    window.dispatchEvent(new CustomEvent("fixture-action", { detail: "This action is inert in the isolated preview. Nothing was submitted or changed." }));
  }
}, true);

function App() {
  const pathname = usePathname(), search = useSearchParams().toString();
  const params = new URLSearchParams(search);
  const requestedState = params.get("fixtureState"), requestedRole = params.get("fixtureRole");
  const state: FixtureState = ["populated", "empty", "loading", "error"].includes(requestedState || "") ? requestedState as FixtureState : "populated";
  const role: FixtureRole = requestedRole === "viewer" ? "viewer" : "owner";
  const [body, setBody] = useState<React.ReactNode>(() => loadingScreen(pathname));
  const [feedback, setFeedback] = useState("");
  const change = useCallback((key: string, value: string) => { const next = new URLSearchParams(search); next.set(key, value); navigate(`${pathname}?${next}`); }, [pathname, search]);
  useEffect(() => {
    let active = true;
    setBody(loadingScreen(pathname));
    renderScreen(pathname, state, role, new URLSearchParams(search), () => change("fixtureState", "populated"))
      .then(result => { if (active) setBody(result); })
      .catch(error => { if (active) setBody(<div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-5 text-red-900"><h1 className="font-semibold">Fixture boundary needs an adapter</h1><p className="mt-2">{error.message}</p><p className="mt-2 text-xs">No backend request was made.</p></div>); });
    return () => { active = false; };
  }, [pathname, search, state, role, change]);
  useEffect(() => { const receive = (event: Event) => setFeedback((event as CustomEvent<string>).detail); window.addEventListener("fixture-action", receive); return () => window.removeEventListener("fixture-action", receive); }, []);
  return <><div className={`relative z-50 border-b border-amber-300 bg-amber-50 p-3 text-slate-950${pathname === "/app/settings/integrations/square" ? "" : " lg:ml-64"}`} data-fixture-toolbar>
    <div className="flex flex-wrap items-center gap-3"><strong className="text-xs">ISOLATED SYNTHETIC PREVIEW</strong><label className="text-xs">State <select aria-label="Fixture state" className="ml-1 rounded border border-slate-400 bg-white p-1 text-slate-950" value={state} onChange={event => change("fixtureState", event.target.value)}>{["populated", "empty", "loading", "error"].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-xs">Context <select aria-label="Fixture role" className="ml-1 rounded border border-slate-400 bg-white p-1 text-slate-950" value={role} onChange={event => change("fixtureRole", event.target.value)}><option value="owner">Owner</option><option value="viewer">Viewer</option></select></label></div>
    {pathname === "/app" ? <label className="mt-2 block text-xs">Business Health alternative <select aria-label="Business Health alternative" className="ml-1 rounded border border-slate-400 bg-white p-1 text-slate-950" value={params.get("healthVisual") === "arc" ? "arc" : "scorecard"} onChange={event => change("healthVisual", event.target.value)}><option value="scorecard">1 · Executive scorecard</option><option value="arc">2 · Segmented arc</option></select></label> : null}
    <p className="mt-1 text-xs">Real UI with synthetic inputs. No Supabase, provider, upload, billing or account changes. Roles and errors are simulations, not permission tests.</p>
    <nav aria-label="Preview screens" className="mt-2 flex flex-wrap gap-2">{routes.map(route => <button key={route.href} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs" onClick={() => navigate(route.href)}>{route.label}</button>)}</nav>
    {feedback ? <p role="status" className="mt-2 text-xs font-semibold">{feedback}</p> : null}
  </div><div key={`${state}:${role}`}>{wrapScreen(body, role, pathname)}</div></>;
}
createRoot(document.getElementById("root")!).render(<App />);
