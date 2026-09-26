import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { CredentialEnvelopeSchema } from "@/lib/integrations/credentials/contracts";
import type { CredentialKms } from "@/lib/integrations/credentials/kms";
import { SQUARE_API_VERSION } from "@/lib/integrations/providers/square/contracts";
import { parseSquarePaymentResponse, squarePaymentFingerprint, squarePaymentResponseFingerprint } from "@/lib/integrations/providers/square/payment-responses";
import { customerFingerprint as fp } from "./customer-flow";
import type { InternalRpc } from "./handlers";

const uuid=z.string().uuid(), hash=z.string().regex(/^sha256:[a-f0-9]{64}$/), time=z.string().datetime({offset:true});
const kmsKey="projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials";
export const CustomerReadCommandSchema=z.object({scanId:uuid,leaseId:uuid,leaseFingerprint:hash}).strict();
type Command=z.infer<typeof CustomerReadCommandSchema>;
const leaseSchema=CustomerReadCommandSchema.extend({status:z.literal("leased"),connectionId:uuid,
  generation:z.number().int().positive().safe(),workspaceId:uuid,businessEntityId:uuid,actorId:uuid,sessionId:uuid,
  windowStart:time,windowEnd:time}).strict();
const observationSchema=z.object({paymentFingerprint:hash,versionFingerprint:hash,
  paymentStatus:z.enum(["approved","completed","canceled","failed","pending","unknown"]),
  occurredAt:time,observedAt:time,sourceFingerprint:hash}).strict();
const pageSchema=z.object({scanId:uuid,leaseId:uuid,leaseFingerprint:hash,responseFingerprint:hash,
  observations:z.array(observationSchema).max(100),hasMore:z.boolean()}).strict();
export type CustomerPaymentsPage=z.infer<typeof pageSchema>;
const denied=()=>new Error("square_customer_read_requires_reconciliation");

/** Called only by the authenticated runtime after an atomic customer claim.
 * Credentials and provider IDs stay in this broker. This deliberately imports
 * only the shared provider parser, not the internal-seller permit handlers. */
export function createCustomerPaymentsBroker(input:{rpc:InternalRpc;kms:CredentialKms;network?:typeof fetch;now?:()=>Date}) {
  return async (raw:Command):Promise<CustomerPaymentsPage>=>{
    const command=CustomerReadCommandSchema.parse(raw),now=input.now??(()=>new Date());
    const stored=z.object({credentialId:uuid,credentialVersion:z.literal(1),ciphertextBase64:z.string().min(16).max(131072),
      aadContext:z.record(z.string(),z.unknown()),aadDigest:hash,kmsKeyResource:z.literal(kmsKey),
      merchantId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),accessExpiresAt:time,
      providerLocationId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$/),locationFingerprint:hash,
      windowStart:time,windowEnd:time,workspaceId:uuid,connectionId:uuid,generation:z.number().int().positive().safe()
    }).strict().parse(await input.rpc("credential",command));
    const aad={providerKey:"square",environment:"production",projectId:"vaeroex-integrations-prod",workspaceId:stored.workspaceId,
      connectionId:stored.connectionId,generation:stored.generation,credentialId:stored.credentialId,credentialVersion:stored.credentialVersion};
    if(canonicalContractJson(aad)!==canonicalContractJson(stored.aadContext)||stored.aadDigest!==fp(["square-production-customer-aad-v1",
      stored.workspaceId,stored.connectionId,stored.generation,stored.credentialId,stored.credentialVersion])||
      stored.locationFingerprint!==fp(["square-customer-location-v1",stored.connectionId,stored.generation,stored.providerLocationId])||
      Date.parse(stored.accessExpiresAt)<=now().getTime()||Date.parse(stored.windowEnd)>now().getTime()||
      Date.parse(stored.windowEnd)-Date.parse(stored.windowStart)<=0||Date.parse(stored.windowEnd)-Date.parse(stored.windowStart)>86400000)throw denied();
    const ciphertext=Buffer.from(stored.ciphertextBase64,"base64"),additionalAuthenticatedData=Buffer.from(canonicalContractJson(aad));
    let plaintext:Uint8Array|undefined;
    try {
      plaintext=await input.kms.decrypt({keyResource:kmsKey,ciphertext,additionalAuthenticatedData});
      const credential=CredentialEnvelopeSchema.parse(JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(plaintext)));
      if(credential.providerKey!=="square"||credential.environment!=="production"||
        credential.externalAuthorizedEntityReference!==stored.merchantId||!credential.grantedScopes.includes("PAYMENTS_READ")||
        Date.parse(credential.accessExpiresAt)!==Date.parse(stored.accessExpiresAt))throw denied();
      z.object({authorized:z.literal(true)}).strict().parse(await input.rpc("authorize_page",command));
      const query={begin_time:new Date(stored.windowStart).toISOString(),end_time:new Date(stored.windowEnd).toISOString(),
        location_id:stored.providerLocationId,limit:"100",sort_order:"ASC"};
      const response=await(input.network??fetch)(`https://connect.squareup.com/v2/payments?${new URLSearchParams(query)}`,{
        method:"GET",headers:{Authorization:`Bearer ${credential.accessToken}`,"Square-Version":SQUARE_API_VERSION},
        redirect:"error",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(15000)});
      if(!response.ok||response.redirected||!response.body){await response.body?.cancel();throw denied();}
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,value:unknown;
      try{
        for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;
          if(size>2097152||chunks.length>=1024){part.value.fill(0);throw denied();}chunks.push(part.value);}
        const bytes=Buffer.concat(chunks);try{value=JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
      }finally{for(const chunk of chunks)chunk.fill(0);await reader.cancel().catch(()=>undefined);reader.releaseLock();}
      const parsed=parseSquarePaymentResponse({providerKey:"square",providerEnvironment:"production",apiVersion:SQUARE_API_VERSION,
        operation:"list_payments",connectionAuthority:{workspaceId:stored.workspaceId,connectionId:stored.connectionId,providerEntityType:"merchant",providerEntityId:stored.merchantId},
        requestContext:{authorizedLocationIds:[stored.providerLocationId],locationId:stored.providerLocationId,query},response:value});
      if(parsed.outcome!=="accepted")throw denied();
      const observedAt=now().toISOString();
      const observations=parsed.value.items.map(item=>{
        // List Payments filters creation time. updated_at may be outside that
        // window; preserve the shared parser's version fingerprint separately.
        const occurredAt=item.createdAt;
        if(!item.id||item.locationId!==stored.providerLocationId||!occurredAt||Date.parse(occurredAt)<Date.parse(stored.windowStart)||
          Date.parse(occurredAt)>Date.parse(stored.windowEnd)||Date.parse(occurredAt)>Date.parse(observedAt))throw denied();
        const row={paymentFingerprint:fp(["square-customer-payment-v1",stored.connectionId,stored.generation,stored.merchantId,item.id]),
          versionFingerprint:squarePaymentFingerprint(item),paymentStatus:(item.status??"UNKNOWN").toLowerCase(),occurredAt,observedAt};
        return observationSchema.parse({...row,sourceFingerprint:fp(["square-customer-observation-v1",command.scanId,
          row.paymentFingerprint,row.versionFingerprint,stored.locationFingerprint,row.paymentStatus,occurredAt,observedAt])});
      });
      return pageSchema.parse({...command,responseFingerprint:squarePaymentResponseFingerprint(parsed.value),observations,
        hasMore:parsed.value.pagination.cursorPresent});
    }finally{plaintext?.fill(0);ciphertext.fill(0);additionalAuthenticatedData.fill(0);}
  };
}

/** One request is claimed once. A lost commit acknowledgement causes only a
 * checked status read, never another provider fetch or commit retry. */
export function createCustomerPaymentsRuntime(input:{rpc:InternalRpc;readPage(command:Command):Promise<unknown>}){
  return async()=>{
    const leaseId=randomUUID(),leaseFingerprint=fp(["square-customer-lease-v1",leaseId]);
    const raw=await input.rpc("claim",{leaseId,leaseFingerprint});
    if(z.object({status:z.literal("idle")}).strict().safeParse(raw).success)return {status:"idle"};
    const lease=leaseSchema.parse(raw);
    if(lease.leaseId!==leaseId||lease.leaseFingerprint!==leaseFingerprint)throw denied();
    const command={scanId:lease.scanId,leaseId,leaseFingerprint};
    let page:CustomerPaymentsPage;
    try{
      page=pageSchema.parse(await input.readPage(command));
      if(page.scanId!==command.scanId||page.leaseId!==leaseId||page.leaseFingerprint!==leaseFingerprint)throw denied();
    }catch{
      try{await input.rpc("fail",command);}catch{/* A lost failure acknowledgement is not permission to retry. */}
      throw denied();
    }
    const commit={...command,responseFingerprint:page.responseFingerprint,observations:page.observations,hasMore:page.hasMore,
      commandFingerprint:fp(["square-customer-page-v1",command.scanId,leaseId,page.responseFingerprint,
        page.observations.map(row=>row.sourceFingerprint).join(","),String(page.hasMore)])};
    try{
      return z.object({status:z.literal("committed"),observationCount:z.number().int().min(0).max(100),nonEconomic:z.literal(true),
        historicalCompleteness:z.literal("unknown")}).strict().parse(await input.rpc("commit",commit));
    }catch{
      const receipt=z.object({status:z.enum(["leased","committed","uncertain"]),nonEconomic:z.literal(true),historicalCompleteness:z.literal("unknown")})
        .strict().parse(await input.rpc("reconcile",command));
      if(receipt.status!=="committed")throw denied();
      return receipt;
    }
  };
}
