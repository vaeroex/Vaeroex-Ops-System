import type { Route } from "next";
import { VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";

export type HelpCategory =
  | "Getting Started"
  | "Operations Intelligence"
  | "Executive Intelligence"
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
  "Executive Intelligence",
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
    summary: "Vaeroex is an Intelligence Systems company.",
    what: "Vaeroex builds intelligence systems that transform business information into visibility, awareness, prediction, and executive action.",
    why: "Organizations often have many signals but limited structure for understanding what is happening, why it matters, what may happen next, and what action should follow.",
    when: "Use this guide when you want the company-level explanation before learning the current Operations Intelligence product.",
    workflow: ["Understand the Vaeroex company mission", "Review Operations Intelligence as the flagship product", "Open Trust Center before uploading data", "Use support or contact channels when needed"],
    mistakes: ["Treating Vaeroex as only one product screen", "Assuming outputs replace judgment", "Uploading regulated sensitive data"],
    nextLabel: "View platform",
    nextHref: "/",
    related: ["Operations Intelligence", "Business Memory", "Trust Center"]
  }),
  article({
    id: "intelligence-platform",
    category: "Getting Started",
    title: "What is an Executive Intelligence platform?",
    summary: "A platform that turns trusted business information into evidence-backed understanding and executive decision support.",
    what: "An Executive Intelligence platform connects business facts, historical context, risks, opportunities, and explainable recommendations so leaders can make better-informed decisions.",
    why: "Information alone is not intelligence. Intelligence requires context, awareness, prediction, and a path to action.",
    when: "Use this guide when you want to understand the category that Operations Intelligence represents.",
    workflow: ["Connect business information", "Build trusted understanding", "Identify meaningful patterns", "Apply executive reasoning", "Support decisions"],
    mistakes: ["Tracking too many metrics at once", "Treating outputs as certainty", "Ignoring stale records"],
    nextLabel: "Explore platform",
    nextHref: "/",
    related: ["Information", "Visibility", "Awareness", "Prediction", "Action"]
  }),
  article({
    id: "operations-intelligence-suite",
    category: "Getting Started",
    title: "What is Operations Intelligence?",
    summary: "Vaeroex's flagship Executive Intelligence platform for Business Health, Intelligence, Explain Finding, Evidence, and Saved Analyses.",
    what: "Operations Intelligence connects trusted business information with deterministic intelligence and advanced executive reasoning.",
    why: "It helps leaders understand current conditions, meaningful change, risk, opportunity, and what deserves attention next.",
    when: "Use it when leadership needs a clearer operating view, KPI context, focused explanations, and evidence-backed decision support.",
    workflow: ["Add business evidence", "Review Business Health", "Open prioritized Intelligence", "Explain a supported finding", "Save useful analyses"],
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
    when: "Use this mindset when reviewing KPIs, Evidence, Business Health, Intelligence, and Saved Analyses.",
    workflow: ["Choose one visibility gap", "Add evidence", "Review the pattern", "Open a focused analysis if needed", "Revisit the result"],
    mistakes: ["Trying to perfect every workflow before starting", "Treating one signal as the whole picture", "Using saved analysis without review"],
    nextLabel: "Open Intelligence",
    nextHref: "/app/intelligence",
    related: ["Operations Intelligence", "Visibility", "Action"]
  }),
  article({
    id: "visibility-accountability-execution",
    category: "Getting Started",
    title: "Understanding Visibility, Awareness, Prediction, and Action",
    summary: "The company-level pillars behind Vaeroex.",
    what: "Visibility shows what is happening. Awareness connects context, risk, and meaning. Prediction identifies supported directional change. Action helps leadership decide what to focus on next.",
    why: "Business information becomes more useful when leaders can see it, understand it, anticipate supported change, and act on it.",
    when: "Use these pillars when reviewing Vaeroex as an Intelligence Systems company.",
    workflow: ["Find the signal", "Understand the context", "Assess risk or opportunity", "Choose a response", "Measure the outcome"],
    mistakes: ["Collecting information without interpretation", "Stopping at awareness without action", "Treating outputs as guaranteed"],
    nextLabel: "View platform",
    nextHref: "/",
    related: ["Information", "Prediction", "Leadership Review"]
  }),
  ...[
    ["creating-workspace", "Creating your workspace", "Set up the organization context Vaeroex uses for workspace intelligence.", "/app/setup"],
    ["dashboard", "Understanding the dashboard", "Use the dashboard to see business health, risks, opportunities, and priorities.", "/app"],
    ["first-kpi", "Creating your first KPI", "Start with a small set of metrics that actually drive decisions.", "/app/kpis"],
    ["first-report", "Saving your first analysis", "Preserve a completed Business Health analysis or Finding Explanation for later review.", "/app/reports"],
    ["first-follow-up", "Uploading your first Evidence source", "Add current business information through the existing Evidence upload flow.", "/app/sources"],
    ["first-sop", "Creating your first SOP", "Document the process that should happen the same way each time.", "/app/sops"],
    ["report-subscriptions", "Understanding Saved Analyses", "Saved Analyses contains only completed intelligence your team explicitly chose to preserve.", "/app/reports"],
    ["leadership-team", "How to use Vaeroex as a leadership team", "Use Saved Analyses, roles, and reviews to run a clearer management rhythm.", "/app/people"]
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
    ["business-memory", "Business Memory", "Relevant historical context from imports, decisions, recommendations, and outcomes.", "/app"],
    ["profit-leak-detector", "Profit Leak Detector", "A review of revenue and opportunity leakage signals.", "/app"],
    ["focus-on", "What Should Leadership Review?", "A prioritized list of evidence-backed topics to review.", "/app"],
    ["reports", "Saved Analyses", "A workspace-scoped library of completed analyses your team explicitly saved.", "/app/reports"],
    ["kpis", "KPIs", "Time-series metrics with targets, trend context, and evidence.", "/app/kpis"],
    ["crm", "Customer Activity Evidence", "Customer activity used as evidence for risk, opportunity, and revenue trends.", "/app/sources"],
    ["files-imports", "Evidence", "Upload files, review source findings, and approve structured imports.", "/app/sources"],
    ["sop-library", "SOP Library", "A place to store, review, and improve working procedures.", "/app/sops"],
    ["issues", "Issues", "A place to log risks, problems, root causes, and recommended fixes.", "/app/issues"],
    ["checklists", "Checklists", "Repeatable review lists for recurring work and quality checks.", "/app/checklists"],
    ["assets", "Assets", "Tracked equipment, tools, locations, readiness, and status checks.", "/app/assets"],
    ["people", "Organization Context", "People, roles, and departments used as context for intelligence and evidence.", "/app/people"],
    ["team-roles", "Workspace Roles", "Workspace access roles that control what users can view or manage.", "/app/people"],
    ["report-sharing", "Saved Analysis Review", "Preserve completed analysis context in workspace history.", "/app/reports"],
    ["report-scheduling", "Saved Analysis History", "Open prior saved analyses without regenerating or rewriting their content.", "/app/reports"],
    ["vaeroex-ai", "Ask Vaeroex", "Ask focused business questions using current workspace context.", "/app/ask"]
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
      related: ["Saved Analyses", "Search", "Executive Intelligence"]
    })
  ),
  ...[
    ["vaeroex-can-do", "What Vaeroex can do", "Summarize, compare, explain, recommend, and help turn workspace context into leadership understanding."],
    ["vaeroex-cannot-do", "What Vaeroex cannot do", "Vaeroex cannot replace human judgment or professional legal, medical, financial, tax, employment, compliance, safety, or management advice."],
    ["workspace-context", "How Vaeroex uses workspace context", "Vaeroex can reference current records, counts, trends, Evidence, and historical business context when producing intelligence."],
    ["recommendations-generated", "How recommendations are generated", "Recommendations are based on available context and should be treated as drafts for review."],
    ["predictive-insights", "What are Predictive Insights?", "Predictive insights are directional signals that may surface emerging risks, performance changes, and patterns that deserve review."],
    ["decision-support", "What is Decision Support?", "Decision support helps translate workspace context into evidence-backed review points and recommended leadership decisions."],
    ["human-review-required", "What does Human Review mean?", "Outputs may be incomplete or unsuitable, so users must review before acting or saving generated records."],
    ["insight-to-action", "How does Vaeroex support action?", "Vaeroex turns supported findings into clear leadership considerations while keeping final decisions under human control."],
    ["turn-into-records", "Saving analyses", "Users can review completed Business Health or Finding Explanation analyses before preserving them in Saved Analyses."],
    ["health-score-general", "How Business Health Score is calculated generally", "The score is directional and based on available KPI, customer activity, issue, organization, and source evidence."],
    ["profit-leak-general", "How Profit Leak Detector works generally", "Vaeroex looks for revenue and opportunity signals such as stalled customer activity, missed targets, response delays, and weak source evidence."],
    ["business-memory-general", "How Business Memory works", "Vaeroex uses prior imports, decisions, source analyses, and outcomes as historical context."],
    ["focus-priorities", "How \"What Should I Focus On?\" works", "Vaeroex prioritizes visible evidence, risk, urgency, and business impact."],
    ["risk-detection", "How risk detection works", "Risk signals are directional indicators from open issues, overdue work, missed targets, stale procedures, and weak data."]
  ].map(([id, title, summary]) =>
    article({
      id,
      category: "Executive Intelligence",
      title,
      summary,
      what: summary,
      why: "Vaeroex recommendations are advisory operations intelligence, not automatic decisions.",
      when: "Use Vaeroex when you want a structured second look at workspace activity.",
      workflow: ["Ask a specific question", "Review the evidence", "Edit the recommendation if needed", "Save only useful outputs", "Compare results over time"],
      mistakes: ["Treating output as guaranteed", "Skipping human review", "Uploading sensitive data"],
      nextLabel: "Ask Vaeroex",
      nextHref: "/app/ask",
      related: ["AI Disclaimer", "Human Review Notice", "Sensitive Data Policy"]
    })
  ),
  ...[
    ["how-many-kpis", "How many KPIs should I track?", "Start with 5 to 10 meaningful metrics before adding more."],
    ["sop-review", "How often should SOPs be reviewed?", "Review critical SOPs at least quarterly and update them after recurring issues."],
    ["weekly-meeting", "How to run a weekly leadership review", "Use KPIs, open risks, Evidence, and Saved Analyses to keep the conversation focused."],
    ["report-subscription-practice", "How to use Saved Analyses", "Save only completed analyses leadership will need to revisit, then review them alongside current intelligence."],
    ["accountability-roles", "How to use roles as context", "Use roles and departments as context for evidence and intelligence while keeping operational execution in your existing systems."],
    ["monthly-performance", "How to review business performance monthly", "Compare KPI trends, revenue, customer activity, issues, SOP changes, and decisions."],
    ["ceo-use", "How to use Vaeroex as a CEO", "Focus on health score, risks, priorities, business memory, and decisions."],
    ["director-use", "How to use Vaeroex as a Director", "Review scorecards, bottlenecks, evidence, and cross-functional patterns."],
    ["manager-use", "How to use Vaeroex as a Manager", "Review signals, issues, checklists, and source evidence for clearer operating context."],
    ["supervisor-use", "How to use Vaeroex as a Supervisor", "Use source evidence to preserve what leadership should know."],
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
      mistakes: ["Overcomplicating the system", "Creating noisy records", "Letting stale records pile up"],
      nextLabel: "Open dashboard",
      nextHref: "/app",
      related: ["Saved Analyses", "KPIs", "Business Health Score"]
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
    workflow: ["Review Business Health", "Review current Intelligence", "Open supporting evidence", "Save a completed analysis when leadership should revisit it"],
    mistakes: ["Ignoring stale data", "Treating a score as a guarantee", "Skipping evidence review"],
    related: ["Business Health Score", "Saved Analyses", "Executive Intelligence"]
  },
  files: {
    what: "Evidence stores business documents and imports by workspace so Vaeroex can build trusted business understanding from approved data.",
    workflow: ["Select a source", "Analyze or import", "Review mappings", "Approve saved data", "Use supported results in live analyses"],
    mistakes: ["Uploading sensitive data", "Treating an incomplete file as sufficient evidence", "Skipping import review"],
    related: ["Evidence", "Sensitive Data Policy", "Saved Analyses"]
  },
  reports: {
    what: "Saved Analyses stores completed Business Health and Explain Finding analyses that a workspace member explicitly chose to preserve.",
    workflow: ["Review a completed live analysis", "Choose Save Analysis", "Search or filter Saved Analyses", "Open the copied analysis when needed"],
    mistakes: ["Assuming a legacy generated report is an exact saved analysis", "Overlooking freshness", "Skipping evidence review"],
    related: ["Business Health Score", "Explain Finding", "Evidence"]
  },
  kpis: {
    what: "KPIs track the numbers that help leadership decide what needs attention.",
    workflow: ["Create a KPI", "Set target", "Add values over time", "Review trends", "Review the source evidence"],
    mistakes: ["Tracking too many KPIs", "No targets", "No source context"],
    related: ["Evidence", "Saved Analyses", "Business Health Score"]
  },
  crm: {
    what: "Customer activity evidence helps Vaeroex understand revenue, conversion, response speed, and opportunity signals.",
    workflow: ["Add customer activity evidence", "Review status", "Review conversion", "Compare against revenue"],
    mistakes: ["Stale customer status", "Missing source", "Treating one customer sample as complete history"],
    related: ["Profit Leak Detector", "KPIs", "Saved Analyses"]
  },
  analysis: {
    what: "Use Intelligence for structured analysis and Search to locate workspace records.",
    workflow: ["Open Intelligence", "Choose a supported finding", "Review evidence", "Save a completed analysis when useful"],
    mistakes: ["Treating output as professional advice", "Skipping review", "Uploading sensitive data"],
    related: ["AI Disclaimer", "Human Review Notice", "Sensitive Data Policy"]
  },
  default: {
    what: "This page helps organize business evidence for visibility, context, and leadership review.",
    workflow: ["Review existing records", "Add only useful information", "Use Intelligence or Saved Analyses to review patterns"],
    mistakes: ["Creating duplicate records", "Leaving stale information", "Skipping human review"],
    related: ["Help Center", "Trust Center", "Support"]
  }
};
