"use server";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { generateOwnerFinancialBrief } from "@/lib/ai/intelligence-briefing/owner-financial-service";

export async function generateOwnerFinancialBriefAction(form:FormData) {
  const access=await requireWorkspaceAccess();
  if(access.membership.role!=="owner"||access.membership.user_id!==access.user.id||access.membership.status!=="active")throw Error("Owner access is required.");
  const input={connectionId:String(form.get("connectionId")||""),from:String(form.get("from")||""),to:String(form.get("to")||"")};
  let failed=false;
  try{await generateOwnerFinancialBrief(access,input);}catch{failed=true;}
  revalidatePath("/app/intelligence/briefings/financial");
  redirect(("/app/intelligence/briefings/financial?"+new URLSearchParams({...input,...(failed?{failed:"1"}:{})})) as Route);
}
