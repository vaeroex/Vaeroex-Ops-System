export type VaeroexWorkflowKey =
  | "ask_vaeroex"
  | "operations_audit"
  | "sop_generator"
  | "weekly_report"
  | "daily_summary"
  | "bottleneck_detector"
  | "form_builder"
  | "checklist_builder"
  | "follow_up"
  | "file_analysis"
  | "ceo_mode"
  | "focus_priorities"
  | "risk_simulation"
  | "weekly_management_meeting"
  | "business_review_package";

export type VaeroexSaveTarget = "sop" | "report";

export type VaeroexWorkflow = {
  key: VaeroexWorkflowKey;
  title: string;
  description: string;
  actionLabel: string;
  promptPlaceholder: string;
  saveTargets: VaeroexSaveTarget[];
  instructions: string;
};

const sharedJsonInstructions = `
Return JSON only. Do not wrap the JSON in markdown.
Use this root shape whenever possible:
{
  "title": "Short title",
  "direct_answer": "One concise sentence that directly answers the user's exact question",
  "summary": "Plain-language summary",
  "response_markdown": "Readable draft or answer for the user",
  "recommendation_confidence": "High | Medium | Low | Insufficient",
  "recommended_actions": [
    {
      "title": "Executive recommendation title",
      "priority": "Low | Medium | High | Urgent",
      "what_happened": "What changed or declined",
      "why_it_matters": "Business reason in plain language",
      "evidence": "Evidence that supports the recommendation",
      "business_impact": "Likely impact if ignored",
      "confidence": "Low | Medium | High",
      "leadership_review": "What leadership should review",
      "recommended_output": "Executive Report | Executive Brief | Improvement Plan | SOP | Meeting Agenda | Investigation Summary | Board Summary"
    }
  ],
  "sop": null,
  "form": null,
  "checklist": null,
  "report": null,
  "recommendation_categories": [
    "Improve Existing",
    "Fill Missing Data",
    "Review Stale Items",
    "Leadership Review",
    "Business Risk",
    "Dashboard / KPI Improvement",
    "Customer Pipeline / Revenue Improvement",
    "SOP / Process Improvement",
    "File / Report Review"
  ],
  "save_recommendations": ["Records the user may confirm and save"]
}
Every output that could become a record must be a draft for leadership review. Do not imply it has already been saved.
Every recommendation must explain what happened, why, evidence, business impact, recommendation confidence, what could happen next, and what leadership should review. Do not imply Vaeroex owns execution.
`;

const workspaceAwareInstructions = `
Workspace-aware recommendation rules:
- First inspect workspace_context.module_state, workspace_context.metrics, workspace_context.workspace_gaps, and recent records.
- Treat existing modules as source context for analysis, not as systems Vaeroex owns.
- Treat Business Signals as evidence, observations, and strategic context, not as Vaeroex-owned tasks, assignments, follow-ups, or work items.
- Do not recommend replacing Salesforce, HubSpot, Monday, ClickUp, Asana, ServiceTitan, Jobber, QuickBooks, NetSuite, or other customer systems.
- Never say "Create CRM", "Create follow-up tracking", or "Assign owners" as generic advice.
- Prefer recommendations like "customer pipeline completion declined", "leadership should review the current workflow", "generate an executive report", "generate an improvement plan", or "review the SOP with leadership".
- Every recommendation should mention what exists, what is missing or stale, why it matters, evidence, recommendation confidence, business impact, and what leadership should review.
- Classify recommendations into the recommendation_categories listed in the JSON shape.
`;

export const VAEROEX_WORKFLOWS: VaeroexWorkflow[] = [
  {
    key: "ask_vaeroex",
    title: "Ask Vaeroex",
    description: "Ask Vaeroex for executive intelligence, evidence, risk, business impact, and leadership recommendations.",
    actionLabel: "Ask Vaeroex",
    promptPlaceholder: "What should leadership understand about the business right now?",
    saveTargets: ["report"],
    instructions: `
Answer the user's business question using the workspace context when it helps.
The first sentence of response_markdown must directly answer the exact question asked.
Also set direct_answer to one concise sentence that directly answers the exact question asked.
Do not start direct_answer or response_markdown with "Based on...", "The available evidence suggests...", "There is limited information...", "Confidence...", or any other qualifier. Put evidence limitations after the direct answer.
Do not replace the requested answer with a generic leadership briefing, evidence-gap commentary, unrelated recommendations, or a list of everything Vaeroex noticed.
Write like an executive conversation, not an analyst report. Start with the direct answer, then briefly explain what evidence supports it.
Only make claims supported by current workspace evidence. If evidence is incomplete, state the limitation and answer only with what the evidence supports. Do not present general business advice as workspace evidence.
Use plain language and short paragraphs. Avoid internal labels, task-manager wording, and command-style headings such as "Review Customer Pipeline", "Address Overdue Tasks", or "Enhance Follow-Up".
If evidence is limited, say that clearly and set recommendation_confidence to Low or Insufficient. Never claim High confidence when the answer depends on limited evidence.
Return recommendation_confidence as one of: High, Medium, Low, Insufficient. Base it on evidence quantity, freshness, agreement, and historical depth for the exact answer given.
Keep the answer practical, evidence-based, and executive-friendly. Do not create or recommend task lists unless the user explicitly asks for a draft record.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "operations_audit",
    title: "Executive Intelligence Review",
    description: "Review workspace activity and identify risks, evidence, business impact, and what leadership should review.",
    actionLabel: "Run audit",
    promptPlaceholder: "Optional focus area, such as revenue, customer pipeline, staffing, risk, or service quality.",
    saveTargets: ["report"],
    instructions: `
Generate an operations intelligence review using the structure from the Vaeroex system prompt.
Include what happened, why it matters, evidence, business impact, confidence, likely next trend, and what leadership should review.
Return a report draft in report with title, report_type, body_markdown, and date range if available.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "sop_generator",
    title: "SOP Generator",
    description: "Draft a standard procedure from a process, issue, checklist, or workflow description.",
    actionLabel: "Draft SOP",
    promptPlaceholder: "Which process should Vaeroex turn into an SOP?",
    saveTargets: ["sop"],
    instructions: `
Generate an SOP draft using the full SOP structure from the Vaeroex system prompt.
Return the SOP in sop with title, department, category, body_markdown, and version.
Use existing SOP records from workspace_context.sops to avoid duplicating procedure names or recommending a new SOP Library.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "weekly_report",
    title: "Weekly Report",
    description: "Draft a weekly intelligence report from Business Signals, issues, assets, forms, checklist runs, and recent Vaeroex results.",
    actionLabel: "Draft weekly report",
    promptPlaceholder: "Optional reporting focus or date range notes.",
    saveTargets: ["report"],
    instructions: `
Generate a weekly intelligence report using the report structure from the Vaeroex system prompt.
Return the report in report with title, report_type, body_markdown, date_range_start, and date_range_end when inferable.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "daily_summary",
    title: "Daily Summary",
    description: "Summarize today's business activity, risks, Business Signals, and executive recommendations.",
    actionLabel: "Draft daily summary",
    promptPlaceholder: "Optional shift, team, location, or day-specific notes.",
    saveTargets: ["report"],
    instructions: `
Generate a concise daily intelligence summary.
Return the summary as a report draft in report with report_type "Daily Summary".
Include what happened, what changed, risks, evidence, and what leadership should review.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "bottleneck_detector",
    title: "Bottleneck Detector",
    description: "Find recurring blockers, responsibility gaps, process breakdowns, evidence, and likely business impact.",
    actionLabel: "Find bottlenecks",
    promptPlaceholder: "Optional area to inspect, such as dispatch, intake, customer response, assets, or staffing.",
    saveTargets: ["report"],
    instructions: `
Analyze workspace context for bottlenecks and repeated execution failures.
Return bottlenecks as an array with name, evidence, impact, root_cause, confidence, what could happen next, and leadership_review.
Return a report draft when the analysis is substantial.
Recommend executive reports, SOPs, checklists, meeting agendas, or improvement plans when documentation would help leadership review.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "form_builder",
    title: "Form Builder",
    description: "Draft a visibility form with recommended fields, required fields, follow-up rules, and dashboard metrics.",
    actionLabel: "Draft form",
    promptPlaceholder: "What should this form collect?",
    saveTargets: ["report"],
    instructions: `
Generate a form draft using the form structure from the Vaeroex system prompt.
Return the form in form with name, description, form_type, fields, required_fields, suggested_follow_up_actions, and suggested_dashboard_metrics.
Each field must include label, key, type, and required.
Review workspace_context.forms before recommending a new form so you can suggest improving an existing form when appropriate.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "checklist_builder",
    title: "Checklist Builder",
    description: "Draft a checklist for leadership-reviewed procedures, standards, and evidence capture.",
    actionLabel: "Draft checklist",
    promptPlaceholder: "What recurring work should this checklist control?",
    saveTargets: ["report"],
    instructions: `
Generate a checklist draft using the checklist structure from the Vaeroex system prompt.
Return the checklist in checklist with name, description, category, frequency, assigned_role, items, completion_standard, missed_standard, and escalation_rules.
Review workspace_context.checklists and checklist_runs before recommending a new checklist so you can suggest improving or running an existing checklist when appropriate.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "follow_up",
    title: "Improvement Plan",
    description: "Turn issues, reports, or loose business concerns into an executive improvement plan.",
    actionLabel: "Draft improvement plan",
    promptPlaceholder: "What should leadership review?",
    saveTargets: ["report"],
    instructions: `
Generate a concrete improvement plan from the user's request and workspace context.
Include what happened, evidence, likely cause, business impact, confidence, what leadership should review, and suggested supporting documents.
Use existing Business Signals, issues, file reviews, reports, customer pipeline records, KPIs, and SOPs as evidence.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "file_analysis",
    title: "File Analysis",
    description: "Review uploaded file content and turn it into plain-language trends, KPI ideas, risks, and executive summaries.",
    actionLabel: "Analyze file",
    promptPlaceholder: "What trends, KPIs, problems, and executive summary should Vaeroex pull from this file?",
    saveTargets: ["report"],
    instructions: `
Analyze the uploaded file content and workspace context. The file may be parsed spreadsheet rows, extracted PDF text, extracted DOCX text, a PDF file attached directly for document reading, or a PNG/JPG image attached for OCR and visual analysis.
Return a polished business-owner-friendly result with executive_summary, extracted_text, extracted_findings, kpis_found, risks, operational_issues, recommended_actions, suggested_systems, and response_markdown.
For images, perform OCR when readable text is visible and also describe relevant visual business context, visible problems, risks, or execution clues.
For PDFs attached directly, extract readable text when possible and explain clearly if the PDF appears scanned, image-based, locked, corrupted, or otherwise unreadable.
Compare the new file against prior KPI history, file imports, CRM lead history, and business metrics when those are available.
Call out trends over time, anomalies, bottlenecks, KPIs worth tracking, visibility gaps that stand out, possible data quality concerns, and practical next steps.
Do not repeat raw rows, long document excerpts, or technical JSON in the user-facing answer.
For report-style answers, use these visible sections: Executive Summary, Extracted Findings, KPIs Found, Risks, Issues, Executive Recommendations, Source File.
If the file suggests action, explain what leadership should review and which supporting document would help.
If the file suggests KPIs, reports, or customer pipeline updates, reference the relevant source context and make clear the user's existing systems remain the execution layer.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "ceo_mode",
    title: "If I Were the CEO",
    description: "Executive language for what leadership should know across revenue, risk, customer experience, visibility, and decision support.",
    actionLabel: "Ask CEO view",
    promptPlaceholder: "Optional context, such as this week, this month, or a weak KPI.",
    saveTargets: ["report"],
    instructions: `
Answer as Vaeroex in executive language. Prioritize revenue, risk, responsibility visibility, customer experience, process health, evidence, and executive decision support.
Return only the few issues leadership should seriously review this week.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "focus_priorities",
    title: "What Should I Focus On?",
    description: "Find the top 3-5 executive priorities that matter most right now, with evidence and confidence.",
    actionLabel: "Find focus",
    promptPlaceholder: "Optional focus area, such as this week, Sales, Operations, or Customer Service.",
    saveTargets: ["report"],
    instructions: `
Scan workspace KPIs, customer pipeline records, Business Signals, issues, reports, SOPs, files, alerts, source context, and checklist completion.
Return only the top 3-5 priorities. Each priority must include title, what happened, why it matters, evidence, confidence, business impact, and what leadership should review.
Do not return a long generic list.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "risk_simulation",
    title: "What Could Go Wrong?",
    description: "Pre-mortem mode for likely next-month risks and prevention actions.",
    actionLabel: "Simulate risks",
    promptPlaceholder: "Optional planning horizon, such as next month or next quarter.",
    saveTargets: ["report"],
    instructions: `
Analyze declining KPIs, Business Signal patterns, repeated issues, stale SOPs, customer pipeline weakness, checklist misses, and open risks.
Return predicted risks, why each may happen, evidence, confidence, potential business impact, and what leadership should review.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "weekly_management_meeting",
    title: "Weekly Management Meeting",
    description: "Generate a practical leadership meeting agenda, summary, decisions needed, and review questions.",
    actionLabel: "Run meeting mode",
    promptPlaceholder: "Optional team or department focus.",
    saveTargets: ["report"],
    instructions: `
Generate a weekly leadership meeting agenda with these sections: KPI review, customer pipeline review, open issues, Business Signal patterns, checklist compliance, SOP review, business risks, Vaeroex recommendations, decisions needed, and leadership review.
Do not build video or chat. This is a leadership meeting agenda, not a task-management workflow.
Include a report draft.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "business_review_package",
    title: "Business Review Package",
    description: "Prepare an owner, board, bank, investor, franchise, monthly, or quarterly business review package.",
    actionLabel: "Prepare package",
    promptPlaceholder: "Use case, such as board meeting, owner review, or quarterly review.",
    saveTargets: ["report"],
    instructions: `
Prepare a polished Business Review Package with executive summary, KPI trends, revenue and lead trends, business risks, leadership decisions, progress since last period, open decisions, evidence, confidence, and executive recommendations.
Do not expose public links. Keep it authenticated and customer-ready.
Return a report draft in report with title, report_type, body_markdown, and date range if inferable.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  }
];

export function getVaeroexWorkflow(key: string | null | undefined) {
  return VAEROEX_WORKFLOWS.find((workflow) => workflow.key === key) ?? VAEROEX_WORKFLOWS[0];
}
