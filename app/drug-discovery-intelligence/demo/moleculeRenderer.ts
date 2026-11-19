import * as THREE from "three";
import { atomColors } from "./SiteGraphic";
import type { Structure } from "./structures";
import { frameFor, type Display } from "./view";

const vector = (values: number[]) => new THREE.Vector3().fromArray(values);
const pocketColor = "#658298";
const toY = new THREE.Vector3(0,1,0);

/** Construct a ribbon through the deposited alpha carbons. Carbonyl oxygens orient
 * the ribbon; each break in the chain starts a new strip. */
function ribbon(site: Structure, local: boolean) {
  const meshPositions: number[] = [], indices: number[] = [];
  let stretch: Structure["chain"] = [];
  const finish = () => {
    if (stretch.length < 2) { stretch=[]; return; }
    const path = new THREE.CatmullRomCurve3(stretch.map(r => vector(r.xyz)));
    const sides = 8, steps = 4 * (stretch.length - 1), start = meshPositions.length / 3;
    const directions: THREE.Vector3[] = [];
    for (const residue of stretch) {
      const previous = directions.at(-1);
      const d = residue.oxygen ? vector(residue.oxygen).sub(vector(residue.xyz)).normalize() :
        previous?.clone() ?? new THREE.Vector3(1,0,0);
      if (previous && d.dot(previous) < 0) d.negate();
      directions.push(d);
    }
    for (let i=0; i<=steps; ++i) {
      const t=i/steps, f=i/4, lo=Math.floor(f), hi=Math.min(lo+1, stretch.length-1), blend=f-lo;
      const center=path.getPoint(t), tangent=path.getTangent(t).normalize();
      const across=directions[lo].clone().lerp(directions[hi], blend);
      across.addScaledVector(tangent,-tangent.dot(across)).normalize();
      const normal=new THREE.Vector3().crossVectors(tangent,across).normalize();
      const widthAt=(j: number) => stretch[j].shape === "loop" ? .32 : stretch[j].shape === "helix" ? 1.05 : 1.25;
      const width=THREE.MathUtils.lerp(widthAt(lo),widthAt(hi),blend);
      for (let j=0; j<sides; ++j) {
        const angle=2*Math.PI*j/sides;
        const p=center.clone().addScaledVector(across, Math.cos(angle)*width).addScaledVector(normal, Math.sin(angle)*.25);
        meshPositions.push(p.x,p.y,p.z);
        if (i) {
          const a=start+(i-1)*sides+j, b=start+(i-1)*sides+(j+1)%sides;
          indices.push(a,b,a+sides,b,b+sides,a+sides);
        }
      }
    }
    stretch=[];
  };
  for (const residue of site.chain) {
    const last=stretch.at(-1);
    if (local && vector(residue.xyz).distanceTo(vector(site.center)) > 13) { finish(); continue; }
    if (last && vector(last.xyz).distanceTo(vector(residue.xyz)) > 4.2) finish();
    stretch.push(residue);
  }
  finish();
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(meshPositions,3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createMoleculeRenderer(canvas: HTMLCanvasElement, site: Structure) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true, powerPreference:"low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));
  renderer.setClearColor(0,0);
  const scene=new THREE.Scene(), pivot=new THREE.Group(), model=new THREE.Group();
  const camera=new THREE.OrthographicCamera(-20,20,12,-12,.1,360);
  camera.position.set(0,0,120);
  scene.add(pivot); pivot.add(model);
  scene.add(new THREE.HemisphereLight(0xf1fbff,0x384352,1.65));
  const light=new THREE.DirectionalLight(0xffffff,2.35); light.position.set(-3,5,5); scene.add(light);
  const bounce=new THREE.DirectionalLight(0x86badc,.8); bounce.position.set(3,-1,-2); scene.add(bounce);

  const ligand=new THREE.Group(), sidechains=new THREE.Group(), zinc=new THREE.Group(), labels=new THREE.Group();
  model.add(ligand,sidechains,zinc,labels);
  const material=(color:string) => new THREE.MeshStandardMaterial({color, roughness:.52,metalness:.04});
  const surfaces = new Map<string,THREE.MeshStandardMaterial>();
  const surface = (color:string) => {
    if (!surfaces.has(color)) surfaces.set(color,material(color));
    return surfaces.get(color)!;
  };
  const ribbonMaterial=new THREE.MeshStandardMaterial({color:"#678d9d",roughness:.54,side:THREE.DoubleSide,transparent:true,depthWrite:false});
  const localRibbon=new THREE.Mesh(ribbon(site,true),ribbonMaterial);
  const fullRibbon=new THREE.Mesh(ribbon(site,false),ribbonMaterial);
  model.add(localRibbon,fullRibbon);
  const sphere=new THREE.SphereGeometry(1,20,14);
  const cylinder=new THREE.CylinderGeometry(1,1,1,12);
  const proteinMaterials=new Set<THREE.MeshStandardMaterial>();
  function rod(group:THREE.Group, a:THREE.Vector3,b:THREE.Vector3,radius:number,mat:THREE.Material) {
    const mesh=new THREE.Mesh(cylinder,mat), axis=b.clone().sub(a);
    mesh.position.copy(a).lerp(b,.5);
    mesh.quaternion.setFromUnitVectors(toY,axis.clone().normalize());
    mesh.scale.set(radius,axis.length(),radius);
    group.add(mesh);
  }
  const color=(atom: Structure["atoms"][number]) => atom.residue==="HIS" ? (atom.element==="N"?"#87a8c8":pocketColor) : atomColors[atom.element];
  const points=site.atoms.map(a=>vector(a.xyz));
  site.atoms.forEach((atom,i)=>{
    const pocket=atom.residue==="HIS", metal=atom.element==="ZN", mat=surface(color(atom));
    if (pocket) proteinMaterials.add(mat);
    const mesh=new THREE.Mesh(sphere,mat);
    mesh.position.copy(points[i]);
    mesh.scale.setScalar(pocket?.23:metal?.64:atom.element==="S"?.47:.39);
    (pocket?sidechains:metal?zinc:ligand).add(mesh);
  });
  for (const [a,b] of site.bonds) {
    const pocket=site.atoms[a].residue==="HIS";
    const mid=points[a].clone().lerp(points[b],.5);
    for (const i of [a,b]) rod(pocket?sidechains:ligand,points[i],mid,pocket?.12:.18,surface(color(site.atoms[i])));
  }
  const proteinContacts=new THREE.Group(); zinc.add(proteinContacts);
  const contactMaterial=surface("#bda5cd"), proteinContactMaterial=surface("#a89ebc");
  proteinMaterials.add(proteinContactMaterial);
  for (const [a,b] of site.contacts) {
    const pocket=site.atoms[b].residue==="HIS";
    for (let j=0;j<5;j++) rod(pocket?proteinContacts:zinc,points[a].clone().lerp(points[b],j/5),
      points[a].clone().lerp(points[b],(j+.54)/5),.043,pocket?proteinContactMaterial:contactMaterial);
  }
  // Labels are anchored to actual alpha carbons from this entry.
  const textures:THREE.Texture[]=[];
  function addLabel(text:string, position:THREE.Vector3, parent:THREE.Group) {
    const tag=document.createElement("canvas"); tag.width=192; tag.height=60;
    const ctx=tag.getContext("2d"); if(!ctx) return;
    ctx.font="600 26px system-ui,sans-serif";
    const width=Math.ceil(ctx.measureText(text).width)+20;
    ctx.fillStyle="rgba(12,30,41,.92)";ctx.fillRect(0,5,width,45);
    ctx.fillStyle="#f2f8f5";ctx.fillText(text,10,36);
    const texture=new THREE.CanvasTexture(tag);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,transparent:true}));
    sprite.center.set(0,.05); sprite.position.copy(position);sprite.renderOrder=3;parent.add(sprite);
  }
  const zincIndex=site.atoms.findIndex(a=>a.element==="ZN");
  const zincLabel=new THREE.Group();zinc.add(zincLabel);
  addLabel("Zn",points[zincIndex],zincLabel);
  site.atoms.forEach((atom,i)=>{if(atom.residue==="HIS" && atom.name==="CA") addLabel("His "+atom.number,points[i],labels)});
  const frames = { site:frameFor(site,"site"), protein:frameFor(site,"protein"), ligand:frameFor(site,"ligand") };
  let lastWidth=0, lastHeight=0;
  function draw(display:Display) {
    const width=canvas.clientWidth,height=canvas.clientHeight;
    if (!width || !height) return;
    if (width!==lastWidth||height!==lastHeight) {renderer.setSize(width,height,false);lastWidth=width;lastHeight=height}
    const {mode,opacity,view}=display;
    const frame=frames[mode], aspect=width/height;
    const span=frame.radius/(Math.min(1,aspect)*view.zoom);
    camera.left=-span*aspect;camera.right=span*aspect;camera.top=span;camera.bottom=-span;camera.updateProjectionMatrix();
    pivot.rotation.set(view.pitch,view.yaw,0,"XYZ");model.position.copy(vector(frame.center)).negate();
    localRibbon.visible=mode==="site" && opacity>0;fullRibbon.visible=mode==="protein" && opacity>0;
    sidechains.visible=mode!=="ligand" && opacity>0;
    zinc.visible=mode!=="ligand" && display.zinc;
    proteinContacts.visible=opacity>0;
    labels.visible=mode!=="ligand" && display.labels;
    ribbonMaterial.opacity=opacity;
    for(const mat of proteinMaterials){mat.opacity=opacity;mat.transparent=opacity<1;mat.depthWrite=opacity>=1}
    const labelWidth=2*span*112/height;
    for(const tag of [...zincLabel.children,...labels.children]) tag.scale.set(labelWidth,labelWidth*60/192,1);
    renderer.render(scene,camera);
  }
  function dispose() {
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    scene.traverse(object=>{
      if(object instanceof THREE.Mesh){geometries.add(object.geometry);materials.add(object.material as THREE.Material)}
      if(object instanceof THREE.Sprite) materials.add(object.material);
    });
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return {draw,dispose};
}
