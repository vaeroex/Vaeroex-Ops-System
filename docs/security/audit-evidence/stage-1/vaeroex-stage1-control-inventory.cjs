// Audit-only static control census: no application code is executed.
const fs=require('node:fs'), path=require('node:path');
const ts=require('/Users/isaacvizcarra/Documents/ChatGPT/Vaeroex/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript');
const snapshots=[['working-tree','/Users/isaacvizcarra/Documents/ChatGPT/Vaeroex'],['deployed-reference-d91be079','/tmp/vaeroex-audit-production']];
const controls=new Set(['button','a','input','select','textarea','form','summary','Link','LoadingLink','PrimaryButton','TextInput','TextArea','SelectInput','PendingSubmitButton','ConfirmSubmitButton','AnalysisProgressSubmit','GlobalSearchTrigger','CreateDrawer','RecordDetailDrawer','SaveAnalysisButton']);
const exclude=/(?:easter-egg|civilization|marketing)/;
const rows=[]; const routes=[];
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)]);}
const clean=s=>s.replace(/\s+/g,' ').trim();
for(const [snapshot,root] of snapshots){
 if(!fs.existsSync(path.join(root,'app/app')))continue;
 const cache=new Map();
 function parse(file){
  if(cache.has(file))return cache.get(file);
  const content=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const imports=new Map(), list=[];
  for(const node of sf.statements){
   if(!ts.isImportDeclaration(node)||!ts.isStringLiteral(node.moduleSpecifier))continue;
   const imp=node.moduleSpecifier.text;
   let local=imp.startsWith('@/')?path.join(root,imp.slice(2)):imp.startsWith('.')?path.resolve(path.dirname(file),imp):null;
   if(!local)continue;
   const target=[local+'.tsx',path.join(local,'index.tsx')].find(x=>fs.existsSync(x));
   if(!target||exclude.test(target))continue;
   const ic=node.importClause;
   if(ic?.name)imports.set(ic.name.text,target);
   if(ic?.namedBindings&&ts.isNamedImports(ic.namedBindings))for(const el of ic.namedBindings.elements)imports.set(el.name.text,target);
  }
  const deps=new Set();
  function visit(node){
   if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
    const tag=node.tagName.getText(sf);
    if(imports.has(tag))deps.add(imports.get(tag));
    if(controls.has(tag)){
     const attrs={}; for(const a of node.attributes.properties)if(ts.isJsxAttribute(a)&&['name','type','href','action','formAction','onClick','onChange','onSubmit','aria-label','label','title','triggerLabel','children','disabled','required','download'].includes(a.name.text)) attrs[a.name.text]=clean(a.initializer?.getText(sf)||'true');
     let label=''; if(ts.isJsxOpeningElement(node)&&ts.isJsxElement(node.parent))label=clean(node.parent.children.map(c=>ts.isJsxText(c)?c.text:ts.isJsxExpression(c)?c.getText(sf):'').join(' '));
     list.push({file:path.relative(root,file),line:sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1,control:tag,attributes:attrs,label:label.slice(0,220)});
    }
   }
   ts.forEachChild(node,visit);
  }
  visit(sf);const result={list,deps:[...deps],content};cache.set(file,result);return result;
 }
 const pages=files(path.join(root,'app/app')).filter(f=>f.endsWith('/page.tsx')).sort();
 for(const page of pages){
  const route='/'+path.relative(path.join(root,'app'),path.dirname(page));
  if(exclude.test(page)){routes.push({snapshot,route,file:path.relative(root,page),status:'untested',note:'Excluded: unrelated Easter Egg/Civilization functionality'});continue;}
  const visited=new Set();
  function walk(f){if(visited.has(f))return;visited.add(f);const p=parse(f);for(const c of p.list)rows.push({snapshot,route,...c,status:'blocked',basis:'Static inventory only; authenticated runtime/persisted result requires isolated account/database'});for(const d of p.deps)walk(d);}
  walk(page);
  // Source wrappers re-export the shared renderer.
  if(route==='/app/sources'||route==='/app/sources/[fileId]')walk(path.join(root,'app/app/sources/SourcesPage.tsx'));
  routes.push({snapshot,route,file:path.relative(root,page),status:'blocked',sourceFiles:visited.size,controlTemplates:rows.filter(r=>r.snapshot===snapshot&&r.route===route).length,note:'Static inventory complete; end-to-end desktop/mobile/keyboard/persistence blocked without isolated account/database'});
 }
 for(const layout of ['app/app/layout.tsx','app/app/admin/layout.tsx']){
  const visited=new Set();function walk(f){if(visited.has(f)||!fs.existsSync(f))return;visited.add(f);const p=parse(f);for(const c of p.list)rows.push({snapshot,route:layout.includes('/admin/')?'SHARED_ADMIN_SHELL':'SHARED_WORKSPACE_SHELL',...c,status:'blocked',basis:'Static inventory only; authenticated runtime requires isolated account/database'});for(const d of p.deps)walk(d);}walk(path.join(root,layout));
 }
}
fs.writeFileSync('/tmp/vaeroex-stage1-control-inventory.json',JSON.stringify({method:'TypeScript AST static census of JSX control templates, recursively following imported TSX components from authenticated pages/layouts. Dynamic instances remain templates. No runtime pass is implied.',rows,routes},null,2));
function csv(v){return '"'+String(v??'').replaceAll('"','""')+'"';}
const keys=['snapshot','route','file','line','control','label','attributes','status','basis'];
fs.writeFileSync('/tmp/vaeroex-stage1-control-coverage.csv',[keys.join(','),...rows.map(row=>keys.map(k=>csv(k==='attributes'?JSON.stringify(row[k]):row[k])).join(','))].join('\n')+'\n');
console.log(JSON.stringify({snapshots:snapshots.map(s=>s[0]),routeEntries:routes.length,controlTemplateOccurrences:rows.length,uniqueTemplates:new Set(rows.map(r=>`${r.snapshot}|${r.file}:${r.line}`)).size},null,2));
