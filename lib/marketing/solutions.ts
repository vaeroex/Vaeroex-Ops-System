export const PROJECT_AGREEMENT_NOTICE =
  "These pages provide information and collect inquiries. They do not accept project payments, and submitting an inquiry does not create a service contract. Before work begins, scope, fees, payment schedule, maintenance, ownership or licensing, delivery, cancellation, and handover are defined in an individual written project agreement.";

export const SOLUTIONS = [
  {
    name: "Intelligence Systems",
    route: "/intelligence-systems",
    description:
      "Subscribe to a product for business information, analysis, and evidence.",
    kind: "intelligence",
    label: "01 / PRODUCTS",
  },
  {
    name: "Custom Business Systems",
    route: "/custom-business-systems",
    description:
      "Build a new business system or enhance existing software with custom features, integrations, and AI.",
    kind: "systems",
    label: "02 / CUSTOM SOFTWARE",
  },
  {
    name: "Website Development & Enhancement",
    route: "/website-development",
    description:
      "Build a new website or improve the one your business already relies on.",
    kind: "websites",
    label: "03 / WEBSITES",
  },
] as const;

export const PROJECT_STEPS = [
  ["Discovery", "Understand the problem, people, and existing tools."],
  [
    "Scope & Proposal",
    "Agree on deliverables, feasibility, costs, and responsibilities.",
  ],
  ["Development", "Build the agreed solution with opportunities for review."],
  ["Testing & Launch", "Check the workflows and prepare for release."],
  ["Ongoing Support", "Maintain the solution under the agreed support plan."],
] as const;
