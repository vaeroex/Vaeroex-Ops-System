import { hydrateRoot } from "react-dom/client";
import { CurrentIntegrations } from "../../components/integrations/CurrentIntegrations";
import { IntegrationDashboardSchema } from "../../lib/integrations/dashboard/model";

const initial = IntegrationDashboardSchema.parse(JSON.parse(document.getElementById("fixture-data")!.textContent!));
hydrateRoot(document.getElementById("fixture")!, <CurrentIntegrations initial={initial} />);
