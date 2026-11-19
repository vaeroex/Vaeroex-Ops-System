"use client";

import { ArrowLeft, ArrowRight, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import SiteGraphic, { atomColors, initialView } from "./SiteGraphic";
import type { Compound } from "./structures";
import styles from "./demo.module.css";

type Point = { x: number; y: number };
const clampZoom = (n: number) => Math.min(2.2, Math.max(.6, n));

export function BindingSiteViewer({ compound }: { compound: Compound }) {
  const [view, setView] = useState(initialView);
  const stage = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number, Point>());
  const zoom = (factor: number) => setView(v => ({...v, zoom: clampZoom(v.zoom * factor)}));
  const rotate = (x: number, y = 0) => setView(v => ({...v, yaw:v.yaw+x, pitch:v.pitch+y}));
  const reset = () => setView(initialView);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== el) return;
      event.preventDefault();
      zoom(Math.exp(-.002 * Math.max(-150, Math.min(150, event.deltaY))));
    };
    el.addEventListener("wheel", wheel, {passive: false});
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  function keyPress(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowRight": rotate(.16); break;
      case "ArrowLeft": rotate(-.16); break;
      case "ArrowUp": rotate(0, -.16); break;
      case "ArrowDown": rotate(0, .16); break;
      case "+": case "=": zoom(1.18); break;
      case "-": zoom(1/1.18); break;
      case "Home": reset(); break;
      default: return;
    }
    e.preventDefault();
  }
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({preventScroll:true});
    touches.current.set(e.pointerId, {x:e.clientX, y:e.clientY});
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    const previous = touches.current.get(e.pointerId);
    if (!previous) return;
    const next = {x:e.clientX, y:e.clientY};
    touches.current.set(e.pointerId,next);
    if (touches.current.size === 1) {
      rotate((next.x-previous.x)*.012, (next.y-previous.y)*.012);
    } else if (touches.current.size === 2) {
      const other = [...touches.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return;
      const before = Math.hypot(previous.x-other.x, previous.y-other.y);
      if (before > 2) zoom(Math.hypot(next.x-other.x,next.y-other.y)/before);
    }
  }
  return <div className={styles.viewer}>
    <div className={styles.stage} ref={stage} tabIndex={0} role="group"
      aria-label={compound.name + " interactive three-dimensional binding site"} aria-describedby="site-instructions"
      onKeyDown={keyPress} onPointerDown={pointerDown} onPointerMove={pointerMove}
      onLostPointerCapture={e => touches.current.delete(e.pointerId)}
      onPointerCancel={e => touches.current.delete(e.pointerId)} onPointerUp={e => touches.current.delete(e.pointerId)}>
      <div className={styles.stageLabel}>PDB {compound.pdb} · Chain A</div>
      <SiteGraphic site={compound.structure} label={compound.name + " bound to zinc in experimental structure "+ compound.pdb + ", chain A."} view={view}/>
    </div>
    <div className={styles.controls} role="group" aria-label="Binding site view controls">
      <button type="button" onClick={()=>rotate(-.28)} aria-label="Rotate left" title="Rotate left"><ArrowLeft size={17}/></button>
      <button type="button" onClick={()=>rotate(.28)} aria-label="Rotate right" title="Rotate right"><ArrowRight size={17}/></button>
      <button type="button" onClick={()=>zoom(1.18)} aria-label="Zoom in" title="Zoom in"><Plus size={17}/></button>
      <button type="button" onClick={()=>zoom(1/1.18)} aria-label="Zoom out" title="Zoom out"><Minus size={17}/></button>
      <button type="button" onClick={reset}><RotateCcw size={16}/> Reset view</button>
    </div>
    <p id="site-instructions" className={styles.help}>Drag to rotate. Pinch or use the zoom controls. With the view focused, use the arrow keys to rotate and + or − to zoom.</p>
    <ul className={styles.legend} aria-label="Structure colors">
      {Object.entries({C:"Carbon",N:"Nitrogen",O:"Oxygen",S:"Sulfur",ZN:"Zinc"}).map(([el,name]) =>
        <li key={el}><span style={{background:atomColors[el]}}/>{name}</li>)}
      <li><span style={{background:"#7088aa"}}/>Protein</li>
    </ul>
  </div>;
}
