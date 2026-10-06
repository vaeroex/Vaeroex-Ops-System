/* eslint-disable @typescript-eslint/no-require-imports -- Actual loader and Supabase serialization against isolated embedded PostgreSQL. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { PGlite } = require('@electric-sql/pglite');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const workspace = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function loadLoader() {
  const loadedModule = { exports: {} }, filename = path.join(root, 'lib/kpis/load-workspace-kpis.ts');
  Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
  }).outputText)(require, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
// A small independent PostgREST grammar reader binds every scalar into SQL.
// PostgreSQL, rather than a JavaScript tuple comparator, decides page contents.
function parseLogic(expression, values) {
  let position = 0;
  const casts = { metric_date: 'date', created_at: 'timestamptz', id: 'uuid' };
  function parse() {
    const token = /^[a-z_]+/.exec(expression.slice(position))?.[0];
    assert(token); position += token.length;
    if (token === 'and' || token === 'or') {
      assert.equal(expression[position++], '('); const children = [parse()];
      while (expression[position] === ',') { position++; children.push(parse()); }
      assert.equal(expression[position++], ')'); return '(' + children.join(token === 'and' ? ' and ' : ' or ') + ')';
    }
    assert(Object.hasOwn(casts, token)); assert.equal(expression[position++], '.');
    const op = /^(eq|lt)\./.exec(expression.slice(position)); assert(op); position += op[0].length;
    assert.equal(expression[position], '"', 'cursor scalar must be quoted');
    const start = position++; let escaped = false;
    for (; position < expression.length; position++) {
      const char = expression[position];
      if (!escaped && char === '"') { position++; break; }
      if (!escaped && char === '\\') escaped = true; else escaped = false;
    }
    const value = JSON.parse(expression.slice(start, position)); assert.equal(typeof value, 'string'); values.push(value);
    return `${token} ${op[1] === 'eq' ? '=' : '<'} $${values.length}::${casts[token]}`;
  }
  const sql = parse(); assert.equal(position, expression.length); return sql;
}
async function verify() {
  const db = new PGlite(), { loadActiveWorkspaceKpis, WORKSPACE_KPI_LOAD_LIMIT } = loadLoader();
  let checks = 0, page = 0, errorPage = 0, authority = [], authorityError = false, insertAfterFirst = false, requests = [];
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
    create table memberships(workspace_id uuid,user_id uuid);
    insert into memberships values('${workspace}','${actor}');
    create function is_workspace_member(workspace_id uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from memberships m where m.workspace_id=$1 and m.user_id=auth.uid()) $$;
    create table kpis(id uuid primary key,workspace_id uuid not null,name text not null,metric_date date not null,created_at timestamptz not null,archived_at timestamptz,deleted_at timestamptz,raw_data_json jsonb not null default '{}');
    alter table kpis enable row level security;grant select on kpis to authenticated,anon;
    create policy members_read on kpis for select to authenticated using(is_workspace_member(workspace_id));
    create index kpis_date on kpis(workspace_id,metric_date desc);`);
  const seed = async count => {
    await db.exec('truncate kpis');
    await db.query(`insert into kpis(id,workspace_id,name,metric_date,created_at)
      select ('00000000-0000-4000-8000-'||lpad(to_hex(i),12,'0'))::uuid,$1,'Revenue',
      date '2026-10-01'-(i/7000)::int,timestamptz '2026-10-01 12:00:00Z'+(i%5)*interval '1 microsecond'
      from generate_series(1,$2::int)i`, [workspace,count]);
    await db.query("insert into kpis values('ffffffff-0000-4000-8000-000000000001',$1,'Foreign','2027-01-01','2027-01-01',null,null,'{}'),('ffffffff-0000-4000-8000-000000000002',$2,'Archived','2027-01-01','2027-01-01',now(),null,'{}'),('ffffffff-0000-4000-8000-000000000003',$2,'Deleted','2027-01-01','2027-01-01',null,now(),'{}')",[foreign,workspace]);
    page=0;requests=[];errorPage=0;authority=[];authorityError=false;insertAfterFirst=false;
  };
  const expected = async () => (await db.query('select to_jsonb(k) row from kpis k where workspace_id=$1 and archived_at is null and deleted_at is null order by metric_date desc,created_at desc,id desc',[workspace])).rows.map(r=>r.row);
  const reader = role => createClient('http://isolated.invalid','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
    const url=new URL(input);assert.equal(url.origin,'http://isolated.invalid');
    if(url.pathname.endsWith('/rpc/read_google_sheets_operational_conflicts_v1')) {
      assert.equal(JSON.parse(init.body).p_workspace_id,workspace);
      return new Response(JSON.stringify(authorityError?{message:'synthetic authority failure'}:authority),{status:authorityError?500:200});
    }
    assert.equal(url.pathname,'/rest/v1/kpis');assert.equal(url.searchParams.get('select'),'*');assert(!url.searchParams.has('offset'),'offset rescans must not return');
    const target=url.searchParams.get('workspace_id');assert(/^eq\.[0-9a-f-]{36}$/.test(target));
    assert.equal(url.searchParams.get('archived_at'),'is.null');assert.equal(url.searchParams.get('deleted_at'),'is.null');
    assert.equal(url.searchParams.get('order'),'metric_date.desc,created_at.desc,id.desc');
    const limit=Number(url.searchParams.get('limit'));assert(limit===1000||limit===1);page++;
    requests.push({page,limit,cursor:url.searchParams.has('or'),workspace:target.slice(3)});
    if(errorPage===page)return new Response(JSON.stringify({message:'synthetic page failure'}),{status:503});
    const values=[target.slice(3)];let predicate='workspace_id=$1 and archived_at is null and deleted_at is null';
    if(url.searchParams.has('or')){
      const upper=url.searchParams.get('metric_date');assert(upper?.startsWith('lte.'));values.push(upper.slice(4));predicate+=' and metric_date<=$2::date';
      predicate+=' and '+parseLogic('or'+url.searchParams.get('or'),values);
    }
    await db.exec('begin');let rows;
    try{
      await db.exec('set local role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[role==='authenticated'?actor:'']);
      rows=(await db.query(`select to_jsonb(k) row from kpis k where ${predicate} order by metric_date desc,created_at desc,id desc limit ${limit}`,values)).rows.map(r=>r.row);
    }finally{await db.exec('rollback');}
    if(insertAfterFirst&&page===1)await db.query("insert into kpis values('ffffffff-0000-4000-8000-000000000004',$1,'Concurrent later observation','2028-01-01','2028-01-01',null,null,'{}')",[workspace]);
    const body=new Headers(init.headers).get('Accept')?.includes('vnd.pgrst.object')?(rows[0]||null):rows;
    return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
  }}});
  const client=reader('authenticated');
  try{
    for(const count of[0,999,1000,1001,2005,20000]){
      await seed(count);const wanted=await expected(),result=await loadActiveWorkspaceKpis({supabase:client,workspaceId:workspace});
      assert.equal(result.error,null);assert(result.complete);assert.deepEqual(result.data,wanted);assert.equal(new Set(result.data.map(r=>r.id)).size,count);assert(requests.every(r=>r.workspace===workspace));
      assert(requests.length<=21);assert.equal(requests[0].cursor,false);assert(requests.slice(1).every(r=>r.cursor));checks+=7;
      if(count===20000){assert.equal(requests.at(-1).limit,1);checks++;}
    }
    await seed(WORKSPACE_KPI_LOAD_LIMIT+1);let r=await loadActiveWorkspaceKpis({supabase:client,workspaceId:workspace});assert(!r.complete);assert.deepEqual(r.data,[]);assert.match(r.error.message,/exceeds the supported 20,000/);assert.equal(requests.length,21);checks+=4;
    await seed(20000);errorPage=21;r=await loadActiveWorkspaceKpis({supabase:client,workspaceId:workspace});assert(!r.complete);assert.deepEqual(r.data,[]);assert.match(r.error.message,/synthetic page failure/);checks+=3;
    await seed(2005);errorPage=2;r=await loadActiveWorkspaceKpis({supabase:client,workspaceId:workspace});assert(!r.complete);assert.deepEqual(r.data,[]);checks+=2;
    await seed(2005);const before=await expected();insertAfterFirst=true;r=await loadActiveWorkspaceKpis({supabase:client,workspaceId:workspace});assert(r.complete);assert.equal(digest(r.data),digest(before));checks+=2;
    await seed(2005);r=await loadActiveWorkspaceKpis({supabase:client,workspaceId:foreign});assert(r.complete);assert.deepEqual(r.data,[]);checks+=2;
    r=await loadActiveWorkspaceKpis({supabase:reader('anon'),workspaceId:workspace});assert.deepEqual(r.data,[]);checks++;
    const id=(await expected())[0].id;await db.query("update kpis set raw_data_json='{"+'"googleSheets"'+":{}}' where id=$1",[id]);authority=[{kpi_id:id}];page=0;r=await loadActiveWorkspaceKpis({supabase:client,workspaceId:workspace});assert(r.complete);assert.equal(r.data.length,2004);assert(!r.data.some(row=>row.id===id));checks+=3;
    for(const malformed of[[{kpi_id:42}],{},Array.from({length:20001},()=>({kpi_id:id}))]){authority=malformed;page=0;r=await loadActiveWorkspaceKpis({supabase:client,workspaceId:workspace});assert(!r.complete);assert.deepEqual(r.data,[]);checks+=2;}
    authorityError=true;page=0;r=await loadActiveWorkspaceKpis({supabase:client,workspaceId:workspace});assert(!r.complete);assert.deepEqual(r.data,[]);checks+=2;
    return {passed:true,checks,maximumAccepted:20000,overflowRejected:20001,postgrestSerialization:'actual supabase-js',querySemantics:'embedded PostgreSQL with authenticated RLS',tieCoverage:'date, timestamp microseconds, UUID',networkRequests:0};
  }finally{await db.close();}
}
if(require.main===module)verify().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={verify};
