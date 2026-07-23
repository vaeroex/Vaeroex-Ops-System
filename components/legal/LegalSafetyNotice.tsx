import Link from "next/link";

type LegalSafetyNoticeProps = {
  tone?: "ai" | "sensitive" | "review";
  compact?: boolean;
};

const copy = {
  ai: "Vaeroex recommendations are advisory executive decision-support outputs. Review and approve them before relying on them.",
  sensitive: "Do not enter patient data, PHI/ePHI, Social Security numbers, payment card numbers, government IDs, or regulated sensitive data unless proper controls exist.",
  review: "Human review is required before Vaeroex-generated content is saved or used for important business decisions."
};

export function LegalSafetyNotice({ tone = "review", compact = false }: LegalSafetyNoticeProps) {
  if (compact) {
    return (
      <p className="text-xs leading-5 text-amber-100/85">
        {copy[tone]}{" "}
        <Link href="/sensitive-data-policy" className="font-semibold text-amber-100 underline">
          Sensitive data policy
        </Link>
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300/30 bg-amber-950/20 p-4 text-sm leading-6 text-amber-50">
      <p>{copy[tone]}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link href="/ai-disclaimer" className="font-semibold text-amber-100 underline">Vaeroex Disclaimer</Link>
        <Link href="/sensitive-data-policy" className="font-semibold text-amber-100 underline">Sensitive Data Policy</Link>
      </div>
    </div>
  );
}
