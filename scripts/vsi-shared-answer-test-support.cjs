/* Credential-free synthetic provider replies, never a live output adapter. */
function observationsFor(payload,all=false){return payload.qualitative_sources.flatMap(source=>source.facts.slice(0,all?undefined:1).map((_,factIndex)=>({ref:source.ref,binding:source.binding,factIndex})));}
function sharedReply(payload,parts={}){return{observations:observationsFor(payload,true),results:[],hypotheses:[],missing_information:[],next_checks:[],...parts};}
function usefulSharedReply(payload,caseId){
 const answer=sharedReply(payload),premises=answer.observations;
 if(caseId==='qualified-brief'){
  answer.missing_information=[{premises,text:'Which invoice, if any, is linked to each payment-held order? The supplied partial observations do not establish invoice/order correspondence or assign an outstanding balance to an order.'}];
  answer.next_checks=[{premises,text:'Ask for the held orders’ existing invoice references, if any, and inspect payment status for owner-confirmed correspondences before deciding whether a hold needs review. Do not assume an unpaid invoice caused a hold.'}];
 }else{
  answer.missing_information=[{premises,text:'The single-day balance and dispatch/backlog counts are different quantities with unknown coverage. They do not establish a billing-to-operations relationship or explain a delay.'}];
  answer.next_checks=[{premises,text:'Check the invoice/order linkage, common observation window and population coverage before making a comparison. Obtain invoice/payment-status history and dispatch identifiers before considering a causal explanation.'}];
 }
 return answer;
}
module.exports={observationsFor,sharedReply,usefulSharedReply};
