import Link from "next/link";

type LegalSafetyNoticeProps = {
  tone?: "ai" | "sensitive" | "review";
  compact?: boolean;
};

const copy = {
  ai: "Vaeroex recommendations are advisory operational-support outputs. Review and approve them before relying on them.",
  sensitive: "Do not enter patient data, PHI/ePHI, Social Security numbers, payment card numbers, government IDs, or regulated sensitive data unless proper controls exist.",
  review: "Human review is required before Vaeroex-generated content is saved or used for important business decisions."
};

export function LegalSafetyNotice({ tone = "review", compact = false }: LegalSafetyNoticeProps) {
  return (
    <div className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-950 ${compact ? "p-3 text-xs" : "p-4 text-sm"} leading-6`}>
      <p>{copy[tone]}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link href="/ai-disclaimer" className="font-semibold underline">Vaeroex Disclaimer</Link>
        <Link href="/sensitive-data-policy" className="font-semibold underline">Sensitive Data Policy</Link>
      </div>
    </div>
  );
}
