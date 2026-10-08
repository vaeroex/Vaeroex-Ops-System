import Link from "next/link";
import { AnswerContent } from "@/components/vsi/AnswerContent";
import { displayDate, safeSourceUrl, type VsiExchange } from "@/components/vsi/contracts";

export function Exchange({ exchange, canEditNotes, saving, disabled, workspaceName, onRemember }: {
  exchange: VsiExchange;
  canEditNotes: boolean;
  saving: boolean;
  disabled: boolean;
  workspaceName: string;
  onRemember: (exchangeId: string) => void;
}) {
  return <article className="space-y-5 border-b border-slate-200 pb-7 last:border-0" aria-label={`Exchange from ${displayDate(exchange.createdAt, true)}`}>
    <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-slate-100 px-4 py-3 sm:max-w-[85%]">
      <p className="mb-1 text-xs font-semibold text-slate-500">You</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-900 [overflow-wrap:anywhere]">{exchange.userMessage}</p>
    </div>
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-vaeroex-blue">Vaeroex</h3>
        <time dateTime={exchange.createdAt} className="text-xs text-slate-500">{displayDate(exchange.createdAt, true)}</time>
      </div>
      <AnswerContent content={exchange.answer} />
      {exchange.citations.length > 0 ? <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <summary className="min-h-7 cursor-pointer text-xs font-semibold text-slate-700">Sources ({exchange.citations.length})</summary>
        <ol className="mt-2 grid gap-3 sm:grid-cols-2">
          {exchange.citations.map((source) => {
            const href = safeSourceUrl(source.url);
            return <li key={source.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-3 text-xs leading-5">
              <span className="font-semibold text-slate-500">[{source.id}] </span>
              {href ? <a href={href} {...(href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="break-words font-semibold text-vaeroex-blue underline decoration-slate-300 underline-offset-2 focus-visible:outline-2 focus-visible:outline-vaeroex-blue">{source.title}</a> : <span className="font-semibold text-slate-700">{source.title}</span>}
              <p className="mt-1 text-slate-600">Evidence: {displayDate(source.evidenceDate)}</p>
              <p className="text-slate-500">Checked: {displayDate(source.retrievedAt, true)}</p>
              {source.excerpt ? <p className="mt-1 break-words text-slate-600 [overflow-wrap:anywhere]">{source.excerpt}</p> : null}
            </li>;
          })}
        </ol>
      </details> : null}
      {exchange.rememberProposal ? <section className="mt-4 rounded-lg border border-cyan-200 bg-vaeroex-soft p-4" aria-label="Proposed Business Note">
        <h4 className="text-sm font-semibold text-slate-900">{exchange.savedNoteId ? "Business Note draft saved" : "Review before saving"}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-600">{exchange.savedNoteId ? "Saved to" : "Proposed destination:"} {workspaceName} → Files &amp; Notes → Business Notes. This note will be visible to people with access to Business Notes in this workspace.</p>
        <p className="mt-3 text-sm font-semibold text-slate-900">{exchange.rememberProposal.title}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{exchange.rememberProposal.content}</p>
        {exchange.savedNoteId ? <p className="mt-3 text-sm text-slate-700">Complete the normal review before this becomes Business Memory. <Link href="/app/sources#business-notes" className="font-semibold text-vaeroex-blue underline">Review, edit, or remove this note</Link>.</p>
          : canEditNotes ? <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={disabled} onClick={() => onRemember(exchange.id)} className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue disabled:opacity-50">{saving ? "Saving note…" : "Confirm and save this note"}</button>
            <span className="text-xs text-slate-600">Only the text shown above will be saved as a draft.</span>
          </div> : <p className="mt-3 text-sm font-medium text-slate-700">The note was not saved. Your workspace role does not allow editing Business Notes.</p>}
      </section> : null}
    </div>
  </article>;
}
