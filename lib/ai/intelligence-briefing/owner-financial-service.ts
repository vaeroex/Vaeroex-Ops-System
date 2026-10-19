import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { loadQboJournalPeriod } from "@/lib/integrations/qbo-customer/journal-accounting";
import { beginGoogleSheetsRead, bindGoogleSheetsRead } from "@/lib/integrations/google-sheets/read-authority";
import { buildOwnerFinancialBriefingPackage } from "./owner-financial-package";
import { parseIntelligenceBriefingArtifact } from "./storage";
import { generateIntelligenceBriefing, intelligenceBriefingProviderAttemptTelemetry } from "./service";
import { isIntelligenceBriefingEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { enforceAIProviderRateLimits } from "@/lib/ai/provider-guardrails";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordVaeroexAiUsage, type VaeroexTokenUsage } from "@/lib/ai/usage";
import { AIProviderExecutionError } from "@/lib/ai/providers/provider-manager";

const querySchema = z.object({connectionId:z.string().uuid(),from:z.string().date(),to:z.string().date()}).strict();
type Access = {supabase:SupabaseClient<Database>;workspaceId:string;user:{id:string;email?:string}};
function rpc(client:SupabaseClient<Database>, name:string, args:Record<string,unknown>) {
  return (client.rpc.bind(client) as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>)(name,args);
}
export async function loadOwnerFinancialBriefContext(access:Access,input:unknown) {
  const query=querySchema.parse(input), day=86400000;
  const start=Date.parse(query.from),end=Date.parse(query.to),duration=(end-start)/day+1;
  if(duration<1||duration>366)throw Error("Choose a period of one to 366 days.");
  const dates=[{from:new Date(start-duration*day).toISOString().slice(0,10),to:new Date(start-day).toISOString().slice(0,10)},query];
  const periods=[];
  for(const date of dates){
    const loaded=await loadQboJournalPeriod(access,{connectionId:query.connectionId,periodStart:date.from,periodEnd:date.to});
    if(loaded.state==="available")periods.push(loaded.data);
    else if(date===query)throw Error(loaded.reason);
  }
  // Stable within a UTC day; changed native receipts produce a new generation key.
  const briefingPackage=buildOwnerFinancialBriefingPackage({workspaceId:access.workspaceId,periods,asOf:new Date().toISOString().slice(0,10)+"T00:00:00.000Z"});
  const dependencies=periods.map(p=>({connectionId:p.connectionId,periodStart:p.periodStart,periodEnd:p.periodEnd,receiptHash:p.receiptHash}));
  const stored=await rpc(access.supabase,"read_owner_financial_brief_v1",{p_workspace_id:access.workspaceId,p_generation_key:briefingPackage.generationKey});
  if(stored.error)throw Error("Private briefing storage could not be verified.");
  const row=stored.data as {status?:string;artifact?:unknown}|null;
  const artifact=parseIntelligenceBriefingArtifact(row?.artifact);
  if(row?.status==="completed"&&(!artifact||artifact.generationKey!==briefingPackage.generationKey||artifact.workspaceId!==access.workspaceId))throw Error("Stored briefing validation failed.");
  return {query,periods,briefingPackage,dependencies,status:row?.status||"ready",artifact};
}

/** Call only after application owner access. Native RPCs independently enforce the current owner/session. */
export async function generateOwnerFinancialBrief(access:Access,input:unknown) {
  const startedAtMs=Date.now(),context=await loadOwnerFinancialBriefContext(access,input);
  if(context.status!=="ready")return context;
  if(!isIntelligenceBriefingEnabled())throw Error("Briefing generation is disabled in this environment.");
  const limit=await isUsageLimitReached({supabase:access.supabase,userId:access.user.id,email:access.user.email,workspaceId:access.workspaceId,limit:"ai_runs_this_month"});
  if(!limit.subscription.allowed||limit.reached)throw Error("Intelligence usage is unavailable for this workspace.");
  await enforceAIProviderRateLimits({userId:access.user.id,workspaceId:access.workspaceId,operation:"owner_financial_briefing_v1"});
  const admin=createSupabaseAdminClient();if(!admin)throw Error("Briefing storage is unavailable.");
  const ticket=await beginGoogleSheetsRead(access.supabase,access.workspaceId,access.user.id);
  const result=await rpc(access.supabase,"claim_owner_financial_brief_v1",{p_workspace_id:access.workspaceId,p_dependencies:context.dependencies,p_generation_key:context.briefingPackage.generationKey});
  const claim=result.data as {status?:string;id?:string;leaseId?:string}|null;
  if(result.error||!claim)throw Error("Private briefing could not be claimed.");
  if(claim.status!=="claimed")return loadOwnerFinancialBriefContext(access,input);
  let generatedUsage:VaeroexTokenUsage|null=null;
  try{
    await bindGoogleSheetsRead(access.supabase,ticket.ticketId,[]);
    const generated=await generateIntelligenceBriefing({supabase:access.supabase,workspaceId:access.workspaceId,readTicketId:ticket.ticketId,briefingPackage:context.briefingPackage,startedAtMs});
    generatedUsage=generated.usage;
    if(!parseIntelligenceBriefingArtifact(generated.artifact))throw Error("Generated briefing failed stored-artifact validation.");
    const saved=await rpc(admin,"finish_owner_financial_brief_v1",{p_run_id:claim.id,p_lease_id:claim.leaseId,p_artifact:generated.artifact});
    if(saved.error||saved.data!==true)throw Error("Evidence changed or private storage failed.");
    await recordVaeroexAiUsage({supabase:admin,workspaceId:access.workspaceId,userId:access.user.id,agentType:"owner_financial_briefing_v1",usage:generated.usage});
  }catch(error){
    await rpc(admin,"finish_owner_financial_brief_v1",{p_run_id:claim.id,p_lease_id:claim.leaseId,p_artifact:null});
    const attempts=error instanceof AIProviderExecutionError?error.attempts:[];
    const totals=attempts.reduce((a,b)=>({inputTokens:a.inputTokens+b.inputTokens,outputTokens:a.outputTokens+b.outputTokens,totalTokens:a.totalTokens+b.totalTokens}),{inputTokens:0,outputTokens:0,totalTokens:0});
    await recordVaeroexAiUsage({supabase:admin,workspaceId:access.workspaceId,userId:access.user.id,agentType:"owner_financial_briefing_v1",usage:generatedUsage?{...generatedUsage,status:"failed"}:{...totals,model:attempts.at(-1)?.runtimeModel||"unavailable",latencyMs:Date.now()-startedAtMs,status:"failed",metadata:{workflow:"owner_financial_briefing_v1",provider_attempts:attempts.map(intelligenceBriefingProviderAttemptTelemetry)} as Json}});
    throw error;
  }
  return loadOwnerFinancialBriefContext(access,input);
}
