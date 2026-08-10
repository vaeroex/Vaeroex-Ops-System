"use client";

export class SpatialResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private readonly delegate: ResizeObserver | null;
  private readonly pendingFrames = new Map<Element, number>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    this.delegate = typeof window !== "undefined" && window.ResizeObserver
      ? new window.ResizeObserver(callback)
      : null;
  }

  observe(target: Element, options?: ResizeObserverOptions) {
    this.delegate?.observe(target, options);
    const previousFrame = this.pendingFrames.get(target);
    if (previousFrame) cancelAnimationFrame(previousFrame);
    const frame = requestAnimationFrame(() => {
      this.pendingFrames.delete(target);
      this.callback([], this);
    });
    this.pendingFrames.set(target, frame);
  }

  unobserve(target: Element) {
    this.delegate?.unobserve(target);
    const frame = this.pendingFrames.get(target);
    if (frame) cancelAnimationFrame(frame);
    this.pendingFrames.delete(target);
  }

  disconnect() {
    this.delegate?.disconnect();
    this.pendingFrames.forEach((frame) => cancelAnimationFrame(frame));
    this.pendingFrames.clear();
  }
}
