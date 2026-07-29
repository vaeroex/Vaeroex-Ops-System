"use client";

import { useState } from "react";
import {
  BUSINESS_NOTE_LARGE_WARNING_CHARACTERS,
  BUSINESS_NOTE_MAX_LENGTH_MESSAGE,
  BUSINESS_NOTE_RECOMMENDED_MAX_CHARACTERS,
  BUSINESS_NOTE_RECOMMENDED_MIN_CHARACTERS,
  BUSINESS_NOTE_SUBMISSION_MAX_CHARACTERS,
  businessNoteInputGuidance
} from "@/lib/ai/business-notes/input-guidance";

const PURPOSE_HELPER =
  "Business Notes are for important business observations, decisions, temporary conditions, incidents, assumptions, and executive context that may not appear in formal reports. For best results, keep notes focused on a single business event or topic.";

const LARGE_NOTE_WARNING =
  "This is a large Business Note and may take longer to analyze. If this is a meeting transcript, SOP, report, or other long-form document, consider uploading it as a document instead.";

export function BusinessNoteComposer({ disabled }: { disabled: boolean }) {
  const [characterCount, setCharacterCount] = useState(0);
  const guidance = businessNoteInputGuidance(characterCount);

  return (
    <label className="block text-sm text-slate-200">
      <span className="mb-1 block text-xs font-semibold text-slate-300">Business Note</span>
      <textarea
        name="note_text"
        required
        maxLength={BUSINESS_NOTE_SUBMISSION_MAX_CHARACTERS}
        rows={8}
        disabled={disabled}
        aria-describedby="business-note-purpose business-note-length business-note-character-count business-note-length-warning"
        placeholder="Write or paste the observation exactly as it was recorded..."
        onChange={(event) => setCharacterCount(event.currentTarget.value.length)}
        className="w-full resize-y rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <span id="business-note-purpose" className="mt-2 block text-xs leading-5 text-slate-400">{PURPOSE_HELPER}</span>
      <span id="business-note-length" className="mt-1 block text-xs font-medium text-slate-300">
        Recommended length: {BUSINESS_NOTE_RECOMMENDED_MIN_CHARACTERS.toLocaleString()}–{BUSINESS_NOTE_RECOMMENDED_MAX_CHARACTERS.toLocaleString()} characters.
      </span>
      <span id="business-note-character-count" aria-live="polite" className="mt-1 block text-xs tabular-nums text-slate-400">
        {characterCount.toLocaleString()} / {BUSINESS_NOTE_SUBMISSION_MAX_CHARACTERS.toLocaleString()} characters
      </span>
      {guidance.showLargeNoteWarning ? (
        <span id="business-note-length-warning" className="mt-2 block rounded-md border border-amber-300/20 bg-amber-950/15 p-3 text-xs leading-5 text-amber-100">
          {characterCount >= BUSINESS_NOTE_SUBMISSION_MAX_CHARACTERS ? BUSINESS_NOTE_MAX_LENGTH_MESSAGE : LARGE_NOTE_WARNING}
        </span>
      ) : (
        <span id="business-note-length-warning" className="sr-only">
          A large-note warning appears at {BUSINESS_NOTE_LARGE_WARNING_CHARACTERS.toLocaleString()} characters.
        </span>
      )}
    </label>
  );
}
