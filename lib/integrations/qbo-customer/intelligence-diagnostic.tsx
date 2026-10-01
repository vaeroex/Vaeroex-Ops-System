import { qboCustomerStoredData, QboCustomerBrowseError } from "./server";
import { QboCoverageDiagnosticView, qboCoverageDiagnostic } from "./diagnostic-view";

export async function QboIntelligenceDiagnostic({ workspaceId }: { workspaceId: string }) {
  try {
    const data = await qboCustomerStoredData({}, workspaceId);
    return data ? <QboCoverageDiagnosticView diagnostic={qboCoverageDiagnostic(data.browser)} /> : null;
  } catch (error) {
    if (!(error instanceof QboCustomerBrowseError)) throw error;
    return error.reason === "denied" ? null : <QboCoverageDiagnosticView diagnostic={null} />;
  }
}
