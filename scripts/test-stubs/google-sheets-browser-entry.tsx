import { hydrateRoot } from "react-dom/client";
import { GoogleSheetsMappingEditor } from "../../components/integrations/google-sheets/GoogleSheetsMappingEditor";
import { GoogleSheetsAuthorizationForm } from "../../components/integrations/google-sheets/GoogleSheetsAuthorizationForm";

const fixture = document.getElementById("fixture")!;
const props = JSON.parse(fixture.dataset.props!);
if (fixture.dataset.kind === "mapping") hydrateRoot(fixture, <GoogleSheetsMappingEditor {...props} />);
else hydrateRoot(fixture, <GoogleSheetsAuthorizationForm mode={props.mode}>
  {props.mode === "connect" ? <><input name="businessEntityId" type="hidden" value={props.entityId} /><input name="displayName" type="hidden" value="Operations metrics" /></> : <input name="connectionId" type="hidden" value={props.connectionId} />}
</GoogleSheetsAuthorizationForm>);
