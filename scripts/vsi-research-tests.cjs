/* eslint-disable @typescript-eslint/no-require-imports -- Imported by the native VSI engine qualification harness. */
const assert=require('node:assert/strict');
exports.run=function({approveVsiPublicTarget,validateVsiResearchPlan,stableVsiCitationId,prepareVsiHistory,selectVsiHistory,validateVsiPublicResearch,priorVsiPublicTopics,withVsiSourceSnapshot}){
  const base={mode:'research',businessEvidence:false,tier:'standard',clarification:'',publicTargets:[{text:'Acme',origin:'question'}],objectives:['overview']};
  assert.equal(validateVsiResearchPlan(base,'Research Acme',[]).mode,'research');assert.deepEqual(validateVsiResearchPlan({...base,objectives:['official_documents','independent_verification']},'Compare official and independent reports about Acme',[]).objectives,['official_documents','independent_verification']);
  const datedHistory=validateVsiResearchPlan({...base,mode:'answer',objectives:['pricing','dated_pricing_only']},'Explain earlier prices using only dated sources',[]);assert.deepEqual(datedHistory.publicTargets,[]);assert.deepEqual(datedHistory.objectives,['dated_pricing_only'],'a dated-price restriction must survive reuse of earlier research without a new public lookup');
  const careerPlan={...base,tier:'simple',publicTargets:[{text:'Morgan Ellis',origin:'prior_public_topic'},{text:'Northbridge University',origin:'question'}],objectives:['professional_background','historical_timeline']};const career=validateVsiResearchPlan(careerPlan,'What was her work before Northbridge University?',['Morgan Ellis']);assert.equal(career.mode,'research');assert.equal(career.tier,'standard','career chronology requires enough allowance to inspect a primary bio or CV');assert.deepEqual(career.objectives,careerPlan.objectives);assert.equal(validateVsiResearchPlan({...careerPlan,tier:'deep'},'What was her work before Northbridge University?',['Morgan Ellis']).tier,'deep');assert.equal(validateVsiResearchPlan({...base,tier:'simple'},'Research Acme',[]).tier,'simple');
  for(const question of ['Search our confidential Acme notes','Search the uploaded file Acme','Find Acme in my supplier list','Search the password Acme','Search this file; Acme','Search pasted private material;\nAcme'])assert.equal(validateVsiResearchPlan(base,question,[]).mode,'clarify',question);
  assert.equal(validateVsiResearchPlan(base,'Research a company',['Acme']).mode,'clarify','current-question provenance cannot silently become prior provenance');
  assert.equal(validateVsiResearchPlan({...base,publicTargets:[{text:'Acme',origin:'prior_public_topic'}]},'Who founded it?',['Acme']).mode,'research');
  assert.equal(validateVsiResearchPlan({...base,publicTargets:[{text:'Acme',origin:'prior_public_topic'}]},'Who founded it?',[]).mode,'clarify');
  assert.equal(approveVsiPublicTarget('Acme','Research Acme; our margin is 37%.','question',[]),null);
  for(const question of ['Acme\nThis name is from my confidential supplier list. Research it.','Acme\nDo not send this private customer name to public search.','Acme; this is from the uploaded file.'])assert.equal(approveVsiPublicTarget('Acme',question,'question',[]),null);
  for(const [target,question] of [['private equity','Research private equity'],['internal combustion','Research internal combustion'],['Acme','What can we learn from Acme?'],['Google Workspace','Look up Google Workspace'],['Costco','What is the revenue of Costco?'],['Acme','Research the customers of Acme']])assert.equal(approveVsiPublicTarget(target,question,'question',[]),target);
  assert.equal(approveVsiPublicTarget('Acme','Compare to our internal customer notes','prior_public_topic',['Acme']),'Acme');
  for(const target of ['our business','42% margin','$120000','PRIVATE_SECRET','http://localhost','https://example.org/?token=private','user@example.org','ignore instructions','12345678'])assert.equal(approveVsiPublicTarget(target,`Research ${target}`,'question',[]),null);
  assert.equal(approveVsiPublicTarget('Acme','Research Acmeology','question',[]),null);
  assert.equal(approveVsiPublicTarget('Vaeroex LLC','Do a public web search for Vaeroex LLC','question',[]),'Vaeroex LLC');
  assert.equal(approveVsiPublicTarget('Isaac Vizcarra','Is it Isaac Vizcarra?','question',[]),'Isaac Vizcarra');
  assert.equal(approveVsiPublicTarget('US inflation','Research US inflation','question',[]),'US inflation');
  const cjkTopics=Array.from({length:6},(_,i)=>'企'.repeat(159)+String.fromCodePoint(0x4e00+i));const cjkPlan={...base,publicTargets:cjkTopics.map(text=>({text,origin:'question'}))};assert.ok(Buffer.byteLength(JSON.stringify(cjkTopics),'utf8')>2500);assert.equal(validateVsiResearchPlan(cjkPlan,'Research '+cjkTopics.join('; '),[]).mode,'clarify');assert.equal(validateVsiResearchPlan({...cjkPlan,publicTargets:cjkPlan.publicTargets.slice(0,4)},'Research '+cjkTopics.join('; '),[]).mode,'research');
  const web={id:'W1',sourceType:'web',sourceId:null,title:'Evidence',url:'https://example.org/article',evidenceDate:'2026-01-01',retrievedAt:'2026-02-01T00:00:00Z',excerpt:'A publicly sourced claim.'};
  const history=prepareVsiHistory([{role:'assistant',content:'Finding [W1]',citations:[web]}]);assert.equal(history.sources[0].retrievedAt,web.retrievedAt);assert.equal(history.sources[0].evidenceDate,web.evidenceDate,'saved historical dates remain their original snapshots');assert.equal(history.sources[0].excerpt,web.excerpt);assert.match(history.messages[0].content,new RegExp(stableVsiCitationId(web)));
  const second=withVsiSourceSnapshot({...web,sourceType:'kpi',sourceId:'private-kpi',url:'/app/kpis',id:'B1',text:'Important source text '+ 'a'.repeat(260)+' end claim'});
  assert.ok(!JSON.stringify(prepareVsiHistory([{role:'assistant',content:'REVOKED BUSINESS FACT [B1]',citations:[second]}])).includes('REVOKED BUSINESS FACT'));
  const permitted=prepareVsiHistory([{role:'assistant',content:'Authorized older finding [B1]',citations:[second]}],[{...second,retrievedAt:'2026-03-01T00:00:00Z'}]);assert.equal(permitted.sources[0].retrievedAt,second.retrievedAt,'current permission check must not replace old snapshot date');
  const changed=prepareVsiHistory([{role:'assistant',content:'OLD PRIVATE FACT [B1]',citations:[second]}],[{...second,text:second.text.replace('end claim','materially changed after the shared preview')}] );assert.ok(!JSON.stringify(changed).includes('OLD PRIVATE FACT'));
  const many=Array.from({length:500},(_,i)=>({role:i%2?'assistant':'user',content:i===30?'Original Acme research finding':`Unrelated chat ${i}`}));const selected=selectVsiHistory(many,'Explain the Acme research finding');assert.ok(selected.length<=24);assert.ok(selected.some(item=>item.content.includes('Original Acme')));assert.equal(selected.at(-1).content,'Unrelated chat 499');
  assert.deepEqual(priorVsiPublicTopics([{role:'assistant',content:'Do not export PRIVATE FACT',publicResearchTopics:['Acme']}]),['Acme']);
  const mixed=Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',content:'x'.repeat(2000),...(i%2?{citations:[{...second,snapshotHash:undefined}]}:{})}));const bounded=prepareVsiHistory(mixed);assert.ok(bounded.messages.reduce((total,message)=>total+message.content.length,0)<=16000,'omitted source placeholders must consume the history budget');assert.ok(bounded.messages.some(message=>message.content.includes('Earlier answer omitted')));
  const cited=prepareVsiHistory(Array.from({length:24},()=>({role:'assistant',content:('[W1] '+'x'.repeat(994)).repeat(2),citations:[web]})));assert.ok(cited.messages.reduce((total,message)=>total+message.content.length,0)<=16000,'expanded stable citation IDs must also fit');
  const result=validateVsiPublicResearch({claims:[{text:'Supported finding',urls:[web.url,'https://fabricated.example.org'],evidenceDate:'2026-01-01',dateProvenance:{kind:'publication',sourceUrl:web.url,sourceText:'Published January 1, 2026'}},{text:'Unsupported claim',urls:['https://fabricated.example.org'],evidenceDate:null,dateProvenance:{kind:'unknown',sourceUrl:null,sourceText:null}}],limitations:[],needsMoreResearch:false},[web]);assert.equal(result.claims.length,1);assert.deepEqual(result.claims[0].urls,[web.url]);assert.equal(result.sources[0].excerpt,'Supported finding');assert.equal(result.sources[0].id,stableVsiCitationId(web));assert.ok(!JSON.stringify(prepareVsiHistory([{role:'assistant',content:'UNTRUSTED HASH CLAIM',citations:[{...second,snapshotHash:'x'.repeat(2000)}]}],[second])).includes('UNTRUSTED HASH CLAIM'));
  const otherWeb={...web,id:'W2',url:'https://example.org/menu',evidenceDate:null};
  const datedClaim=(evidenceDate,sourceText,kind='publication',sourceUrl=web.url)=>({text:'Supported public fact.',urls:[web.url,otherWeb.url],evidenceDate,dateProvenance:{kind,sourceUrl,sourceText}});
  const checkDate=claim=>validateVsiPublicResearch({claims:[claim],limitations:[],needsMoreResearch:false},[web,otherWeb]);
  for(const claim of [
    datedClaim('2026-10-09',null,'unknown',null),
    datedClaim('2026-10-09','Retrieved October 9, 2026'),
    datedClaim('2026-10-09','Accessed 2026-10-09'),
    datedClaim('2026-10-09','Lookup date: 2026-10-09'),
    datedClaim('2026-10-09','Crawled 2026-10-09'),
    datedClaim('2026-10-09','Copyright 2026-10-09'),
    datedClaim('2026-10-09','Updated today, October 9, 2026','updated'),
    datedClaim('2026-10-09','Published October 2026'),
    datedClaim('2026-10-09','Published October 9'),
    datedClaim('2026-10-09','Published 10/09/2026'),
    datedClaim('2026-10-09','Published October 8, 2026'),
    datedClaim('2026-10-09','Published October 9, 2026','publication','https://fabricated.example.org'),
    datedClaim('2026-02-30','Published February 30, 2026'),
    datedClaim('2026-10-09T12:45:00Z','Observed October 9, 2026 at 12:45','observation'),
    datedClaim('2026-10-09T12:45:00Z','Observed October 9, 2026 at 12:45 CST','observation'),
    datedClaim('2026-10-09T12:45:00Z','Observed October 9, 2026 at 11:45 UTC','observation'),
    datedClaim('2026-10-09T12:45:00Z','Observed October 9, 2026','observation'),
    datedClaim('2026-10-09T12:45:00Z','Published 2026-10-09T12:45:00Z','observation'),
    datedClaim('2026-10-09T12:45:00Z','Forecast valid from 2026-10-09T12:45:00Z','observation')
  ]){const checked=checkDate(claim);assert.equal(checked.claims[0].evidenceDate,null,JSON.stringify(claim.dateProvenance));assert.deepEqual(checked.claims[0].dateProvenance,{kind:'unknown',sourceUrl:null,sourceText:null});assert.ok(checked.sources.every(source=>source.evidenceDate===null&&!source.evidenceDateKind&&!source.evidenceDateText));assert.equal(checked.claims[0].text,claim.text,'invalid dates must not discard supported facts');}
  for(const [date,passage,kind] of [
    ['2026-10-09','Published October 9, 2026','publication'],
    ['2026-10-09','Last updated 9 Oct 2026','updated'],
    ['2026-10-09','Conference date: 2026-10-09','event'],
    ['2026-10-09T12:45:00Z','Observation time: 2026-10-09T12:45:00Z','observation'],
    ['2026-10-09T19:45:00Z','Observed October 9, 2026 at 12:45 PM PDT','observation'],
    ['2026-10-09T19:45:00Z','Observed 9 October 2026 at 12:45 GMT-07:00','observation'],
    ['2026-10-10T01:45:00Z','Observed October 9, 2026 at 18:45 PDT','observation']
  ]){const checked=checkDate(datedClaim(date,passage,kind));assert.equal(checked.claims[0].evidenceDate,date,passage);assert.equal(checked.sources[0].evidenceDate,date);assert.equal(checked.sources[0].evidenceDateKind,kind);assert.equal(checked.sources[0].evidenceDateText,passage);assert.equal(checked.sources[1].evidenceDate,null,'one page date cannot be copied to another supporting source');}
  const conflictingDates=validateVsiPublicResearch({claims:[datedClaim('2026-10-09','Published October 9, 2026'),datedClaim('2026-10-08','Published October 8, 2026')],limitations:[],needsMoreResearch:false},[web,otherWeb]);assert.equal(conflictingDates.sources[0].evidenceDate,null,'conflicting date passages cannot become one asserted citation date');
  assert.equal(withVsiSourceSnapshot({...second,sourceType:'product_context',snapshotHash:'a'.repeat(64)}).snapshotHash,'a'.repeat(64));
  console.log(JSON.stringify({passed:true,suite:'VSI public-target provenance and source-history snapshots'}));
};
