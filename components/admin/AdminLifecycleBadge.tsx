import { lifecycleLabel, type AdminLifecycle } from "@/lib/admin/company-directory";

const tones: Record<AdminLifecycle, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-800",
  pending_activation: "border-amber-300 bg-amber-50 text-amber-900",
  inactive: "border-slate-300 bg-slate-100 text-slate-700",
  archived: "border-blue-200 bg-blue-50 text-blue-700"
};

export function AdminLifecycleBadge({ value }: { value: AdminLifecycle }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[value]}`}>
      {lifecycleLabel(value)}
    </span>
  );
}
