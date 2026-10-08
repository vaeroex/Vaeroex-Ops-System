import type { ReactNode } from "react";

/** Small, text-only renderer: never renders model HTML or model-selected URLs. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-slate-100 px-1 text-[0.92em]">{part.slice(1, -1)}</code>;
    return part;
  });
}

export function AnswerContent({ content }: { content: string }) {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return <div className="space-y-3 break-words text-sm leading-7 text-slate-800 [overflow-wrap:anywhere]">
    {blocks.map((block, index) => {
      if (/^```/.test(block)) return <pre key={index} className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs leading-6"><code>{block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "")}</code></pre>;
      if (/^#{1,6} /.test(block) && !block.includes("\n")) return <h3 key={index} className="font-semibold text-slate-900">{inline(block.replace(/^#{1,6} /, ""))}</h3>;
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*] /.test(line))) return <ul key={index} className="list-disc space-y-1 pl-5">{lines.map((line, item) => <li key={item}>{inline(line.slice(2))}</li>)}</ul>;
      if (lines.every((line) => /^\d+\. /.test(line))) return <ol key={index} className="list-decimal space-y-1 pl-5">{lines.map((line, item) => <li key={item}>{inline(line.replace(/^\d+\. /, ""))}</li>)}</ol>;
      return <p key={index} className="whitespace-pre-wrap">{inline(block)}</p>;
    })}
  </div>;
}
