import { GRID_X_LABELS, GRID_Y_LABELS, MODEL_COORDINATE_MAX, NORMALIZED_MINOR_GRID_SIZE } from "../constants";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../lib/canvas-size";
import { clamp, normalizedXToCanvas, normalizedYToCanvas } from "../lib/coordinates";
import { getGridColors } from "../lib/color";

export function drawCoordinateGrid(ctx: CanvasRenderingContext2D, backgroundColor: string) {
  const colors = getGridColors(backgroundColor);

  ctx.save();
  ctx.lineWidth = 1;

  ctx.strokeStyle = colors.minor;
  for (let x = NORMALIZED_MINOR_GRID_SIZE; x < MODEL_COORDINATE_MAX; x += NORMALIZED_MINOR_GRID_SIZE) {
    const canvasX = normalizedXToCanvas(x);
    ctx.beginPath();
    ctx.moveTo(canvasX, 0);
    ctx.lineTo(canvasX, CANVAS_HEIGHT);
    ctx.stroke();
  }

  for (let y = NORMALIZED_MINOR_GRID_SIZE; y < MODEL_COORDINATE_MAX; y += NORMALIZED_MINOR_GRID_SIZE) {
    const canvasY = normalizedYToCanvas(y);
    ctx.beginPath();
    ctx.moveTo(0, canvasY);
    ctx.lineTo(CANVAS_WIDTH, canvasY);
    ctx.stroke();
  }

  ctx.strokeStyle = colors.major;
  GRID_X_LABELS.forEach((x) => {
    const canvasX = normalizedXToCanvas(x);
    ctx.beginPath();
    ctx.moveTo(canvasX, 0);
    ctx.lineTo(canvasX, CANVAS_HEIGHT);
    ctx.stroke();
  });

  GRID_Y_LABELS.forEach((y) => {
    const canvasY = normalizedYToCanvas(y);
    ctx.beginPath();
    ctx.moveTo(0, canvasY);
    ctx.lineTo(CANVAS_WIDTH, canvasY);
    ctx.stroke();
  });

  ctx.font = "600 18px system-ui, -apple-system, ui-sans-serif, sans-serif";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";

  GRID_X_LABELS.forEach((x) => {
    const label = `x ${x}`;
    const metrics = ctx.measureText(label);
    const labelX = clamp(normalizedXToCanvas(x), 8 + metrics.width / 2, CANVAS_WIDTH - 8 - metrics.width / 2);
    drawGridLabel(ctx, label, labelX - metrics.width / 2, 8, metrics.width, colors);
  });

  ctx.textBaseline = "middle";
  GRID_Y_LABELS.forEach((y) => {
    const label = `y ${y}`;
    const metrics = ctx.measureText(label);
    const labelY = clamp(normalizedYToCanvas(y), 18, CANVAS_HEIGHT - 18);
    drawGridLabel(ctx, label, 8, labelY - 10, metrics.width, colors);
  });

  ctx.restore();
}

export function drawGridLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  width: number,
  colors: ReturnType<typeof getGridColors>,
) {
  ctx.fillStyle = colors.labelBackground;
  ctx.beginPath();
  ctx.roundRect(x - 5, y - 3, width + 10, 24, 5);
  ctx.fill();
  ctx.fillStyle = colors.label;
  ctx.fillText(label, x, y);
}
