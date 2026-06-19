import { VaeroexLoading } from "@/components/brand/VaeroexLoading";

export default function SetupLoading() {
  return (
    <div className="space-y-4">
      <VaeroexLoading label="Preparing Vaeroex setup" />
      <div className="h-96 animate-pulse rounded-lg bg-slate-200" />
    </div>
  );
}
