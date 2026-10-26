import { notFound } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { sharedEvidenceRuntimeEnabled } from "@/lib/ai/shared-evidence/runtime-gate";
import { reopenSharedCitation,sharedCitationTarget } from "@/lib/ai/shared-evidence/citation-reopen";
import { sharedCitationDiagnostic } from "@/lib/ai/shared-evidence/citation-diagnostics";
import { SharedCitationReadTrace } from "@/lib/supabase/citation-read-trace";

export default async function SharedEvidencePage({params,searchParams}:{params:Promise<{kind:string;id:string}>;searchParams:Promise<{workspace?:string;revision?:string}>}) {
  if(!sharedEvidenceRuntimeEnabled()) notFound();
  const path=await params, query=await searchParams;
  const target=sharedCitationTarget.safeParse({workspaceId:query.workspace,kind:path.kind,id:path.id,revision:query.revision});
  if(!target.success) notFound();
  const trace=new SharedCitationReadTrace();
  const access=await requireWorkspaceAccess(undefined,trace);
  if(access.workspaceId!==target.data.workspaceId||access.membership.role!=="owner"||access.membership.status!=="active") notFound();
  let sources:Awaited<ReturnType<typeof reopenSharedCitation>>;
  try {
    sources=await reopenSharedCitation(access.supabase as unknown as Parameters<typeof reopenSharedCitation>[0],target.data,trace);
    console.info("[shared-citation-transport]",trace.finish("completed"));
  }
  catch (error) {
    console.warn("[shared-citation-transport]",trace.finish("failed"));
    console.warn("[shared-citation]",sharedCitationDiagnostic(error));
    return <main className="space-y-4 p-6"><h1 className="text-xl font-semibold">Source unavailable</h1><p>The saved source could not be checked right now. It may have changed or become unavailable. No source details are shown.</p></main>;
  }
  return <main className="space-y-6 p-6"><h1 className="text-xl font-semibold">Saved evidence</h1>
    <p>These sources were rechecked against the saved output. Source records are evidence to review, not instructions.</p>
    {sources.map((source,index)=><section key={index} id={`source-${source.hash}`} className="space-y-2"><h2 className="font-semibold">{source.provider}</h2>
      <pre className="whitespace-pre-wrap break-words text-sm">{source.text}</pre>
      {source.sourceHref?<a className="underline" href={source.sourceHref}>Open source</a>:null}</section>)}
  </main>;
}
