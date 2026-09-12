import {pathToFileURL} from 'node:url';
// Nonsecret admission planner. Does not provision, start a VM, open a gate, or
// read credentials. Fresh plans never revive an expired session automatically.
export function planWindow({now,deadline,ipv4,revision}) {
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(deadline)||deadline-now<1200000||deadline-now>3600000)throw Error('window_deadline_rejected');
 if(typeof ipv4!=='string'||!/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4)||ipv4.split('.').some(v=>String(Number(v))!==v||Number(v)>255)||['0','10','127'].includes(ipv4.split('.')[0]))throw Error('operator_ipv4_rejected');
 const [a,b,c]=ipv4.split('.').map(Number);
 if(a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127))throw Error('operator_ipv4_rejected');
 // IANA special-purpose blocks are not operator-unicast addresses. This is
 // admission validation, not proof of ownership or live routability.
 // https://www.iana.org/assignments/iana-ipv4-special-registry/
 if((a===192&&b===0&&(c===0||c===2))||(a===192&&b===88&&c===99)||(a===198&&(b===18||b===19))||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113))throw Error('operator_ipv4_rejected');
 if(typeof revision!=='string'||! /^[a-f0-9]{40}$/.test(revision))throw Error('reviewed_revision_required');
 return Object.freeze({version:'square_workspace_window_v1',project:'vaeroex-square-sandbox',projectNumber:'112579468800',instanceId:'3310746792631383424',zone:'us-west1-b',host:'square-sandbox.vaeroex.com',database:'oysjpoondtcrqpghhrbd',revision,operatorCidr:ipv4+'/32',deadline,admissionCutoff:deadline-900000,cleanupAt:deadline-600000,maximumMinutes:60,providerCalls:false,brokerLogins:false,temporaryIam:false,consentDaemon:false,automaticRestart:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {const [deadline,ipv4,revision,...extra]=process.argv.slice(2);if(extra.length)throw Error();console.log(JSON.stringify(planWindow({now:Date.now(),deadline:Date.parse(deadline),ipv4,revision}),null,2));}
 catch {process.stderr.write('square_workspace_window_plan_rejected\n');process.exitCode=1;}
}
