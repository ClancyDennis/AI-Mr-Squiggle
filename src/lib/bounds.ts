import { MODEL_COORDINATE_MAX } from "../constants";
import { clamp, normalizedXToCanvas, normalizedYToCanvas } from "./coordinates";
import type { CollaborationMark, NormalizedBounds } from "../types";

export function getCollaborationMarksBounds(marks: CollaborationMark[]): NormalizedBounds | null {
  return marks.reduce<NormalizedBounds | null>((bounds, mark) => {
    const markBounds = getCollaborationMarkBounds(mark);
    return markBounds ? mergeNormalizedBounds(bounds, markBounds) : bounds;
  }, null);
}

export function getCollaborationMarkBounds(mark: CollaborationMark): NormalizedBounds | null {
  if (!mark.points.length) return null;

  if (mark.kind === "dot" || mark.kind === "star") {
    const center = mark.points[0];
    const edge = mark.points[1];
    const radius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : Math.max(36, mark.width * 5);
    return expandNormalizedBounds(
      {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      },
      Math.max(24, mark.width * 2),
      110,
    );
  }

  let minX = MODEL_COORDINATE_MAX;
  let minY = MODEL_COORDINATE_MAX;
  let maxX = 0;
  let maxY = 0;

  mark.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return expandNormalizedBounds({ minX, minY, maxX, maxY }, Math.max(28, mark.width * 4), 24);
}

export function mergeNormalizedBounds(
  first: NormalizedBounds | null,
  second: NormalizedBounds,
): NormalizedBounds {
  if (!first) return second;

  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
  };
}

export function expandNormalizedBounds(bounds: NormalizedBounds, padding: number, minSpan: number): NormalizedBounds {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const halfWidth = Math.max((bounds.maxX - bounds.minX) / 2 + padding, minSpan / 2);
  const halfHeight = Math.max((bounds.maxY - bounds.minY) / 2 + padding, minSpan / 2);

  return {
    minX: clamp(centerX - halfWidth, 0, MODEL_COORDINATE_MAX),
    minY: clamp(centerY - halfHeight, 0, MODEL_COORDINATE_MAX),
    maxX: clamp(centerX + halfWidth, 0, MODEL_COORDINATE_MAX),
    maxY: clamp(centerY + halfHeight, 0, MODEL_COORDINATE_MAX),
  };
}

export function normalizedBoundsToCanvasRect(bounds: NormalizedBounds) {
  const x = normalizedXToCanvas(bounds.minX);
  const y = normalizedYToCanvas(bounds.minY);
  const maxX = normalizedXToCanvas(bounds.maxX);
  const maxY = normalizedYToCanvas(bounds.maxY);

  return {
    x,
    y,
    width: Math.max(1, maxX - x),
    height: Math.max(1, maxY - y),
  };
}

export function fullNormalizedBounds(): NormalizedBounds {
  return {
    minX: 0,
    minY: 0,
    maxX: MODEL_COORDINATE_MAX,
    maxY: MODEL_COORDINATE_MAX,
  };
}
