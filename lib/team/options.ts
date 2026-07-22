export const OPERATIONAL_ROLES = ["Owner", "Executive", "Director", "Manager", "Supervisor", "Coordinator", "Staff", "Viewer"];

export const TEAM_DEPARTMENTS = [
  "Operations",
  "Sales",
  "Customer Service",
  "Field Operations",
  "Admin",
  "Finance",
  "HR",
  "Warehouse",
  "Custom"
];

export const ASSIGNMENT_STATUSES = ["Open", "In Progress", "Waiting", "Done", "Dismissed"];
export const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const SHARE_SCOPES = ["Person", "Role", "Department", "Entire workspace"];
export const DISTRIBUTION_SCHEDULES = ["One-time share", "Daily", "Weekly", "Monthly", "Quarterly"];

export function suggestOperationalRole(text: string) {
  const normalized = text.toLowerCase();

  if (normalized.includes("strategy") || normalized.includes("executive") || normalized.includes("budget")) return "Executive";
  if (normalized.includes("director") || normalized.includes("cross-department") || normalized.includes("policy")) return "Director";
  if (normalized.includes("process") || normalized.includes("department") || normalized.includes("sop")) return "Manager";
  if (normalized.includes("field") || normalized.includes("checklist") || normalized.includes("missed") || normalized.includes("execution")) return "Supervisor";
  if (normalized.includes("admin") || normalized.includes("follow-up") || normalized.includes("schedule")) return "Coordinator";

  return "Staff";
}
