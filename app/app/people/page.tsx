import { permanentRedirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function RetiredPeoplePage() {
  await requireWorkspacePage();
  permanentRedirect("/app");
}
