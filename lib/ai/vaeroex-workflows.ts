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
      "suggested_owner": "Role or person who should own it",
      "due_date_recommendation": "Short recommendation",
      "reason_this_matters": "Why this action matters",
      "related_module": "Tasks | KPIs | CRM | SOPs | Checklists | Forms | Reports | Files | Issues | Assets | People"
    }
  ],
  "recommended_actions": [
    {
      "title": "Action title",
      "priority": "Low | Medium | High | Urgent",
      "suggested_owner": "Role or person who should own it",
      "suggested_due_date": "Specific date or timing",
      "why_it_matters": "Business reason in plain language",
      "related_module": "Tasks | KPIs | CRM | SOPs | Checklists | Forms | Reports | Files | Issues | Assets | People"
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
    "Convert Insight Into Action",
    "Operational Risk",
    "Dashboard / KPI Improvement",
    "CRM / Revenue Improvement",
    "SOP / Process Improvement",
    "File / Report Follow-up"
  ],
  "save_recommendations": ["Records the user may confirm and save"]
}
Every output that could become a record must be a draft for manager review. Do not imply it has already been saved.
Every recommendation must be actionable. Include title, priority, suggested owner, suggested due date, why it matters, and related module.
`;

const workspaceAwareInstructions = `
Workspace-aware recommendation rules:
- First inspect workspace_context.module_state, workspace_context.metrics, workspace_context.workspace_gaps, and recent records.
- Do not recommend creating a module that already exists in Vaeroex. Built-in modules include Executive Dashboard, KPI Dashboard, CRM Pipeline, Tasks, Issues, Checklists, SOP Library, Reports, Files, Forms, Assets, People, and Vaeroex Results.
- If a module exists, recommend improving, completing, reviewing, converting, assigning, or using the existing module.
- Never say "Create KPI Dashboard", "Create CRM", "Create task tracking", "Create SOPs", "Create reports", or "Upload files" as generic advice.
- Prefer recommendations like "add weekly revenue and conversion KPIs to the existing KPI Dashboard", "add lead source and next-follow-up to the existing CRM Pipeline", or "assign owners and review cadence to existing SOPs".
- Every recommendation should mention what exists, what is missing or stale, why it matters, and the next practical action.
- Classify recommendations into the recommendation_categories listed in the JSON shape.
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
${workspaceAwareInstructions}
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
${workspaceAwareInstructions}
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
Use existing SOP records from workspace_context.sops to avoid duplicating procedure names or recommending a new SOP Library.
${workspaceAwareInstructions}
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
${workspaceAwareInstructions}
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
${workspaceAwareInstructions}
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
Recommend using or improving existing tasks, issues, checklists, SOPs, reports, KPIs, files, and CRM records before suggesting new structures.
${workspaceAwareInstructions}
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
Review workspace_context.forms before recommending a new form so you can suggest improving an existing form when appropriate.
${workspaceAwareInstructions}
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
Review workspace_context.checklists and checklist_runs before recommending a new checklist so you can suggest improving or running an existing checklist when appropriate.
${workspaceAwareInstructions}
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
Use existing tasks, issues, file analyses, reports, CRM records, KPIs, and SOPs as evidence for the follow-up tasks.
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
    saveTargets: ["tasks", "report"],
    instructions: `
Analyze the uploaded file content and workspace context. The file may be parsed spreadsheet rows, extracted PDF text, extracted DOCX text, a PDF file attached directly for document reading, or a PNG/JPG image attached for OCR and visual analysis.
Return a polished business-owner-friendly result with executive_summary, extracted_text, extracted_findings, kpis_found, risks, operational_issues, recommended_actions, suggested_systems, and response_markdown.
For images, perform OCR when readable text is visible and also describe relevant visual business context, visible problems, risks, or operational clues.
For PDFs attached directly, extract readable text when possible and explain clearly if the PDF appears scanned, image-based, locked, corrupted, or otherwise unreadable.
Compare the new file against prior KPI history, file imports, CRM lead history, and operational metrics when those are available.
Call out trends over time, anomalies, bottlenecks, KPIs worth tracking, operational problems that stand out, possible data quality concerns, and practical next steps.
Do not repeat raw rows, long document excerpts, or technical JSON in the user-facing answer.
For report-style answers, use these visible sections: Executive Summary, Extracted Findings, KPIs Found, Risks, Operational Issues, Recommended Actions, Source File.
If the file suggests follow-up work, include suggested_tasks for manager review.
If the file suggests KPIs, tasks, reports, or CRM records, reference existing Vaeroex modules and records first. Say "add these KPI records to the existing KPI Dashboard", "attach this analysis to an existing report", "convert these recommendations into tasks", or "update existing CRM records" when workspace context supports it.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "ceo_mode",
    title: "If I Were the CEO",
    description: "Executive language for what the owner should do next across revenue, risk, accountability, customer experience, operations, and execution.",
    actionLabel: "Ask CEO view",
    promptPlaceholder: "Optional context, such as this week, this month, or a weak KPI.",
    saveTargets: ["tasks", "report"],
    instructions: `
Answer as Vaeroex in executive language. Prioritize revenue, risk, team accountability, customer experience, operations, process health, and execution.
Return only the few actions an owner should seriously consider this week.
Include suggested_tasks for actions the user may approve.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "focus_priorities",
    title: "What Should I Focus On?",
    description: "Find the top 3-5 priorities that matter most right now, with evidence and suggested ownership.",
    actionLabel: "Find focus",
    promptPlaceholder: "Optional focus area, such as this week, Sales, Operations, or Customer Service.",
    saveTargets: ["tasks"],
    instructions: `
Scan workspace KPIs, CRM, tasks, issues, reports, SOPs, files, alerts, assignments, and checklist completion.
Return only the top 3-5 priorities. Each priority must include title, why it matters, evidence, recommended owner, recommended due date, and suggested action.
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
    saveTargets: ["tasks", "report"],
    instructions: `
Analyze declining KPIs, overdue work, repeated issues, stale SOPs, CRM weakness, checklist misses, and open risks.
Return predicted risks, why each may happen, evidence, prevention action, suggested owner, and suggested due date.
Include suggested_tasks for prevention actions.
${workspaceAwareInstructions}
${sharedJsonInstructions}
`
  },
  {
    key: "weekly_management_meeting",
    title: "Weekly Management Meeting",
    description: "Generate a practical weekly meeting agenda, summary, decisions needed, and assignments for next week.",
    actionLabel: "Run meeting mode",
    promptPlaceholder: "Optional team or department focus.",
    saveTargets: ["tasks", "report"],
    instructions: `
Generate an operations meeting workflow with these sections: KPI review, CRM pipeline review, open issues, overdue tasks, checklist compliance, SOP review, department risks, Vaeroex recommendations, decisions needed, and assignments for next week.
Do not build video or chat. This is an operations meeting agenda and follow-up workflow.
Include a report draft and suggested_tasks.
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
    saveTargets: ["report", "tasks"],
    instructions: `
Prepare a polished Business Review Package with executive summary, KPI trends, revenue and lead trends, operational risks, corrective actions, progress since last period, open decisions, completed actions, and recommended next steps.
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
