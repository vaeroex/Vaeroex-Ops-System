import Link from "next/link";
import type { HelpArticle } from "@/lib/help/content";

export function HelpArticleCard({ article }: { article: HelpArticle }) {
  return (
    <article className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-blue">{article.category}</p>
          <h3 className="mt-1 text-base font-semibold text-ink">{article.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted">{article.summary}</p>
        </div>
        <Link href={article.nextHref} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
          {article.nextLabel}
        </Link>
      </div>
      <details className="mt-4 rounded-lg border border-line bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Read guide</summary>
        <div className="mt-3 grid gap-4 text-sm leading-6 text-slate-600 lg:grid-cols-2">
          <div>
            <p className="font-semibold text-ink">What this means</p>
            <p className="mt-1">{article.what}</p>
          </div>
          <div>
            <p className="font-semibold text-ink">Why it matters</p>
            <p className="mt-1">{article.why}</p>
          </div>
          <div>
            <p className="font-semibold text-ink">When to use it</p>
            <p className="mt-1">{article.when}</p>
          </div>
          <div>
            <p className="font-semibold text-ink">Common mistakes</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {article.mistakes.map((mistake) => (
                <li key={mistake}>{mistake}</li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-2">
            <p className="font-semibold text-ink">Suggested review path</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {article.workflow.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="lg:col-span-2">
            <p className="font-semibold text-ink">Related features</p>
            <p className="mt-1">{article.related.join(", ")}</p>
          </div>
        </div>
      </details>
    </article>
  );
}
