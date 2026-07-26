import {
  approveBusinessNoteAction,
  cancelBusinessNoteReviewAction,
  submitBusinessNoteForReviewAction
} from "@/app/app/sources/business-notes/actions";
import {
  BUSINESS_NOTE_MAX_CHARACTERS,
  BUSINESS_NOTE_TYPES,
  type BusinessNoteExtraction
} from "@/lib/ai/business-notes/contracts";
import {
  businessNoteReviewWarnings,
  validateBusinessNoteExtraction
} from "@/lib/ai/business-notes/validation";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import type { Database } from "@/lib/supabase/types";

type BusinessNoteRow = Database["public"]["Tables"]["business_notes"]["Row"];

export type BusinessNotesObservability = Readonly<{
  extractionCount: number;
  primarySuccessRate: number;
  fallbackRate: number;
  averageLatencyMs: number;
  averageTokens: number;
  averageCostCents: number;
  failureCount: number;
  averageCorrections: number;
}>;

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function reviewExtraction(note: BusinessNoteRow) {
  const parsed = validateBusinessNoteExtraction(note.extraction_json, note.original_note_text);
  return parsed.ok ? parsed.value : null;
}

function QuotedItems({
  title,
  collection,
  items
}: {
  title: string;
  collection: string;
  items: readonly { text: string; sourceQuote: string; detail?: string }[];
}) {
  if (!items.length) return null;
  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</h4>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <label key={`${collection}-${index}`} className="flex gap-3 rounded-md border border-white/10 bg-slate-950/55 p-3">
            <input type="checkbox" name="remove_item" value={`${collection}.${index}`} className="mt-1 size-4 shrink-0 accent-red-400" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-100">{item.text}</span>
              {item.detail ? <span className="mt-1 block text-xs text-slate-400">{item.detail}</span> : null}
              <span className="mt-1 block break-words text-xs leading-5 text-cyan-100/80">Exact note text: "{item.sourceQuote}"</span>
              <span className="mt-1 block text-[11px] text-slate-500">Select to remove this extracted item.</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function ReviewForm({ note, extraction }: { note: BusinessNoteRow; extraction: BusinessNoteExtraction }) {
  const observationDateFallback = extraction.reportingPeriod.start || extraction.reportingPeriod.end
    ? ""
    : note.user_observation_date || "";
  const warnings = businessNoteReviewWarnings(extraction);
  return (
    <article className="rounded-lg border border-cyan-300/30 bg-cyan-950/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Business Context Review</p>
          <p className="mt-1 text-xs text-slate-400">Submitted {dateTime(note.created_at)}</p>
        </div>
        <span className="rounded-full border border-cyan-300/30 bg-cyan-950/40 px-2.5 py-1 text-xs font-semibold text-cyan-100">
          {Math.round(extraction.extractionConfidence * 100)}% extraction confidence
        </span>
      </div>
      <form action={approveBusinessNoteAction} className="mt-4 space-y-5">
        <input type="hidden" name="note_id" value={note.id} />
        {warnings.length ? (
          <div className="rounded-md border border-amber-300/20 bg-amber-950/15 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-100">Review warnings</p>
            <ul className="mt-2 space-y-1 text-sm text-amber-50/90">
              {warnings.map((warning) => <li key={warning.code}>- {warning.label}</li>)}
            </ul>
            <p className="mt-2 text-xs leading-5 text-amber-100/70">These warnings do not prevent approval as contextual evidence.</p>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-200">
            <span className="mb-1 block text-xs font-semibold text-slate-300">Generated title</span>
            <input name="title" defaultValue={extraction.title} maxLength={160} required className="min-h-11 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-cyan-300" />
          </label>
          <label className="text-sm text-slate-200">
            <span className="mb-1 block text-xs font-semibold text-slate-300">Note type</span>
            <select name="note_type" defaultValue={extraction.noteType} className="min-h-11 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-cyan-300">
              {BUSINESS_NOTE_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}
            </select>
          </label>
        </div>
        <div className="rounded-md border border-white/10 bg-slate-950/45 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Short summary</p>
          <p className="mt-2 text-sm leading-6 text-slate-100">{extraction.summary}</p>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div><dt className="text-slate-500">Source classification</dt><dd className="mt-1 text-slate-200">{label(extraction.sourceClassification)}</dd></div>
            <div><dt className="text-slate-500">Evidence treatment proposal</dt><dd className="mt-1 text-slate-200">{label(extraction.evidenceTreatment)}</dd></div>
          </dl>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-200">
            <span className="mb-1 block text-xs font-semibold text-slate-300">Departments</span>
            <input name="departments" defaultValue={extraction.departments.join(", ")} placeholder="Sales, Operations" className="min-h-11 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-cyan-300" />
          </label>
          <label className="text-sm text-slate-200">
            <span className="mb-1 block text-xs font-semibold text-slate-300">Topics</span>
            <input name="topics" defaultValue={extraction.topics.join(", ")} placeholder="Returns, staffing" className="min-h-11 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-cyan-300" />
          </label>
          <label className="text-sm text-slate-200">
            <span className="mb-1 block text-xs font-semibold text-slate-300">Reporting period start</span>
            <input type="date" name="reporting_period_start" defaultValue={extraction.reportingPeriod.start || observationDateFallback} className="min-h-11 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-cyan-300" />
          </label>
          <label className="text-sm text-slate-200">
            <span className="mb-1 block text-xs font-semibold text-slate-300">Reporting period end</span>
            <input type="date" name="reporting_period_end" defaultValue={extraction.reportingPeriod.end || observationDateFallback} className="min-h-11 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-cyan-300" />
          </label>
        </div>
        <div className="space-y-5">
          <QuotedItems title="Explicit facts" collection="explicitFacts" items={extraction.explicitFacts.map((item) => ({ text: item.statement, sourceQuote: item.sourceQuote }))} />
          <QuotedItems title="Opinions or assumptions" collection="opinionsOrAssumptions" items={extraction.opinionsOrAssumptions.map((item) => ({ text: item.statement, sourceQuote: item.sourceQuote }))} />
          <QuotedItems title="Risks" collection="risks" items={extraction.risks.map((item) => ({ text: item.description, sourceQuote: item.sourceQuote }))} />
          <QuotedItems title="Opportunities" collection="opportunities" items={extraction.opportunities.map((item) => ({ text: item.description, sourceQuote: item.sourceQuote }))} />
          <QuotedItems title="Decisions" collection="decisions" items={extraction.decisions.map((item) => ({ text: item.description, sourceQuote: item.sourceQuote }))} />
          <QuotedItems title="Mentioned metrics or quantities" collection="mentionedMetrics" items={extraction.mentionedMetrics.map((item) => ({
            text: item.name,
            detail: item.value === null ? "No precise value extracted" : `${item.value}${item.unit ? ` ${item.unit}` : ""} · note-derived and unverified`,
            sourceQuote: item.sourceQuote
          }))} />
          <QuotedItems title="People mentioned" collection="peopleMentioned" items={extraction.peopleMentioned.map((item) => ({ text: item.name, sourceQuote: item.sourceQuote }))} />
          <QuotedItems title="Customers mentioned" collection="customersMentioned" items={extraction.customersMentioned.map((item) => ({ text: item.name, sourceQuote: item.sourceQuote }))} />
          <QuotedItems title="Vendors mentioned" collection="vendorsMentioned" items={extraction.vendorsMentioned.map((item) => ({ text: item.name, sourceQuote: item.sourceQuote }))} />
          <QuotedItems title="Projects mentioned" collection="projectsMentioned" items={extraction.projectsMentioned.map((item) => ({ text: item.name, sourceQuote: item.sourceQuote }))} />
        </div>
        {extraction.missingContext.length ? (
          <div className="rounded-md border border-amber-300/20 bg-amber-950/15 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-100">Missing context</p>
            <ul className="mt-2 space-y-1 text-sm text-amber-50/90">{extraction.missingContext.map((item) => <li key={item}>- {item}</li>)}</ul>
          </div>
        ) : null}
        <details className="rounded-md border border-white/10 bg-slate-950/45 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-200">Original note</summary>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{note.original_note_text}</p>
        </details>
        <div className="flex flex-col gap-2 sm:flex-row">
          <PendingSubmitButton pendingLabel="Approving to Evidence..." className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Approve to Evidence
          </PendingSubmitButton>
        </div>
      </form>
      <form action={cancelBusinessNoteReviewAction} className="mt-2">
        <input type="hidden" name="note_id" value={note.id} />
        <PendingSubmitButton pendingLabel="Cancelling review..." className="min-h-11 rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.05]">
          Cancel without adding to Evidence
        </PendingSubmitButton>
      </form>
    </article>
  );
}

export function BusinessNotesPanel({
  notes,
  enabled,
  observability
}: {
  notes: BusinessNoteRow[];
  enabled: boolean;
  observability?: BusinessNotesObservability | null;
}) {
  const reviewNotes = notes.filter((note) => note.status === "review_required");
  const approvedNotes = notes.filter((note) => note.status === "approved");
  const failedNotes = notes.filter((note) => note.status === "extraction_failed");
  return (
    <section id="business-notes" className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Business Notes</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Capture business context for review</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">Capture observations, meetings, incidents, decisions, concerns, assumptions, and other business context that may not exist in formal reports.</p>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-300">{approvedNotes.length} approved</span>
      </div>

      <details className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-950/10 p-3" open={!notes.length}>
        <summary className="cursor-pointer list-none text-sm font-semibold text-cyan-100">Write Business Note</summary>
        <form action={submitBusinessNoteForReviewAction} className="mt-4 space-y-3">
          <label className="block text-sm text-slate-200">
            <span className="mb-1 block text-xs font-semibold text-slate-300">Business Note</span>
            <textarea
              name="note_text"
              required
              maxLength={BUSINESS_NOTE_MAX_CHARACTERS}
              rows={8}
              disabled={!enabled}
              placeholder="Write or paste the observation exactly as it was recorded..."
              className="w-full resize-y rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label className="block max-w-xs text-sm text-slate-200">
            <span className="mb-1 block text-xs font-semibold text-slate-300">Observation date (optional)</span>
            <input type="date" name="observation_date" disabled={!enabled} className="min-h-11 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-cyan-300 disabled:opacity-60" />
          </label>
          <p className="text-xs leading-5 text-slate-400">Business context is extracted only after submission. Documents and longer meeting notes should continue through the existing Evidence upload action.</p>
          {enabled ? (
            <PendingSubmitButton pendingLabel="Extracting business context..." className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
              Review &amp; Extract Business Context
            </PendingSubmitButton>
          ) : (
            <p className="rounded-md border border-amber-300/20 bg-amber-950/15 p-3 text-sm text-amber-100">Business context extraction is not enabled in this environment.</p>
          )}
        </form>
      </details>

      {reviewNotes.length ? <div className="mt-5 space-y-4">{reviewNotes.map((note) => {
        const extraction = reviewExtraction(note);
        return extraction ? <ReviewForm key={note.id} note={note} extraction={extraction} /> : null;
      })}</div> : null}

      {approvedNotes.length ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-white">Approved Business Notes</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {approvedNotes.map((note) => {
              const extraction = reviewExtraction({ ...note, extraction_json: note.reviewed_extraction_json });
              if (!extraction) return null;
              return (
                <article key={note.id} className="rounded-md border border-white/10 bg-slate-950/45 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold text-white">{extraction.title}</h4>
                    <span className="rounded-full border border-emerald-300/25 bg-emerald-950/25 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">Contextual evidence</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{extraction.summary}</p>
                  <p className="mt-2 text-xs text-slate-500">Approved {dateTime(note.approved_at || note.updated_at)} | Quantities remain note-derived until corroborated.</p>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {failedNotes.length ? (
        <div className="mt-5 rounded-md border border-red-300/20 bg-red-950/15 p-3">
          <p className="text-sm font-semibold text-red-100">{failedNotes.length} note extraction{failedNotes.length === 1 ? "" : "s"} could not be completed safely.</p>
          <p className="mt-1 text-xs leading-5 text-red-100/75">The original notes were preserved and none were added to active Evidence.</p>
        </div>
      ) : null}

      {observability ? (
        <details className="mt-5 rounded-md border border-white/10 bg-slate-950/45 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-300">Preview extraction observability</summary>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-slate-500">Primary success</dt><dd className="mt-1 text-slate-100">{observability.primarySuccessRate}%</dd></div>
            <div><dt className="text-slate-500">Fallback rate</dt><dd className="mt-1 text-slate-100">{observability.fallbackRate}%</dd></div>
            <div><dt className="text-slate-500">Average latency</dt><dd className="mt-1 text-slate-100">{observability.averageLatencyMs} ms</dd></div>
            <div><dt className="text-slate-500">Average tokens</dt><dd className="mt-1 text-slate-100">{observability.averageTokens}</dd></div>
            <div><dt className="text-slate-500">Average cost</dt><dd className="mt-1 text-slate-100">{observability.averageCostCents.toFixed(2)} cents</dd></div>
            <div><dt className="text-slate-500">Failures</dt><dd className="mt-1 text-slate-100">{observability.failureCount}</dd></div>
            <div><dt className="text-slate-500">Average corrections</dt><dd className="mt-1 text-slate-100">{observability.averageCorrections.toFixed(1)}</dd></div>
            <div><dt className="text-slate-500">Measured extractions</dt><dd className="mt-1 text-slate-100">{observability.extractionCount}</dd></div>
          </dl>
        </details>
      ) : null}
    </section>
  );
}
