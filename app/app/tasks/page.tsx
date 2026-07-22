import { permanentRedirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function RetiredBusinessSignalsPage() {
  await requireWorkspacePage();
  permanentRedirect("/app/sources");
}
