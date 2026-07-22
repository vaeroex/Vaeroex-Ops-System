import { permanentRedirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function RetiredNotificationsPage() {
  await requireWorkspacePage();
  permanentRedirect("/app");
}
