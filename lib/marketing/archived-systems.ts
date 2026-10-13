// Preserved research definitions for the archived page implementations only.
// Public navigation, pricing and product context import public-systems instead.
import type { PublicSystemDefinition } from "./public-systems";

const ARCHIVED_SYSTEMS = [
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

export const DRUG_DISCOVERY_INTELLIGENCE_SYSTEM = ARCHIVED_SYSTEMS[0];
export const BIOLOGICAL_INTELLIGENCE_SYSTEM = ARCHIVED_SYSTEMS[1];
