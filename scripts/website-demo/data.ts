// Fictional source observations, never imported by application runtime.
import type { Database } from "../../lib/supabase/types";
export const AS_OF = "2026-10-12T18:00:00.000Z";
export const WORKSPACE_ID = "00000000-0000-4000-8000-000000000101";
export type FixtureState = "populated" | "partial" | "empty" | "loading" | "error";
export type FixtureRole = "owner" | "viewer";
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export function freeze<T>(value: T): T { return value; }
export const workspace = { id: WORKSPACE_ID, name: "Juniper Table", industry: "Restaurant", business_type: "Restaurant", size: "18 people", created_at: "2026-04-01T18:00:00.000Z", updated_at: AS_OF, subscription_status: "active", subscription_required: true, manually_unlocked: false };
export const profile = { id: "00000000-0000-4000-8000-000000000102", full_name: "Maya Rowan", email: "maya@example.invalid", created_at: AS_OF };
const common = { google_sheets_read_ticket_id: null, workspace_id: WORKSPACE_ID, created_at: AS_OF, updated_at: AS_OF, archived_at: null, deleted_at: null, folder_id: null, created_by: profile.id };
// Weekly observations for one restaurant, Monday-ending weeks. Sales grew during
// summer; the last four weeks softened while margin and service time worsened.
// These are authored fictional inputs, not scores or generated conclusions.
export const metrics = [
  { name: "Weekly net sales", category: "Financial", unit: "$", format: "currency", direction: "maximize", target: 24000, definition: "Net food and beverage sales for the week, after refunds and before sales tax.", values: [21200,21800,22050,21700,22400,22800,22650,23100,23500,23800,24100,23750,24500,24700,24200,24900,25300,25100,24700,24500,24100,23800,23200,22600,21800,21100,20500,19800] },
  { name: "Gross margin", category: "Financial", unit: "%", format: "percent", direction: "maximize", target: 68, definition: "Weekly net sales less food and beverage cost, divided by weekly net sales.", values: [67,67.4,68,67.8,68.2,68.5,68.1,68.8,69,68.5,69.1,68.8,69.2,69,68.7,68.5,68.4,68.2,68,67.8,67.3,66.8,66,65.5,64.5,63.8,63,62] },
  { name: "Labor cost share", category: "Financial", unit: "%", format: "percent", direction: "minimize", target: 32, definition: "Hourly and salaried restaurant labor cost divided by weekly net sales.", values: [31,31.4,31,30.8,31.2,30.8,31,30.5,30.7,30.4,30.8,31,30.3,30.5,30.8,30.6,30.9,31,31.2,31.5,31.7,32,32.5,33,33.5,34,34.5,35] },
  { name: "Average ticket time", category: "Operations", unit: "minutes", format: "decimal", direction: "minimize", target: 18, definition: "Mean time from kitchen order acceptance to ready-to-serve, in minutes.", values: [18,17.5,18.2,17.8,17.2,17.5,17,17.2,16.8,17,17.2,16.9,17.1,17.4,17,17.6,18,18.2,18.5,19,19.2,19.8,20.1,21,21.5,22,23,24] },
  { name: "Guest satisfaction", category: "Customers", unit: "%", format: "percent", direction: "maximize", target: 90, definition: "Share of weekly feedback cards rated satisfied or very satisfied; at least 40 cards per week.", values: [89,90,91,90,92,91,92,93,92,93,94,93,94,94,95,94,95,94,95,95,94,95,94,95,96,95,95,96] },
  { name: "Food waste share", category: "Operations", unit: "%", format: "percent", direction: "minimize", target: 5, definition: "Cost of logged spoiled or discarded ingredients as a share of food purchases for the week.", values: [6.2,6,5.8,5.7,5.5,5.3,5.2,5,4.9,4.8,4.7,4.8,4.5,4.4,4.3,4.2,4.3,4.1,4,3.9,3.8,3.9,3.7,3.6,3.7,3.5,3.4,3.5] },
] as const;
export const kpis: Row<"kpis">[] = metrics.flatMap((metric, m) => metric.values.map((actual_value, week) => {
  const date = new Date("2026-04-06T18:00:00.000Z"); date.setUTCDate(date.getUTCDate() + week * 7);
  return { ...common, id: `juniper-observation-${m}-${week}`, name: metric.name, category: metric.category, target: metric.target, actual_value, metric_date: date.toISOString().slice(0,10), owner: "Maya Rowan", notes: metric.definition, source: "file_import", source_file_id: `juniper-source-${m}`, import_id: `juniper-import-${m}`, import_row_id: `juniper-row-${m}-${week}`, raw_data_json: { restaurant: "Juniper Table", period: "weekly", definition: metric.definition } };
}));
export const performanceKpis = kpis;
export const performanceKpiSettings: Row<"kpi_settings">[] = metrics.map((metric, i) => ({
  google_sheets_read_ticket_id: null, id: `juniper-setting-${i}`, workspace_id: WORKSPACE_ID, kpi_name: metric.name, category: metric.category, target: metric.target, weight: 1,
  definition: metric.definition, color: ["#38BDF8","#14B8A6","#F59E0B","#8B5CF6","#10B981","#F97316"][i], color_source: "user", is_visible: true, sort_order: i,
  unit_type: metric.unit === "$" ? "currency" : metric.unit === "%" ? "percent" : "minutes", display_unit: metric.unit, value_format: metric.format, x_axis_label: "Week ending", y_axis_label: metric.name, preferred_chart_type: "line",
  canonical_name: metric.name.toLowerCase().replaceAll(" ", "_"), display_name: metric.name, original_source_label: metric.name, aliases: [], semantic_unit: metric.unit === "$" ? "currency" : metric.unit === "%" ? "percent" : metric.unit, semantic_scale: 1,
  aggregation_basis: "observed_value", period_basis: "weekly", desired_direction: metric.direction, target_behavior: metric.direction === "maximize" ? "minimum_goal" : "maximum_limit", ideal_value: null, ideal_range_min: null, ideal_range_max: null, metric_role: "actual",
  classification_source: "user", classification_confidence: 1, classification_version: "user-confirmed", classification_rationale: "Restaurant reporting definitions and weekly targets confirmed by Maya Rowan.", classification_confirmed: true, created_by: profile.id, created_at: AS_OF, updated_at: AS_OF,
}));
export const csvContents = metrics.map(metric => "metric_date,name,actual_value,target\n" + kpis.filter(row => row.name === metric.name).map(row => `${row.metric_date},${row.name},${row.actual_value},${row.target}`).join("\n") + "\n");
export const files: Row<"file_uploads">[] = metrics.map((metric, i) => ({
  ...common, id: `juniper-source-${i}`, original_name: `${metric.name.toLowerCase().replaceAll(" ", "-")}-apr-oct.csv`, display_name: `${metric.name} · April–October`, file_extension: "csv", mime_type: "text/csv", file_size_bytes: new TextEncoder().encode(csvContents[i]).length, storage_bucket: "local-demo-only", storage_path: "no-remote-object", import_type: "csv", import_status: "imported", imported_rows: 28,
  analysis_prompt: null, analysis_summary: null, processing_status: "completed", processing_error: null, processed_at: AS_OF, index_status: "pending", indexed_at: null, indexed_chunk_count: 0, index_error: null, metadata_json: {},
}));
export const imports: Row<"file_imports">[] = files.map((file, i) => ({ id: `juniper-import-${i}`, workspace_id: WORKSPACE_ID, file_upload_id: file.id, import_type: "csv", status: "imported", recovery_status: "none", rows_total: 28, rows_imported: 28, mapping_json: {}, extraction_summary: null, errors_json: [], reviewed_at: AS_OF, imported_at: AS_OF, created_by: profile.id, created_at: AS_OF }));
export const noteDraft = "Juniper Table — Monday service review\n\nWe are a neighborhood restaurant with 54 seats, open Tuesday through Sunday for dinner and Saturday–Sunday for lunch. Our goal is to bring weekly net sales back toward $24,000 while keeping guest satisfaction at or above 90%.\n\nThe last four weeks show softer sales, higher labor cost share, and longer ticket times. Maya will review the weekly kitchen schedule with Ellis before the next menu meeting. These figures do not establish the cause; check covers, staffing hours, and item-level food costs before deciding what to change.\n\nGuest feedback remains positive and the waste log has improved. Keep the smaller prep batches introduced in August while we review service capacity. The October patio closure may be relevant context, but its effect has not been measured.";
export const analyses: never[] = [];
export const briefings = Object.fromEntries(["weekly", "monthly"].map(briefingType => [briefingType, { briefingType, status: "unavailable", eligibility: "no_eligible_evidence", confidence: "Low", artifact: null, message: "Generation is not connected in this local capture environment.", period: { start: "2026-10-06", end: "2026-10-12", cutoff: AS_OF, dayCount: 7, timeZone: "UTC" } }]));
