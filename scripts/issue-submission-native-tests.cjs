/* eslint-disable @typescript-eslint/no-require-imports -- Isolated native receipt contention; no application services. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {Client}=require('pg'),{qualify}=require('./issue-submission-tests.cjs'),bin=process.env.ISSUE_TEST_PG_BIN;
if(!bin||!path.isAbsolute(bin))throw Error('Set ISSUE_TEST_PG_BIN to the installed native PostgreSQL bin directory');
let owned,started=false;const clients=[];
function command(name,args){const result=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.status!==0)throw Error(`owned_${name}_failed:${result.stderr.slice(0,500)}`);}
async function session(){const client=new Client({host:path.join(owned,'socket'),user:'postgres',database:'postgres',statement_timeout:15000});await client.connect();clients.push(client);return{query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql)};}
(async()=>{
 owned=fs.mkdtempSync('/tmp/vaeroex-issue-receipt-native-');fs.chmodSync(owned,0o700);fs.mkdirSync(path.join(owned,'socket'),{mode:0o700});
 command('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 command('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${path.join(owned,'socket')}' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 const db=await session(),state=(await db.query("select current_setting('data_directory') d,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(state.d),fs.realpathSync(path.join(owned,'data')));assert.equal(state.ip,null);
 console.log(JSON.stringify(await qualify(db,await Promise.all(Array.from({length:8},()=>session()))),null,2));
})().catch(error=>{console.error({failure:true,code:error.code,message:error.message,stack:error.code?undefined:error.stack});process.exitCode=1;}).finally(async()=>{await Promise.allSettled(clients.map(client=>client.end()));if(started)command('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
