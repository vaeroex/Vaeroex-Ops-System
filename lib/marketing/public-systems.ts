import type { Route } from "next";

export type PublicSystemDefinition = Readonly<{
  id: string;
  name: string;
  relationship: string;
  tagline: string;
  description: string;
  availability: "available";
  route: Route;
  cta: string;
  visual: Readonly<{
    accent: string;
    environment: "executive_chamber";
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
  }
] as const satisfies readonly PublicSystemDefinition[];

export const EXECUTIVE_INTELLIGENCE_SYSTEM = PUBLIC_SYSTEMS[0];
