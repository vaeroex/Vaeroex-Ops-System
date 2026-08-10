"use client";

import type { RootState } from "@react-three/fiber";

export type CanvasPixelProbeResult = "pending" | "nonblank" | "blank";

export function probeCanvasPixels(canvas: HTMLCanvasElement): Exclude<CanvasPixelProbeResult, "pending"> {
  const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!context) return "blank";

  const sampleSize = Math.min(64, context.drawingBufferWidth, context.drawingBufferHeight);
  const background = new Uint8Array(4);
  const pixels = new Uint8Array(sampleSize * sampleSize * 4);
  context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, background);

  let variedPixels = 0;
  for (const xRatio of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (const yRatio of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = Math.max(0, Math.floor((context.drawingBufferWidth - sampleSize) * xRatio));
      const y = Math.max(0, Math.floor((context.drawingBufferHeight - sampleSize) * yRatio));
      context.readPixels(x, y, sampleSize, sampleSize, context.RGBA, context.UNSIGNED_BYTE, pixels);
      for (let index = 0; index < pixels.length; index += 4) {
        const difference = Math.abs(pixels[index] - background[0])
          + Math.abs(pixels[index + 1] - background[1])
          + Math.abs(pixels[index + 2] - background[2]);
        if (difference > 12) variedPixels += 1;
      }
    }
  }

  return variedPixels > 12 ? "nonblank" : "blank";
}

export function probeRenderedCanvas(
  { camera, gl, scene }: RootState,
  onResult: (result: Exclude<CanvasPixelProbeResult, "pending">) => void
) {
  gl.domElement.dataset.canvasProbe = "created";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      gl.render(scene, camera);
      const result = probeCanvasPixels(gl.domElement);
      gl.domElement.dataset.canvasProbe = result;
      gl.domElement.closest("[data-spatial-webgl]")?.setAttribute("data-canvas-pixels", result);
      onResult(result);
    });
  });
}
