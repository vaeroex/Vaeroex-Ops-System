export function ComplianceNotice({ compact = false }: { compact?: boolean }) {
  return (
    <details className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-900 ${compact ? "p-3 text-xs" : "p-3 text-sm"}`}>
      <summary className="cursor-pointer font-semibold">Sensitive information reminder</summary>
      <p className={`mt-2 ${compact ? "leading-5" : "leading-6"}`}>
        Do not enter patient data, PHI, ePHI, Social Security numbers, medical record numbers, insurance IDs, or other regulated sensitive information unless your organization has the proper legal, compliance, security, and agreement requirements in place.
      </p>
    </details>
  );
}
