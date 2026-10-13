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
  const pathname = usePathname(), allParams = useSearchParams();
  const routeParams = new URLSearchParams(allParams); routeParams.delete("finding");
  const search = routeParams.toString();
  const params = new URLSearchParams(search);
  const requestedState = params.get("fixtureState"), requestedRole = params.get("fixtureRole");
  const state: FixtureState = ["populated", "partial", "empty", "loading", "error"].includes(requestedState || "") ? requestedState as FixtureState : "populated";
  const role: FixtureRole = requestedRole === "viewer" ? "viewer" : "owner";
  const [body, setBody] = useState<React.ReactNode>(() => loadingScreen(pathname));
  const change = useCallback((key: string, value: string) => { const next = new URLSearchParams(search); next.set(key, value); navigate(`${pathname}?${next}`); }, [pathname, search]);
  useEffect(() => {
    let active = true;
    setBody(loadingScreen(pathname));
    renderScreen(pathname, state, role, new URLSearchParams(window.location.search), () => change("fixtureState", "populated"))
      .then(result => { if (active) setBody(result); })
      .catch(error => { if (active) setBody(<div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-5 text-red-900"><h1 className="font-semibold">Fixture boundary needs an adapter</h1><p className="mt-2">{error.message}</p><p className="mt-2 text-xs">No backend request was made.</p></div>); });
    return () => { active = false; };
  }, [pathname, search, state, role, change]);

  return <div key={`${state}:${role}`}>{wrapScreen(body, role, pathname)}</div>;
}
createRoot(document.getElementById("root")!).render(<App />);
