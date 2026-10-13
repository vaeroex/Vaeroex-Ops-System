// Seeded, reviewed synthetic context. These are fixture records, not claimed
// provider output. Normal quote validation and contextual eligibility still run.
import { AS_OF, WORKSPACE_ID, profile } from "./data";
import { BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION, type BusinessNoteExtraction } from "@/lib/ai/business-notes/contracts";
import { validateBusinessNoteExtraction } from "@/lib/ai/business-notes/validation";
import { buildBusinessNoteContextRecordV1 } from "@/lib/ai/business-notes/contextual-contract";
import { sha256 } from "./hash";
import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import type { Database, Json } from "@/lib/supabase/types";
const original = "Coastal Kitchen has 54 seats and serves dinner Tuesday through Sunday and lunch on weekends. Smaller prep batches began in August. The October 12 supplier register marks CK-410 and CK-411 overdue. Maya will compare them with bank settlement and supplier statements before approving another payment. No delivery disruption has been recorded.";
const facts = original.split(/(?<=\.) /);
const extraction: BusinessNoteExtraction = {
  schemaVersion: BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION, extractionDisposition:"extractable", title:"Coastal Kitchen operating context", summary:original, noteType:"meeting_outcome", sourceClassification:"meeting_notes", departments:["Operations"], topics:["supplier invoices","service","prep batches"],peopleMentioned:[],customersMentioned:[],vendorsMentioned:[],projectsMentioned:[],
  explicitFacts:facts.map(statement=>({statement,sourceQuote:statement,confidence:1})),opinionsOrAssumptions:[],risks:[],opportunities:[],decisions:[],mentionedMetrics:[],reportingPeriod:{start:"2026-10-12",end:"2026-10-12",inferred:false,sourceQuote:"October 12"},evidenceTreatment:"context_only",extractionConfidence:1,missingContext:["Current bank settlement status"]
};
const validated = validateBusinessNoteExtraction(extraction,original);
if (!validated.ok) throw new Error(`Invalid synthetic context: ${validated.reason}`);
export const businessNotes: Database["public"]["Tables"]["business_notes"]["Row"][] = [{
  google_sheets_read_ticket_id:null,id:"00000000-0000-4000-8000-000000000150",workspace_id:WORKSPACE_ID,author_user_id:profile.id,original_note_text:original,original_file_id:null,source_text_hash:sha256(original),source_version:1,release_channel:"production",status:"approved",evidence_lifecycle_status:"active",user_observation_date:"2026-10-12",user_reporting_period_start:"2026-10-12",user_reporting_period_end:"2026-10-12",inferred_reporting_period_start:null,inferred_reporting_period_end:null,
  extraction_json:validated.value as unknown as Json,reviewed_extraction_json:validated.value as unknown as Json,source_spans_json:[],user_corrections_json:{},extraction_version:"business_note_extraction_v1",validator_version:"business_note_extraction_validator_v2",policy_version:"synthetic_reviewed_fixture",provider_name:null,model_used:null,fallback_used:false,provider_attempts_json:[],input_tokens:0,output_tokens:0,total_tokens:0,estimated_provider_cost_cents:0,latency_ms:null,provider_request_id:null,failure_reason:null,retry_count:0,approved_by:profile.id,approved_at:AS_OF,extracted_at:AS_OF,archived_at:null,deleted_at:null,created_at:AS_OF,updated_at:AS_OF
}];
export const contextualRecords = businessNotes.map(note=>buildBusinessNoteContextRecordV1({note,extraction:validated.value,userAddedContext:[],reviewedExtractionHash:snapshotHash(validated.value),evaluationDate:AS_OF.slice(0,10)})).filter(record=>record!==null);
