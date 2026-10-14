/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node regression runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const m = {exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/marketing/assembly/assemblyMotion.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:m.exports,module:m});
const {assemblyPose,assemblyCamera}=m.exports;
for(const count of [36,60]) {
 for(let i=0;i<count;i++) {
  const forward=[];
  for(let step=0;step<=400;step++) {
   const p=step/400, pose=assemblyPose(i,count,p);
   assert.ok([...pose.position,...pose.rotation,pose.scale].every(Number.isFinite));
   assert.ok(pose.position.every(v=>Math.abs(v)<8));
   assert.ok(pose.scale>0 && pose.scale<=1);
   if(step) assert.ok(Math.hypot(...pose.position.map((v,j)=>v-forward[step-1].position[j]))<.3,'No position discontinuity at stage boundaries');
   forward.push(pose);
  }
  for(let step=400;step>=0;step--) assert.deepEqual(assemblyPose(i,count,step/400),forward[step],'Scroll reversal is deterministic');
  assert.deepEqual(assemblyPose(i,count,-1),forward[0]);
  assert.deepEqual(assemblyPose(i,count,2),forward[400]);
 }
 // Final facade rows must not overlap vertically, even at full quality.
 const first=assemblyPose(0,count,1),next=assemblyPose(6,count,1);
 assert.ok(next.position[1]-first.position[1] > first.scale*1.35);
}
for(let step=0;step<=400;step++)assert.ok(assemblyCamera(step/400).every(Number.isFinite));
const cameras=[0,.25,.5,.75,1].map(p=>JSON.stringify(assemblyCamera(p)));
assert.equal(new Set(cameras).size,5,'Each stage has an authored viewpoint');
console.log('Homepage assembly: finite bounded poses, continuity, reversible full/compact choreography, non-overlapping final rows, and five camera stages passed.');
