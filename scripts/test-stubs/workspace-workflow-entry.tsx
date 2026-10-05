import { Component, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RecordDetailDrawer } from "@/components/operations/RecordDetailDrawer";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { GlobalSearchTrigger } from "@/components/app/GlobalSearchTrigger";
import { InternalFormSubmissionForm } from "@/components/operations/InternalFormSubmissionForm";
import { WorkbookImportReview } from "@/components/evidence/WorkbookImportReview";
import { createSubmissionSchema } from "@/lib/forms/submission-schema";
class SyntheticActionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(error: Error) {
    if (error.message !== "Synthetic submission failed") throw error;
    return { failed: true };
  }
  render() {
    return this.state.failed ? <section role="alert">Synthetic submission failed. Nothing was retried automatically.
      <button type="button" onClick={() => this.setState({ failed: false })}>Reset synthetic form</button>
    </section> : this.props.children;
  }
}
createRoot(document.getElementById("fixture")!, { onCaughtError(error) {
  if (!(error instanceof Error) || error.message !== "Synthetic submission failed") throw error;
} }).render(new URL(location.href).searchParams.get('fixture') === 'worksheet' ? <main className="vaeroex-app-shell vaeroex-customer-workspace">
  <WorkbookImportReview
    file={{ id: 'synthetic-file', display_name: 'Synthetic worksheet' } as ComponentProps<typeof WorkbookImportReview>["file"]}
    importRecord={{ id: 'synthetic-import', workspace_id: 'synthetic-workspace', file_upload_id: 'synthetic-file', import_type: 'metrics', status: 'extracted', recovery_status: 'not_started', rows_total: 1, rows_imported: 0, extraction_summary: null, errors_json: [], reviewed_at: null, imported_at: null, created_by: null, created_at: '2026-01-01T00:00:00Z', mapping_json: { mode: 'workbook', worksheets: [{ index: 1, name: 'CSV', detected_type: 'sales', selected_type: 'sales', enabled: true, status: 'parsed', row_count: 1, columns: ['date', 'revenue'], mapping: {}, metric_columns: [] }] } } as ComponentProps<typeof WorkbookImportReview>["importRecord"]}
    rows={[{ id: 'synthetic-row', row_number: 2, data_json: { date: '2026-01-01', revenue: 42 }, mapped_data_json: { __source: { worksheet_index: 1, row_number: 2 } } } as ComponentProps<typeof WorkbookImportReview>["rows"][number]]}
  />
</main> : <main className="vaeroex-app-shell vaeroex-customer-workspace">
  <h1>Synthetic workspace workflow verification</h1>
  <button id="before">Outside before</button>
  <RecordDetailDrawer title="Synthetic record" triggerLabel="Open synthetic record">
    <label>Inside details<input id="inside" name="synthetic" /></label>
    <GlobalSearchTrigger id="nested-search">Search from record</GlobalSearchTrigger>
    <button id="inside-last">Inside last</button>
  </RecordDetailDrawer>
  <button id="after">Outside after</button>
  <GlobalSearch className="hidden xl:block" />
  <GlobalSearch variant="icon" className="xl:hidden" />
  <GlobalSearchTrigger id="external-search" initialQuery="synthetic">Search evidence</GlobalSearchTrigger>
  <button id="last">Outside last</button>
  <section><h2>Internal form</h2><SyntheticActionBoundary><InternalFormSubmissionForm requestId="11111111-1111-4111-8111-111111111111" forms={[
    { id: "00000000-0000-4000-8000-000000000001", name: "Inspection", schema_json: createSubmissionSchema("Business detail\nInspection date\nPriority") },
    { id: "00000000-0000-4000-8000-000000000002", name: "Second form", schema_json: createSubmissionSchema("Location\nContact") }
  ]} returnPath="/app/form-submissions" /></SyntheticActionBoundary></section>
</main>);
