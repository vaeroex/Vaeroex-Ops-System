import { VaeroexLoading } from "@/components/brand/VaeroexLoading";

export function ModuleLoading() {
  return (
    <div className="space-y-6">
      <VaeroexLoading label="Loading Vaeroex module" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
      </div>
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-96 animate-pulse rounded-lg bg-slate-200" />
      </div>
    </div>
  );
}
