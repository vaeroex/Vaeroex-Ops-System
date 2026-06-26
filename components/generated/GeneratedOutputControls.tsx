"use client";

import { useMemo, useState } from "react";

type GeneratedOutputControlsProps = {
  title: string;
  markdown: string;
};

function fileNameFromTitle(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return `${slug || "vaeroex-generated-output"}.md`;
}

export function GeneratedOutputControls({ title, markdown }: GeneratedOutputControlsProps) {
  const [message, setMessage] = useState("");
  const fileName = useMemo(() => fileNameFromTitle(title), [title]);

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(markdown);
      setMessage("Copied.");
    } catch {
      setMessage("Copy failed. Select the output text and copy it manually.");
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Download started.");
  }

  function printOutput() {
    window.print();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={copyOutput}
        className="min-h-10 rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={downloadMarkdown}
        className="min-h-10 rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
      >
        Download Markdown
      </button>
      <button
        type="button"
        onClick={printOutput}
        className="min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-cyan-300/30 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
      >
        Print-friendly
      </button>
      {message ? <span className="text-xs font-semibold text-emerald-300">{message}</span> : null}
    </div>
  );
}
