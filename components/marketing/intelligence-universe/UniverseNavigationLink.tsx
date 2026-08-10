"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";
import { universeDestinationForPathname } from "@/lib/marketing/intelligence-universe";

type UniverseNavigationLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onClick"> & Readonly<{
  href: Route;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}>;

export function UniverseNavigationLink({ href, children, onClick, ...props }: UniverseNavigationLinkProps) {
  const universe = useIntelligenceUniverse();
  const destination = universeDestinationForPathname(String(href));

  return (
    <Link
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented
          || !destination
          || event.button !== 0
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || event.altKey
        ) return;

        event.preventDefault();
        universe.travel(destination);
      }}
    >
      {children}
    </Link>
  );
}
