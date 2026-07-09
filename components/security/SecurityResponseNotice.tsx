import { SECURITY_RESPONSE_MESSAGE, SECURITY_RESPONSE_TITLE } from "@/lib/security/security-response";

type SecurityResponseNoticeProps = {
  compact?: boolean;
};

const statusRows = [
  "Files modified: 0",
  "Business Memory modified: 0",
  "Reports modified: 0",
  "KPIs modified: 0",
  "Workspace modified: 0"
];

export function SecurityResponseNotice({ compact = false }: SecurityResponseNoticeProps) {
  return (
    <section
      className={`rounded-lg border border-amber-300/35 bg-slate-950 ${compact ? "p-4" : "p-5"} text-slate-100 shadow-panel`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">{SECURITY_RESPONSE_TITLE}</p>
          <h2 className={`${compact ? "mt-2 text-base" : "mt-3 text-lg"} font-semibold text-white`}>No changes were made.</h2>
        </div>
        <span className="w-fit rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">
          Blocked
        </span>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reason</p>
        <p className="mt-2 text-sm leading-6 text-slate-100">{SECURITY_RESPONSE_MESSAGE}</p>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</p>
        <div className="mt-3 grid gap-2 text-sm text-slate-100 sm:grid-cols-2">
          {statusRows.map((row) => (
            <div key={row} className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-2">
              {row}
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-50">No changes were made.</p>
      </div>
    </section>
  );
}
