import React from "react";

export default function Link({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
  delete props.prefetch;
  return <a {...props}>{children}</a>;
}
export function useRouter() { return { refresh() { throw new Error("Synthetic browsing cannot refresh workspace data"); } }; }
export function explainFindingAction() { throw new Error("Synthetic browsing cannot call a model"); }
export function mutateIntelligenceCardLifecycleAction() { throw new Error("Synthetic browsing cannot mutate workspace data"); }
export function generateBusinessHealthExplanationAction() { throw new Error("Synthetic browsing cannot call a model"); }
export function SaveAnalysisButton() { return null; }
export function spatialSurfaceClassName() { return "spatial-surface"; }
