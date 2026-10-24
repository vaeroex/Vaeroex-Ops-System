/** Suggestions are editable drafts. Selecting one never submits a request. */
export const VSI_SUGGESTED_PROMPTS = [
  {
    "id": "executive-brief",
    "label": "Executive brief · last 30 days",
    "prompt": "Prepare an executive brief for my business covering the last 30 days, using the workspace sources I can access. Summarize performance and notable changes with citations to the supporting originals. Distinguish recorded facts, calculations, reported context and possible interpretations, and explain missing or stale evidence."
  },
  {
    "id": "weekly-brief",
    "label": "Executive brief · last 7 days",
    "prompt": "Prepare an executive brief for my business covering the last 7 days. Use accessible plug-in evidence, processed files and approved Business Notes where relevant. Cite the originals and their dates, distinguish measured performance from reported context, and explain what the available evidence cannot establish."
  },
  {
    "id": "period-comparison",
    "label": "Compare with the prior period",
    "prompt": "Compare my business over the last 30 days with the preceding 30 days where the available evidence supports a like-for-like comparison. Cite the sources and dates, preserve entity, currency, unit and coverage differences, and do not add overlapping totals or treat missing data as zero."
  },
  {
    "id": "explain-change",
    "label": "Explore a notable change",
    "prompt": "Help me explore a notable change using my accessible plug-in evidence, processed files and approved Business Notes together. If I have not identified the change or period, ask me which one to examine first. Cite the originals, distinguish observations from tentative explanations, and explain what matching evidence would be needed to test a possible explanation without asserting causation."
  },
  {
    "id": "finding-plan",
    "label": "Plan from an Intelligence finding",
    "prompt": "Help me turn an existing Intelligence finding into a practical action plan. If I have not supplied or identified the finding, ask me to choose it first; do not invent a selected finding. Review its supporting sources, identify information gaps, and propose actions, checks and success criteria for me to review. Keep suggestions separate from established facts, and do not create tasks or change records."
  }
] as const;

export function suggestedPromptDraft(draft: string, id: string): { draft: string; added: boolean } {
  const suggestion = VSI_SUGGESTED_PROMPTS.find(prompt => prompt.id === id);
  if (!suggestion) return { draft, added: false };
  const next = draft.length ? `${draft}\n\n${suggestion.prompt}` : suggestion.prompt;
  // Preserve the owner's text exactly; never truncate it to fit a suggestion.
  return next.length <= 8000 ? { draft: next, added: true } : { draft, added: false };
}
