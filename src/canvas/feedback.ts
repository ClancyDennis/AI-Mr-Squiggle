import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../lib/canvas-size";
import { clamp } from "../lib/coordinates";
import { normalizedBoundsToCanvasRect } from "../lib/bounds";
import { drawCoordinateGrid } from "./grid";
import type { CanvasFeedbackImages, NormalizedBounds } from "../types";

// The model's feedback after each pass is just the full updated canvas (grid-stamped,
// with a box around the latest edit). We no longer send zoomed focus/diff crops.
export async function buildCanvasFeedbackImages(
  canvas: HTMLCanvasElement,
  backgroundColor: string,
  recentBounds: NormalizedBounds | null,
): Promise<CanvasFeedbackImages> {
  const updatedCanvas = createFeedbackCanvas(canvas, backgroundColor, recentBounds, "last tool area");

  return {
    updatedImageDataUrl: updatedCanvas.toDataURL("image/png"),
    recentBounds,
  };
}

export function createFeedbackCanvas(
  canvas: HTMLCanvasElement,
  backgroundColor: string,
  recentBounds: NormalizedBounds | null,
  boundsLabel: string,
) {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = CANVAS_WIDTH;
  exportCanvas.height = CANVAS_HEIGHT;
  const exportContext = exportCanvas.getContext("2d");

  if (!exportContext) return exportCanvas;

  exportContext.fillStyle = backgroundColor;
  exportContext.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  exportContext.drawImage(canvas, 0, 0);
  drawCoordinateGrid(exportContext, backgroundColor);

  if (recentBounds) {
    drawNormalizedBoundsOverlay(exportContext, recentBounds, boundsLabel);
  }

  return exportCanvas;
}

export function drawNormalizedBoundsOverlay(ctx: CanvasRenderingContext2D, bounds: NormalizedBounds, label: string) {
  const rect = normalizedBoundsToCanvasRect(bounds);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 79, 163, 0.86)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 16, centerY);
  ctx.lineTo(centerX + 16, centerY);
  ctx.moveTo(centerX, centerY - 16);
  ctx.lineTo(centerX, centerY + 16);
  ctx.stroke();
  drawFeedbackLabel(ctx, label, clamp(rect.x + 8, 8, CANVAS_WIDTH - 190), clamp(rect.y + 8, 8, CANVAS_HEIGHT - 34));
  ctx.restore();
}

export function drawFeedbackLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number) {
  ctx.save();
  ctx.font = "600 16px system-ui, -apple-system, ui-sans-serif, sans-serif";
  const width = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(22, 18, 20, 0.82)";
  ctx.beginPath();
  ctx.roundRect(x - 6, y - 5, width + 12, 27, 6);
  ctx.fill();
  ctx.fillStyle = "#fff8e8";
  ctx.fillText(label, x, y + 14);
  ctx.restore();
}
