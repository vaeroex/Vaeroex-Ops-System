export type WorkspaceSetupCategory = {
  id: string;
  name: string;
  description: string;
  complianceNotice?: string;
  forms: string[];
  checklists: string[];
  workflows: string[];
  assetExamples?: string[];
};

export const COMPLIANCE_NOTICE =
  "Do not enter patient data, PHI, ePHI, Social Security numbers, medical record numbers, insurance IDs, or other regulated sensitive information unless your organization has the proper legal, compliance, security, and agreement requirements in place.";

export const workspaceSetupCategories: WorkspaceSetupCategory[] = [
  {
    id: "general-business",
    name: "General Business",
    description: "For businesses that want broad visibility, accountability, reporting, follow-up, and decision support.",
    forms: ["Business Intake Form", "Follow-Up Request", "Issue Review Form"],
    checklists: ["Weekly Management Review", "Accountability Review Checklist", "Monthly Reporting Review"],
    workflows: ["Request to owner assignment", "Issue to manager review", "Weekly review to next actions"],
    assetExamples: ["Management dashboard", "Shared inbox", "Operations tracker", "Reporting file", "Team workspace"]
  },
  {
    id: "retail-customer-service",
    name: "Retail & Customer Service",
    description: "For customer-facing businesses managing service quality, sales activity, customer issues, staff follow-up, and daily operations.",
    forms: ["Customer Issue Form", "Sales Activity Update", "Staff Follow-Up Form"],
    checklists: ["Opening Review", "Closing Review", "Service Quality Walkthrough"],
    workflows: ["Customer issue to resolution", "Sales activity to follow-up", "Daily shift review"],
    assetExamples: ["Point-of-sale station", "Inventory area", "Customer service desk", "Store tablet", "Shift log"]
  },
  {
    id: "professional-services",
    name: "Professional Services",
    description: "For agencies, consultants, legal, accounting, administrative, advisory, and client-service businesses managing deliverables, clients, tasks, and follow-up.",
    forms: ["Client Intake Form", "Deliverable Status Update", "Client Follow-Up Form"],
    checklists: ["Client Onboarding Checklist", "Weekly Client Review", "Deliverable QA Review"],
    workflows: ["Client intake to onboarding", "Deliverable review to handoff", "Client follow-up to next action"],
    assetExamples: ["Client workspace", "Document library", "Reporting dashboard", "Shared drive", "Review checklist"]
  },
  {
    id: "field-operations",
    name: "Field Operations",
    description: "For mobile teams, technicians, inspections, dispatch, logistics, routes, equipment, field work, and operational follow-through.",
    forms: ["Field Activity Report", "Dispatch Update Form", "Equipment Issue Report"],
    checklists: ["Start-of-Day Field Review", "Job Completion Checklist", "Supervisor Field Review"],
    workflows: ["Dispatch to completion", "Field issue to supervisor review", "Equipment issue to follow-up"],
    assetExamples: ["Field vehicle", "Technician tablet", "Equipment kit", "Route schedule", "Dispatch board"]
  },
  {
    id: "construction-trades",
    name: "Construction & Trades",
    description: "For contractors, job sites, subcontractors, change requests, estimates, scheduling, inspections, materials, and project follow-up.",
    forms: ["Jobsite Report", "Change Request Form", "Subcontractor Issue Form"],
    checklists: ["Jobsite Readiness Review", "Punch List Review", "End-of-Day Wrap-Up"],
    workflows: ["Estimate to scheduled work", "Change request to approval", "Jobsite issue to owner review"],
    assetExamples: ["Truck", "Tool trailer", "Jobsite tablet", "Materials tracker", "Inspection checklist"]
  },
  {
    id: "healthcare-support",
    name: "Healthcare Support",
    description: "For non-patient operational support, administrative workflows, readiness, staffing, equipment, front desk, coordination, and compliance-aware operations.",
    complianceNotice: COMPLIANCE_NOTICE,
    forms: ["Administrative Request Form", "Readiness Issue Log", "Staffing Coordination Form"],
    checklists: ["Opening Admin Checklist", "Equipment Readiness Review", "Weekly Coordination Review"],
    workflows: ["Admin request to follow-up", "Readiness issue to manager review", "Staffing concern to coordination"],
    assetExamples: ["Front desk computer", "Printer", "Supply cabinet", "Office phone", "Readiness checklist"]
  },
  {
    id: "security",
    name: "Security",
    description: "For security teams, patrols, incidents, shift handoffs, post orders, staffing, reports, equipment checks, and situational awareness.",
    forms: ["Incident Report", "Shift Handoff Form", "Equipment Check Form"],
    checklists: ["Post Order Review", "Patrol Readiness Checklist", "End-of-Shift Review"],
    workflows: ["Incident to supervisor review", "Shift handoff to next action", "Equipment issue to follow-up"],
    assetExamples: ["Radio", "Patrol vehicle", "Post orders", "Access device", "Incident log"]
  },
  {
    id: "government",
    name: "Government",
    description: "For public-sector teams, departments, programs, reporting, accountability, service requests, field activity, internal reviews, and operational coordination.",
    forms: ["Service Request Review", "Program Status Update", "Internal Review Form"],
    checklists: ["Department Review Checklist", "Program Reporting Review", "Field Activity Review"],
    workflows: ["Service request to assignment", "Program update to leadership review", "Field activity to report"],
    assetExamples: ["Program tracker", "Service request queue", "Department dashboard", "Field log", "Reporting packet"]
  },
  {
    id: "custom-workspace",
    name: "Custom Workspace",
    description: "For organizations that do not fit a listed category or want to configure Vaeroex from a general starting point.",
    forms: ["Custom Intake Form", "Follow-Up Request", "Issue Review Form"],
    checklists: ["Workspace Review Checklist", "Accountability Review", "Reporting Review"],
    workflows: ["Request to owner assignment", "Issue to review", "Report to next action"],
    assetExamples: ["Workspace dashboard", "Shared tracker", "Reference file", "Review checklist", "Operations log"]
  }
];
