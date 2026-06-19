import { VaeroexLogo } from "@/components/brand/VaeroexLogo";

type VaeroexLoadingProps = {
  label?: string;
};

export function VaeroexLoading({ label = "Loading Vaeroex workspace" }: VaeroexLoadingProps) {
  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-lg border border-vaeroex-accent/30 bg-vaeroex-navy shadow-sm shadow-blue-950/20">
          <VaeroexLogo variant="symbol" size="sm" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">{label}</p>
          <p className="mt-1 text-xs text-muted">Preparing the command center.</p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-vaeroex-soft">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-[linear-gradient(90deg,#1E6BFF,#38BDF8)]" />
      </div>
    </div>
  );
}
