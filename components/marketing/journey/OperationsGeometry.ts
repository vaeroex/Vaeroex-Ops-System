import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Shape, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

function box(width: number, height: number, depth: number, x = 0, y = 0, z = 0) {
  return new BoxGeometry(width, height, depth).translate(x, y, z);
}

function merge(parts: BufferGeometry[]) {
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return geometry;
}

/** Beveled physical displays with generic document, connection and browser layouts. */
export function operationsDisplayGeometry(family: number) {
  // Reserve the bevel inside the same conservative panel bounds used by clearance checks.
  const width = (family === 0 ? 1.35 : 1.05) - .03;
  const height = family === 0 ? .88 : .78;
  const radius = .055;
  const outline = new Shape();
  outline.moveTo(-width / 2 + radius, -height / 2);
  outline.lineTo(width / 2 - radius, -height / 2);
  outline.quadraticCurveTo(width / 2, -height / 2, width / 2, -height / 2 + radius);
  outline.lineTo(width / 2, height / 2 - radius);
  outline.quadraticCurveTo(width / 2, height / 2, width / 2 - radius, height / 2);
  outline.lineTo(-width / 2 + radius, height / 2);
  outline.quadraticCurveTo(-width / 2, height / 2, -width / 2, height / 2 - radius);
  outline.lineTo(-width / 2, -height / 2 + radius);
  outline.quadraticCurveTo(-width / 2, -height / 2, -width / 2 + radius, -height / 2);
  const body = new ExtrudeGeometry(outline, {
    depth: .09, steps: 1, bevelEnabled: true, bevelSegments: 2,
    bevelSize: .014, bevelThickness: .014, curveSegments: 4,
  }).translate(0, 0, -.055);
  const face = box(width - .09, height - .09, .018, 0, 0, .055);
  const traces: BufferGeometry[] = [];
  const frames: BufferGeometry[] = [
    box(width - .04, .016, .02, 0, -height / 2 + .022, .075),
    box(.016, height - .04, .02, -width / 2 + .022, 0, .075),
    box(.016, height - .04, .02, width / 2 - .022, 0, .075),
  ];
  const card = (x: number, y: number, w: number, h: number) => {
    frames.push(box(w, h, .012, x, y, .077));
    traces.push(box(w * .68, .012, .014, x - w * .04, y + h * .23, .093));
    traces.push(box(w * .48, .01, .014, x - w * .14, y - h * .03, .093));
  };

  if (family === 0) {
    // An organized document wall, deliberately without figures, axes or invented metrics.
    traces.push(box(.78, .026, .015, -.13, .31, .091));
    for (const x of [-.39, 0, .39]) card(x, .02, .30, .40);
    frames.push(box(1.08, .026, .012, 0, -.29, .078));
  } else if (family === 1) {
    // A connection canvas with physical module tiles and quiet connector lines.
    for (const x of [-.29, .29]) for (const y of [-.16, .16]) card(x, y, .24, .18);
    traces.push(box(.34, .016, .014, 0, .16, .093));
    traces.push(box(.34, .016, .014, 0, -.16, .093));
    traces.push(box(.016, .32, .014, 0, 0, .093));
  } else {
    // Browser controls, address field, navigation, hero and content cards are recognizable
    // page structure, not a claim to show a real website or product interface.
    frames.push(box(.94, .115, .016, 0, .285, .077));
    for (let i = 0; i < 3; i++) {
      traces.push(new CylinderGeometry(.015, .015, .018, 10)
        .rotateX(Math.PI / 2).translate(-.405 + i * .048, .285, .093));
    }
    traces.push(box(.49, .035, .014, .08, .285, .093));
    frames.push(box(.11, .04, .012, -.37, .16, .077));
    for (const x of [.13, .27, .40]) traces.push(box(.08, .011, .014, x, .16, .093));
    card(-.20, -.015, .42, .22);
    frames.push(box(.30, .22, .012, .24, -.015, .077));
    traces.push(box(.18, .025, .014, -.29, -.19, .093));
    for (const x of [-.31, 0, .31]) card(x, -.285, .25, .09);
  }
  return { body, face, trace: merge(traces), frame: merge(frames) };
}
