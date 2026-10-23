import type { VsiCitation } from "@/lib/vsi/types";

export type SharedVsiRelationship = {fact:string;inputSourceIds:string[]};
/** The closed financial boundary is application-owned. Reject recognized joint
 * finance claims outside its exact text and require both supporting originals.
 * This is a bounded guard, not a general semantic/answer-quality proof. */
export function validateSharedVsiRelationships(answer:{content:string;citationIds:string[]},sources:VsiCitation[],relationships:SharedVsiRelationship[]) {
 const cited=new Set([...answer.citationIds,...[...answer.content.matchAll(/\[([BWP]\d+)\]/g)].map(match=>match[1])]);
 let remaining=answer.content.replace(/\[([BWP]\d+)\]/g,'').trim();
 for(const relationship of relationships) {
  const inputs=relationship.inputSourceIds.map(id=>sources.find(source=>source.sourceId===id));
  if(inputs.some(source=>!source)) throw new Error('shared_relationship_dependency_missing');
  if(remaining.includes(relationship.fact)) {
   if(inputs.some(source=>!cited.has(source!.id))) throw new Error('shared_relationship_citation_missing');
   // A substring can be negated by its surrounding prose. Only remove an
   // application-owned fact when it is the entire standalone claim line.
   const lines=remaining.split('\n');
   if(lines.some(line=>line.includes(relationship.fact)&&line.trim()!==relationship.fact)) throw new Error('shared_relationship_claim_changed');
   remaining=lines.filter(line=>line.trim()!==relationship.fact).join('\n');
  }
 }
 // The model cannot disable checking by dropping citations.
 if(relationships.length && /\b(?:matched transaction|payment shortfall|financial stages?|amounts?[^.\n]{0,60}(?:added|combined|reconciled)|(?:add|combine|reconcile)[^.\n]{0,60}(?:amounts?|totals?)|order[^.\n]{0,80}(?:invoice|billed)|(?:invoice|billed)[^.\n]{0,80}order|caused?|because of|due to|therefore)\b/i.test(remaining)) throw new Error('shared_relationship_claim_changed');
}
