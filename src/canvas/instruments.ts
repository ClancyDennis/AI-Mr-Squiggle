import { clamp } from "../lib/coordinates";
import type { InstrumentSegmentOptions, Point, StrokePoint, Tool } from "../types";

export function drawAccent(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.82;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

export function drawInstrumentSegment(ctx: CanvasRenderingContext2D, options: InstrumentSegmentOptions) {
  const { from, to, tool, color, size, pressureResponse, alphaScale = 1 } = options;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = clamp(Math.ceil(distance / 3.5), 1, 56);

  ctx.save();
  ctx.lineCap = tool === "marker" ? "square" : "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";

  if (distance < 0.5) {
    drawInstrumentDot(ctx, to, tool, size, pressureResponse, alphaScale);
    ctx.restore();
    return;
  }

  let previous = from;
  for (let index = 1; index <= steps; index += 1) {
    const amount = index / steps;
    const current = interpolateStrokePoint(from, to, amount);
    const pressure = (previous.pressure + current.pressure) / 2;
    const tilt = getTiltMagnitude(current);
    const width = getInstrumentWidth(tool, size, pressure, pressureResponse, tilt);
    const alpha = getInstrumentAlpha(tool, pressure, alphaScale);

    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();

    if (tool === "pencil" && tilt > 0.28) {
      drawPencilTiltShade(ctx, previous, current, width, alpha, tilt);
    }

    previous = current;
  }

  ctx.restore();
}

export function drawInstrumentDot(
  ctx: CanvasRenderingContext2D,
  point: StrokePoint,
  tool: Tool,
  size: number,
  pressureResponse: number,
  alphaScale: number,
) {
  const tilt = getTiltMagnitude(point);
  const radius = getInstrumentWidth(tool, size, point.pressure, pressureResponse, tilt) / 2;
  ctx.globalAlpha = getInstrumentAlpha(tool, point.pressure, alphaScale);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPencilTiltShade(
  ctx: CanvasRenderingContext2D,
  from: StrokePoint,
  to: StrokePoint,
  width: number,
  alpha: number,
  tilt: number,
) {
  const length = Math.hypot(to.tiltX, to.tiltY) || 1;
  const offsetX = (to.tiltX / length) * width * tilt * 0.72;
  const offsetY = (to.tiltY / length) * width * tilt * 0.72;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  ctx.lineWidth = width * (1.6 + tilt * 1.8);
  ctx.globalAlpha = alpha * (0.16 + tilt * 0.18);
  ctx.beginPath();
  ctx.moveTo(from.x + offsetX, from.y + offsetY);
  ctx.lineTo(to.x + offsetX, to.y + offsetY);
  ctx.stroke();
  ctx.restore();
}

export function interpolateStrokePoint(from: StrokePoint, to: StrokePoint, amount: number): StrokePoint {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    pressure: from.pressure + (to.pressure - from.pressure) * amount,
    tiltX: from.tiltX + (to.tiltX - from.tiltX) * amount,
    tiltY: from.tiltY + (to.tiltY - from.tiltY) * amount,
    pointerType: to.pointerType,
    time: from.time + (to.time - from.time) * amount,
  };
}

export function getInstrumentWidth(
  tool: Tool,
  size: number,
  pressure: number,
  pressureResponse: number,
  tilt: number,
) {
  const response = clamp(pressureResponse / 100, 0, 1);
  const pressureFactor = 0.42 + pressure * 1.18;
  const shapedPressure = 1 + (pressureFactor - 1) * response;
  const base = {
    pencil: size * 0.86,
    brush: size,
    marker: size * 1.56,
    eraser: size * 1.78,
  }[tool];
  const tiltBoost = tool === "pencil" ? 1 + tilt * 0.42 : 1;

  return clamp(base * shapedPressure * tiltBoost, 1.2, tool === "eraser" ? 90 : 68);
}

export function getInstrumentAlpha(tool: Tool, pressure: number, alphaScale: number) {
  const alpha = {
    pencil: 0.34 + pressure * 0.54,
    brush: 0.52 + pressure * 0.42,
    marker: 0.16 + pressure * 0.2,
    eraser: 1,
  }[tool];

  return clamp(alpha * alphaScale, 0.05, 1);
}

export function getTiltMagnitude(point: StrokePoint) {
  return clamp(Math.hypot(point.tiltX, point.tiltY) / 90, 0, 1);
}

export function strokePointFromPoint(point: Point, pressure = 0.72, tiltX = 0, tiltY = 0): StrokePoint {
  return {
    ...point,
    pressure,
    tiltX,
    tiltY,
    pointerType: "tool",
    time: 0,
  };
}
