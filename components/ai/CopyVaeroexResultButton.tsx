"use client";

import { useState } from "react";

type CopyVaeroexResultButtonProps = {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
};

export function CopyVaeroexResultButton({
  text,
  label = "Copy",
  copiedLabel = "Copied.",
  className = "rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-200 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
}: CopyVaeroexResultButtonProps) {
  const [message, setMessage] = useState("");

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(copiedLabel);
    } catch {
      setMessage("Copy failed. Select the result text and copy it manually.");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copyResult}
        className={className}
      >
        {label}
      </button>
      {message ? <span className="text-xs font-semibold text-emerald-300">{message}</span> : null}
    </span>
  );
}
