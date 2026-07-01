import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../lib/canvas-size";
import { clamp, denormalizeModelPoint } from "../lib/coordinates";
import {
  degreesToRadians,
  fillPolygon,
  normalizedDistanceToCanvas,
  offsetPolyline,
  rectanglePoints,
  sampleEllipse,
  sampleSmoothPolyline,
  starPoints,
} from "../lib/geometry";
import { drawAccent, drawInstrumentSegment, strokePointFromPoint } from "./instruments";
import type {
  CanvasStats,
  CollaborationMark,
  CollaborationMarkRenderOptions,
  DrawingTool,
  Point,
} from "../types";

export async function drawLocalCollaboration(ctx: CanvasRenderingContext2D, stats: CanvasStats) {
  const bounds =
    stats.bounds ??
    ({
      minX: CANVAS_WIDTH * 0.34,
      maxX: CANVAS_WIDTH * 0.66,
      minY: CANVAS_HEIGHT * 0.32,
      maxY: CANVAS_HEIGHT * 0.68,
    } satisfies NonNullable<CanvasStats["bounds"]>);
  const center = stats.centroid;
  const spreadX = Math.max(160, bounds.maxX - bounds.minX + 80);
  const spreadY = Math.max(130, bounds.maxY - bounds.minY + 80);
  const seed = Date.now() % 1000;
  const collaboratorPalette = ["#64d8c8", "#9c89f6", "#f3aa3d", "#dc5796", "#ffffff"];

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  try {
    for (let index = 0; index < 7; index += 1) {
      const angle = (Math.PI * 2 * (index + 1)) / 7 + seed / 80;
      const radiusX = spreadX * (0.35 + index * 0.035);
      const radiusY = spreadY * (0.28 + index * 0.025);
      const start = {
        x: clamp(center.x + Math.cos(angle) * radiusX, 24, CANVAS_WIDTH - 24),
        y: clamp(center.y + Math.sin(angle) * radiusY, 24, CANVAS_HEIGHT - 24),
      };
      const end = {
        x: clamp(center.x + Math.cos(angle + 1.1) * radiusX, 24, CANVAS_WIDTH - 24),
        y: clamp(center.y + Math.sin(angle + 1.1) * radiusY, 24, CANVAS_HEIGHT - 24),
      };
      const control = {
        x: clamp(center.x + Math.cos(angle + 0.52) * spreadX * 0.58, 24, CANVAS_WIDTH - 24),
        y: clamp(center.y + Math.sin(angle + 0.52) * spreadY * 0.58, 24, CANVAS_HEIGHT - 24),
      };

      ctx.strokeStyle = collaboratorPalette[index % collaboratorPalette.length];
      ctx.globalAlpha = 0.74;
      ctx.lineWidth = 3 + (index % 3) * 2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      ctx.stroke();

      drawAccent(ctx, end.x, end.y, 7 + index, collaboratorPalette[(index + 2) % collaboratorPalette.length]);
      await new Promise((resolve) => window.setTimeout(resolve, 72));
    }
  } finally {
    ctx.restore();
  }
}

export async function drawCollaborationMarks(
  ctx: CanvasRenderingContext2D,
  marks: CollaborationMark[],
  options: CollaborationMarkRenderOptions = {},
) {
  for (const mark of marks.slice(0, 8)) {
    await drawCollaborationMark(ctx, mark, options);
  }
}

export async function drawCollaborationMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  switch (mark.kind) {
    case "ellipse":
      await drawEllipseMark(ctx, mark, options);
      return;
    case "rectangle":
      await drawRectangleMark(ctx, mark, options);
      return;
    case "dot":
      await drawDotMark(ctx, mark, options);
      return;
    case "hatch":
      drawHatchMark(ctx, mark, options);
      return;
    case "star":
      await drawStarMark(ctx, mark, options);
      return;
    case "stroke":
    case "line":
    case "curve":
    case "highlight":
    case "smudge":
      await drawPathMark(ctx, mark, options);
      return;
  }
}

export async function drawPathMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const canvasPoints = mark.points.map(denormalizeModelPoint);
  if (!canvasPoints.length) return;

  if (canvasPoints.length === 1) {
    await drawDotMark(ctx, { ...mark, kind: "dot" }, options);
    return;
  }

  const points =
    mark.kind === "line"
      ? canvasPoints.slice(0, 2)
      : mark.kind === "curve" || mark.kind === "smudge"
        ? sampleSmoothPolyline(canvasPoints, 10)
        : canvasPoints;
  const passes = mark.kind === "smudge" ? 3 : 1;

  for (let pass = 0; pass < passes; pass += 1) {
    const offset = mark.kind === "smudge" ? (pass - 1) * Math.max(2, mark.width * 0.36) : 0;
    const offsetPoints = offset ? offsetPolyline(points, offset) : points;
    await drawInstrumentPolyline(ctx, offsetPoints, mark, options, false, {
      alphaScale: mark.kind === "highlight" ? 0.62 : mark.kind === "smudge" ? 0.34 : 1,
      sizeScale: mark.kind === "highlight" ? 2.4 : mark.kind === "smudge" ? 2.15 : 1,
      tool: mark.kind === "highlight" ? "marker" : mark.tool,
    });
  }
}

export async function drawEllipseMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const box = canvasBoxFromMark(mark);
  if (!box) return;

  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const radiusX = Math.max(2, Math.abs(box.width) / 2);
  const radiusY = Math.max(2, Math.abs(box.height) / 2);
  const rotation = degreesToRadians(mark.rotation);
  const color = options.overrideColor ?? mark.color;

  if (mark.fill) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = markAlpha(mark, options, mark.tool === "marker" ? 0.34 : 0.42);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, radiusX, radiusY, rotation, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const outline = sampleEllipse(center, radiusX, radiusY, rotation, 54);
  await drawInstrumentPolyline(ctx, outline, mark, options, true);
}

export async function drawRectangleMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const box = canvasBoxFromMark(mark);
  if (!box) return;

  const points = rectanglePoints(box, degreesToRadians(mark.rotation));
  const color = options.overrideColor ?? mark.color;

  if (mark.fill) {
    fillPolygon(ctx, points, color, markAlpha(mark, options, mark.tool === "marker" ? 0.28 : 0.38));
  }

  await drawInstrumentPolyline(ctx, points, mark, options, true);
}

export async function drawDotMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const center = denormalizeModelPoint(mark.points[0]);
  const edge = mark.points[1] ? denormalizeModelPoint(mark.points[1]) : null;
  const radius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : mark.width * 2.6;
  const color = options.overrideColor ?? mark.color;

  if (mark.fill || mark.kind === "dot") {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = markAlpha(mark, options, mark.tool === "marker" ? 0.52 : 0.72);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(center.x, center.y, Math.max(1.5, radius), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!mark.fill) {
    const outline = sampleEllipse(center, Math.max(1.5, radius), Math.max(1.5, radius), 0, 34);
    await drawInstrumentPolyline(ctx, outline, mark, options, true);
  }
}

export function drawHatchMark(ctx: CanvasRenderingContext2D, mark: CollaborationMark, options: CollaborationMarkRenderOptions) {
  const box = canvasBoxFromMark(mark);
  if (!box) return;

  const color = options.overrideColor ?? mark.color;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const diagonal = Math.hypot(box.width, box.height) * 0.72;
  const spacing = Math.max(4, normalizedDistanceToCanvas(mark.spacing));

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.translate(center.x, center.y);
  ctx.rotate(degreesToRadians(mark.rotation));
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, mark.width);
  ctx.globalAlpha = markAlpha(mark, options, 0.78);

  for (let x = -diagonal; x <= diagonal; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, -diagonal);
    ctx.lineTo(x, diagonal);
    ctx.stroke();
  }

  ctx.restore();
}

export async function drawStarMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const center = denormalizeModelPoint(mark.points[0]);
  const edge = mark.points[1] ? denormalizeModelPoint(mark.points[1]) : null;
  const radius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : mark.width * 4;
  const points = starPoints(center, Math.max(5, radius), degreesToRadians(mark.rotation));
  const color = options.overrideColor ?? mark.color;

  if (mark.fill) {
    fillPolygon(ctx, points, color, markAlpha(mark, options, mark.tool === "marker" ? 0.3 : 0.46));
  }

  await drawInstrumentPolyline(ctx, points, mark, options, true);
}

export async function drawInstrumentPolyline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
  closePath: boolean,
  overrides: { alphaScale?: number; sizeScale?: number; tool?: DrawingTool } = {},
) {
  if (points.length < 2) return;

  const color = options.overrideColor ?? mark.color;
  const tool = overrides.tool ?? mark.tool;
  const path = closePath ? [...points, points[0]] : points;

  for (let index = 1; index < path.length; index += 1) {
    const from = strokePointFromPoint(
      path[index - 1],
      0.56 + (index % 3) * 0.08,
      tool === "pencil" ? 24 : 0,
      tool === "pencil" ? -12 : 0,
    );
    const to = strokePointFromPoint(
      path[index],
      0.62 + (index % 2) * 0.08,
      tool === "pencil" ? 24 : 0,
      tool === "pencil" ? -12 : 0,
    );

    drawInstrumentSegment(ctx, {
      from,
      to,
      tool,
      color,
      size: collaborationMarkSize(mark, tool) * (overrides.sizeScale ?? 1),
      pressureResponse: options.pressureResponse ?? 62,
      alphaScale: markAlpha(mark, options, overrides.alphaScale ?? 1),
    });

    if (options.delayMs) {
      await new Promise((resolve) => window.setTimeout(resolve, options.delayMs));
    }
  }
}

export function collaborationMarkSize(mark: CollaborationMark, tool: DrawingTool) {
  if (tool === "marker") return mark.width * 0.72;
  if (tool === "pencil") return mark.width * 1.18;
  return mark.width;
}

export function markAlpha(mark: CollaborationMark, options: CollaborationMarkRenderOptions, scale = 1) {
  return clamp(mark.alpha * (options.alphaScale ?? 1) * scale, 0.04, 1);
}

export function canvasBoxFromMark(mark: CollaborationMark) {
  if (!mark.points.length) return null;
  const first = denormalizeModelPoint(mark.points[0]);
  const second = mark.points[1] ? denormalizeModelPoint(mark.points[1]) : null;
  const halfSize = mark.width * 3;

  if (!second) {
    return {
      x: first.x - halfSize,
      y: first.y - halfSize,
      width: halfSize * 2,
      height: halfSize * 2,
    };
  }

  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const width = Math.max(2, Math.abs(second.x - first.x));
  const height = Math.max(2, Math.abs(second.y - first.y));
  return { x, y, width, height };
}
