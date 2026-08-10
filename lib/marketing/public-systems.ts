import type { Route } from "next";

export type PublicSystemDefinition = Readonly<{
  id: string;
  name: string;
  relationship: string;
  tagline: string;
  description: string;
  availability: "available" | "under_development";
  route: Route;
  cta: string;
  visual: Readonly<{
    accent: string;
    environment: "executive_chamber" | "molecular_discovery";
  }>;
  capabilities: readonly string[];
}>;

export const PUBLIC_SYSTEMS = [
  {
    id: "executive-intelligence",
    name: "Executive Intelligence",
    relationship: "A Vaeroex Intelligence System",
    tagline: "See the condition of the business. Understand what deserves attention.",
    description: "Executive Intelligence brings Business Health, performance, prioritized intelligence, evidence, and saved analyses into one inspectable leadership environment.",
    availability: "available",
    route: "/executive-intelligence",
    cta: "Explore Executive Intelligence",
    visual: {
      accent: "#62d9ff",
      environment: "executive_chamber"
    },
    capabilities: ["Business Health", "Performance", "Intelligence", "Evidence", "Saved Analyses"]
  },
  {
    id: "drug-discovery-intelligence",
    name: "Drug Discovery Intelligence",
    relationship: "A Vaeroex Intelligence System",
    tagline: "Turn computational discovery into traceable research intelligence.",
    description: "Explore biological targets, run advanced computational discovery workflows, evaluate molecular candidates, preserve experimental evidence, and prioritize promising directions for further research.",
    availability: "under_development",
    route: "/drug-discovery-intelligence",
    cta: "View Drug Discovery Intelligence",
    visual: {
      accent: "#7de4dc",
      environment: "molecular_discovery"
    },
    capabilities: ["Protein Structure", "Molecular Generation", "Molecular Docking", "Binder Design", "Candidate Intelligence"]
  }
] as const satisfies readonly PublicSystemDefinition[];

export const EXECUTIVE_INTELLIGENCE_SYSTEM = PUBLIC_SYSTEMS[0];
export const DRUG_DISCOVERY_INTELLIGENCE_SYSTEM = PUBLIC_SYSTEMS[1];
