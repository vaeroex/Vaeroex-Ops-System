/* Test-only tripwire: loading an AI runtime OR doing any network I/O fails. The
 * actual ingestion regression injects its fixed synthetic Square transport. */
const Module=require("node:module"),load=Module._load;
let calls=0;
Module._load=function(name,...args){
  if(/(?:^|\/)(?:openai|@ai-sdk|ai)(?:\/|$)|\/lib\/ai\/|^@\/lib\/ai\//.test(name)){calls++;throw new Error("unexpected_ai_runtime");}
  return load.call(this,name,...args);
};
global.fetch=()=>{calls++;throw new Error("unexpected_network_runtime");};
for(const name of ["node:http","node:https"])for(const method of ["request","get"]){require(name)[method]=()=>{calls++;throw new Error("unexpected_network_runtime");};}
process.on("exit",()=>{if(calls!==0)process.exitCode=1;else console.log("Deterministic ingestion/replay: zero AI runtime loads or network calls");});
