import Link from "next/link";
import { evidenceMappingSetupEnabled } from "@/lib/ai/shared-evidence/mapping-gate";
import { mappingTarget } from "@/lib/ai/shared-evidence/mapping";

export function EvidenceMappingLink(props: { workspaceId: string; provider: string; connectionId: string; owner: boolean; status: string }) {
  if (!evidenceMappingSetupEnabled() || !props.owner || props.status !== "connected") return null;
  const target = mappingTarget.safeParse(props);
  if (!target.success) return null;
  return <Link href={`/app/integrations/evidence-mapping?${new URLSearchParams(target.data)}`} className="inline-block min-h-11 py-3 text-sm underline">Review business correspondence</Link>;
}
