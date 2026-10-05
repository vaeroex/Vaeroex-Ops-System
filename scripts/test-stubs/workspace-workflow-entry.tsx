import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RecordDetailDrawer } from "@/components/operations/RecordDetailDrawer";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { GlobalSearchTrigger } from "@/components/app/GlobalSearchTrigger";
import { InternalFormSubmissionForm } from "@/components/operations/InternalFormSubmissionForm";
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
} }).render(<main className="vaeroex-app-shell vaeroex-customer-workspace">
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
  <section><h2>Internal form</h2><SyntheticActionBoundary><InternalFormSubmissionForm forms={[
    { id: "00000000-0000-4000-8000-000000000001", name: "Inspection", schema_json: createSubmissionSchema("Business detail\nInspection date\nPriority") },
    { id: "00000000-0000-4000-8000-000000000002", name: "Second form", schema_json: createSubmissionSchema("Location\nContact") }
  ]} returnPath="/app/form-submissions" /></SyntheticActionBoundary></section>
</main>);
