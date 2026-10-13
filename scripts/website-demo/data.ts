// Fictional source observations, never imported by application runtime.
import type { Database } from "../../lib/supabase/types";
export const AS_OF = "2026-10-12T18:00:00.000Z";
export const WORKSPACE_ID = "00000000-0000-4000-8000-000000000101";
export type FixtureState = "populated" | "partial" | "empty" | "loading" | "error";
export type FixtureRole = "owner" | "viewer";
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export function freeze<T>(value: T): T { return value; }
export const workspace = { id: WORKSPACE_ID, name: "Coastal Kitchen", industry: "Restaurant", business_type: "Restaurant", size: "18 people", created_at: "2026-04-01T18:00:00.000Z", updated_at: AS_OF, subscription_status: "active", subscription_required: true, manually_unlocked: false };
export const profile = { id: "00000000-0000-4000-8000-000000000102", full_name: "Maya Rowan", email: "maya@example.invalid", created_at: AS_OF };
const common = { google_sheets_read_ticket_id: null, workspace_id: WORKSPACE_ID, created_at: AS_OF, updated_at: AS_OF, archived_at: null, deleted_at: null, folder_id: null, created_by: profile.id };
// Weekly observations for one restaurant, Monday-ending weeks. Sales grew during
// summer; service and cost controls remain healthy, with a supplier follow-up.
// These are authored fictional inputs, not scores or generated conclusions.
export const metrics = [
  { name: "Weekly net sales", category: "Financial", unit: "$", format: "currency", direction: "maximize", target: 24000, definition: "Net food and beverage sales for the week, after refunds and before sales tax.", values: [21200,21800,22050,21700,22400,22800,22650,23100,23500,23800,24100,23750,24500,24700,24200,24900,25300,25100,25400,25500,25800,26100,26400,26200,26800,27000,27200,27600] },
  { name: "Gross margin", category: "Financial", unit: "%", format: "percent", direction: "maximize", target: 68, definition: "Weekly net sales less food and beverage cost, divided by weekly net sales.", values: [67,67.4,68,67.8,68.2,68.5,68.1,68.8,69,68.5,69.1,68.8,69.2,69,68.7,68.5,68.4,68.2,68.5,68.8,69,69.1,69.2,69.3,69.5,69.6,69.8,70] },
  { name: "Labor percentage", category: "Financial", unit: "%", format: "percent", direction: "minimize", target: 32, definition: "Hourly and salaried restaurant labor cost divided by weekly net sales.", values: [31,31.4,31,30.8,31.2,30.8,31,30.5,30.7,30.4,30.8,31,30.3,30.5,30.8,30.6,30.9,31,30.8,30.6,30.5,30.4,30.3,30.2,30,30.1,29.9,29.8] },
  { name: "Average ticket time", category: "Operations", unit: "minutes", format: "decimal", direction: "minimize", target: 18, definition: "Mean time from kitchen order acceptance to ready-to-serve, in minutes.", values: [18,17.5,18.2,17.8,17.2,17.5,17,17.2,16.8,17,17.2,16.9,17.1,17.4,17,17.6,17.5,17.3,17.2,17,16.9,16.8,16.8,16.6,16.5,16.4,16.3,16.2] },
  { name: "Guest satisfaction", category: "Customers", unit: "%", format: "percent", direction: "maximize", target: 90, definition: "Share of weekly feedback cards rated satisfied or very satisfied; at least 40 cards per week.", values: [89,90,91,90,92,91,92,93,92,93,94,93,94,94,95,94,95,94,95,95,94,95,94,95,96,95,95,96] },
  { name: "Food waste share", category: "Operations", unit: "%", format: "percent", direction: "minimize", target: 5, definition: "Cost of logged spoiled or discarded ingredients as a share of food purchases for the week.", values: [6.2,6,5.8,5.7,5.5,5.3,5.2,5,4.9,4.8,4.7,4.8,4.5,4.4,4.3,4.2,4.3,4.1,4,3.9,3.8,3.9,3.7,3.6,3.7,3.5,3.4,3.5] },
] as const;
export const kpis: Row<"kpis">[] = metrics.flatMap((metric, m) => metric.values.map((actual_value, week) => {
  const date = new Date("2026-04-06T18:00:00.000Z"); date.setUTCDate(date.getUTCDate() + week * 7);
  return { ...common, created_at: date.toISOString(), updated_at: date.toISOString(), id: `coastal-observation-${m}-${week}`, name: metric.name, category: metric.category, target: metric.target, actual_value, metric_date: date.toISOString().slice(0,10), owner: "Maya Rowan", notes: metric.definition, source: "file_import", source_file_id: `coastal-source-${m}-${date.toISOString().slice(0,7)}`, import_id: `coastal-import-${m}-${date.toISOString().slice(0,7)}`, import_row_id: `coastal-row-${m}-${week}`, raw_data_json: { restaurant: "Coastal Kitchen", period: "weekly", definition: metric.definition } };
}));
export const performanceKpis = kpis;
export const performanceKpiSettings: Row<"kpi_settings">[] = metrics.map((metric, i) => ({
  google_sheets_read_ticket_id: null, id: `coastal-setting-${i}`, workspace_id: WORKSPACE_ID, kpi_name: metric.name, category: metric.category, target: metric.target, weight: 1,
  definition: metric.definition, color: ["#38BDF8","#14B8A6","#F59E0B","#8B5CF6","#10B981","#F97316"][i], color_source: "user", is_visible: true, sort_order: i,
  unit_type: metric.unit === "$" ? "currency" : metric.unit === "%" ? "percent" : "minutes", display_unit: metric.unit, value_format: metric.format, x_axis_label: "Week ending", y_axis_label: metric.name, preferred_chart_type: "line",
  canonical_name: metric.name.toLowerCase().replaceAll(" ", "_"), display_name: metric.name, original_source_label: metric.name, aliases: [], semantic_unit: metric.unit === "$" ? "currency" : metric.unit === "%" ? "percent" : metric.unit, semantic_scale: 1,
  aggregation_basis: "observed_value", period_basis: "weekly", desired_direction: metric.direction, target_behavior: metric.direction === "maximize" ? "minimum_goal" : "maximum_limit", ideal_value: null, ideal_range_min: null, ideal_range_max: null, metric_role: "actual",
  classification_source: "user", classification_confidence: 1, classification_version: "user-confirmed", classification_rationale: "Restaurant reporting definitions and weekly targets confirmed by Maya Rowan.", classification_confirmed: true, created_by: profile.id, created_at: AS_OF, updated_at: AS_OF,
}));
// Separate monthly exports preserve genuine historical source dates. The same
// observations are never counted twice or relabeled as independent evidence.
const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
function laborCosts(month: string) {
  const sales = kpis.filter(row=>row.name === "Weekly net sales" && row.metric_date.startsWith(month)).at(-1)!.actual_value!;
  const share = kpis.filter(row=>row.name === "Labor percentage" && row.metric_date.startsWith(month)).at(-1)!.actual_value!;
  const total = Math.round(sales * share) / 100;
  const kitchen = Math.round(total * 0.55 * 100) / 100;
  return [kitchen, Math.round((total-kitchen)*100)/100];
}
export const sourceDocuments = metrics.flatMap((metric, m) => months.map(month => {
  const rows = kpis.filter(row => row.name === metric.name && row.metric_date.startsWith(month));
  return { id: `coastal-source-${m}-${month}`, importId: `coastal-import-${m}-${month}`, name: `${metric.name} · ${month}`, date: rows.at(-1)!.metric_date, rows: rows.length,
    text: "metric_date,name,actual_value,target\n" + rows.map(row => `${row.metric_date},${row.name},${row.actual_value},${row.target}`).join("\n") + "\n" };
}));
for (const month of months) {
  const date = kpis.filter(row => row.metric_date.startsWith(month)).at(-1)!.metric_date;
  for (const [kind, title, text] of [
    ["labor", "Staffing and labor cost ledger", `Role,Cost\nKitchen,${laborCosts(month)[0]}\nService,${laborCosts(month)[1]}\n`],
    ["process", "Service process and SOP review", "Procedure,Review,Status\nPrep batches,Weekly,Confirmed\nSupplier invoice reconciliation,Weekly,Confirmed\n"],
    ["risk", "Issue and risk review", "Risk,Status,Review\nFood temperature control,Controlled,Logs reviewed\nSupplier continuity,Monitored,Backup supplier confirmed\n"]
  ]) sourceDocuments.push({id:`coastal-${kind}-${month}`,importId:`coastal-import-${kind}-${month}`,name:`${title} · ${month}`,date,rows:2,text});
}
const invoiceRows = [
  ["CK-410", "Harbor Produce", 420, "2026-10-08", "Overdue"],
  ["CK-411", "Bay Pantry", 180, "2026-10-09", "Overdue"],
  ["CK-412", "Cove Dairy", 310, "2026-10-16", "Open"],
  ["CK-413", "Harbor Produce", 860, "2026-10-02", "Paid"],
  ["CK-414", "Bay Pantry", 540, "2026-10-05", "Paid"],
  ["CK-415", "Cove Dairy", 280, "2026-10-06", "Paid"]
] as const;
sourceDocuments.push({id:"coastal-invoices",importId:"coastal-import-invoices",name:"Supplier invoice register · October 12",date:"2026-10-12",rows:invoiceRows.length,text:"Invoice,Supplier,Amount,Due Date,Status\n"+invoiceRows.map(row=>row.join(",")).join("\n")+"\n"});
export const csvContents = sourceDocuments.map(source=>source.text);
export const files: Row<"file_uploads">[] = sourceDocuments.map(source => ({
  ...common, created_at: `${source.date}T18:00:00.000Z`, updated_at: `${source.date}T18:00:00.000Z`, id: source.id, original_name: `${source.name.replaceAll(" · ", "-").replaceAll(" ", "-").toLowerCase()}.csv`, display_name: source.name, file_extension: "csv", mime_type: "text/csv", file_size_bytes: new TextEncoder().encode(source.text).length, storage_bucket: "local-demo-only", storage_path: "no-remote-object", import_type: "csv", import_status: "imported", imported_rows: source.rows,
  analysis_prompt: null, analysis_summary: null, processing_status: "completed", processing_error: null, processed_at: `${source.date}T18:00:00.000Z`, index_status: "pending", indexed_at: null, indexed_chunk_count: 0, index_error: null, metadata_json: {},
}));
export const imports: Row<"file_imports">[] = sourceDocuments.map(source => ({ id: source.importId, workspace_id: WORKSPACE_ID, file_upload_id: source.id, import_type: "csv", status: "imported", recovery_status: "none", rows_total: source.rows, rows_imported: source.rows, mapping_json: {}, extraction_summary: null, errors_json: [], reviewed_at: `${source.date}T18:00:00.000Z`, imported_at: `${source.date}T18:00:00.000Z`, created_by: profile.id, created_at: `${source.date}T18:00:00.000Z` }));
export const operationalMetrics: Row<"operational_metrics">[] = [
  ...months.flatMap(month => ["Kitchen", "Service"].map((role, index) => {
    const source=sourceDocuments.find(item=>item.id===`coastal-labor-${month}`)!;
    return {...common,id:`coastal-labor-${month}-${index}`,created_at:`${source.date}T18:00:00.000Z`,updated_at:`${source.date}T18:00:00.000Z`,source_file_id:source.id,import_id:source.importId,import_row_id:`labor-${month}-${index}`,metric_name:`${role} labor cost`,category:"Staffing",value:laborCosts(month)[index],metric_date:source.date,owner:"Maya Rowan",notes:"Recorded weekly role cost in the final week of each monthly staffing ledger.",raw_data_json:{Role:role,Cost:laborCosts(month)[index],"Vaeroex worksheet":"Staffing ledger","Vaeroex source row":index+2}};
  })),
  ...invoiceRows.map(([invoice,supplier,amount,due,status],index)=>({...common,id:`coastal-invoice-${index}`,source_file_id:"coastal-invoices",import_id:"coastal-import-invoices",import_row_id:`invoice-${index}`,metric_name:"Supplier invoice amount",category:"Financial",value:amount,metric_date:"2026-10-12",owner:"Maya Rowan",notes:"Status recorded in the October 12 supplier register; bank settlement has not been reconciled.",raw_data_json:{Invoice:invoice,Supplier:supplier,Amount:amount,"Due Date":due,Status:status,"Vaeroex worksheet":"Supplier invoices","Vaeroex source row":index+2}}))
];
export const noteDraft = "Coastal Kitchen — Monday service review\n\nWe are a neighborhood restaurant with 54 seats, open Tuesday–Sunday for dinner and Saturday–Sunday for lunch. Weekly net sales reached $27,600 against our $24,000 target. Gross margin is 70%, labor percentage is 29.8%, and guest satisfaction is 96%.\n\nKeep the smaller prep batches introduced in August: logged food waste is 3.5%, below our 5% ceiling. Average ticket time is 16.2 minutes against an 18-minute ceiling. These are observations, not proof that the prep change caused every improvement.\n\nThe supplier register marks two invoices totaling $600 overdue. Maya will compare CK-410 and CK-411 with bank settlement and supplier statements before approving another payment. No delivery disruption is recorded; do not infer a cash shortage from an unreconciled status.";
export const analyses: never[] = [];
export const briefings = Object.fromEntries(["weekly", "monthly"].map(briefingType => [briefingType, { briefingType, status: "unavailable", eligibility: "no_eligible_evidence", confidence: "Low", artifact: null, message: "Generation is not connected in this local capture environment.", period: { start: "2026-10-06", end: "2026-10-12", cutoff: AS_OF, dayCount: 7, timeZone: "UTC" } }]));
