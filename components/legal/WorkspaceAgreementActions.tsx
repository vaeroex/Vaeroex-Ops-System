"use client";

import { Download, Eye, Printer } from "lucide-react";

export function WorkspaceAgreementActions({
  agreementId,
  admin = false
}: {
  agreementId: string;
  admin?: boolean;
}) {
  const base = admin
    ? `/api/admin/workspace-agreements/${agreementId}/pdf`
    : `/api/legal/workspace-agreements/${agreementId}/pdf`;
  const className = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue hover:text-vaeroex-blue";

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <a href={`${base}?disposition=inline`} target="_blank" rel="noreferrer" className={className}>
        <Eye className="h-4 w-4" aria-hidden="true" />
        View PDF
      </a>
      <a href={`${base}?disposition=attachment`} className={className}>
        <Download className="h-4 w-4" aria-hidden="true" />
        Download
      </a>
      <button type="button" onClick={() => window.print()} className={className}>
        <Printer className="h-4 w-4" aria-hidden="true" />
        Print
      </button>
    </div>
  );
}
