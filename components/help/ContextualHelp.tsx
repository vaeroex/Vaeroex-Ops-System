import Link from "next/link";
import { contextualHelp } from "@/lib/help/content";

function helpKey(title: string, eyebrow?: string) {
  const text = `${eyebrow || ""} ${title}`.toLowerCase();
  if (text.includes("dashboard") || text.includes("intelligence")) return "dashboard";
  if (text.includes("file")) return "files";
  if (text.includes("report")) return "reports";
  if (text.includes("kpi")) return "kpis";
  if (text.includes("crm")) return "crm";
  if (text.includes("vaeroex") || text.includes("ask")) return "ask vaeroex";
  return "default";
}

export function ContextualHelp({ title, eyebrow }: { title: string; eyebrow?: string }) {
  const help = contextualHelp[helpKey(title, eyebrow)] || contextualHelp.default;

  return (
    <details className="relative">
      <summary className="list-none rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-vaeroex-blue hover:text-vaeroex-blue">
        Help
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-line bg-white p-4 text-left shadow-xl">
        <p className="text-sm font-semibold text-ink">What this page does</p>
        <p className="mt-1 text-sm leading-6 text-muted">{help.what}</p>
        <p className="mt-3 text-sm font-semibold text-ink">Suggested review path</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-6 text-muted">
          {help.workflow.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <p className="mt-3 text-sm font-semibold text-ink">Common mistakes</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
          {help.mistakes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-vaeroex-blue">Related help</p>
        <p className="mt-1 text-sm leading-6 text-muted">{help.related.join(", ")}</p>
        <Link href="/app/help" className="mt-3 inline-flex rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
          Open Help Center
        </Link>
      </div>
    </details>
  );
}
