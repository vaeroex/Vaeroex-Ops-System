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
  | "file_analysis";

export type VaeroexSaveTarget = "tasks" | "sop" | "form" | "checklist" | "report";

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
  "summary": "Plain-language summary",
  "response_markdown": "Readable draft or answer for the user",
  "suggested_tasks": [
    {
      "title": "Task title",
      "description": "What should be done",
      "priority": "Low | Medium | High | Urgent",
      "category": "Category",
      "due_date_recommendation": "Short recommendation"
    }
  ],
  "sop": null,
  "form": null,
  "checklist": null,
  "report": null,
  "save_recommendations": ["Records the user may confirm and save"]
}
Every output that could become a record must be a draft for manager review. Do not imply it has already been saved.
`;

export const VAEROEX_WORKFLOWS: VaeroexWorkflow[] = [
  {
    key: "ask_vaeroex",
    title: "Ask Vaeroex",
    description: "Ask Vaeroex about operations, follow-up, accountability, SOPs, forms, checklists, reports, and next actions.",
    actionLabel: "Ask Vaeroex",
    promptPlaceholder: "What operational problem should Vaeroex help you think through?",
    saveTargets: ["tasks"],
    instructions: `
Answer the user's operations question using the workspace context when it helps.
If useful, include suggested_tasks. Keep the answer practical and direct.
${sharedJsonInstructions}
`
  },
  {
    key: "operations_audit",
    title: "Operations Audit",
    description: "Review workspace activity and identify bottlenecks, gaps, risks, and systems to build next.",
    actionLabel: "Run audit",
    promptPlaceholder: "Optional focus area, such as missed follow-ups, handoffs, equipment, or manager visibility.",
    saveTargets: ["tasks", "report"],
    instructions: `
Generate an operations audit using the structure from the Vaeroex system prompt.
Include current operational problems, bottlenecks, accountability gaps, recommended systems, suggested forms, suggested checklists, suggested SOPs, dashboard metrics, and a 30-day action plan.
Return a report draft in report with title, report_type, body_markdown, and date range if available.
Include suggested_tasks for the highest-priority next actions.
${sharedJsonInstructions}
`
  },
  {
    key: "sop_generator",
    title: "SOP Generator",
    description: "Draft a standard operating procedure from a process, issue, checklist, or workflow description.",
    actionLabel: "Draft SOP",
    promptPlaceholder: "Which process should Vaeroex turn into an SOP?",
    saveTargets: ["sop", "tasks"],
    instructions: `
Generate an SOP draft using the full SOP structure from the Vaeroex system prompt.
Return the SOP in sop with title, department, category, body_markdown, and version.
Include suggested_tasks only when follow-up work is needed before approval.
${sharedJsonInstructions}
`
  },
  {
    key: "weekly_report",
    title: "Weekly Report",
    description: "Draft a weekly operations report from tasks, issues, assets, forms, checklist runs, and recent Vaeroex results.",
    actionLabel: "Draft weekly report",
    promptPlaceholder: "Optional reporting focus or date range notes.",
    saveTargets: ["report", "tasks"],
    instructions: `
Generate a weekly operations report using the report structure from the Vaeroex system prompt.
Return the report in report with title, report_type, body_markdown, date_range_start, and date_range_end when inferable.
Include suggested_tasks for the most important next actions.
${sharedJsonInstructions}
`
  },
  {
    key: "daily_summary",
    title: "Daily Summary",
    description: "Summarize today's operational activity, risks, open work, and recommended manager actions.",
    actionLabel: "Draft daily summary",
    promptPlaceholder: "Optional shift, team, location, or day-specific notes.",
    saveTargets: ["report", "tasks"],
    instructions: `
Generate a concise daily operations summary.
Return the summary as a report draft in report with report_type "Daily Summary".
Include blockers, open work, risks, and suggested manager actions.
${sharedJsonInstructions}
`
  },
  {
    key: "bottleneck_detector",
    title: "Bottleneck Detector",
    description: "Find recurring blockers, ownership gaps, process breakdowns, and likely fixes.",
    actionLabel: "Find bottlenecks",
    promptPlaceholder: "Optional area to inspect, such as dispatch, intake, onboarding, customer follow-up, or assets.",
    saveTargets: ["tasks", "report"],
    instructions: `
Analyze workspace context for bottlenecks and repeated operational failures.
Return bottlenecks as an array with name, evidence, impact, root_cause, recommended_system, and priority.
Return a report draft when the analysis is substantial.
Include suggested_tasks for fixes that should be assigned.
${sharedJsonInstructions}
`
  },
  {
    key: "form_builder",
    title: "Form Builder",
    description: "Draft an operational form with recommended fields, required fields, follow-up rules, and dashboard metrics.",
    actionLabel: "Draft form",
    promptPlaceholder: "What should this form collect?",
    saveTargets: ["form", "tasks"],
    instructions: `
Generate a form draft using the form structure from the Vaeroex system prompt.
Return the form in form with name, description, form_type, fields, required_fields, suggested_follow_up_actions, and suggested_dashboard_metrics.
Each field must include label, key, type, and required.
Include suggested_tasks only when rollout or review work is needed.
${sharedJsonInstructions}
`
  },
  {
    key: "checklist_builder",
    title: "Checklist Builder",
    description: "Draft a recurring checklist with frequency, owner role, completion rules, and escalation rules.",
    actionLabel: "Draft checklist",
    promptPlaceholder: "What recurring work should this checklist control?",
    saveTargets: ["checklist", "tasks"],
    instructions: `
Generate a checklist draft using the checklist structure from the Vaeroex system prompt.
Return the checklist in checklist with name, description, category, frequency, assigned_role, items, completion_standard, missed_standard, and escalation_rules.
Include suggested_tasks only when rollout or review work is needed.
${sharedJsonInstructions}
`
  },
  {
    key: "follow_up",
    title: "Follow-Up",
    description: "Turn submissions, issues, audit notes, or loose operational concerns into accountable next steps.",
    actionLabel: "Draft follow-ups",
    promptPlaceholder: "What needs follow-up?",
    saveTargets: ["tasks"],
    instructions: `
Generate concrete follow-up tasks from the user's request and workspace context.
Each suggested task must include title, description, priority, category, due_date_recommendation, and reason_this_matters.
Keep tasks specific enough for a manager to assign.
${sharedJsonInstructions}
`
  },
  {
    key: "file_analysis",
    title: "File Analysis",
    description: "Review uploaded file content and turn it into plain-language trends, KPI ideas, risks, and executive summaries.",
    actionLabel: "Analyze file",
    promptPlaceholder: "What trends, KPIs, problems, and executive summary should Vaeroex pull from this file?",
    saveTargets: ["tasks", "report"],
    instructions: `
Analyze the uploaded file content and workspace context. The file may be parsed spreadsheet rows, extracted PDF text, or extracted DOCX text.
Return a polished business-owner-friendly result with executive_summary, extracted_findings, kpis_found, risks, operational_issues, recommended_actions, suggested_systems, and response_markdown.
Compare the new file against prior KPI history, file imports, CRM lead history, and operational metrics when those are available.
Call out trends over time, anomalies, bottlenecks, KPIs worth tracking, operational problems that stand out, possible data quality concerns, and practical next steps.
Do not repeat raw rows, long document excerpts, or technical JSON in the user-facing answer.
For report-style answers, use these visible sections: Executive Summary, Extracted Findings, KPIs Found, Risks, Operational Issues, Recommended Actions, Source File.
If the file suggests follow-up work, include suggested_tasks for manager review.
${sharedJsonInstructions}
`
  }
];

export function getVaeroexWorkflow(key: string | null | undefined) {
  return VAEROEX_WORKFLOWS.find((workflow) => workflow.key === key) ?? VAEROEX_WORKFLOWS[0];
}
