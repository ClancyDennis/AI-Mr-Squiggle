import { MODEL_COORDINATE_MAX } from "../constants";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./canvas-size";
import type { Point, StrokePoint } from "../types";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeCanvasPoint(point: Point): Point {
  return {
    x: clamp((point.x / CANVAS_WIDTH) * MODEL_COORDINATE_MAX, 0, MODEL_COORDINATE_MAX),
    y: clamp((point.y / CANVAS_HEIGHT) * MODEL_COORDINATE_MAX, 0, MODEL_COORDINATE_MAX),
  };
}

export function denormalizeModelPoint(point: Point): Point {
  return {
    x: clamp((point.x / MODEL_COORDINATE_MAX) * CANVAS_WIDTH, 0, CANVAS_WIDTH),
    y: clamp((point.y / MODEL_COORDINATE_MAX) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT),
  };
}

export function normalizedXToCanvas(x: number) {
  return (x / MODEL_COORDINATE_MAX) * CANVAS_WIDTH;
}

export function normalizedYToCanvas(y: number) {
  return (y / MODEL_COORDINATE_MAX) * CANVAS_HEIGHT;
}

export function normalizedXToModel(x: number) {
  return clamp((x / CANVAS_WIDTH) * MODEL_COORDINATE_MAX, 0, MODEL_COORDINATE_MAX);
}

export function normalizedYToModel(y: number) {
  return clamp((y / CANVAS_HEIGHT) * MODEL_COORDINATE_MAX, 0, MODEL_COORDINATE_MAX);
}

export function formatNormalizedPoint(point: Point) {
  const normalized = normalizeCanvasPoint(point);
  return `${Math.round(normalized.x)}, ${Math.round(normalized.y)}`;
}

export function pick<T>(items: T[], seed: number) {
  return items[Math.abs(Math.floor(seed)) % items.length];
}

export function sampleFromPointerEvent(event: globalThis.PointerEvent, canvas: HTMLCanvasElement): StrokePoint {
  const rect = canvas.getBoundingClientRect();
  const pointerType = event.pointerType || "mouse";
  const defaultPressure = pointerType === "pen" ? 0.42 : 0.68;

  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH, 0, CANVAS_WIDTH),
    y: clamp(((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT),
    pressure: clamp(event.pressure || defaultPressure, 0.04, 1),
    tiltX: clamp(event.tiltX || 0, -90, 90),
    tiltY: clamp(event.tiltY || 0, -90, 90),
    pointerType,
    time: event.timeStamp,
  };
}

export function smoothStrokePoint(previous: StrokePoint, current: StrokePoint, smoothing: number): StrokePoint {
  const factor = clamp(smoothing / 100, 0, 0.82);
  if (factor <= 0.01) return current;

  return {
    x: previous.x * factor + current.x * (1 - factor),
    y: previous.y * factor + current.y * (1 - factor),
    pressure: previous.pressure * factor + current.pressure * (1 - factor),
    tiltX: previous.tiltX * factor + current.tiltX * (1 - factor),
    tiltY: previous.tiltY * factor + current.tiltY * (1 - factor),
    pointerType: current.pointerType,
    time: current.time,
  };
}
