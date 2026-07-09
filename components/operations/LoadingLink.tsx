"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useActivitySignal } from "@/components/app/ActivityProvider";

type LoadingLinkProps = Omit<ComponentProps<typeof Link>, "children"> & {
  children: ReactNode;
  loadingLabel?: string;
};

export function LoadingLink({ children, loadingLabel = "Loading...", onClick, ...props }: LoadingLinkProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  useActivitySignal(loading, loadingLabel, { source: "loading-link", timeoutMs: 8000 });

  function resetLoading() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    setLoading(false);
  }

  useEffect(() => resetLoading(), [pathname, searchParams]);

  useEffect(() => {
    window.addEventListener("pagehide", resetLoading);
    window.addEventListener("popstate", resetLoading);
    window.addEventListener("focus", resetLoading);

    return () => {
      window.removeEventListener("pagehide", resetLoading);
      window.removeEventListener("popstate", resetLoading);
      window.removeEventListener("focus", resetLoading);
      resetLoading();
    };
  }, []);

  return (
    <Link
      {...props}
      aria-busy={loading}
      data-vaeroex-local-activity="true"
      data-vaeroex-activity-label={loadingLabel}
      onClick={(event) => {
        onClick?.(event);

        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }

        const hrefValue = typeof props.href === "string" ? props.href : props.href.toString();
        const target = new URL(hrefValue, window.location.href);

        if (target.pathname === window.location.pathname && target.search === window.location.search) {
          resetLoading();
          return;
        }

        timerRef.current = window.setTimeout(() => {
          setLoading(true);
          fallbackTimerRef.current = window.setTimeout(resetLoading, 8000);
        }, 500);
      }}
    >
      {loading ? loadingLabel : children}
    </Link>
  );
}
