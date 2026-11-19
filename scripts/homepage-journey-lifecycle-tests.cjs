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
const logoOutline = load('components/marketing/journey/logoOutline.ts', {});
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
const milestones = [
  ['home-opening',0],['solutions',.14],['featured-product',.30],
  ['home-custom',.50],['home-websites',.70],['project-process-title',.84],['home-finish',1],
];
// Unequal section heights ensure progress follows the actual content, not an
// assumed fraction of total page length or a uniform chapter spacing.
const documentTops = [500,1230,2160,3100,4200,5050,6200];
function fixture({reduced=false,compact=false,saveData=false,missing=[]}={}) {
  const slots=[],pending=[],rafs=new Map(),intersections=[],resizes=[];
  let cursor=0,dirty=false,tree,frameId=0,scroll=0,visualTop=0;
  const window={...events(),innerHeight:1000,innerWidth:compact?390:1440},document={...events(),visibilityState:'visible',getElementById(id){
    if(id==='home-connected-journey')return {};
    const index=milestones.findIndex(([anchor])=>anchor===id);
    if(index<0 || missing.includes(id))return null;
    return {getBoundingClientRect:()=>({top:documentTops[index]-scroll})};
  }};
  const motion={...events(),matches:reduced},small={...events(),matches:compact};
  const node={getBoundingClientRect:()=>({bottom:300})};
  const visualNode={getBoundingClientRect:()=>({top:visualTop})};
  const same=(a,b)=>a && b && a.length===b.length && a.every((v,i)=>Object.is(v,b[i]));
  const react={Component:class{},useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{
    const next=typeof value==='function'?value(slots[i].value):value;
    if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}
  }];},useRef(initial){const i=cursor++;if(!slots[i])slots[i]={current:initial};return slots[i];},useCallback(callback,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:callback};return slots[i].value;},useEffect(effect,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps,cleanup:old?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}};
  const jsx=(type,props)=>({type,props});
  const Scene=()=>null;
  const {HomeJourney}=load('components/marketing/journey/HomeJourney.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx},'next/dynamic':{__esModule:true,default:()=>Scene},
    '../clarity/clarityDevicePolicy':policy,'./logoOutline':logoOutline,'./HomeJourney.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>key})},
  },{window,document,navigator:{hardwareConcurrency:8,deviceMemory:8,connection:{saveData}},matchMedia:q=>q.includes('reduced-motion')?motion:small,
    requestAnimationFrame(fn){const id=++frameId;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),
    IntersectionObserver:class {constructor(callback,options){this.callback=callback;this.options=options;this.connected=false;intersections.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}},
    ResizeObserver:class {constructor(callback){this.callback=callback;this.connected=false;resizes.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}},
  });
  const render=()=>{cursor=0;tree=HomeJourney();tree.props.ref.current=node;
    walk(tree,n=>n.props?.className==='visual').forEach(n=>{n.props.ref.current=visualNode;});};
  const commit=()=>{let turns=0;do{dirty=false;render();while(pending.length)pending.shift()();assert.ok(++turns<20,'Lifecycle settles without render loop');}while(dirty);};
  const flush=()=>{const callbacks=[...rafs.values()];rafs.clear();callbacks.forEach(fn=>fn());commit();};
  const intersect=(visible)=>{for(const observer of intersections)if(observer.connected)observer.callback([{isIntersecting:visible}]);commit();};
  commit();
  return {get tree(){return tree;},scene:()=>walk(tree,n=>n.type===Scene)[0],poster:()=>walk(tree,n=>n.props?.className?.split(' ').includes('poster'))[0],
    commit,flush,intersect,window,document,motion,small,rafs,
    scrollTo(value){scroll=value;window.emit('scroll');},
    setVisualTop(value){visualTop=value;},
    unmount(){slots.forEach(slot=>slot.cleanup?.());assert.equal(window.count(),0);assert.equal(document.count(),0);assert.equal(motion.count(),0);assert.equal(small.count(),0);assert.equal(rafs.size,0);assert.ok(intersections.every(o=>!o.connected));assert.ok(resizes.every(o=>!o.connected));},
  };
}

// The server-rendered reduced-motion poster uses the same traced faces at the same
// proportions as the assembled 3D mark, including the gap between the lower pieces.
{
  const h = fixture({ reduced: true });
  const posterComponent = h.poster().props.children;
  const svg = posterComponent.type(posterComponent.props);
  const front = walk(svg, node => node.type === 'polygon' && node.props['data-logo-piece']);
  assert.equal(front.length, logoOutline.logoPieces.length);
  const { logoBounds, logoToWorld } = logoOutline;
  for (const piece of logoOutline.logoPieces) {
    const face = front.find(node => node.props['data-logo-piece'] === piece.id);
    assert.ok(face, 'Reduced-motion poster includes ' + piece.id);
    const vertices = face.props.points.split(' ').map(pair => pair.split(',').map(Number));
    assert.equal(vertices.length, piece.points.length);
    piece.points.forEach((p, i) => {
      const [x, y] = logoToWorld(p);
      assert.ok(Math.abs(vertices[i][0] - (x + logoBounds.worldWidth / 2)) < 1e-8);
      assert.ok(Math.abs(vertices[i][1] - (logoBounds.worldHeight / 2 - y)) < 1e-8);
    });
  }
  h.unmount();
}

for(const compact of [false,true]) {
  const h=fixture({compact});h.intersect(true);h.flush();
  const sampled=[];
  for(let index=0;index<milestones.length;index++) {
    h.scrollTo(documentTops[index]-h.window.innerHeight*.5);h.flush();
    assert.equal(h.scene().props.progress,milestones[index][1],`${milestones[index][0]} corresponds exactly to its camera milestone`);
    sampled.push(h.scene().props.progress);
    if(index<milestones.length-1) {
      const midpoint=(documentTops[index]+documentTops[index+1])/2-h.window.innerHeight*.5;
      h.scrollTo(midpoint);h.flush();
      const expected=(milestones[index][1]+milestones[index+1][1])/2;
      assert.ok(Math.abs(h.scene().props.progress-expected)<1e-10,'Mid-section progress interpolates over measured content spacing');
    }
  }
  for(let index=milestones.length-1;index>=0;index--) {
    h.scrollTo(documentTops[index]-h.window.innerHeight*.5);h.flush();
    assert.equal(h.scene().props.progress,sampled[index],'Reverse scrolling restores the exact milestone');
  }
  h.scrollTo(-1000);h.flush();assert.equal(h.scene().props.progress,0,'Before opening remains at the initial pose');
  h.scrollTo(9000);h.flush();assert.equal(h.scene().props.progress,1,'After final CTA remains fully resolved');
  h.window.innerHeight=600;h.scrollTo(documentTops[3]-300);h.window.emit('resize');h.flush();
  assert.equal(h.scene().props.progress,.5,'Viewport resize changes focus without changing the milestone');
  h.unmount();
}
for(const missing of [['home-custom'],['home-finish'],milestones.map(([id])=>id)]) {
  const h=fixture({missing});h.intersect(true);h.flush();
  for(const position of [0,1500,3500,7000]) {
    h.scrollTo(position);h.flush();const p=h.scene().props.progress;
    assert.ok(Number.isFinite(p) && p>=0 && p<=1,'Absent anchors cannot yield an invalid camera progress');
  }
  h.unmount();
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
// Final composition follows the CTA only in portrait. Account for the sticky
// visual moving at its root boundary so scrolling cannot double-shift the logo.
{
  const h=fixture({compact:true});h.intersect(true);h.flush();h.scene().props.onReady();h.commit();
  h.scrollTo(5700);h.flush();assert.equal(h.scene().props.progress,1);assert.equal(h.scene().props.finalShift,0);
  h.scrollTo(6300);h.flush();assert.equal(h.scene().props.finalShift,-.1);assert.equal(h.tree.props.style['--journey-final-shift'],'-10svh');
  h.scrollTo(6500);h.flush();assert.equal(h.scene().props.finalShift,-.3);
  h.setVisualTop(-120);h.window.emit('resize');h.flush();assert.equal(h.scene().props.finalShift,-.18);
  assert.equal(h.scene().props.finalShift*h.window.innerHeight-120,-300,'Sticky-root motion and final shift add to the CTA displacement exactly once');
  h.scrollTo(5200);h.flush();assert.ok(h.scene().props.progress<.94);assert.equal(h.scene().props.finalShift,0,'Reverse scroll resets final-only following');
  h.scrollTo(6500);h.flush();h.window.innerWidth=844;h.window.innerHeight=390;h.window.emit('resize');h.flush();
  assert.equal(h.scene().props.finalShift,0,'Compact landscape uses the side composition, not portrait following');h.unmount();
}
for(const fallback of ['static','failure','reduced-motion']) {
  const h=fixture({compact:true});h.intersect(true);h.flush();h.scene().props.onReady();h.commit();h.scrollTo(6500);h.flush();
  assert.ok(h.scene().props.finalShift<0);
  if(fallback==='static')walk(h.tree,n=>n.type==='button')[0].props.onClick();
  else if(fallback==='failure')h.scene().props.onFailure();
  else {h.motion.matches=true;h.motion.emit('change');}
  h.commit();assert.equal(h.scene(),undefined);assert.equal(h.tree.props.style['--journey-final-shift'],'0svh',
    'Static/failure/reduced-motion poster cannot retain a stale offscreen final shift');
  assert.equal(h.window.count('scroll'),0);assert.equal(h.rafs.size,0);h.unmount();
}
{
  const h=fixture();h.intersect(true);h.flush();h.scrollTo(6500);h.flush();assert.equal(h.scene().props.finalShift,0,'Desktop keeps the logo beside the CTA');h.unmount();
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
// A cold load in the sculpture's empty passage needs a second view of actual
// geometry. The diagnostic must never draw that view into the public canvas.
{
  const three=require('three');
  const {probeJourneyOverview}=load('components/marketing/journey/probeJourneyOverview.ts',{three});
  const {probeRenderedCanvas}=load('components/spatial/CanvasPixelProbe.tsx',{},{
    requestAnimationFrame(fn){queue.push(fn);return queue.length;},cancelAnimationFrame(){},
  });
  const scene=new three.Scene(), geometry=new three.BoxGeometry(), material=new three.MeshStandardMaterial();
  const part=new three.InstancedMesh(geometry,material,1);
  scene.add(part); part.computeBoundingBox();
  part.setMatrixAt(0,new three.Matrix4().makeTranslation(30,5,-12));
  const userCamera=new three.PerspectiveCamera(), queue=[];
  for (const scenario of ['visible','sparse','blank','driver error']) {
    const previousTarget = {}, results=[], targets=[], overviewCameras=[];
    let active=previousTarget,disposed=0;
    const gl={
      domElement:{dataset:{},closest:()=>null,getContext:()=>({
        drawingBufferWidth:8,drawingBufferHeight:8,RGBA:6408,UNSIGNED_BYTE:5121,
        readPixels(_x,_y,w,h,_format,_type,bytes){if (scenario==='visible' && w*h>1) bytes.fill(255);},
      })},
      getRenderTarget:()=>active,getActiveCubeFace:()=>2,getActiveMipmapLevel:()=>1,
      setRenderTarget(target,face,level){
        targets.push(target);active=target;
        if(target===previousTarget){assert.equal(face,2);assert.equal(level,1);}
        else target.addEventListener('dispose',()=>{disposed++;});
      },
      render(s,c){
        assert.equal(s,scene);
        if(active===previousTarget){assert.equal(c,userCamera);return;}
        assert.ok(c.isOrthographicCamera);overviewCameras.push(c);
        c.updateMatrixWorld();
        const center=new three.Vector3(30,5,-12).project(c);
        assert.ok(Math.abs(center.x)<1e-10 && Math.abs(center.y)<1e-10,'Overview uses the current instance bounds');
        if(scenario==='driver error')throw new Error('Synthetic offscreen error');
      },
      readRenderTargetPixels(target,_x,_y,_w,_h,bytes){
        assert.equal(target,active);
        if(scenario==='sparse')bytes.fill(120,8,128);
      },
    };
    probeRenderedCanvas({gl,scene,camera:userCamera},result=>results.push(result),()=>probeJourneyOverview(gl,scene));
    while(queue.length)queue.shift()();
    const healthy=scenario==='visible'||scenario==='sparse';
    assert.deepEqual(results,[healthy?'nonblank':'blank']);
    assert.equal(gl.domElement.dataset.canvasProbeView,scenario==='visible'?'visible':'offscreen');
    assert.equal(overviewCameras.length,scenario==='visible'?0:1);
    assert.equal(targets.length,scenario==='visible'?0:2);
    assert.equal(disposed,scenario==='visible'?0:1,'Dispose the target even when its render throws');
    assert.equal(active,previousTarget);
  }
  geometry.dispose();material.dispose();part.dispose();
}
console.log('Homepage journey mocked lifecycle: seven exact content milestones, interpolation/reversal, viewport resize, missing anchors, deferred mount, reduced motion/data-saving, offscreen/hidden pause, responsive quality, portrait final CTA following/root cancellation, static shift reset, static toggle, context-loss and driver-exception fallback, HTML links, and listener/observer/frame cleanup passed. No browser or WebGL rendering is claimed.');
