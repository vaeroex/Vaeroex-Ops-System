"use client";
import { useState, type FormEvent } from "react";

/** Isolated qualification inspection only; no normal chat affordance points here. */
export function VsiPreparationForm({ workspaceId }: { workspaceId: string }) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState("");
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setResult("");
    try {
      const response = await fetch("/api/vsi/prepare", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedWorkspaceId: workspaceId, question }) });
      const value = await response.json();
      setResult(JSON.stringify(response.ok ? value : { error: value.error, code: value.code }, null, 2));
    } catch { setResult("Preparation could not finish. No model request was sent."); }
    finally { setPending(false); }
  }
  return <section className="space-y-4 p-4">
    <h1 className="text-xl font-semibold">Qualification evidence preparation</h1>
    <p>Inspect the complete prepared source set. This does not generate an answer or use a question allowance.</p>
    <form onSubmit={prepare} className="space-y-3">
      <label htmlFor="preparation-question">Approved question</label>
      <textarea id="preparation-question" value={question} onChange={event => setQuestion(event.target.value)}
        required maxLength={8000} rows={6} className="block w-full rounded border bg-transparent p-2" />
      <button type="submit" disabled={pending || !question.trim()} className="rounded border px-3 py-2">{pending ? "Preparing…" : "Prepare evidence"}</button>
    </form>
    <pre role="status" aria-live="polite" className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all text-sm">{result}</pre>
  </section>;
}
