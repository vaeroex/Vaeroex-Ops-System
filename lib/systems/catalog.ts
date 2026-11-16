// Descriptions are catalog information, never authorization or customer assignments.
import { EXECUTIVE_INTELLIGENCE_SYSTEM } from "@/lib/marketing/public-systems";

export const SYSTEM_CATALOG = [
  { id: "executive-intelligence", name: "Executive Intelligence", status: "available", description: EXECUTIVE_INTELLIGENCE_SYSTEM.description },
  { id: "biological-intelligence", name: "Biological Intelligence", status: "development", description: "In development to help researchers organize biological information, explore relationships, and investigate scientific questions with supporting evidence." },
  { id: "drug-discovery-intelligence", name: "Drug Discovery Intelligence", status: "development", description: "In development to help researchers explore scientific literature, compounds, and biological targets, organize evidence, and identify questions for further investigation." },
] as const;
