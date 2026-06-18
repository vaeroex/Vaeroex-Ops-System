export function ComplianceNotice({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-900 ${compact ? "p-3 text-xs" : "p-4 text-sm"}`}>
      <p className="font-semibold">Sensitive information reminder</p>
      <p className={`mt-1 ${compact ? "leading-5" : "leading-6"}`}>
        Do not enter patient data, PHI, ePHI, Social Security numbers, medical record numbers, insurance IDs, or other regulated sensitive information unless your organization has the proper legal, compliance, security, and agreement requirements in place.
      </p>
    </aside>
  );
}
