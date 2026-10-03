import { useSyncExternalStore, type ComponentProps } from "react";
const subscribe = (callback: () => void) => { window.addEventListener("popstate", callback); return () => window.removeEventListener("popstate", callback); };
export function usePathname() { return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/app/intelligence"); }
export const navigate = (href: string) => { history.pushState({}, "", href); window.dispatchEvent(new PopStateEvent("popstate")); window.scrollTo(0, 0); };
export function useRouter() { return { push: navigate, replace: navigate, refresh() {} }; }
export function useSearchParams() { return new URLSearchParams(window.location.search); }
export default function Link({ href, children, prefetch, ...props }: ComponentProps<"a"> & { href: string; prefetch?: boolean }) {
  void prefetch;
  return <a href={href} {...props} onClick={(event) => { event.preventDefault(); if (typeof href !== "string" || !href.startsWith("/app")) throw new Error("fixture navigation blocked"); navigate(href); }}>{children}</a>;
}
