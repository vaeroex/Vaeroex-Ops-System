/* eslint-disable @typescript-eslint/no-require-imports -- Offline lifecycle fixture; no browser, network, or WebGL claims. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(relative, mocks, globals = {}) {
  const result = {exports:{}};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:relative,
  }).outputText;
  vm.runInNewContext(code, {module:result,exports:result.exports,require(name) {
    if (Object.hasOwn(mocks,name)) return mocks[name];
    throw new Error(`Unexpected dependency in offline fixture: ${name}`);
  },...globals}, {filename:relative});
  return result.exports;
}
const policy = load('components/marketing/clarity/clarityDevicePolicy.ts', {});
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type,event) { for(const fn of [...(listeners.get(type)||[])])fn(event); },
    count(type) { return type ? listeners.get(type)?.size||0 : [...listeners.values()].reduce((n,s)=>n+s.size,0); },
  };
}
function walk(node, predicate, matches=[]) {
  if(!node || typeof node!=='object')return matches;
  if(Array.isArray(node)){node.forEach(child=>walk(child,predicate,matches));return matches;}
  if(predicate(node))matches.push(node);
  walk(node.props?.children,predicate,matches);return matches;
}
function fixture({reduced=false,compact=false,saveData=false}={}) {
  const slots=[],pending=[],rafs=new Map(),intersections=[],resizes=[];
  let cursor=0,dirty=false,tree,frameId=0,scroll=0;
  const window=events(),document={...events(),visibilityState:'visible',getElementById(id){
    const index=['solutions','featured-product','home-custom','home-websites','home-finish'].indexOf(id);
    return id==='home-connected-journey'?{}:{getBoundingClientRect:()=>({top:400+index*600-scroll})};
  }};
  const motion={...events(),matches:reduced},small={...events(),matches:compact};
  const node={getBoundingClientRect:()=>({bottom:300})};
  const same=(a,b)=>a && b && a.length===b.length && a.every((v,i)=>Object.is(v,b[i]));
  const react={Component:class{},useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{
    const next=typeof value==='function'?value(slots[i].value):value;
    if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}
  }];},useRef(initial){const i=cursor++;if(!slots[i])slots[i]={current:initial};return slots[i];},useCallback(callback,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:callback};return slots[i].value;},useEffect(effect,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps,cleanup:old?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}};
  const jsx=(type,props)=>({type,props});
  const Scene=()=>null;
  const {HomeJourney}=load('components/marketing/journey/HomeJourney.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx},'next/dynamic':{__esModule:true,default:()=>Scene},
    '../clarity/clarityDevicePolicy':policy,'./HomeJourney.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>key})},
  },{window,document,navigator:{hardwareConcurrency:8,deviceMemory:8,connection:{saveData}},matchMedia:q=>q.includes('reduced-motion')?motion:small,
    requestAnimationFrame(fn){const id=++frameId;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),
    IntersectionObserver:class {constructor(callback,options){this.callback=callback;this.options=options;this.connected=false;intersections.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}},
    ResizeObserver:class {constructor(callback){this.callback=callback;this.connected=false;resizes.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}},
  });
  const render=()=>{cursor=0;tree=HomeJourney();tree.props.ref.current=node;};
  const commit=()=>{let turns=0;do{dirty=false;render();while(pending.length)pending.shift()();assert.ok(++turns<20,'Lifecycle settles without render loop');}while(dirty);};
  const flush=()=>{const callbacks=[...rafs.values()];rafs.clear();callbacks.forEach(fn=>fn());commit();};
  const intersect=(visible)=>{for(const observer of intersections)if(observer.connected)observer.callback([{isIntersecting:visible}]);commit();};
  commit();
  return {get tree(){return tree;},scene:()=>walk(tree,n=>n.type===Scene)[0],poster:()=>walk(tree,n=>n.props?.className?.split(' ').includes('poster'))[0],
    commit,flush,intersect,window,document,motion,small,rafs,
    scrollTo(value){scroll=value;window.emit('scroll');},
    unmount(){slots.forEach(slot=>slot.cleanup?.());assert.equal(window.count(),0);assert.equal(document.count(),0);assert.equal(motion.count(),0);assert.equal(small.count(),0);assert.equal(rafs.size,0);assert.ok(intersections.every(o=>!o.connected));assert.ok(resizes.every(o=>!o.connected));},
  };
}

for(const options of [{reduced:true},{saveData:true}]) {
  const h=fixture(options);h.intersect(true);h.flush();
  assert.equal(h.scene(),undefined,'Reduced motion/data saving never mounts the dynamic canvas');
  assert.ok(h.poster(),'Static poster remains available');
  assert.equal(h.tree.props['data-mode'],'static');assert.equal(h.tree.props['data-active'],false);
  assert.equal(h.window.count('scroll'),0,'Static view has no scroll animation listener');
  assert.equal(walk(h.tree,n=>n.type==='a').length,3,'All three offering links remain HTML');h.unmount();
}
{
  const h=fixture();assert.equal(h.scene(),undefined,'Canvas is not mounted before proximity');
  h.intersect(true);h.flush();assert.equal(h.scene().props.active,true);
  h.scene().props.onReady();h.commit();assert.equal(h.tree.props['data-mode'],'interactive');
  const initial=Number(h.tree.props['data-progress']);h.scrollTo(1000);h.flush();assert.ok(Number(h.tree.props['data-progress'])>initial);
  h.scrollTo(1100);assert.equal(h.rafs.size,1);h.intersect(false);
  assert.equal(h.rafs.size,0,'Leaving view cancels scheduled measurement');assert.equal(h.window.count('scroll'),0);assert.equal(h.scene().props.active,false);
  h.intersect(true);h.flush();h.document.visibilityState='hidden';h.document.emit('visibilitychange');h.commit();
  assert.equal(h.scene().props.active,false);assert.equal(h.window.count('scroll'),0);
  h.document.visibilityState='visible';h.document.emit('visibilitychange');h.commit();h.flush();assert.equal(h.scene().props.active,true);
  h.motion.matches=true;h.motion.emit('change');h.commit();assert.equal(h.scene(),undefined);assert.equal(h.tree.props['data-reason'],'reduced-motion');
  h.motion.matches=false;h.motion.emit('change');h.commit();h.flush();assert.ok(h.scene());
  h.small.matches=true;h.small.emit('change');h.commit();assert.equal(h.scene().props.compact,true);
  const button=walk(h.tree,n=>n.type==='button')[0];button.props.onClick();h.commit();
  assert.equal(h.scene(),undefined,'Static-view control unmounts renderer');assert.equal(h.tree.props['data-reason'],'user-static');assert.equal(h.window.count('scroll'),0);
  walk(h.tree,n=>n.type==='button')[0].props.onClick();h.commit();h.flush();assert.ok(h.scene());h.unmount();
}
{
  const h=fixture();h.intersect(true);h.flush();h.scene().props.onReady();h.commit();
  const canvas=events();let cleanup;const onFailure=h.scene().props.onFailure;
  const {PublicSpatialContextGuard}=load('components/spatial/PublicSpatialCanvasGuard.tsx',{
    react:{Component:class{},useEffect(fn){cleanup=fn();}},'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null},'@react-three/fiber':{useThree:()=>({gl:{domElement:canvas}})},
  });
  PublicSpatialContextGuard({onFailure});let prevented=false;canvas.emit('webglcontextlost',{preventDefault(){prevented=true;}});h.commit();
  assert.equal(prevented,true);assert.equal(h.scene(),undefined,'Actual context-loss guard callback unmounts the scene');
  assert.equal(h.tree.props['data-reason'],'rendering-unavailable');assert.ok(!h.poster().props.className.includes('hidden'),'Failure restores poster');
  assert.equal(walk(h.tree,n=>n.type==='a').length,3,'Offering links survive rendering failure');
  cleanup();assert.equal(canvas.count(),0,'Context-loss listener is removed');h.unmount();
}
for (const failure of ['render', 'readPixels']) {
  const h=fixture();h.intersect(true);h.flush();
  const onFailure=h.scene().props.onFailure,frames=new Map(),results=[],attributes={};let id=0;
  const {probeRenderedCanvas}=load('components/spatial/CanvasPixelProbe.tsx',{}, {
    requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
  });
  const canvas={dataset:{},closest:()=>({setAttribute(name,value){attributes[name]=value;}}),getContext:()=>({
    drawingBufferWidth:64,drawingBufferHeight:64,RGBA:6408,UNSIGNED_BYTE:5121,
    readPixels(){throw new Error('Synthetic driver pixel-read failure');},
  })};
  const cleanup=probeRenderedCanvas({camera:{},scene:{},gl:{domElement:canvas,render(){if(failure==='render')throw new Error('Synthetic driver render failure');}}},result=>{results.push(result);if(result==='blank')onFailure();});
  for(let turn=0;turn<2;turn++){const next=[...frames.values()];frames.clear();next.forEach(fn=>fn());}
  h.commit();
  assert.deepEqual(results,['blank'],`${failure} exception reports exactly one failed probe`);
  assert.equal(canvas.dataset.canvasProbe,'blank');assert.equal(attributes['data-canvas-pixels'],'blank');
  assert.equal(h.scene(),undefined,`${failure} failure restores the fallback without an uncaught frame error`);
  assert.equal(h.tree.props['data-reason'],'rendering-unavailable');assert.ok(!h.poster().props.className.includes('hidden'));
  cleanup();assert.equal(frames.size,0);h.unmount();
}
for(const cancelAfterFirst of [false,true]) {
  const frames=new Map();let id=0,renders=0,callbacks=0;
  const {probeRenderedCanvas}=load('components/spatial/CanvasPixelProbe.tsx',{}, {
    requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
  });
  const cleanup=probeRenderedCanvas({camera:{},scene:{},gl:{domElement:{dataset:{}},render(){renders++;}}},()=>{callbacks++;});
  if(cancelAfterFirst){const next=[...frames.values()];frames.clear();next.forEach(fn=>fn());}
  assert.equal(frames.size,1);cleanup();assert.equal(frames.size,0,'Probe cleanup cancels either pending frame');
  assert.equal(renders,0);assert.equal(callbacks,0,'Unmounted probe cannot call the owner');
}
console.log('Homepage journey mocked lifecycle: deferred mount, reduced motion/data-saving, scroll progress, offscreen/hidden pause, responsive quality, static toggle, context-loss and driver-exception fallback, HTML links, and listener/observer/frame cleanup passed. No browser or WebGL rendering is claimed.');
