"use client";

import { ArrowLeft, ArrowRight, ChevronDown, Focus, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import SiteGraphic, { atomColors } from "./SiteGraphic";
import type { Compound } from "./structures";
import { defaults, frameFor, modeNames, type Display, type DisplayMode, type View } from "./view";
import type { createMoleculeRenderer } from "./moleculeRenderer";
import styles from "./demo.module.css";

type Point = { x: number; y: number };
const clampZoom = (value: number) => Math.min(3.5, Math.max(.55,value));

export function BindingSiteViewer({ compound }: { compound: Compound }) {
  const [display,setDisplay] = useState<Display>(defaults);
  const [renderer,setRenderer] = useState<"loading"|"webgl"|"projection">("loading");
  const {view,mode,opacity,zinc,labels} = display;
  const liveDisplay = useRef(display);
  const engine = useRef<ReturnType<typeof createMoleculeRenderer> | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDetailsElement>(null);
  const pointers = useRef(new Map<number,Point>());
  useEffect(()=>{
    const panel=drawer.current;
    if(!panel) return;
    const wide=window.matchMedia("(min-width: 861px)");
    const resize=()=>{panel.open=wide.matches};
    resize();wide.addEventListener("change",resize);
    return ()=>wide.removeEventListener("change",resize);
  },[]);
  useEffect(()=>{
    liveDisplay.current=display;
    engine.current?.draw(display);
  },[display]);
  useEffect(()=>{
    const element=canvas.current;
    if(!element) return;
    let active=true;
    const observer=new ResizeObserver(()=>engine.current?.draw(liveDisplay.current));
    const lost=(event:Event)=>{
      event.preventDefault();
      observer.disconnect();
      engine.current?.dispose();
      engine.current = null;
      setRenderer("projection");
    };
    element.addEventListener("webglcontextlost",lost);
    async function setup() {
      try {
        const {createMoleculeRenderer}=await import("./moleculeRenderer");
        if (!active) return;
        engine.current=createMoleculeRenderer(element!,compound.structure);
        engine.current.draw(liveDisplay.current);
        observer.observe(element!);
        setRenderer("webgl");
      } catch {
        if(active) setRenderer("projection");
      }
    }
    void setup();
    return ()=>{
      active=false;
      observer.disconnect();
      element.removeEventListener("webglcontextlost",lost);
      engine.current?.dispose();engine.current=null;
    };
  },[compound]);
  function updateView(update:(current:View)=>View) {
    setDisplay(prev=>({...prev,view:update(prev.view)}));
  }
  const zoom=(factor:number)=>updateView(v=>({...v,zoom:clampZoom(v.zoom*factor)}));
  const rotate=(x:number,y=0)=>updateView(v=>({...v,yaw:v.yaw+x,pitch:v.pitch+y}));
  const focusSite=()=>setDisplay(prev=>({...prev,mode:"site",view:{...prev.view,zoom:1}}));
  const reset=()=>setDisplay(defaults);
  function chooseMode(next:DisplayMode) {
    setDisplay(prev=>({...prev,mode:next,view:{...prev.view,zoom:1}}));
  }
  useEffect(()=>{
    const el=stage.current;
    if(!el) return;
    const wheel=(e:WheelEvent)=>{
      if(document.activeElement!==el) return;
      e.preventDefault();
      const factor=Math.exp(-.002*Math.max(-150,Math.min(150,e.deltaY)));
      setDisplay(d=>({...d,view:{...d.view,zoom:clampZoom(d.view.zoom*factor)}}));
    };
    el.addEventListener("wheel",wheel,{passive:false});
    return ()=>el.removeEventListener("wheel",wheel);
  },[]);
  function keyPress(e:KeyboardEvent<HTMLDivElement>) {
    switch(e.key){
      case "ArrowRight": rotate(.16); break;
      case "ArrowLeft": rotate(-.16); break;
      case "ArrowUp": rotate(0,-.16); break;
      case "ArrowDown": rotate(0,.16); break;
      case "+": case "=": zoom(1.18); break;
      case "-": zoom(1/1.18); break;
      case "Home": reset(); break;
      default:return;
    }
    e.preventDefault();
  }
  function pointerDown(e:PointerEvent<HTMLDivElement>) {
    if(e.pointerType==="mouse" && e.button!==0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({preventScroll:true});
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  }
  function pointerMove(e:PointerEvent<HTMLDivElement>) {
    const previous=pointers.current.get(e.pointerId);
    if(!previous) return;
    const next={x:e.clientX,y:e.clientY};
    pointers.current.set(e.pointerId,next);
    if(pointers.current.size===1) rotate((next.x-previous.x)*.012,(next.y-previous.y)*.012);
    if(pointers.current.size===2){
      const other=[...pointers.current.entries()].find(([id])=>id!==e.pointerId)?.[1];
      if(!other) return;
      const before=Math.hypot(previous.x-other.x,previous.y-other.y);
      if(before>2) zoom(Math.hypot(next.x-other.x,next.y-other.y)/before);
    }
  }
  const end=(e:PointerEvent<HTMLDivElement>)=>{pointers.current.delete(e.pointerId)};
  return <>
    <div className={styles.plot}>
      <div className={styles.plotTitle}>
        <span>Experimental structure</span><span>PDB {compound.pdb} · Chain A</span>
      </div>
      <div ref={stage} className={styles.stage} role="group" tabIndex={0}
        data-structure-stage="" data-renderer={renderer} data-pdb={compound.pdb} data-mode={mode}
        data-rotation={view.yaw.toFixed(3)+","+view.pitch.toFixed(3)} data-zoom={view.zoom.toFixed(3)} data-opacity={opacity}
        data-zinc={mode!=="ligand" && zinc} data-labels={mode!=="ligand" && labels}
        aria-label={compound.name+" interactive three-dimensional "+modeNames[mode].toLowerCase()} aria-describedby="site-instructions"
        onKeyDown={keyPress} onPointerDown={pointerDown} onPointerMove={pointerMove}
        onLostPointerCapture={end} onPointerCancel={end} onPointerUp={end}>
        {renderer!=="webgl" && <SiteGraphic site={compound.structure} label={compound.name+" experimental structure, PDB "+compound.pdb+", chain A."} display={display} frame={frameFor(compound.structure,mode)}/>}
        <canvas ref={canvas} aria-hidden="true" style={{visibility:renderer==="webgl"?"visible":"hidden"}}/>
        <span className={styles.stageCaption}>{compound.name}<small>{modeNames[mode]}</small></span>
      </div>
      <div className={styles.stageFoot}>
        <p id="site-instructions">Drag to rotate · Pinch or scroll to zoom</p>
        <span className="sr-only">Focus the view and use the arrow keys to rotate, + or − to zoom, or Home to reset.</span>
        <ul className={styles.legend} aria-label="Structure colors">
          {Object.entries({C:"Carbon",N:"Nitrogen",O:"Oxygen",S:"Sulfur",...(mode!=="ligand" && zinc?{ZN:"Zinc"}:{})}).map(([element,name])=>
            <li key={element}><i style={{background:atomColors[element]}}/>{name}</li>)}
          {mode!=="ligand" && <li><i style={{background:"#678d9d"}}/>Protein</li>}
        </ul>
      </div>
      {renderer==="projection" && <p className={styles.fallback} role="status">WebGL is unavailable. This projection uses the same experimental coordinates.</p>}
    </div>
    <details ref={drawer} className={styles.settings}>
      <summary>Display controls <ChevronDown size={16} aria-hidden="true"/></summary>
      <div className={styles.panel}>
        <fieldset><legend>View</legend><div className={styles.modes}>
          {(Object.keys(modeNames) as DisplayMode[]).map(key=><button key={key} type="button" aria-pressed={mode===key}
            onClick={()=>chooseMode(key)}>{modeNames[key]}</button>)}
        </div></fieldset>
        <fieldset className={styles.proteinOptions} disabled={mode==="ligand"}>
          <legend className="sr-only">Protein display</legend>
          <label className={styles.rangeLabel} htmlFor="protein-opacity">Protein opacity <output htmlFor="protein-opacity">{Math.round(opacity*100)}%</output></label>
          <input id="protein-opacity" type="range" min="0" max="100" step="1" value={Math.round(opacity*100)}
            aria-valuetext={Math.round(opacity*100)+" percent"} onChange={e=>setDisplay(d=>({...d,opacity:Number(e.target.value)/100}))}/>
          <label className={styles.toggle}><input type="checkbox" checked={mode!=="ligand" && zinc} onChange={e=>setDisplay(d=>({...d,zinc:e.target.checked}))}/>Zinc marker</label>
          <label className={styles.toggle}><input type="checkbox" checked={mode!=="ligand" && labels} onChange={e=>setDisplay(d=>({...d,labels:e.target.checked}))}/>Nearby residue labels</label>
        </fieldset>
        <div className={styles.camera}>
          <div className={styles.controls} role="group" aria-label="Camera controls">
            <button type="button" aria-label="Rotate left" title="Rotate left" onClick={()=>rotate(-.28)}><ArrowLeft size={16}/></button>
            <button type="button" aria-label="Rotate right" title="Rotate right" onClick={()=>rotate(.28)}><ArrowRight size={16}/></button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={()=>zoom(1/1.18)}><Minus size={16}/></button>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={()=>zoom(1.18)}><Plus size={16}/></button>
          </div>
          <button className={styles.focusButton} type="button" onClick={focusSite}><Focus size={16}/>Center binding site</button>
          <button className={styles.resetButton} type="button" onClick={reset}><RotateCcw size={14}/>Reset view</button>
        </div>
      </div>
    </details>
  </>;
}
