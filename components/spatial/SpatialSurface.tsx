import type { ReactNode } from "react";

export type SpatialDepth = "subtle" | "raised" | "focus";

type SpatialSurfaceClassOptions = {
  depth?: SpatialDepth;
  interactive?: boolean;
  selected?: boolean;
};

export function spatialSurfaceClassName({
  depth = "subtle",
  interactive = false,
  selected = false
}: SpatialSurfaceClassOptions = {}) {
  return [
    "vaeroex-spatial-surface",
    `vaeroex-spatial-surface--${depth}`,
    interactive ? "vaeroex-spatial-surface--interactive" : "",
    selected ? "vaeroex-spatial-surface--selected" : ""
  ].filter(Boolean).join(" ");
}

type SpatialSurfaceProps = SpatialSurfaceClassOptions & {
  as?: "article" | "div" | "section";
  children: ReactNode;
  className?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
};

export function SpatialSurface({
  as: Component = "div",
  children,
  className = "",
  id,
  ariaLabel,
  ariaLabelledBy,
  ...options
}: SpatialSurfaceProps) {
  return (
    <Component
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`${spatialSurfaceClassName(options)} ${className}`.trim()}
    >
      {children}
    </Component>
  );
}
