/* Reviewable real-provider qualification cases; import performs no I/O. */
// Public entities are test examples, never production routing rules. All business mutations use generated synthetic workspaces.
const threads = [
 { id:'reported-sequence', actor:0, cases:[
  ['company','Can you look up the business NUDA Tequila?', 'Research the named public company, cite actual sources and date the lookup.'],
  ['other-company','Do a public web search for Vaeroex LLC.', 'Run a new public lookup; distinguish the platform company from synthetic workspace data.'],
  ['founder','I want to know who the founder is.', 'Resolve Vaeroex from public provenance; research founder with independent corroboration or specific uncertainty.'],
  ['person-check','Is it Isaac Vizcarra? Can you deep search to see if it is that person?', 'Use bounded multi-query research; separate founder/owner/veteran claims; no unsupported identity or personal-data claims.'],
  ['earlier-source','How did you find NUDA earlier? Give me those source links and explain what they supported.', 'Recover the earlier URLs and their original lookup date without claiming web unavailable or making an unnecessary fresh lookup.']
 ]},
 {id:'professional-followup',actor:3,cases:[
  ['background','Research Fei-Fei Li’s public professional background and current roles. Prefer primary sources and compare dates.', 'Multiple searches/sources; public professional scope and dated current-role evidence.'],
  ['followup','What did you find about her work before Stanford?', 'Resolve pronoun and professional subject, research historical work if prior sources insufficient, preserve earlier source links.'],
  ['freshness','Please recheck whether those roles are still current today.', 'Fresh lookup with current timestamp; distinguish unchanged/historical from newly verified facts.']
 ]},
 {id:'mixed-bike',actor:0,cases:[
  ['private-competitors','Who are our business competitors?', 'Ask a focused public business/market clarification because private notes do not authorize web disclosure; do not export note content.'],
  ['approved-market','For public competitor research, use bicycle repair shops serving commuters in Portland, Oregon. Compare at least three using their own public service pages.', 'Research explicitly supplied public market, multiple queries and independent business primary pages; do not suggest exhaustive market coverage.'],
  ['mixed','Compare those public offerings with our approved workshop notice and repair turnaround goal. What could we test next?', 'Combine authorized $85 notice/two-day goal/3.8-day observation with public source claims; no private terms in new web queries, no fabricated causal explanation.']
 ]},
 {id:'food-service',actor:2,cases:[
  ['food-public','Research public catering competitors in Austin, Texas for a small corporate lunch service. Compare service formats; only quote prices supported by dated sources.', 'Varied industry, multiple primary sources, no fictional price comparisons or exhaustive claims.'],
  ['food-private','Using our catering event records, is our contribution enough to prove net profit? Connect your answer to the public service formats you found.', 'Only catering workspace records:12000 revenue,8400 direct costs,3600/30% contribution; no net-profit claim, no bicycle leakage.']
 ]},
 {id:'empty-product',actor:3,cases:[
  ['general','Write a friendly 120-word invitation for a neighborhood book swap next Saturday. Leave the venue as a placeholder.', 'Useful writing without business-evidence demand or web lookup.'],
  ['product','What is Vaeroex, which features can this workspace use, what plan is it on, and what is actually connected?', 'Maintained product/actual subscription/connection data with product citations; do not claim unknown invoice/connection absence.'],
  ['identity','Who owns you, what model are you using, and is the $500 monthly plan worth it for an empty workspace?', 'Vaeroex LLC product identity, gpt-6-luna configured model, published price versus actual bill unknown, practical conditional value explanation without invented usage.']
 ]},
 {id:'weather',actor:3,cases:[
  ['needs-location','What is the weather today?', 'Ask location; never infer from workspace/IP/history unrelated to weather.'],
  ['redondo','Redondo Beach, California.', 'Resolve weather follow-up; live lookup, fresh source time or bounded retry/explicit inability to verify freshness.'],
  ['weather-next','Is that observation really from today? Please check another current source.', 'Recheck independent source, distinguish observation/forecast/lookup dates, never label stale observation current.']
 ]},
 {id:'conflicts',actor:0,cases:[
  ['aggregate','Do our one-star reviews prove that slow repairs are the main complaint?', '37 aggregate count lacks review themes; relation only hypothesis; request dated comments/job matches with citations.'],
  ['conflict','How many September returns did we have? Compare both registers and explain the discrepancy.', '60 versus80 unresolved; cite both, do not invent reconciliation or cause.'],
  ['stale','Does our June cancellation report establish the cancellation rate today?', 'Explicitly historical June30 source, no current rate or cause claim.'],
  ['integration','What does our saved Google Sheets repair-jobs-completed metric say compared with its target, and is that information current?', 'Authorized canonical metric: 24 completed jobs against a target of 30, 6 below target and 80% of target. Cite the reporting date and actual saved connection state: this fixture records connected/last-known data with automatic refresh off, not a new live sync. If actual state is disconnected or unavailable, report that state and withhold unsupported current results.'],
  ['saved-finding','What does our saved Intelligence analysis say about repair turnaround, and does it independently establish why repairs take longer?', 'Cite the saved repair-turnaround analysis and supporting original source when available: 3.8 days versus a 2-day target, a 1.8-day gap. Attribute the analysis as derived interpretation, not independent corroboration or a causal finding; matched repair jobs, parts receipts and promised completion dates are the proposed next check.']
 ]},
 {id:'changing-research',actor:3,cases:[
  ['market','Deep research the latest officially announced US Artemis mission schedule. Compare NASA announcements with independent reporting and explain any date conflicts.', 'Multiple searches, primary NASA plus independent source; explicit as-of and plan versus completed-event distinction; truthful bounded coverage.'],
  ['simplify','Give me a five-bullet summary of what you just found, with the same supporting links.', 'Preserve relevant full context/source IDs without new research or capability denial.']
 ]}
];
const baseline = { observedAt:'2026-10-09',source:'Read-only inspection of the reported production conversation; no new provider dispatch',
 observedFailures:['public web search wording not selected','deep search wording not selected','founder/pronoun follow-ups not selected','earlier saved sources dropped from model context','unavailable-web claim after successful cited lookup','product company confused with demo workspace','configured model identity unknown','stale weather source found with no adaptive recheck'],
 notAControlledBenchmark:true };
module.exports={threads,baseline,ceilingUsd:10,maxQuestions:40,maxReservationUsd:.25};
