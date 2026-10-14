import { comparisonSchema } from "@/lib/charts/comparison";
import response from "./chart-response.json";
import monthly from "./monthly-briefing.json";
import { WORKSPACE_ID } from "./data";
import type { VsiChat, VsiExchange } from "@/components/vsi/contracts";
import type { IntelligenceBriefingArtifact } from "@/lib/ai/intelligence-briefing/contracts";
// Recorded actual engine outputs; capture-only. Never shipped as a runtime fixture.
export const chartChat: VsiChat = {id:"coastal-financial-comparison",title:"Sales, costs and profitability",exchangeCount:1,createdAt:response.createdAt,updatedAt:response.createdAt};
export const chartExchange: VsiExchange = {id:"coastal-financial-answer",userMessage:response.question,answer:response.answer,citations:response.citations.map(source => source.comparisons ? {...source, comparisons:source.comparisons.map(chart => comparisonSchema.parse(chart))} : source),createdAt:response.createdAt};
export const monthlyBriefing = monthly as unknown as IntelligenceBriefingArtifact;
export function chartReadResponse(url: URL, method="GET") {
 if(method!=="GET" || url.searchParams.get("workspaceId")!==WORKSPACE_ID) throw new Error("Only the recorded workspace may read this capture.");
 if(url.pathname==="/api/vsi/conversations") return {workspaceId:WORKSPACE_ID,conversations:[chartChat],canEditBusinessNotes:false,nextCursor:null};
 if(url.pathname===`/api/vsi/conversations/${chartChat.id}`) return {workspaceId:WORKSPACE_ID,conversation:chartChat,exchanges:[chartExchange],canEditBusinessNotes:false};
 throw new Error("Read-only recording: no action performed.");
}
