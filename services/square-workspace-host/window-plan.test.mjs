import assert from 'node:assert/strict';
import {planWindow} from './window-plan.mjs';
const input={now:1789190000000,deadline:1789193600000,ipv4:'172.58.208.32',revision:'a'.repeat(40)};
const plan=planWindow(input);assert.equal(plan.operatorCidr,'172.58.208.32/32');assert.equal(plan.cleanupAt,input.deadline-600000);assert.equal(plan.admissionCutoff,input.deadline-900000);assert(Object.isFrozen(plan));
for(const delta of [-1,0,1199999,3600001])assert.throws(()=>planWindow({...input,deadline:input.now+delta}));
for(const ipv4 of ['0.0.0.0','127.0.0.1','10.0.0.1','192.168.1.2','172.16.0.1','169.254.1.1','100.64.0.1','224.1.1.1','172.58.208.32/0','172.58.208.032','256.1.1.1','::1','1.2.3.4;echo x'])assert.throws(()=>planWindow({...input,ipv4}));
for(const revision of ['main','a'.repeat(39),'a'.repeat(40)+'\n'])assert.throws(()=>planWindow({...input,revision}));
assert.equal(plan.providerCalls,false);assert.equal(plan.brokerLogins,false);assert.equal(plan.temporaryIam,false);assert.equal(plan.automaticRestart,false);
console.log('square_workspace_repeatable_window_plan_passed');
