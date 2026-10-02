import { hydrateRoot } from "react-dom/client";
import { ErasureApprovalForm } from "../../app/app/settings/integrations/google-sheets/erasure/[requestId]/ErasureApprovalForm";
import type { ErasureScope } from "../../app/app/settings/integrations/google-sheets/erasure/scope";

const root = document.getElementById("approval");
if (root) {
  const scope = JSON.parse(root.dataset.scope ?? "null") as ErasureScope;
  hydrateRoot(root, <ErasureApprovalForm scope={scope} />);
}
