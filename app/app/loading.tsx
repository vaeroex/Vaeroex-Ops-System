import { VaeroexLoading } from "@/components/brand/VaeroexLoading";

export default function AppLoading() {
  return (
    <div className="space-y-4">
      <VaeroexLoading label="Loading Vaeroex command center" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-lg bg-slate-200" />
        ))}
      </div>
      <div className="h-52 animate-pulse rounded-lg bg-slate-200" />
    </div>
  );
}
