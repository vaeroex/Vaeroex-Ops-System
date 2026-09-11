import "server-only";
import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema, Sha256FingerprintSchema } from "@/lib/integrations/contracts/primitives";
import { emptyDeterministicStateSnapshot } from "@/lib/integrations/deterministic/engine";
import { ActiveContributionSchema, DeterministicStateSnapshotSchema } from "@/lib/integrations/deterministic/contracts";
import { interpretSquareObservation, reconcileSquareInterpretations, SQUARE_INTERPRETATION_POLICY, SquareInterpretationContextSchema, type SquareObservationInput } from "./canonical-interpretation";
import { squareDescriptiveControl, updateSquareDescriptiveControls } from "./canonical-incremental";
import { squareVerifiedIntelligenceSnapshot } from "./canonical-explanation";

export interface SquareCanonicalTransactionClient {
  query(text:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>
}
const Prior=z.object({revision:z.number().int().positive().safe(),inputFingerprint:Sha256FingerprintSchema,
  output:z.object({controls:ActiveContributionSchema.array().max(1000),state:DeterministicStateSnapshotSchema}).passthrough().nullable()}).nullable();

/** Native checked administrative entry, deliberately not a browser route or
 * background registration. Caller owns an exclusive connection with finite
 * query/connection deadlines and TLS; this function never acquires credentials.
 * Authority locks, immutable facts and CAS checkpoint commit together. */
export async function interpretAdmittedSquareSources(client:SquareCanonicalTransactionClient, approvalFingerprint:string) {
  Sha256FingerprintSchema.parse(approvalFingerprint);
  let committing=false;
  try {
    await client.query("begin");
    await client.query("set local lock_timeout='5s'");
    await client.query("set local statement_timeout='20s'");
    const response=await client.query("select public.read_square_interpretation_inputs_v1($1) as value",[approvalFingerprint]);
    const value=z.object({inputs:z.array(z.unknown()).min(1).max(13),prior:Prior,asOf:IsoTimestampSchema}).strict().parse(response.rows[0]?.value);
    const inputs=value.inputs as SquareObservationInput[];
    const items=inputs.map(input=>{
      const age=Date.parse(value.asOf)-Date.parse(input.pending.observedAt);
      const item=interpretSquareObservation(input,SquareInterpretationContextSchema.parse({...input.pending.scope,authority:"active",asOf:value.asOf,
        freshness:age>=0 && age<=86_400_000?"observed":"stale",scan:"unknown"}));
      if(item.outcome!=="interpreted") throw new Error("square_interpretation_not_current");
      return item;
    });
    const relationships=reconcileSquareInterpretations(items);
    const fingerprint=contractSha256({policy:SQUARE_INTERPRETATION_POLICY,
      evidence:items.map(i=>({fact:i.fact.factFingerprint,freshness:i.freshness,scan:i.scan})).sort((a,b)=>a.fact.localeCompare(b.fact))});
    if(value.prior?.output && value.prior.inputFingerprint===fingerprint) {
      await client.query("commit");return {outcome:"replayed" as const,revision:value.prior.revision,modelCalls:0 as const};
    }
    const controls=items.map(squareDescriptiveControl);
    const prior=value.prior?.output?.state ?? emptyDeterministicStateSnapshot(items[0].scope);
    const result=updateSquareDescriptiveControls(prior,value.prior?.output?.controls??[],controls,value.asOf.slice(0,10));
    const output={policyVersion:SQUARE_INTERPRETATION_POLICY,economic:"blocked",historical:"unknown",
      facts:items.map(i=>i.fact),relationships,controls,state:result.snapshot,
      intelligence:squareVerifiedIntelligenceSnapshot(items,value.asOf),work:result.metrics};
    const committed=await client.query("select public.commit_square_interpretation_v1($1,$2,$3,$4::jsonb) as value",
      [approvalFingerprint,value.prior?.revision??0,fingerprint,JSON.stringify(output)]);
    const receipt=z.object({outcome:z.enum(["committed","replayed"]),revision:z.number().int().positive().safe()}).strict().parse(committed.rows[0]?.value);
    committing=true;await client.query("commit");
    return {...receipt,observations:items.length,relationships:relationships.links.length,work:result.metrics,modelCalls:0 as const};
  } catch {
    await client.query("rollback").catch(()=>{});
    // No raw provider/database payloads. An uncertain COMMIT is reconciled by
    // repeating the checked read, never by trusting an application audit label.
    return {outcome:committing?"commit_uncertain" as const:"rejected" as const,modelCalls:0 as const};
  }
}
