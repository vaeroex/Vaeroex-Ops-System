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

export type PublicSystemDefinition = PublicSystemBase & (AvailablePublicSystem | DevelopmentPublicSystem);

export const PUBLIC_SYSTEMS = [
  {
    id: "executive-intelligence",
    name: "Executive Intelligence",
    relationship: "A specialized Vaeroex intelligence environment",
    tagline: "See the condition of the business. Understand what deserves attention.",
    description: "Executive Intelligence brings Business Health, performance, prioritized intelligence, evidence, and saved analyses into one inspectable leadership environment.",
    availability: "available",
    statusLabel: "Available",
    route: "/executive-intelligence",
    detailCta: "Explore Executive Intelligence",
    pricing: {
      display: "Current published subscription",
      ctaLabel: "Start with Vaeroex",
      behavior: "checkout",
      checkoutRoute: "/api/stripe/checkout"
    },
    visual: {
      accent: "#62d9ff",
      environment: "executive_chamber"
    },
    capabilities: ["Business Health", "Performance", "Intelligence", "Evidence", "Saved Analyses"]
  },
  {
    id: "drug-discovery-intelligence",
    name: "Drug Discovery Intelligence",
    relationship: "A specialized Vaeroex intelligence environment",
    tagline: "Turn computational discovery into traceable research intelligence.",
    description: "Explore biological targets, run advanced computational discovery workflows, evaluate molecular candidates, preserve experimental evidence, and prioritize promising directions for further research.",
    availability: "under_development",
    statusLabel: "In Development",
    route: "/drug-discovery-intelligence",
    detailCta: "Explore Drug Discovery Intelligence",
    pricing: {
      display: "Pricing not yet announced",
      ctaLabel: "Under Development",
      behavior: "status",
      checkoutRoute: null
    },
    visual: {
      accent: "#7de4dc",
      environment: "molecular_discovery"
    },
    capabilities: ["Protein Structure", "Molecular Generation", "Molecular Docking", "Binder Design", "Candidate Intelligence"]
  },
  {
    id: "biological-intelligence",
    name: "Biological Intelligence",
    relationship: "A specialized Vaeroex intelligence environment",
    tagline: "Understand the system behind the signal.",
    description: "Transform genomic, molecular, cellular, experimental, and scientific evidence into structured intelligence for mechanisms, hypotheses, knowledge gaps, and research priorities.",
    availability: "under_development",
    statusLabel: "In Development",
    route: "/biological-intelligence",
    detailCta: "Explore Biological Intelligence",
    pricing: {
      display: "Pricing not yet announced",
      ctaLabel: "Under Development",
      behavior: "status",
      checkoutRoute: null
    },
    visual: {
      accent: "#72c9ff",
      environment: "biological_systems"
    },
    capabilities: ["Evidence Synthesis", "Mechanism Discovery", "Hypothesis Intelligence", "Knowledge Gaps", "Research Prioritization"]
  }
] as const satisfies readonly PublicSystemDefinition[];

export const EXECUTIVE_INTELLIGENCE_SYSTEM = PUBLIC_SYSTEMS[0];
export const DRUG_DISCOVERY_INTELLIGENCE_SYSTEM = PUBLIC_SYSTEMS[1];
export const BIOLOGICAL_INTELLIGENCE_SYSTEM = PUBLIC_SYSTEMS[2];
