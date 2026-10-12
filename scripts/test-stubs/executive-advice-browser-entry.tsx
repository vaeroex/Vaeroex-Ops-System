import { hydrateRoot } from "react-dom/client";
import { IntelligenceSignalInbox } from "../../components/intelligence/IntelligenceSignalInbox";
import { BusinessHealthAnalysisPanel } from "../../components/intelligence/BusinessHealthAnalysisPanel";

const data = JSON.parse(document.getElementById("fixture-data")!.textContent!);
hydrateRoot(document.getElementById("findings")!, <IntelligenceSignalInbox {...data.findings} />);
hydrateRoot(document.getElementById("health")!, <BusinessHealthAnalysisPanel {...data.health} />);
