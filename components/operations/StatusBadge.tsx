type StatusBadgeProps = {
  value: string | null | undefined;
};

export function StatusBadge({ value }: StatusBadgeProps) {
  const label = value || "Unassigned";
  const tone = label.toLowerCase();
  const className =
    tone.includes("urgent") || tone.includes("high") || tone.includes("broken") || tone.includes("overdue")
      ? "border-red-200 bg-red-50 text-red-700"
      : tone.includes("medium") || tone.includes("needs") || tone.includes("waiting")
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone.includes("done") || tone.includes("ready") || tone.includes("complete") || tone.includes("active")
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-blue-200 bg-vaeroex-soft text-vaeroex-blue";

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}
