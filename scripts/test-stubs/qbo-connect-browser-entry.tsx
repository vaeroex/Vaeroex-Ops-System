import { hydrateRoot } from "react-dom/client";
import { QboAuthorizationForm } from "../../components/integrations/QboAuthorizationForm";

hydrateRoot(document.getElementById("fixture")!, <QboAuthorizationForm>
  <input name="businessEntityId" type="hidden" value="synthetic-entity" />
</QboAuthorizationForm>);
