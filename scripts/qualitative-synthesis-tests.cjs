/* eslint-disable @typescript-eslint/no-require-imports -- Repository offline TS loader. */
const assert=require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
const {validateQualitativeInterpretation:validate,renderQualitativeInterpretation:render}=require('../lib/ai/shared-evidence/qualitative-synthesis.ts');
assert.equal(require('../lib/ai/shared-evidence/qualitative-policy.ts').qualitativeSynthesisEnabled(),false);
const sources=[
 {ref:'file',binding:'a'.repeat(64),dependencies:['original-file'],facts:['The reviewed file reports delivery delays; coverage is incomplete and no cause is established.'],reported:'file',environment:'supporting'},
 {ref:'note',binding:'b'.repeat(64),dependencies:['original-note'],facts:['The approved Business Note reports staffing coverage; it is reported context, not measured performance.'],reported:'note',environment:'supporting'}
];
const value={premises:sources.map(s=>({ref:s.ref,binding:s.binding,quote:s.facts[0]})),hypothesis:'Staffing coverage may be relevant to delivery delays.',missing_information:'Whether staffing coverage and delivery delays concern comparable periods.',next_check:'Review staffing coverage alongside delivery delays.'};
assert.deepEqual(validate(value,sources),value);
const text=render(value,sources,ref=>` [${ref}]`);
assert.match(text,/Interpretation \(unverified hypothesis\)/);assert.match(text,/Reviewed file \(reported context\)/);assert.match(text,/Approved Business Note \(reported context\)/);assert.match(text,/not a measured finding or a calculation/);
let negativeCases=0;
const denied=(patch,context=sources)=>{assert.throws(()=>validate({...value,...patch},context));negativeCases++;};
denied({premises:[{...value.premises[0],ref:'fabricated'},value.premises[1]]});
denied({premises:[{...value.premises[0],binding:'c'.repeat(64)},value.premises[1]]});
denied({premises:[{...value.premises[0],quote:'The reviewed file reports delivery delays.'},value.premises[1]]});
denied({premises:[value.premises[0],value.premises[0]]});
for(const hypothesis of ['Staffing coverage may cause delivery delays.','Staffing coverage caused delivery delays.','Staffing coverage may explain 50% of delivery delays.','Staffing coverage may explain half of delivery delays.','Alice may be relevant to delivery delays.','Staffing coverage may be matched to delivery delays.','Staffing coverage may concern the same period as delivery delays.','The reviewed file may report staffing coverage.','Staffing coverage may be relevant to delivery delays. Revenue improved.'])denied({hypothesis});
denied({missing_information:'Whether staffing coverage caused delivery delays.'});
denied({next_check:'Review staffing coverage because it caused delivery delays.'});
denied({next_check:'Review staffing coverage with $200 of revenue.'});
denied({hypothesis:'Staffing coverage may be relevant.'});
denied({hypothesis:'Staffing coverage may be relevant to delivery delays １２３.'});
denied({hypothesis:'Staffing coverage may be relevant to delivery delays 造成损失.'});
denied({},sources.map(s=>({...s,dependencies:['same-original-row']})));
const oneRow=sources.map(s=>({...s,dependencies:['shared:same-original-row']}));
assert.notEqual(oneRow[0].binding,oneRow[1].binding);
assert.throws(()=>validate({...value,premises:oneRow.map(s=>({ref:s.ref,binding:s.binding,quote:s.facts[0]}))},oneRow),/distinct_dependencies_required/);negativeCases++;
denied({},[{...sources[0],environment:'sandbox',installation:'first'},{...sources[1],environment:'production'}]);
denied({},sources.map((s,i)=>({...s,environment:'sandbox',installation:String(i)})));
denied({},sources.map(s=>({...s,environment:'sandbox'})));
assert.throws(()=>render({...value,next_check:'Review fraud.'},sources));negativeCases++;
console.log(JSON.stringify({novelQualifiedSynthesis:true,exactCompletePremises:true,negativeCases,semanticEntailmentProved:false,externalCalls:0}));
