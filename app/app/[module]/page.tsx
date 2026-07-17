import Link from "next/link";
import { GlobalSearchTrigger } from "@/components/app/GlobalSearchTrigger";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type ComingSoonCopy = {
  title: string;
  whatItWillDo: string[];
  whyItMatters: string;
  futureCapability: string[];
};

const comingSoonCopy: Record<string, ComingSoonCopy> = {
  workflows: {
    title: "Workflow Builder",
    whatItWillDo: [
      "Map repeatable business processes from trigger to completion.",
      "Map handoffs, review points, evidence capture, forms, and checklists.",
      "Connect workflow signals to reports so leaders can see where patterns emerge."
    ],
    whyItMatters:
      "Many small teams know the work, but the steps live in heads, texts, spreadsheets, and side conversations. A workflow builder will turn that into visible business structure.",
    futureCapability: [
      "Visual workflow maps",
      "Source evidence and review points",
      "Workflow templates by industry",
      "Vaeroex recommendations for bottlenecks and missed handoffs"
    ]
  },
  settings: {
    title: "Workspace Settings",
    whatItWillDo: [
      "Manage workspace profile, business details, and default workspace preferences.",
      "Review member roles and workspace access settings.",
      "Control compliance reminders and future integration settings."
    ],
    whyItMatters:
      "Settings should give owners control without turning the product into an admin maze. It needs to be built carefully around roles, subscriptions, and tenant safety.",
    futureCapability: [
      "Workspace profile editing",
      "Member and role management",
      "Notification preferences",
      "Future integrations and branding controls"
    ]
  },
  intake: {
    title: "Business Intake",
    whatItWillDo: [
      "Capture business context before setup.",
      "Identify recurring headaches, Business Signals, and spreadsheet-driven processes.",
      "Use answers to recommend starter workflows, KPIs, forms, SOPs, and reports."
    ],
    whyItMatters:
      "A good intake helps Vaeroex recommend practical systems instead of generic templates.",
    futureCapability: [
      "Richer pre-setup intake",
      "Industry-specific questions",
      "Recommended workspace blueprint",
      "Manager review before workspace generation"
    ]
  }
};

const defaultCopy: ComingSoonCopy = {
  title: "Module Coming Soon",
  whatItWillDo: [
      "Extend Vaeroex with a focused business intelligence capability.",
      "Use workspace-safe records and clear owner-friendly workflows.",
    "Connect future records to dashboard, reports, and Vaeroex context when appropriate."
  ],
  whyItMatters:
    "This module is not ready for daily use yet, so it is not shown in the main navigation.",
  futureCapability: [
    "Workspace-specific records",
    "Search, filters, and record management",
    "Dashboard and report integration",
    "Draft recommendations from Vaeroex where useful"
  ]
};

type ModulePageProps = {
  params: Promise<{
    module: string;
  }>;
};

function formatModuleName(module: string) {
  return module
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function ModuleComingSoonPage({ params }: ModulePageProps) {
  await requireWorkspacePage();

  const { module } = await params;
  const copy = comingSoonCopy[module] || {
    ...defaultCopy,
    title: `${formatModuleName(module) || defaultCopy.title} Coming Soon`
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Coming soon</p>
        <h2 className="mt-2 text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          This page is intentionally not listed in the main navigation because it is not ready for daily use yet.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/app" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Back to dashboard
          </Link>
          <GlobalSearchTrigger className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Search
          </GlobalSearchTrigger>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <h3 className="text-sm font-semibold">What it will do</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
            {copy.whatItWillDo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <h3 className="text-sm font-semibold">Why it matters</h3>
          <p className="mt-3 text-sm leading-6 text-muted">{copy.whyItMatters}</p>
        </article>

        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <h3 className="text-sm font-semibold">Expected future capability</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
            {copy.futureCapability.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}
