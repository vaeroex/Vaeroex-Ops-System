import type { Route } from "next";

export const INTELLIGENCE_SYSTEMS_ROUTE = "/intelligence-systems" as Route;

type PublicSystemBase = Readonly<{
  id: string;
  name: string;
  relationship: string;
  tagline: string;
  description: string;
  route: Route;
  detailCta: string;
  visual: Readonly<{
    accent: string;
    environment: "executive_chamber" | "molecular_discovery" | "biological_systems";
  }>;
  capabilities: readonly string[];
}>;

type AvailablePublicSystem = Readonly<{
  availability: "available";
  statusLabel: "Available";
  pricing: Readonly<{
    display: "Current published subscription";
    ctaLabel: "Start with Vaeroex";
    behavior: "checkout";
    checkoutRoute: Route;
  }>;
}>;

type DevelopmentPublicSystem = Readonly<{
  availability: "under_development";
  statusLabel: "In Development";
  pricing: Readonly<{
    display: "Pricing not yet announced";
    ctaLabel: "Under Development";
    behavior: "status";
    checkoutRoute: null;
  }>;
}>;

type PreviewPublicSystem = Readonly<{
  availability: "research_preview";
  statusLabel: "Research preview";
  pricing: Readonly<{
    display: "Free public sample";
    ctaLabel: "Request a walkthrough";
    behavior: "walkthrough";
    checkoutRoute: null;
  }>;
}>;

export type PublicSystemDefinition = PublicSystemBase & (AvailablePublicSystem | DevelopmentPublicSystem | PreviewPublicSystem);

export const EXECUTIVE_INTELLIGENCE_SYSTEM = {
  id: "executive-intelligence",
  name: "Executive Intelligence",
  relationship: "Business intelligence for owners and operators",
  tagline: "See the condition of the business. Understand what deserves attention.",
  description: "Executive Intelligence helps restaurants, breweries, retailers, and other businesses investigate performance with connected records, uploaded reports, Business Notes, and Vaeroex Super Intelligence.",
  availability: "available",
  statusLabel: "Available",
  route: "/executive-intelligence",
  detailCta: "Explore Executive Intelligence",
  pricing: {
    display: "Current published subscription",
    ctaLabel: "Start with Vaeroex",
    behavior: "checkout",
    checkoutRoute: "/checkout/legal"
  },
  visual: {
    accent: "#62d9ff",
    environment: "executive_chamber"
  },
  capabilities: ["Business Health", "Performance", "Intelligence", "Evidence", "Saved Analyses"]
} as const satisfies PublicSystemDefinition;

export const DRUG_DISCOVERY_SYSTEM = {
  id: "drug-discovery-intelligence",
  name: "Drug Discovery Intelligence",
  relationship: "Compound review for research teams",
  tagline: "Follow a compound from its evidence to an approved test batch.",
  description: "Inspect published structures in a free browser demo. Request a walkthrough of the private compound review and approval workspace.",
  availability: "research_preview",
  statusLabel: "Research preview",
  route: "/drug-discovery-intelligence",
  detailCta: "Explore Drug Discovery Intelligence",
  pricing: { display: "Free public sample", ctaLabel: "Request a walkthrough", behavior: "walkthrough", checkoutRoute: null },
  visual: { accent: "#00a8d6", environment: "molecular_discovery" },
  capabilities: ["Experimental structures", "Saved protein references", "Evidence review", "Approved shortlist exports"]
} as const satisfies PublicSystemDefinition;

export const PUBLIC_SYSTEMS = [DRUG_DISCOVERY_SYSTEM] as const;
