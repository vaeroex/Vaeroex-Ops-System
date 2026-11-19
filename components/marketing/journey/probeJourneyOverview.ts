import { Box3, InstancedMesh, OrthographicCamera, Sphere, WebGLRenderTarget, type Scene, type WebGLRenderer } from "three";

/** A restored scroll position can put the public camera inside the sculpture's empty passage. */
export function probeJourneyOverview(gl: WebGLRenderer, scene: Scene): boolean {
  // Instanced bounds may have been cached before the latest scroll transforms.
  scene.traverse(object => {
    if (object instanceof InstancedMesh) object.computeBoundingBox();
  });
  const bounds = new Box3().setFromObject(scene).getBoundingSphere(new Sphere());
  if (!Number.isFinite(bounds.radius) || bounds.radius <= 0) return false;

  const extent = bounds.radius * 1.1;
  const camera = new OrthographicCamera(-extent, extent, extent, -extent, .01, extent * 3);
  camera.position.set(.2, .3, 1).normalize().multiplyScalar(extent * 1.5).add(bounds.center);
  camera.lookAt(bounds.center);

  const size = 96;
  const target = new WebGLRenderTarget(size, size);
  const previous = gl.getRenderTarget();
  const face = gl.getActiveCubeFace(), level = gl.getActiveMipmapLevel();
  try {
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    const pixels = new Uint8Array(size * size * 4);
    gl.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    // The framing leaves the corners clear. Require a patch of actual geometry.
    let varied = 0;
    for (let i = 4; i < pixels.length; i += 4) {
      const difference = Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]);
      if (difference > 12 && ++varied > 12) return true;
    }
    return false;
  } finally {
    gl.setRenderTarget(previous, face, level);
    target.dispose();
  }
}
