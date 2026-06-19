export type IndustryTemplate = {
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

export const industryTemplates: IndustryTemplate[] = [
  {
    id: "field-service",
    name: "Field Service Company",
    description: "For teams managing leads, jobs, technicians, equipment, and customer follow-up.",
    forms: ["Lead Intake Form", "Job Completion Report", "Customer Follow-Up Form"],
    checklists: ["Technician Start-of-Day Checklist", "Job Completion Checklist", "Weekly Manager Review"],
    workflows: ["New lead to booked job", "Job completion to customer follow-up", "Equipment issue to manager review"],
    assetExamples: ["Service vehicle", "Technician tablet", "Tool kit", "Parts bin", "Backup phone"]
  },
  {
    id: "construction",
    name: "Construction Company",
    description: "For companies coordinating jobsites, subcontractors, change requests, and daily reviews.",
    forms: ["Daily Jobsite Report", "Subcontractor Issue Form", "Change Request Form"],
    checklists: ["Jobsite Opening Checklist", "Safety/Readiness Checklist", "End-of-Day Wrap-Up"],
    workflows: ["Project start", "Change order review", "Subcontractor issue escalation"],
    assetExamples: ["Truck", "Generator", "Tool trailer", "Safety kit", "Jobsite tablet"]
  },
  {
    id: "ems-non-patient",
    name: "EMS Readiness - Non Patient",
    description: "For non-patient business workflows such as vehicles, equipment, shift handoffs, and supervisor review.",
    complianceNotice: COMPLIANCE_NOTICE,
    forms: ["Vehicle Readiness Form", "Shift Handoff Form", "Equipment Issue Report"],
    checklists: ["Start-of-Shift Unit Check", "End-of-Shift Charging Checklist", "Weekly Supervisor Review"],
    workflows: ["Equipment issue escalation", "Shift handoff", "Vehicle readiness review"],
    assetExamples: ["Response vehicle", "Radio", "Charging dock", "Readiness bag", "Supervisor tablet"]
  },
  {
    id: "cleaning",
    name: "Cleaning Company",
    description: "For recurring jobs, client closeout, cleaner checklists, and supply visibility.",
    forms: ["New Client Intake", "Job Completion Form", "Supply Request Form"],
    checklists: ["Cleaner Arrival Checklist", "Cleaning Completion Checklist", "Weekly Supplies Review"],
    workflows: ["New client to first job", "Job completion to customer follow-up", "Supply request to restock"],
    assetExamples: ["Supply bin", "Vacuum", "Vehicle", "Key set", "Cleaner phone"]
  },
  {
    id: "automotive",
    name: "Automotive Shop",
    description: "For intake, repair status, customer updates, bays, tools, and completion checks.",
    forms: ["Vehicle Intake Form", "Repair Status Update", "Customer Follow-Up Form"],
    checklists: ["Bay Opening Checklist", "Vehicle Completion Checklist", "Tool/Equipment Check"],
    workflows: ["Vehicle intake to repair", "Repair status update", "Vehicle completion to customer follow-up"],
    assetExamples: ["Bay lift", "Diagnostic tablet", "Tool cart", "Detail kit", "Loaner vehicle"]
  },
  {
    id: "gym",
    name: "Gym/Fitness Studio",
    description: "For facility checks, member inquiries, cleaning, equipment walkthroughs, and daily open/close.",
    forms: ["New Member Inquiry", "Facility Issue Report", "Cleaning/Equipment Check"],
    checklists: ["Opening Checklist", "Closing Checklist", "Equipment Walkthrough"],
    workflows: ["Member inquiry to tour", "Facility issue to manager review", "Equipment check to maintenance follow-up"],
    assetExamples: ["Treadmill", "Front desk tablet", "Cleaning cart", "Speaker system", "Access control device"]
  },
  {
    id: "medical-admin-no-phi",
    name: "Small Medical Admin Office Without PHI",
    description: "For non-patient administrative follow-ups, supplies, office workflows, and front desk coordination.",
    complianceNotice: COMPLIANCE_NOTICE,
    forms: ["Admin Follow-up Request", "Supply Request", "Front Desk Issue Log"],
    checklists: ["Opening Admin Checklist", "Closing Admin Checklist", "Weekly Office Review"],
    workflows: ["Admin request to follow-up", "Supply request to restock", "Office issue to manager review"],
    assetExamples: ["Front desk computer", "Printer", "Supply cabinet", "Office phone", "Check-in tablet"]
  },
  {
    id: "agency-consulting",
    name: "Agency/Consulting Business",
    description: "For client onboarding, client work updates, deliverable QA, and follow-up systems.",
    forms: ["New Client Intake", "Client Work Status Update", "Client Follow-Up Form"],
    checklists: ["Client Onboarding Checklist", "Weekly Client Review", "Deliverable QA Checklist"],
    workflows: ["New client to onboarding", "Weekly client review", "Deliverable QA to client handoff"],
    assetExamples: ["Client workspace", "Project board", "Shared drive", "QA checklist", "Reporting dashboard"]
  }
];
