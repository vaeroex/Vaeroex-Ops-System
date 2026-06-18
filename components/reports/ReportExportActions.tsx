"use client";

import { useState } from "react";

type ReportExportActionsProps = {
  title: string;
  reportType: string;
  body: string;
  dateRange: string;
};

function safeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "vaeroex-report";
}

export function ReportExportActions({ title, reportType, body, dateRange }: ReportExportActionsProps) {
  const [message, setMessage] = useState("");
  const reportText = `# ${title}\n\n${reportType}\n${dateRange}\n\n${body || "No report body yet."}`;

  async function copyReport() {
    await navigator.clipboard.writeText(reportText);
    setMessage("Report copied.");
  }

  async function copyInternalLink() {
    await navigator.clipboard.writeText(window.location.href);
    setMessage("Internal link copied.");
  }

  function downloadReport() {
    const blob = new Blob([reportText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Report downloaded.");
  }

  function printReport() {
    setMessage("Use your browser print dialog to save as PDF or print.");
    window.print();
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">Professional report actions</p>
          <p className="mt-1 text-xs leading-5 text-muted">Export, print, copy, or share this report for internal review.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={printReport} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
            Export PDF
          </button>
          <button type="button" onClick={printReport} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">
            Print view
          </button>
          <button type="button" onClick={downloadReport} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">
            Download
          </button>
          <button type="button" onClick={copyReport} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">
            Copy report
          </button>
          <button type="button" onClick={copyInternalLink} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">
            Share link
          </button>
          <a
            href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(reportText.slice(0, 1800))}`}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold"
          >
            Email draft
          </a>
        </div>
      </div>
      {message ? <p className="mt-3 text-xs font-semibold text-emerald-700">{message}</p> : null}
    </div>
  );
}
