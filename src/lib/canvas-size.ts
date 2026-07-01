import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from "../constants";
import type { CanvasSize } from "../types";

export let CANVAS_WIDTH = DEFAULT_CANVAS_WIDTH;
export let CANVAS_HEIGHT = DEFAULT_CANVAS_HEIGHT;

export function getViewportCanvasSize(): CanvasSize {
  if (typeof window === "undefined") {
    return { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT };
  }

  return {
    width: Math.max(320, Math.round(window.innerWidth)),
    height: Math.max(320, Math.round(window.innerHeight)),
  };
}

export function syncCanvasGeometry(size: CanvasSize) {
  CANVAS_WIDTH = size.width;
  CANVAS_HEIGHT = size.height;
}

export function currentCanvasSize(): CanvasSize {
  return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}

syncCanvasGeometry(getViewportCanvasSize());
