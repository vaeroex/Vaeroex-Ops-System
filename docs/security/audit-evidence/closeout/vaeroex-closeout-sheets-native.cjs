const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex',bin='/tmp/vaeroex-stage4-pg/bin';
const {Client}=require(root+'/node_modules/pg'),{qualify}=require(root+'/scripts/google-sheets-data-tests.cjs');
let owned,db,started=false;
function cmd(n,args){const x=spawnSync(path.join(bin,n),args,{encoding:'utf8',timeout:120000,maxBuffer:1048576});if(x.status!==0)throw Error('owned_'+n+'_failed:'+x.stderr.slice(0,500));}
(async()=>{
owned=fs.mkdtempSync('/tmp/vaeroex-sheets-recovery-native-');fs.chmodSync(owned,448);const socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:448});
cmd('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
cmd('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c max_connections=10 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
db=new Client({host:socket,port:5432,user:'postgres',database:'postgres',statement_timeout:15000});await db.connect();
const state=(await db.query("select current_setting('data_directory') d,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(state.d),fs.realpathSync(path.join(owned,'data')));assert.equal(state.ip,null);
// Every array parameter in this focused fixture is a JSONB header/row payload,
// not a PostgreSQL array. pg defaults differ from PGlite here.
const adapter={query:(sql,args)=>db.query(sql,args?.map(value=>Array.isArray(value)?JSON.stringify(value):value)),exec:sql=>db.query(sql)};
console.log(JSON.stringify({scope:'Actual Sheets migration/RPC qualification on owned native PostgreSQL. Reduced repository schema; synthetic role GUCs; expiry accelerated in persisted state. No worker process kill, provider, or Auth HTTP.',sourceRoot:root,...await qualify(adapter)},null,2));
})().catch(e=>{console.error(JSON.stringify({failure:true,code:e.code,message:e.message,where:e.where}));process.exitCode=1;}).finally(async()=>{if(db)await db.end();if(started)cmd('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
