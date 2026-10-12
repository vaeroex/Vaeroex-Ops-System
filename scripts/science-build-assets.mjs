/** Rebuild local illustrations from archived official RCSB/wwPDB CC0 files. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MeshBasicMaterial } from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
const root = process.cwd();
const sourceDir = path.join(root, 'scripts/science-sources');
const outDir = path.join(root, 'public/brand/science');
fs.mkdirSync(outDir, {recursive:true});
const round = (v, digits=4) => Number(v.toFixed(digits));
const length = (v) => Math.hypot(...v);
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (v) => v.map(x=>x/length(v));
const centroid = (points) => [0,1,2].map(i=>points.reduce((sum,p)=>sum+p[i],0)/points.length);
const radii = { C:1.7, N:1.55, O:1.52, S:1.8, H:1.2, ZN:1.39 };
const scale=0.14;
// A broader sampled atom envelope avoids coarse atom-scale cavities in close views.
const surfaceSigmaFactor=0.65;
const fullSurfaceResolution=88;
const compactSurfaceResolution=48;
const pdb=fs.readFileSync(path.join(sourceDir,'1AZM.pdb'),'utf8');
const lines=pdb.split(/\r?\n/);
const records=lines.filter(l=>/^(ATOM  |HETATM)/.test(l) && [' ','A'].includes(l[16])).map(l=>({record:l.slice(0,6).trim(),id:l.slice(12,16).trim(),residueName:l.slice(17,20).trim(),chain:l[21],residue:Number(l.slice(22,26)),element:l.slice(76,78).trim(),raw:[Number(l.slice(30,38)),Number(l.slice(38,46)),Number(l.slice(46,54))]}));
const protein=records.filter(a=>a.record==='ATOM' && a.chain==='A');
const bound=records.filter(a=>a.residueName==='AZM');
const metal=records.find(a=>a.residueName==='ZN');
if(protein.length<1900 || bound.length!==13 || !metal)throw Error('Unexpected 1AZM composition');
const origin=centroid(bound.map(a=>a.raw));
const z=unit(sub(origin,centroid(protein.map(a=>a.raw))));
const x=unit(cross(Math.abs(z[1])>.95?[1,0,0]:[0,1,0],z));
const y=unit(cross(z,x));
const axes=[x,y,z];
const transform=(p)=>axes.map(axis=>round(dot(sub(p,origin),axis)*scale));
const atom=(a,fn=transform)=>({id:a.id,element:a.element,position:fn(a.raw),radius:round((radii[a.element]||1.7)*scale)});
const secondaryRanges=lines.filter(l=>l.startsWith('HELIX ')||l.startsWith('SHEET ')).map(l=>l.startsWith('HELIX ')?{type:'helix',chain:l[19],start:Number(l.slice(21,25)),end:Number(l.slice(33,37))}:{type:'sheet',chain:l[21],start:Number(l.slice(22,26)),end:Number(l.slice(33,37))});
const backbone=protein.filter(a=>a.id==='CA').map(a=>({residue:a.residue,residueName:a.residueName,chain:a.chain,position:transform(a.raw),oxygen:transform(protein.find(o=>o.residue===a.residue&&o.id==='O').raw),secondary:secondaryRanges.find(r=>r.chain===a.chain&&a.residue>=r.start&&a.residue<=r.end)?.type||'coil'}));
function cifLoop(text, prefix){
 const rows=text.split(/\r?\n/);const start=rows.findIndex(l=>l.trim().startsWith(prefix+'.'));
 const keys=[];let i=start;
 while(rows[i]?.trim().startsWith(prefix+'.'))keys.push(rows[i++].trim().slice(prefix.length+1));
 const out=[];
 while(i<rows.length && !/^(#|loop_|_)/.test(rows[i])){
  const tokens=rows[i++].match(/"[^"]*"|'[^']*'|\S+/g)||[];
  if(tokens.length) {if(tokens.length!==keys.length)throw Error('Unexpected CIF row');out.push(Object.fromEntries(keys.map((key,k)=>[key,tokens[k].replace(/^["']|["']$/g,'')])));}
 }
 return out;
}
const names={AZM:'Acetazolamide',MZM:'Methazolamide',EZL:'Ethoxzolamide'};
function ligand(ccdId, observed){
 const text=fs.readFileSync(path.join(sourceDir,ccdId+'.cif'),'utf8');
 const entries=cifLoop(text,'_chem_comp_atom').filter(a=>a.type_symbol!=='H');
 const raw=observed||entries.map(a=>({id:a.atom_id,element:a.type_symbol,raw:['x','y','z'].map(axis=>Number(a['pdbx_model_Cartn_'+axis+'_ideal']))}));
 const center=centroid(raw.map(a=>a.raw));
 const atoms=raw.map(a=>atom(a,observed?transform:p=>sub(p,center).map(v=>round(v*scale))));
 const bonds=cifLoop(text,'_chem_comp_bond').filter(b=>atoms.some(a=>a.id===b.atom_id_1)&&atoms.some(a=>a.id===b.atom_id_2)).map(b=>({a:atoms.findIndex(a=>a.id===b.atom_id_1),b:atoms.findIndex(a=>a.id===b.atom_id_2),order:({SING:1,DOUB:2,TRIP:3,AROM:1.5})[b.value_order],aromatic:b.pdbx_aromatic_flag==='Y'}));
 return {ccdId,name:names[ccdId],atoms,bonds,sourceUrl:'https://www.rcsb.org/ligand/'+ccdId,coordinates:observed?'observed-bound':'CCD-ideal'};
}
const atoms=protein.map(a=>atom(a));
function surface(resolution){
 const min=[0,1,2].map(i=>Math.min(...atoms.map(a=>a.position[i]))-.7);
 const max=[0,1,2].map(i=>Math.max(...atoms.map(a=>a.position[i]))+.7);
 const center=centroid([min,max]);const size=Math.max(...max.map((v,i)=>v-min[i]));
 const material=new MeshBasicMaterial();const cubes=new MarchingCubes(resolution,material,false,false,100000);
 cubes.isolation=.25;
 for(const a of atoms){
  const sigma=a.radius*surfaceSigmaFactor;const cutoff=sigma*3.8;
  const coords=a.position.map((v,i)=>(v-center[i]+size/2)/size*resolution);
  const gridRadius=cutoff/size*resolution;
  const ranges=coords.map(c=>[Math.max(1,Math.floor(c-gridRadius)),Math.min(resolution-2,Math.ceil(c+gridRadius))]);
  for(let gz=ranges[2][0];gz<=ranges[2][1];gz++)for(let gy=ranges[1][0];gy<=ranges[1][1];gy++)for(let gx=ranges[0][0];gx<=ranges[0][1];gx++){
   const d2=((gx-coords[0])**2+(gy-coords[1])**2+(gz-coords[2])**2)*(size/resolution)**2;
   cubes.field[gx+gy*resolution+gz*resolution*resolution]+=Math.exp(-d2/(2*sigma*sigma));
  }
 }
 cubes.update();
 const positions=[];const normals=[];const indices=[];const vertices=new Map();
 for(let i=0;i<cubes.count;i++){
  const position=[0,1,2].map(axis=>round(cubes.positionArray[i*3+axis]*size/2+center[axis],4));
  const key=position.join(',');let index=vertices.get(key);
  if(index===undefined){index=positions.length/3;vertices.set(key,index);positions.push(...position);const n=[0,1,2].map(axis=>cubes.normalArray[i*3+axis]);normals.push(...unit(n).map(v=>round(v,3)));}
  indices.push(index);
 }
 cubes.geometry.dispose();material.dispose();
 return {positions,normals,indices,resolution,representation:'approximate-Gaussian-envelope'};
}
const nearest=bound.reduce((best,a)=>length(sub(a.raw,metal.raw))<length(sub(best.raw,metal.raw))?a:best,bound[0]);
const data={schemaVersion:1,pdbId:'1AZM',name:'Human carbonic anhydrase I',source:{url:'https://www.rcsb.org/structure/1AZM',downloadUrl:'https://files.rcsb.org/download/1AZM.pdb',doi:'https://doi.org/10.2210/pdb1AZM/pdb',citationDoi:'https://doi.org/10.1006/jmbi.1994.1655',authors:['S. Chakravarty','K. K. Kannan'],method:'X-RAY DIFFRACTION',resolutionAngstrom:2,license:'CC0-1.0',licenseUrl:'https://www.rcsb.org/pages/usage-policy',sourceSha256:crypto.createHash('sha256').update(pdb).digest('hex')},transform:{originAngstrom:origin.map(v=>round(v,6)),axes:axes.map(a=>a.map(v=>round(v,8))),scale},backbone,secondaryRanges,atoms,ligand:ligand('AZM',bound),zinc:{position:transform(metal.raw),ligandAtomId:nearest.id,distanceAngstrom:round(length(sub(nearest.raw,metal.raw)),3)},pocket:{center:[0,0,0],radius:round(Math.max(...bound.map(a=>length(sub(a.raw,origin))))*scale+.2),outward:[0,0,1],interpretation:'Illustrative focus around the observed ligand, not a predicted pocket boundary.'},surface:surface(fullSurfaceResolution),compactSurface:surface(compactSurfaceResolution),candidates:['AZM','MZM','EZL'].map(id=>ligand(id)),notice:'Observed 1AZM protein and bound acetazolamide coordinates. Approximate Gaussian envelope and all approach, comparison, and emphasis motion are conceptual illustrations, not docking, dynamics, affinity, or efficacy predictions.'};
function packSurface(mesh) {
 const signed16=Buffer.alloc(mesh.positions.length*2);
 mesh.positions.forEach((v,i)=>signed16.writeInt16LE(Math.round(v*1000),i*2));
 // Quantization can collapse tiny marching-cube triangles; omit those faces.
 const valid=[];
 const position=(i)=>[0,1,2].map(axis=>signed16.readInt16LE(i*6+axis*2)/1000);
 for(let i=0;i<mesh.indices.length;i+=3){
  const face=mesh.indices.slice(i,i+3);const [a,b,c]=face.map(position);
  if(length(cross(sub(b,a),sub(c,a)))>1e-8)valid.push(...face);
 }
 // Normals follow the actual displayed facets. Raw field finite differences can
 // disagree with coarse concave marching-cube triangles and produce bright shards.
 const accumulated=new Float64Array(mesh.positions.length);
 for(let i=0;i<valid.length;i+=3){
  const face=valid.slice(i,i+3);const [a,b,c]=face.map(position);
  const normal=cross(sub(b,a),sub(c,a));
  for(const vertex of face)for(let axis=0;axis<3;axis++)accumulated[vertex*3+axis]+=normal[axis];
 }
 const signed8=Buffer.alloc(mesh.normals.length);
 for(let i=0;i<accumulated.length;i+=3){
  const normal=Array.from(accumulated.slice(i,i+3));
  const normalized=length(normal)>1e-12?unit(normal):unit(mesh.normals.slice(i,i+3));
  normalized.forEach((v,axis)=>signed8.writeInt8(Math.round(v*127),i+axis));
 }
 const unsigned16=Buffer.alloc(valid.length*2);
 valid.forEach((v,i)=>unsigned16.writeUInt16LE(v,i*2));
 return {encoding:'quantized-le-v1',positionData:signed16.toString('base64'),normalData:signed8.toString('base64'),indexData:unsigned16.toString('base64'),resolution:mesh.resolution,representation:mesh.representation};
}
const packed={...data,surface:packSurface(data.surface),compactSurface:packSurface(data.compactSurface)};
const json=JSON.stringify(packed);
fs.writeFileSync(path.join(outDir,'carbonic-anhydrase-1azm.json'),json+'\n');
console.log(JSON.stringify({bytes:Buffer.byteLength(json),backbone:backbone.length,proteinAtoms:atoms.length,triangles:Buffer.from(packed.surface.indexData,'base64').length/6,compactTriangles:Buffer.from(packed.compactSurface.indexData,'base64').length/6,zinc:data.zinc,candidates:data.candidates.map(l=>({id:l.ccdId,atoms:l.atoms.length,bonds:l.bonds.length}))},null,2));
