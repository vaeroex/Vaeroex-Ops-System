import type { Route } from "next";
import { VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";

export type HelpCategory =
  | "Getting Started"
  | "Operations Intelligence"
  | "AI & Vaeroex"
  | "Best Practices"
  | "Legal & Compliance"
  | "Trust Center"
  | "Release Notes"
  | "Contact Support";

export type HelpArticle = {
  id: string;
  category: HelpCategory;
  title: string;
  summary: string;
  what: string;
  why: string;
  when: string;
  workflow: string[];
  mistakes: string[];
  nextLabel: string;
  nextHref: Route;
  related: string[];
};

export const helpCategories: HelpCategory[] = [
  "Getting Started",
  "Operations Intelligence",
  "AI & Vaeroex",
  "Best Practices",
  "Legal & Compliance",
  "Trust Center",
  "Release Notes",
  "Contact Support"
];

function article(input: HelpArticle): HelpArticle {
  return input;
}

export const helpArticles: HelpArticle[] = [
  article({
    id: "what-is-vaeroex",
    category: "Getting Started",
    title: "What is Vaeroex?",
    summary: "Vaeroex is an Operations Intelligence Platform.",
    what: "Vaeroex helps organizations turn information into visibility, awareness, prediction, and action.",
    why: "Organizations often have many signals but limited structure for understanding what is happening, why it matters, what may happen next, and what action should follow.",
    when: "Use this guide when you want the company-level explanation before learning the current Operations Intelligence product.",
    workflow: ["Understand the Vaeroex intelligence model", "Review Operations Intelligence as the current product", "Open Trust Center before uploading data", "Use support or contact channels when needed"],
    mistakes: ["Treating Vaeroex as only one product screen", "Assuming outputs replace judgment", "Uploading regulated sensitive data"],
    nextLabel: "View platform",
    nextHref: "/",
    related: ["Operations Intelligence", "Business Memory", "Trust Center"]
  }),
  article({
    id: "intelligence-platform",
    category: "Getting Started",
    title: "What is an Operations Intelligence Platform?",
    summary: "A system that helps preserve business context, identify patterns, surface risk, and support better leadership decisions.",
    what: "An Operations Intelligence Platform connects information, historical context, risk signals, and recommendations so leaders can make better-informed decisions.",
    why: "Information alone is not intelligence. Intelligence requires context, awareness, prediction, and a path to action.",
    when: "Use this guide when you want to understand Vaeroex beyond the current Operations Intelligence product.",
    workflow: ["Capture signals", "Preserve context", "Identify patterns", "Surface risk", "Support decisions"],
    mistakes: ["Tracking too many metrics at once", "Treating outputs as certainty", "Ignoring stale records"],
    nextLabel: "Explore platform",
    nextHref: "/",
    related: ["Information", "Visibility", "Awareness", "Prediction", "Action"]
  }),
  article({
    id: "operations-intelligence-suite",
    category: "Getting Started",
    title: "What is Operations Intelligence?",
    summary: "The Vaeroex product for operational visibility, Business Memory, evidence-backed recommendations, and decision support.",
    what: "Operations Intelligence analyzes business evidence such as KPIs, files, reports, customer activity evidence, Business Signals, issues, and historical memory.",
    why: "It helps organizations understand operating signals, performance, risk, opportunity, and what leadership should review next.",
    when: "Use it when the organization needs clearer operations review, recurring reports, KPI trends, risk detection, and leadership context.",
    workflow: ["Add or import evidence", "Review Business Health", "Use reports and briefings", "Review recommendations", "Compare results over time"],
    mistakes: ["Expecting automatic decisions", "Skipping human review", "Treating limited data as complete"],
    nextLabel: "Learn more",
    nextHref: "/operations-intelligence",
    related: ["Business Health Score", "Profit Leak Detection", "Recommendation Tracking"]
  }),
  article({
    id: "build-the-structure",
    category: "Getting Started",
    title: "The structure your growth depends on",
    summary: "Vaeroex helps leaders understand where business structure is strong, weak, or missing.",
    what: "The slogan means growth depends on reliable context: clear evidence, historical memory, meaningful metrics, and reviewed recommendations.",
    why: "Without structure, growth creates more noise, slower decisions, stale information, and unclear priorities.",
    when: "Use this mindset when reviewing KPIs, Business Signals, files, reports, and briefings.",
    workflow: ["Choose one visibility gap", "Add evidence", "Review the pattern", "Generate a brief if needed", "Revisit the result"],
    mistakes: ["Trying to perfect every workflow before starting", "Treating one signal as the whole picture", "Using reports without review"],
    nextLabel: "Search or Ask",
    nextHref: "/app?search=1",
    related: ["Operations Intelligence", "Visibility", "Action"]
  }),
  article({
    id: "visibility-accountability-execution",
    category: "Getting Started",
    title: "Understanding Visibility, Awareness, and Action",
    summary: "The company-level pillars behind Vaeroex.",
    what: "Visibility shows what is happening. Awareness connects context, risk, and meaning. Action helps leadership decide what should be reviewed next.",
    why: "Signals become more useful when people can see them, understand them, and act on them.",
    when: "Use these pillars when reviewing Vaeroex as an Operations Intelligence Platform.",
    workflow: ["Find the signal", "Understand the context", "Assess risk or opportunity", "Choose a response", "Measure the outcome"],
    mistakes: ["Collecting information without interpretation", "Stopping at awareness without action", "Treating outputs as guaranteed"],
    nextLabel: "View platform",
    nextHref: "/",
    related: ["Information", "Prediction", "Leadership Review"]
  }),
  ...[
    ["creating-workspace", "Creating your workspace", "Set up the organization context Vaeroex uses for workspace intelligence.", "/app/setup"],
    ["demo-workspace", "Using the demo workspace", "Explore realistic sample data without touching your live workspace.", "/app"],
    ["dashboard", "Understanding the dashboard", "Use the dashboard to see business health, risks, opportunities, and priorities.", "/app"],
    ["first-kpi", "Creating your first KPI", "Start with a small set of metrics that actually drive decisions.", "/app/kpis"],
    ["first-report", "Creating your first report", "Generate a period summary for leadership review.", "/app/reports"],
    ["first-follow-up", "Adding your first Business Signal", "Capture business context Vaeroex can remember and analyze.", "/app/tasks"],
    ["first-sop", "Creating your first SOP", "Document the process that should happen the same way each time.", "/app/sops"],
    ["notifications", "Understanding notifications", "Use unread notifications to see what requires attention now.", "/app/notifications"],
    ["report-subscriptions", "Understanding report subscriptions", "Choose which review summaries should be generated and delivered.", "/app/reports"],
    ["leadership-team", "How to use Vaeroex as a leadership team", "Use shared reports, roles, and reviews to run a clearer management rhythm.", "/app/people"]
  ].map(([id, title, summary, href]) =>
    article({
      id,
      category: "Getting Started",
      title,
      summary,
      what: summary,
      why: "This helps leadership reduce confusion, preserve context, and create a repeatable review rhythm.",
      when: "Use this when the business needs a clearer way to see evidence, review decisions, or understand patterns.",
      workflow: ["Open the related page", "Add only useful context", "Review the result", "Compare changes over time"],
      mistakes: ["Starting with too much detail", "Leaving records stale", "Skipping review dates"],
      nextLabel: "Open related page",
      nextHref: href as Route,
      related: ["Visibility", "Awareness", "Action"]
    })
  ),
  ...[
    ["executive-dashboard", "Executive Dashboard", "A leadership view of business health, signals, risks, and recommended actions.", "/app"],
    ["business-health-score", "Business Health Score", "A directional score built from available workspace signals.", "/app"],
    ["business-memory", "Business Memory", "A history of imports, reports, decisions, recommendations, and outcomes.", "/app"],
    ["profit-leak-detector", "Profit Leak Detector", "A review of revenue and opportunity leakage signals.", "/app"],
    ["focus-on", "What Should Leadership Review?", "A prioritized list of evidence-backed topics to review.", "/app"],
    ["reports", "Reports", "Customer-ready summaries by day, week, month, quarter, year, or year-to-date.", "/app/reports"],
    ["kpis", "KPIs", "Time-series metrics with targets, trend context, and evidence.", "/app/kpis"],
    ["crm", "Customer Activity Evidence", "Customer activity used as evidence for risk, opportunity, and revenue trends.", "/app/sources"],
    ["files-imports", "Files & Imports", "Upload files, extract content, review mappings, and save approved data historically.", "/app/files"],
    ["sop-library", "SOP Library", "A place to store, review, and improve working procedures.", "/app/sops"],
    ["tasks", "Business Signals", "Business observations and events that help Vaeroex build memory and context.", "/app/tasks"],
    ["issues", "Issues", "A place to log risks, problems, root causes, and recommended fixes.", "/app/issues"],
    ["checklists", "Checklists", "Repeatable review lists for recurring work and quality checks.", "/app/checklists"],
    ["assets", "Assets", "Tracked equipment, tools, locations, readiness, and status checks.", "/app/assets"],
    ["people", "Organization Context", "People, roles, and departments used as context for briefings and evidence.", "/app/people"],
    ["team-roles", "Workspace Roles", "Workspace access roles that control what users can view or manage.", "/app/people"],
    ["report-sharing", "Report Sharing", "Share report context through in-app notifications and workspace history.", "/app/reports"],
    ["report-scheduling", "Report Scheduling", "Configure weekly, monthly, quarterly, and alert-driven report preferences.", "/app/reports"],
    ["kpi-alerts", "KPI Alerts", "Create attention signals when important metrics drift from target.", "/app/kpis"],
    ["vaeroex-ai", "Search or Ask", "Search your workspace or ask broad business questions using workspace context.", "/app?search=1"]
  ].map(([id, title, summary, href]) =>
    article({
      id,
      category: "Operations Intelligence",
      title,
      summary,
      what: summary,
      why: "This helps improve operational clarity and reduces the need to chase information across disconnected tools.",
      when: "Use it when leadership needs evidence, context, or a repeatable review point.",
      workflow: ["Open the page", "Review existing evidence first", "Add or update only what is useful", "Use reports or Vaeroex to review patterns"],
      mistakes: ["Creating duplicate records", "Treating incomplete data as complete", "Using stale data without review"],
      nextLabel: "Open feature",
      nextHref: href as Route,
      related: ["Reports", "Search or Ask", "Notifications"]
    })
  ),
  ...[
    ["vaeroex-can-do", "What Vaeroex can do", "Summarize, compare, explain, recommend, and help turn workspace context into leadership understanding."],
    ["vaeroex-cannot-do", "What Vaeroex cannot do", "Vaeroex cannot replace human judgment or professional legal, medical, financial, tax, employment, compliance, safety, or management advice."],
    ["workspace-context", "How Vaeroex uses workspace context", "Vaeroex can reference current records, counts, trends, files, reports, and historical business memory when generating outputs."],
    ["recommendations-generated", "How recommendations are generated", "Recommendations are based on available context and should be treated as drafts for review."],
    ["predictive-insights", "What are Predictive Insights?", "Predictive insights are directional signals that may surface emerging risks, performance changes, and patterns that deserve review."],
    ["decision-support", "What is Decision Support?", "Decision support helps translate workspace context into evidence-backed review points and recommended leadership decisions."],
    ["human-review-required", "What does Human Review mean?", "Outputs may be incomplete or unsuitable, so users must review before acting or saving generated records."],
    ["insight-to-action", "How does Vaeroex support action?", "Vaeroex can turn recommendations into executive briefs, reports, SOP drafts, checklists, or improvement plans after user review."],
    ["turn-into-records", "Saving recommendations", "Users can review recommendations before saving supporting documents or evidence-backed outputs."],
    ["health-score-general", "How Business Health Score is calculated generally", "The score is directional and based on available KPI, customer activity, issue, report, organization, file, and Business Signal evidence."],
    ["profit-leak-general", "How Profit Leak Detector works generally", "Vaeroex looks for revenue and opportunity signals such as stalled customer activity, missed targets, response delays, and weak source evidence."],
    ["business-memory-general", "How Business Memory works", "Vaeroex uses prior imports, reports, decisions, file analyses, and outcomes as historical context."],
    ["ceo-mode", "How \"If I Were the CEO\" should be interpreted", "This is a leadership prompt for thinking, not a command or professional advice."],
    ["focus-priorities", "How \"What Should I Focus On?\" works", "Vaeroex prioritizes visible evidence, risk, urgency, and business impact."],
    ["risk-detection", "How risk detection works", "Risk signals are directional indicators from open issues, overdue work, missed targets, stale procedures, and weak data."]
  ].map(([id, title, summary]) =>
    article({
      id,
      category: "AI & Vaeroex",
      title,
      summary,
      what: summary,
      why: "Vaeroex recommendations are advisory operations intelligence, not automatic decisions.",
      when: "Use Vaeroex when you want a structured second look at workspace activity.",
      workflow: ["Ask a specific question", "Review the evidence", "Edit the recommendation if needed", "Save only useful outputs", "Compare results over time"],
      mistakes: ["Treating output as guaranteed", "Skipping human review", "Uploading sensitive data"],
      nextLabel: "Search or Ask",
      nextHref: "/app?search=1",
      related: ["AI Disclaimer", "Human Review Notice", "Sensitive Data Policy"]
    })
  ),
  ...[
    ["how-many-kpis", "How many KPIs should I track?", "Start with 5 to 10 meaningful metrics before adding more."],
    ["sop-review", "How often should SOPs be reviewed?", "Review critical SOPs at least quarterly and update them after recurring issues."],
    ["weekly-meeting", "How to run a weekly leadership review", "Use KPIs, open risks, Business Signals, and reports to keep the conversation focused."],
    ["quiet-kpi-alerts", "How to use KPI alerts without creating noise", "Use alerts only for metrics that require action when they drift."],
    ["report-subscription-practice", "How to use report subscriptions", "Subscribe to summaries that match the leadership rhythm, then pause what is not useful."],
    ["accountability-roles", "How to use roles as context", "Use roles and departments as context for evidence and briefings while keeping operational execution in your existing systems."],
    ["monthly-performance", "How to review business performance monthly", "Compare KPI trends, revenue, customer activity, issues, SOP changes, and decisions."],
    ["ceo-use", "How to use Vaeroex as a CEO", "Focus on health score, risks, priorities, business memory, and decisions."],
    ["director-use", "How to use Vaeroex as a Director", "Review scorecards, bottlenecks, evidence, and cross-functional patterns."],
    ["manager-use", "How to use Vaeroex as a Manager", "Review signals, issues, checklists, and source evidence for clearer operating context."],
    ["supervisor-use", "How to use Vaeroex as a Supervisor", "Use Business Signals and source evidence to preserve what leadership should know."],
    ["clean-data", "How to keep data clean", "Use clear names, dates, categories, and notes that another leader can understand."],
    ["avoid-sensitive-data", "How to avoid uploading sensitive data", "Keep Vaeroex focused on operational business records and avoid regulated sensitive records."]
  ].map(([id, title, summary]) =>
    article({
      id,
      category: "Best Practices",
      title,
      summary,
      what: summary,
      why: "Good operating habits make Vaeroex more useful and reduce confusion.",
      when: "Use this guidance when building your leadership rhythm or cleaning up workspace records.",
      workflow: ["Pick one habit", "Apply it for one week", "Review the result", "Update the evidence", "Document what changed"],
      mistakes: ["Overcomplicating the system", "Creating noisy alerts", "Letting stale records pile up"],
      nextLabel: "Open dashboard",
      nextHref: "/app",
      related: ["Reports", "KPIs", "Notifications"]
    })
  ),
  ...[
    ["terms-guide", "Terms of Service", "The main customer terms for using Vaeroex.", "/terms"],
    ["privacy-guide", "Privacy Policy", "How Vaeroex may collect, use, process, and share information.", "/privacy"],
    ["acceptable-use-guide", "Acceptable Use Policy", "Rules for safe and responsible platform use.", "/acceptable-use"],
    ["refund-guide", "Refund Policy", "How cancellation and refund handling works.", "/refund-policy"],
    ["ai-disclaimer-guide", "AI Disclaimer", "How to interpret Vaeroex-generated recommendations safely.", "/ai-disclaimer"],
    ["sensitive-guide", "Sensitive Data Policy", "What not to upload or enter unless proper controls exist.", "/sensitive-data-policy"],
    ["billing-guide", "Subscription & Billing Terms", "How Vaeroex subscription access, billing requests, and promotions work.", "/subscription-billing-terms"],
    ["retention-guide", "Data Retention Notice", "General retention expectations for account, workspace, support, and audit records.", "/data-retention"],
    ["human-review-guide", "Human Review Notice", "Why users remain responsible for reviewing outputs and decisions.", "/human-review"]
  ].map(([id, title, summary, href]) =>
    article({
      id,
      category: "Legal & Compliance",
      title,
      summary,
      what: summary,
      why: "Clear policy language reduces confusion and helps customers understand responsibilities.",
      when: "Review before launch, onboarding, using Vaeroex recommendations, uploading files, or handling sensitive information.",
      workflow: ["Open the policy", "Review customer responsibilities", "Confirm the use case is appropriate", `Contact ${VAEROEX_CONTACT_EMAILS.support} with questions`],
      mistakes: ["Assuming certifications that are not stated", "Entering prohibited sensitive data", "Using recommendations without review"],
      nextLabel: "Open policy",
      nextHref: href as Route,
      related: ["Trust Center", "Human Review Notice", "Sensitive Data Policy"]
    })
  ),
  article({
    id: "trust-center",
    category: "Trust Center",
    title: "Trust Center",
    summary: "Workspace isolation, role-based access, admin security, AI safety, and customer data responsibilities.",
    what: "The Trust Center explains how Vaeroex is designed to keep customer workspaces separated and reviewed.",
    why: "Customers need careful, plain-English security and responsibility language without unsupported compliance claims.",
    when: "Use it before onboarding customers, inviting staff, uploading files, or asking security questions.",
    workflow: ["Review workspace isolation", "Assign roles carefully", "Avoid sensitive data", "Use human review", `Contact ${VAEROEX_CONTACT_EMAILS.support} for trust questions`],
    mistakes: ["Assuming absolute security claims", "Inviting the wrong role", "Mixing demo data and live data"],
    nextLabel: "Open Trust Center",
    nextHref: "/app/help/trust",
    related: ["Privacy Policy", "Sensitive Data Policy", "Human Review Notice"]
  }),
  article({
    id: "release-notes",
    category: "Release Notes",
    title: "Release Notes",
    summary: "A customer-friendly history of product improvements without internal commit details.",
    what: "Release notes show meaningful feature additions, improvements, security updates, and bug fixes.",
    why: "They help customers see Vaeroex is maintained and improving.",
    when: "Review after updates, during onboarding, or before inviting more team members.",
    workflow: ["Open release notes", "Review changes by date", "Share relevant updates", `Contact ${VAEROEX_CONTACT_EMAILS.support} with questions`],
    mistakes: ["Using release notes as legal guarantees", "Expecting internal implementation details"],
    nextLabel: "Open release notes",
    nextHref: "/app/help/release-notes",
    related: ["Help Center", "Trust Center"]
  }),
  article({
    id: "contact-support",
    category: "Contact Support",
    title: "Contact Support",
    summary: "Submit support, bug, feature, confusion, billing, or subscription questions.",
    what: `Support requests route questions to Vaeroex for review. Support questions can also be sent to ${VAEROEX_CONTACT_EMAILS.support}; billing, subscription, and payment questions can be sent to ${VAEROEX_CONTACT_EMAILS.billing}.`,
    why: "A clear support path reduces confusion and helps improve the platform.",
    when: `Use support for bugs, confusing workflows, feature requests, or account access issues. Use ${VAEROEX_CONTACT_EMAILS.billing} for billing, subscription, and payment questions.`,
    workflow: ["Open support", "Choose issue type", "Include page/module", "Explain the problem", "Submit the request or email the right Vaeroex alias"],
    mistakes: ["Including regulated sensitive data", "Submitting unclear workspace references", "Leaving out the page where the issue happened"],
    nextLabel: "Submit support request",
    nextHref: "/app/support",
    related: ["Trust Center", "Sensitive Data Policy"]
  })
];

export function articlesByCategory(category: HelpCategory) {
  return helpArticles.filter((article) => article.category === category);
}

export function searchHelpArticles(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return helpArticles;

  return helpArticles.filter((article) =>
    [article.title, article.summary, article.what, article.why, article.when, ...article.workflow, ...article.mistakes, ...article.related]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );
}

export const contextualHelp: Record<string, { what: string; workflow: string[]; mistakes: string[]; related: string[] }> = {
  dashboard: {
    what: "The dashboard summarizes business health, KPI signals, risks, opportunities, and recommended leadership reviews.",
    workflow: ["Review Business Health", "Check alerts", "Open supporting evidence", "Generate a report if leadership needs a summary"],
    mistakes: ["Ignoring stale data", "Treating a score as a guarantee", "Skipping evidence review"],
    related: ["Business Health Score", "Reports", "Search or Ask"]
  },
  files: {
    what: "Files store business documents and imports by workspace so Vaeroex can build historical memory from approved data.",
    workflow: ["Select a file", "Analyze or import", "Review mappings", "Approve saved data", "Use results in reports"],
    mistakes: ["Uploading sensitive data", "Creating reports from empty files", "Skipping import review"],
    related: ["Files & Imports", "Sensitive Data Policy", "Reports"]
  },
  reports: {
    what: "Reports turn workspace records into period summaries, trend comparisons, risks, and recommendations.",
    workflow: ["Choose period", "Select filters", "Generate report", "Review output", "Save or export the summary"],
    mistakes: ["Using reports without checking source data", "Overlooking date range", "Skipping human review"],
    related: ["Report Scheduling", "Human Review Notice", "AI Disclaimer"]
  },
  kpis: {
    what: "KPIs track the numbers that help leadership decide what needs attention.",
    workflow: ["Create a KPI", "Set target", "Add values over time", "Review trends", "Use alerts sparingly"],
    mistakes: ["Tracking too many KPIs", "No targets", "No source context"],
    related: ["KPI Alerts", "Reports", "Business Health Score"]
  },
  crm: {
    what: "Customer activity evidence helps Vaeroex understand revenue, conversion, response speed, and opportunity signals.",
    workflow: ["Add customer activity evidence", "Review status", "Review conversion", "Compare against revenue"],
    mistakes: ["Stale customer status", "Missing source", "Treating one customer sample as complete history"],
    related: ["Profit Leak Detector", "KPIs", "Reports"]
  },
  "ask vaeroex": {
    what: "Use Search or Ask for workspace search and broad business questions using workspace context.",
    workflow: ["Ask a specific question", "Review evidence", "Edit if needed", "Save only useful outputs", "Compare results over time"],
    mistakes: ["Treating output as professional advice", "Skipping review", "Uploading sensitive data"],
    related: ["AI Disclaimer", "Human Review Notice", "Sensitive Data Policy"]
  },
  default: {
    what: "This page helps organize business evidence for visibility, context, and leadership review.",
    workflow: ["Review existing records", "Add only useful information", "Use reports or Vaeroex to review patterns"],
    mistakes: ["Creating duplicate records", "Leaving stale information", "Skipping human review"],
    related: ["Help Center", "Trust Center", "Support"]
  }
};
