import { VaeroexLoading } from "@/components/brand/VaeroexLoading";

export default function VaeroexHubLoading() {
  return (
    <div className="space-y-4">
      <VaeroexLoading label="Opening Vaeroex result" />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="h-96 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-96 animate-pulse rounded-lg bg-slate-200" />
      </div>
    </div>
  );
}
