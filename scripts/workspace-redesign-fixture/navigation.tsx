import { useSyncExternalStore, type ComponentProps } from "react";
const subscribe = (callback: () => void) => { window.addEventListener("popstate", callback); return () => window.removeEventListener("popstate", callback); };
export function usePathname() { return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/app"); }
export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search, () => "")); }
export function navigate(href: string) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin || !(url.pathname === "/app" || url.pathname.startsWith("/app/"))) throw new Error("Only synthetic workspace navigation is permitted.");
  for (const name of ["fixtureState", "fixtureRole"]) if (!url.searchParams.has(name)) {
    const value = new URLSearchParams(window.location.search).get(name); if (value) url.searchParams.set(name, value);
  }
  history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate")); window.scrollTo(0, 0);
}
export function useRouter() { return { push: navigate, replace: navigate, refresh() { window.dispatchEvent(new PopStateEvent("popstate")); }, back() { history.back(); } }; }
export function redirect(href: string): never { throw new Error(`Fixture redirect: ${href}`); }
export const permanentRedirect = redirect;
export function notFound(): never { throw new Error("Synthetic route not found"); }
export default function Link({ href, children, prefetch, onClick, ...props }: ComponentProps<"a"> & { href: string; prefetch?: boolean }) {
  void prefetch;
  const internal = href.startsWith("/app") && !href.startsWith("//");
  return <a href={internal ? href : "#fixture-external-link"} {...props} onClick={event => {
    onClick?.(event); if (event.defaultPrevented) return;
    event.preventDefault();
    if (internal) navigate(href);
    else window.dispatchEvent(new CustomEvent("fixture-action", { detail: "External navigation is disabled in this isolated preview." }));
  }}>{children}</a>;
}
