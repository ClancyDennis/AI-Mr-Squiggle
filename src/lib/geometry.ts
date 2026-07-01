import { MODEL_COORDINATE_MAX } from "../constants";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./canvas-size";
import type { Point } from "../types";

export function rectanglePoints(
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
): Point[] {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const points = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];

  return rotation ? points.map((point) => rotatePoint(point, center, rotation)) : points;
}

export function sampleEllipse(center: Point, radiusX: number, radiusY: number, rotation: number, steps: number): Point[] {
  const points: Point[] = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps;
    const x = Math.cos(angle) * radiusX;
    const y = Math.sin(angle) * radiusY;
    points.push({
      x: center.x + x * cos - y * sin,
      y: center.y + x * sin + y * cos,
    });
  }

  return points;
}

export function starPoints(center: Point, radius: number, rotation: number): Point[] {
  const points: Point[] = [];
  const inner = radius * 0.44;

  for (let index = 0; index < 10; index += 1) {
    const angle = rotation - Math.PI / 2 + (Math.PI * index) / 5;
    const currentRadius = index % 2 === 0 ? radius : inner;
    points.push({
      x: center.x + Math.cos(angle) * currentRadius,
      y: center.y + Math.sin(angle) * currentRadius,
    });
  }

  return points;
}

export function fillPolygon(ctx: CanvasRenderingContext2D, points: Point[], color: string, alpha: number) {
  if (!points.length) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function rotatePoint(point: Point, center: Point, rotation: number): Point {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const x = point.x - center.x;
  const y = point.y - center.y;

  return {
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  };
}

export function sampleSmoothPolyline(points: Point[], stepsPerSegment: number) {
  if (points.length < 3) return points;

  const sampled: Point[] = [points[0]];

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];

    for (let step = 1; step <= stepsPerSegment; step += 1) {
      const t = step / stepsPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      sampled.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }

  return sampled;
}

export function offsetPolyline(points: Point[], amount: number) {
  if (points.length < 2) return points;

  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;

    return {
      x: point.x + (-dy / length) * amount,
      y: point.y + (dx / length) * amount,
    };
  });
}

export function normalizedDistanceToCanvas(value: number) {
  return (value / MODEL_COORDINATE_MAX) * ((CANVAS_WIDTH + CANVAS_HEIGHT) / 2);
}

export function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
