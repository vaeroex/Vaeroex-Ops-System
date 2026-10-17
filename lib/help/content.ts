import type { Route } from "next";
import { VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";
import { GOOGLE_SHEETS_PILOT } from "@/lib/integrations/google-sheets/availability";

export type HelpCategory =
  | "Getting Started"
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
    id: "supported-plug-ins",
    category: "Getting Started",
    title: "Connecting your plug-ins",
    summary: "Check what each plug-in can read before using its data in an answer.",
    what: "Supported plug-ins include Square, QuickBooks Online, Zoho Books, and Loyverse. Availability depends on workspace setup and account eligibility. Google Sheets remains a limited pilot; a subscription does not grant pilot access.",
    why: "A connection does not mean Vaeroex has every record, every date, or the other tool’s AI-generated insights. Each plug-in reads a defined set of data.",
    when: "Use this guide before connecting a tool or when an answer is missing expected information.",
    workflow: ["Open the plug-in connections page using the link below.", "Review the provider’s requirements and the data it reads. The workspace owner authorizes supported connections.", "Complete the required account or organization selection and any review steps.", "Check connection status and the available reporting period before using the data.", "If the needed data is unavailable, upload a supported report in Files & Notes or contact support."],
    mistakes: ["Assuming all plug-ins import the same information or history.", "Assuming another system’s AI summaries are automatically imported.", "Treating a connection error or missing period as zero activity."],
    nextLabel: "Open plug-in connections",
    nextHref: "/app/integrations",
    related: ["Google Sheets limited pilot", "Files & Notes", "Business Notes"]
  }),
  article({
    id: "business-notes",
    category: "Getting Started",
    title: "Adding Business Notes",
    summary: "Give Vaeroex the context that numbers alone do not show.",
    what: "Business Notes record goals, decisions, and events such as a closure, staffing change, or supplier change. They help explain the business context alongside your reports.",
    why: "Lower sales during an early closure mean something different from lower sales during normal hours. A dated note helps Vaeroex consider that difference without assuming the cause.",
    when: "Add a note when something happens that may affect your results or priorities.",
    workflow: ["Open Files & Notes and find Business Notes.", "Describe what happened, when it happened, and which part of the business it affected.", "Review any extracted details, dates, and warnings.", "Approve the information when it is accurate and you have permission to do so.", "Correct or archive outdated context when needed."],
    mistakes: ["Treating an opinion as a verified fact.", "Leaving out the date or business location.", "Assuming a note proves why a metric changed."],
    nextLabel: "Open Files & Notes",
    nextHref: "/app/sources",
    related: ["Business Memory", "Vaeroex Super Intelligence", "Human Review"]
  }),
  article({
    id: "check-an-answer",
    category: "Trust Center",
    title: "Checking an answer or adding missing information",
    summary: "Use the evidence to decide whether an answer is ready to act on.",
    what: "VSI uses business evidence and separate calculations to help prevent hallucinated answers. When it lacks enough information, Vaeroex can identify what is missing instead of presenting an unsupported conclusion.",
    why: "A confident explanation or a source link alone does not prove an answer is correct. Data may be incomplete, old, or about a different reporting period.",
    when: "Use this guide if an answer seems wrong, contradicts a report, or asks for more information.",
    workflow: ["Check which workspace and reporting period the question refers to.", "Open the cited sources and compare the dates and figures.", "Add the requested report or Business Note if information is missing.", "Ask Vaeroex to explain the difference using that evidence.", "If the issue continues, contact support with the question and page name. Remove sensitive information from examples."],
    mistakes: ["Repeating the question without checking the underlying data.", "Treating a calculation as proof of the cause.", "Acting on an important recommendation without reviewing it."],
    nextLabel: "Open Trust Center",
    nextHref: "/app/help/trust",
    related: ["Files & Notes", "Business Notes", "Saved Analyses"]
  }),
  article({
    id: "google-sheets-pilot",
    category: "Getting Started",
    title: GOOGLE_SHEETS_PILOT.title,
    summary: GOOGLE_SHEETS_PILOT.eligibility,
    what: GOOGLE_SHEETS_PILOT.catalog,
    why: GOOGLE_SHEETS_PILOT.fallback,
    when: "Check pilot eligibility before trying to connect or relying on Google Sheets when purchasing Vaeroex.",
    workflow: ["Confirm with Vaeroex support that the Google account you will use is an approved pilot test user.", "If eligible, open the plug-in connections page, choose Google Sheets, and follow the connection and mapping approval steps.", GOOGLE_SHEETS_PILOT.reconnect, GOOGLE_SHEETS_PILOT.fallback],
    mistakes: ["Assuming a paid subscription grants Google pilot eligibility.", "Assuming a successful test connection means Google Sheets is generally available."],
    nextLabel: "Open Files & Notes",
    nextHref: "/app/sources",
    related: ["files-imports", "first-follow-up"]
  }),
  article({
    id: "vaeroex-super-intelligence",
    category: "Getting Started",
    title: "Vaeroex Super Intelligence",
    summary: "VSI is the intelligence behind Vaeroex, including its conversational help.",
    what: "VSI brings business calculations, approved context, and explanations together. In Super Intelligence, you can ask Vaeroex everyday questions or work through a business question using information you are allowed to access.",
    why: "Ask why sales rose while profits fell without starting a separate review of every report. Supporting evidence and missing information help you judge the answer.",
    when: "Use it for writing, planning, general questions, or business analysis. Available information and usage limits affect what Vaeroex can answer.",
    workflow: ["Open Super Intelligence and start or reopen a chat.", "For a business question, name the business, reporting period, and decision you are trying to make.", "Check the sources and dates. If Vaeroex needs more information, add the requested report or context.", "If you ask Vaeroex to remember something, review the proposed Business Note and confirm before saving.", "Use Usage to check your question allowance. Workspace usage protections may pause access earlier."],
    mistakes: ["Assuming a confident answer is correct without checking its evidence.", "Entering prohibited personal or healthcare data.", "Assuming a private conversation automatically becomes shared Business Memory."],
    nextLabel: "Open Super Intelligence",
    nextHref: "/app/si",
    related: ["Business Notes", "Files & Notes", "Trust Center"]
  }),
  article({
    id: "what-is-vaeroex",
    category: "Getting Started",
    title: "What is Vaeroex?",
    summary: "Business information in one place, with help understanding what needs attention.",
    what: "Vaeroex is the company behind Executive Intelligence. VSI—Vaeroex Super Intelligence—is the intelligence behind Vaeroex. It helps connect your business numbers with the context behind them.",
    why: "Sales, costs, staffing, and decisions affect one another. Reviewing them together can help explain a problem that one report alone cannot.",
    when: "Start here if you want to understand how the workspace can help your business.",
    workflow: ["Review the product and supported plug-ins.", "Add relevant reports and business context.", "Review what changed and what needs attention.", "Check the evidence before deciding what to do."],
    mistakes: ["Assuming every source contains complete or current information.", "Treating recommendations as automatic decisions.", "Uploading prohibited sensitive data."],
    nextLabel: "Explore Executive Intelligence",
    nextHref: "/executive-intelligence",
    related: ["Vaeroex Super Intelligence", "Business Notes", "Trust Center"]
  }),
  article({
    id: "intelligence-platform",
    category: "Getting Started",
    title: "How does the workspace help?",
    summary: "Spend less time comparing reports and more time deciding what to do.",
    what: "Executive Intelligence brings supported business information together so you can ask questions, review findings, and save useful analyses.",
    why: "A rise in sales does not always mean a rise in profit. Comparing revenue, costs, dates, and business notes can help explain the difference.",
    when: "Use it when your reports seem to disagree, you need to choose a priority, or you want to review a change.",
    workflow: ["Choose a question and reporting period.", "Add the reports and notes needed to answer it.", "Review the analysis and supporting sources.", "Decide what action to take.", "Return with updated data to review what changed."],
    mistakes: ["Comparing different reporting periods without noticing.", "Assuming missing figures are zero.", "Treating a possible explanation as proven cause."],
    nextLabel: "Open Intelligence",
    nextHref: "/app/intelligence",
    related: ["Files & Notes", "Performance", "Saved Analyses"]
  }),
  article({
    id: "operations-intelligence-suite",
    category: "Getting Started",
    title: "What is Executive Intelligence?",
    summary: "Vaeroex's flagship Executive Intelligence platform for Business Health, Intelligence, Explain Finding, Evidence, and Saved Analyses.",
    what: "Executive Intelligence connects trusted business information with deterministic intelligence and advanced executive reasoning.",
    why: "It helps leaders understand current conditions, meaningful change, risk, opportunity, and what deserves attention next.",
    when: "Use it when leadership needs a clearer operating view, KPI context, focused explanations, and evidence-backed decision support.",
    workflow: ["Add business evidence", "Review Business Health", "Open prioritized Intelligence", "Explain a supported finding", "Save useful analyses"],
    mistakes: ["Expecting automatic decisions", "Skipping human review", "Treating limited data as complete"],
    nextLabel: "Learn more",
    nextHref: "/executive-intelligence",
    related: ["Business Health Score", "Profit Leak Detection", "Recommendation Tracking"]
  }),
  article({
    id: "build-the-structure",
    category: "Getting Started",
    title: "The structure your growth depends on",
    summary: "Vaeroex helps leaders understand where business structure is strong, weak, or missing.",
    what: "As your business grows, keep reports current, record important decisions, and check whether changes are helping.",
    why: "Without structure, growth creates more noise, slower decisions, stale information, and unclear priorities.",
    when: "Use this mindset when reviewing KPIs, Evidence, Business Health, Intelligence, and Saved Analyses.",
    workflow: ["Choose one visibility gap", "Add evidence", "Review the pattern", "Open a focused analysis if needed", "Revisit the result"],
    mistakes: ["Trying to perfect every workflow before starting", "Treating one signal as the whole picture", "Using saved analysis without review"],
    nextLabel: "Open Intelligence",
    nextHref: "/app/intelligence",
    related: ["Executive Intelligence", "Visibility", "Action"]
  }),
  article({
    id: "visibility-accountability-execution",
    category: "Getting Started",
    title: "Understanding Visibility, Awareness, Prediction, and Action",
    summary: "The company-level pillars behind Vaeroex.",
    what: "Information provides the inputs. Visibility shows what is happening. Awareness connects context and meaning. Prediction identifies supported directional change. Action helps people decide what deserves focus next.",
    why: "Information becomes more useful when people can see it, understand it, anticipate supported change, and act on it.",
    when: "Use these pillars when reviewing Vaeroex Intelligence Systems.",
    workflow: ["Find the signal", "Understand the context", "Assess risk or opportunity", "Choose a response", "Measure the outcome"],
    mistakes: ["Collecting information without interpretation", "Stopping at awareness without action", "Treating outputs as guaranteed"],
    nextLabel: "View platform",
    nextHref: "/",
    related: ["Information", "Prediction", "Leadership Review"]
  }),
  ...[
    ["creating-workspace", "Creating your workspace", "Add the organization and owner, review the Workspace Agreement, and sign electronically.", "/app/setup"],
    ["dashboard", "Understanding the dashboard", "Use the dashboard to see business health, risks, opportunities, and priorities.", "/app"],
    ["first-kpi", "Creating your first KPI", "Start with a small set of metrics that actually drive decisions.", "/app/kpis"],
    ["first-saved-analysis", "Saving your first analysis", "Preserve a completed Business Health analysis or Finding Explanation for later review.", "/app/reports"],
    ["first-follow-up", "Uploading your first file", "Add a supported report through Files & Notes, then review any extracted data before approving an import.", "/app/sources"],
    ["first-sop", "Creating your first SOP", "Document the process that should happen the same way each time.", "/app/sops"],
    ["saved-analysis-library", "Understanding Saved Analyses", "Saved Analyses contains only completed intelligence your team explicitly chose to preserve.", "/app/reports"]
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
    ["business-health-score", "Business Health Score", "Review the score, movement, freshness, history and evidence in Intelligence.", "/app/intelligence#business-health"],
    ["business-memory", "Business Memory", "Relevant historical context from imports, decisions, recommendations, and outcomes.", "/app"],
    ["profit-leak-detector", "Profit Leakage Review", "A KPI-based review of supported revenue leakage indicators.", "/app/kpis/profit-leakage"],
    ["focus-on", "What Should Leadership Review?", "A prioritized list of evidence-backed topics to review.", "/app"],
    ["reports", "Saved Analyses", "A workspace-scoped library of completed analyses your team explicitly saved.", "/app/reports"],
    ["kpis", "Performance", "Track business metrics (KPIs), targets, and changes over time.", "/app/kpis"],
    ["crm", "Customer Activity Evidence", "Customer activity used as evidence for risk, opportunity, and revenue trends.", "/app/sources"],
    ["files-imports", "Files & Notes", "Upload reports, add Business Notes, and review data before approving an import.", "/app/sources"],
    ["sop-library", "SOP Library", "A place to store, review, and improve working procedures.", "/app/sops"],
    ["issues", "Issues", "A place to log risks, problems, root causes, and recommended fixes.", "/app/issues"],
    ["assets", "Assets", "Tracked equipment, tools, locations, readiness, and status checks.", "/app/assets"],
    ["saved-analysis-review", "Saved Analysis Review", "Preserve completed analysis context in workspace history.", "/app/reports"],
    ["saved-analysis-history", "Saved Analysis History", "Open prior saved analyses without regenerating or rewriting their content.", "/app/reports"],
    ["vaeroex-ai", "Executive Intelligence", "Review prioritized findings and focused explanations grounded in current workspace evidence.", "/app/intelligence"]
  ].map(([id, title, summary, href]) =>
    article({
      id,
      category: "Executive Intelligence",
      title,
      summary,
      what: summary,
      why: "This helps improve operational clarity and reduces the need to chase information across disconnected tools.",
      when: "Use it when leadership needs evidence, context, or a repeatable review point.",
      workflow: ["Open the page", "Review existing evidence first", "Add or update only what is useful", "Use Intelligence or Saved Analyses to review patterns"],
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
    ["profit-leak-general", "How Profit Leakage Review works", "The KPI review uses available revenue, target, and operating-cost values to show supported leakage indicators and visible limitations."],
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
      why: "Vaeroex recommendations are advisory executive intelligence, not automatic decisions.",
      when: "Use Executive Intelligence when leadership needs a structured second look at workspace activity.",
      workflow: ["Open Intelligence", "Review a prioritized finding", "Inspect the evidence", "Open Explain Finding when useful", "Save completed analysis when leadership should revisit it"],
      mistakes: ["Treating output as guaranteed", "Skipping human review", "Uploading sensitive data"],
      nextLabel: "Open Intelligence",
      nextHref: "/app/intelligence",
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
    ["manager-use", "How to use Vaeroex as a Manager", "Review signals, issues, and source evidence for clearer operating context."],
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
    ["sensitive-guide", "Sensitive Data Policy", "What information you must keep out of your workspace.", "/sensitive-data-policy"],
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
    what: "Intelligence summarizes Business Health, changes in your metrics, risks, and priorities to review.",
    workflow: ["Review Business Health", "Review current Intelligence", "Open supporting evidence", "Save a completed analysis when leadership should revisit it"],
    mistakes: ["Ignoring stale data", "Treating a score as a guarantee", "Skipping evidence review"],
    related: ["Business Health Score", "Saved Analyses", "Executive Intelligence"]
  },
  files: {
    what: "Files & Notes stores reports and business context in the active workspace. Review extracted information before approving it for use.",
    workflow: ["Select a source", "Analyze or import", "Review mappings", "Approve saved data", "Use supported results in live analyses"],
    mistakes: ["Uploading sensitive data", "Treating an incomplete file as sufficient evidence", "Skipping import review"],
    related: ["Evidence", "Sensitive Data Policy", "Saved Analyses"]
  },
  reports: {
    what: "Saved Analyses stores completed Business Health and Explain Finding analyses that a workspace member explicitly chose to preserve.",
    workflow: ["Review a completed live analysis", "Choose Save Analysis", "Search or filter Saved Analyses", "Open the copied analysis when needed"],
    mistakes: ["Assuming saved content updates with a live analysis", "Overlooking freshness", "Skipping evidence review"],
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
    related: ["Profit Leakage Review", "KPIs", "Saved Analyses"]
  },
  analysis: {
    what: "Use Intelligence for structured analysis and Search to locate workspace records.",
    workflow: ["Open Intelligence", "Choose a supported finding", "Review evidence", "Save a completed analysis when useful"],
    mistakes: ["Treating output as professional advice", "Skipping review", "Uploading sensitive data"],
    related: ["Executive Intelligence", "AI Disclaimer", "Sensitive Data Policy"]
  },
  default: {
    what: "This page helps organize business evidence for visibility, context, and leadership review.",
    workflow: ["Review existing records", "Add only useful information", "Use Intelligence or Saved Analyses to review patterns"],
    mistakes: ["Creating duplicate records", "Leaving stale information", "Skipping human review"],
    related: ["Help Center", "Trust Center", "Support"]
  }
};
