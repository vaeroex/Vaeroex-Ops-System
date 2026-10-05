const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const file=process.argv[2]||'/tmp/vaeroex-closeout-e2e.with-navigation.cjs';const source=fs.readFileSync(file,'utf8');const helper=source.slice(source.indexOf('function checkedActionRedirect'),source.indexOf('async function fillSubmission'));
let checks=0;const passed=name=>{checks++;console.log(JSON.stringify({check:name,passed:true,qualification:'harness selftest only; no browser, Auth, server action, or database'}));};
function setup(options={}){
 const state={goto:[],clicks:0,screenshots:0,current:'http://127.0.0.1:4200/app/forms/one',navigationCalls:0};
 const sandbox={assert,URL,path,sanitize:String,appOrigin:'http://127.0.0.1:4200',output:'/tmp/synthetic-selftest',continueAfterNavigationFailure:Boolean(options.continue),actionResponses:[],results:[],navigationFailures:[],process:{exitCode:undefined},console:{error(){}},fs:{writeFileSync(){}},result(name,data){sandbox.results.push({name,passed:true,...data});}};
 vm.createContext(sandbox);vm.runInContext(helper,sandbox);
 const header=options.header===undefined?'/app/forms/one?message=Saved;push':options.header;
 const response={url:()=>state.current,request:()=>({method:()=> 'POST',headers:()=>({'next-action':'synthetic-reference'})}),status:()=>options.status||303,allHeaders:async()=>({'x-action-redirect':header,'content-type':'text/x-component'})};
 const page={waitForResponse:async predicate=>{assert(predicate(response));if(options.missingResponse)throw Error('synthetic_timeout');return response;},waitForURL:async expected=>{state.navigationCalls++;if(options.automatic||state.navigationCalls>1){state.current='http://127.0.0.1:4200/app/forms/one?message=Saved';assert(expected(new URL(state.current)));return;}throw Error('synthetic_navigation_timeout');},url:()=>state.current,locator:()=>({evaluateAll:async()=>[{text:'Working...',disabled:true,ariaBusy:'true'}],innerText:async()=> 'Synthetic fixture only'}),screenshot:async()=>{state.screenshots++;},goto:async url=>{state.goto.push(url);state.current=url;}};
 const button={click:async()=>{state.clicks++;if(options.clickError)throw Error('synthetic_click_failed');}};
 return{sandbox,state,run:()=>sandbox.submitAndObserve(page,button,'synthetic_action',u=>u.searchParams.has('message'))};
}
(async()=>{
 let x=setup();await assert.rejects(x.run(),/client_action_navigation_failed/);assert.equal(x.state.goto.length,0);assert.equal(x.state.screenshots,1);assert.equal(x.sandbox.results[0].passed,false);assert.equal(x.sandbox.process.exitCode,1);passed('default remains fail-fast with recorded navigation failure');
 x=setup({continue:true});await x.run();assert.equal(x.state.goto.length,1);assert.equal(x.state.clicks,1);assert.equal(x.sandbox.process.exitCode,1);assert.equal(x.sandbox.results[0].passed,false);assert.equal(x.sandbox.results[1].automaticNavigationPassed,false);passed('explicit continuation retains failure and navigates once without resubmission');
 x=setup({continue:true,automatic:true});await x.run();assert.equal(x.state.goto.length,0);assert.equal(x.sandbox.navigationFailures.length,0);assert.equal(x.sandbox.results[0].manualRecovery,false);passed('successful automatic navigation uses no recovery');
 for(const [name,opts,pattern]of [
 ['external redirect denied',{header:'https://other.example/app/forms/one?message=Saved;push'},/same_origin/],
 ['missing redirect denied',{header:''},/redirect_required/],
 ['wrong outcome denied',{header:'/app/forms/one?error=Denied;push'},/expected_outcome/],
 ['non303 denied',{status:500},/redirect_response/],
 ['missing response denied',{missingResponse:true},/not_captured/],
 ['credential-bearing redirect denied',{header:'http://user@127.0.0.1:4200/app/forms/one?message=Saved;push'},/same_origin/],
 ['non-workspace redirect denied',{header:'/login?message=Saved;push'},/same_origin/]]){
  x=setup({continue:true,...opts});await assert.rejects(x.run(),pattern);assert.equal(x.state.goto.length,0);assert.equal(x.sandbox.results[0].passed,false);assert.equal(x.sandbox.process.exitCode,1);passed(name);
 }
 x=setup({continue:true,clickError:true});await assert.rejects(x.run(),/click_failed/);assert.equal(x.state.goto.length,0);passed('click failure cannot trigger recovery');
 assert(source.includes("const passed = !results.some(record=>record.passed===false);if(!passed)process.exitCode=1;"));assert(source.includes("result('closeout_complete',{passed,"));passed('overall outcome retains any recorded failure');
 const argumentCode=source.slice(source.indexOf('const [configFile, output, ...options]'),source.indexOf('assert(configFile && output'));
 const parse=args=>vm.runInNewContext(argumentCode+';continueAfterNavigationFailure',{assert,process:{argv:['node','helper','synthetic-config','synthetic-output',...args]}});
 assert.equal(parse([]),false);assert.equal(parse(['--continue-after-navigation-failure']),true);passed('continuation flag is explicitly opt-in');
 assert.throws(()=>parse(['--unknown']),/unknown_closeout_option/);passed('unknown options rejected');
 assert.throws(()=>parse(['--continue-after-navigation-failure','--continue-after-navigation-failure']),/unknown_closeout_option/);passed('duplicate flags rejected');
 const operatorStart=source.indexOf('    for(const actor of [manager,administrator])');
 const operatorBlock=source.slice(operatorStart,source.indexOf("    stage='browser_memory_confirmation';",operatorStart));
 const operatorLabels=[];const operatorSandbox={manager:{role:'manager'},administrator:{role:'admin'},prefix:'Synthetic',formId:'synthetic-form',context:async()=>({c:{close:async()=>{}},page:{},client:{from:()=>({select:()=>({eq:async()=>({data:[{id:'synthetic-row'}]})})})}}),fillSubmission:async()=>({getByRole:()=>({})}),submitAndObserve:async(_page,_button,label)=>operatorLabels.push(label),waitFor:async callback=>callback(),check:r=>r.data,result:()=>{}};
 await vm.runInNewContext('(async()=>{'+operatorBlock+'})()',operatorSandbox);
 assert.deepEqual(operatorLabels,['internal_form_manager_390','internal_form_admin_390']);passed('actual manager/admin loop labels resolve without owner-width scope');
 console.log(JSON.stringify({checks,passed:true,qualification:'harness selftests only'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
