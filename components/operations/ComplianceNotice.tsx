"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "vaeroex.sensitive-reminder.dismissed";

export function DismissibleSensitiveReminder({ compact = false }: { compact?: boolean }) {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(STORAGE_KEY) === "1");
    setReady(true);
  }, []);

  if (!ready || dismissed) {
    return null;
  }

  return (
    <details className={`rounded-lg border border-amber-300/30 bg-amber-950/20 text-amber-50 ${compact ? "p-2.5 text-xs" : "p-3 text-sm"}`}>
      <summary className="cursor-pointer font-semibold text-amber-100">Sensitive information reminder</summary>
      <p className={`mt-2 text-amber-50/85 ${compact ? "leading-5" : "leading-6"}`}>
        Do not enter patient data, PHI, ePHI, Social Security numbers, medical record numbers, insurance IDs, or other regulated sensitive information unless your organization has the proper legal, compliance, security, and agreement requirements in place.
      </p>
      <button
        type="button"
        className="mt-3 rounded-md border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50"
        onClick={() => {
          sessionStorage.setItem(STORAGE_KEY, "1");
          setDismissed(true);
        }}
      >
        Dismiss for this session
      </button>
    </details>
  );
}

export function ComplianceNotice({ compact = false }: { compact?: boolean }) {
  return <DismissibleSensitiveReminder compact={compact} />;
}
