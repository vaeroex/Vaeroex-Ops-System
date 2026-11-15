/* eslint-disable @typescript-eslint/no-require-imports -- Isolated pure-motion regression runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleResult = {exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/marketing/journey/journeyMotion.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:moduleResult.exports,module:moduleResult});
const {journeyCamera,journeyPanel,journeyFrame} = moduleResult.exports;
for (const count of [18,30]) {
  for (let i=0;i<count;i++) {
    const samples=[];
    for (let step=0;step<=500;step++) {
      const pose=journeyPanel(i,count,step/500);
      assert.ok([...pose.position,...pose.rotation,pose.scale].every(Number.isFinite));
      assert.ok(pose.position.every(v=>Math.abs(v)<30));
      assert.ok(pose.scale>0 && pose.scale<=1);
      if(step) assert.ok(Math.hypot(...pose.position.map((v,j)=>v-samples[step-1].position[j]))<.6,'Panel travel stays continuous');
      samples.push(pose);
    }
    for(let step=500;step>=0;step--) assert.deepEqual(journeyPanel(i,count,step/500),samples[step],'Reverse scrolling recreates the same pose');
    assert.deepEqual(journeyPanel(i,count,-1),samples[0]);
    assert.deepEqual(journeyPanel(i,count,2),samples[500]);
  }
  for(let bank=0;bank<3;bank++) {
    const points=Array.from({length:count/3},(_,row)=>journeyPanel(row*3+bank,count,1).position);
    assert.equal(new Set(points.map(p=>JSON.stringify(p))).size,points.length,'Final panels do not overlap');
    for(const p of points) assert.ok(Math.abs(p[0]-(bank-1)*7.8)<1.5,'Final panels resolve into three distinct offering branches');
  }
}
for(const compact of [false,true]) {
  let previous;
  for(let step=0;step<=500;step++) {
    const view=journeyCamera(step/500,compact);
    assert.ok([...view.position,...view.target].every(Number.isFinite));
    assert.ok(Math.hypot(...view.target.map((v,j)=>v-view.position[j]))>2,'Camera never loses its look direction');
    if(previous)assert.ok(Math.hypot(...view.position.map((v,j)=>v-previous.position[j]))<.8,'Camera is continuous through stage boundaries');
    previous=view;
  }
  const inside=journeyCamera(.5,compact).position;
  assert.ok(Math.abs(inside[0])<3.5 && Math.abs(inside[1])<2.3 && inside[2]<-8,'Camera genuinely travels inside the central structure');
  assert.ok(journeyCamera(0,compact).position[2]>0);
}
for(let i=0;i<9;i++)for(let step=0;step<=100;step++)assert.ok(journeyFrame(i,step/100).every(Number.isFinite));
console.log('Homepage journey: full/compact finite reversible geometry, continuity, through-structure camera travel, and distinct organized final branches passed.');
