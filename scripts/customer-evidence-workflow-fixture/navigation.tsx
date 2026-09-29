import { useSyncExternalStore, type ComponentProps } from "react";

const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};
export function usePathname() { return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/app/sources"); }
export function useSearchParams() {
  return new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search, () => ""));
}
export function navigate(href: string) {
  if (!href.startsWith("/app/") && href !== "/app") throw new Error("Only synthetic app routes are available.");
  history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}
export function useRouter() { return { push: navigate, replace: navigate, refresh() {} }; }
export default function Link({ href, children, prefetch, onClick, ...props }: ComponentProps<"a"> & { href: string; prefetch?: boolean }) {
  void prefetch;
  return <a href={href} {...props} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }}>{children}</a>;
}
