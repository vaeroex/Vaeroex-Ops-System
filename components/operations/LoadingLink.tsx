"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

type LoadingLinkProps = Omit<ComponentProps<typeof Link>, "children"> & {
  children: ReactNode;
  loadingLabel?: string;
};

export function LoadingLink({ children, loadingLabel = "Loading...", onClick, ...props }: LoadingLinkProps) {
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      document.documentElement.style.cursor = "";
    };
  }, []);

  return (
    <Link
      {...props}
      aria-busy={loading}
      onClick={(event) => {
        onClick?.(event);

        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }

        timerRef.current = window.setTimeout(() => {
          setLoading(true);
          document.documentElement.style.cursor = "progress";
        }, 500);
      }}
    >
      {loading ? loadingLabel : children}
    </Link>
  );
}
