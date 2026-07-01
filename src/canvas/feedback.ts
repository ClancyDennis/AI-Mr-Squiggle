import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../lib/canvas-size";
import { clamp } from "../lib/coordinates";
import { expandNormalizedBounds, fullNormalizedBounds, normalizedBoundsToCanvasRect } from "../lib/bounds";
import { drawCoordinateGrid } from "./grid";
import { drawCollaborationMarks } from "./marks";
import type { CanvasFeedbackImages, CollaborationMark, NormalizedBounds } from "../types";

export async function buildCanvasFeedbackImages(
  canvas: HTMLCanvasElement,
  backgroundColor: string,
  marks: CollaborationMark[],
  recentBounds: NormalizedBounds | null,
): Promise<CanvasFeedbackImages> {
  const focusBounds = expandNormalizedBounds(recentBounds ?? fullNormalizedBounds(), 90, 240);
  const updatedCanvas = createFeedbackCanvas(canvas, backgroundColor, recentBounds, "last tool area");
  const diffCanvas = createFeedbackCanvas(canvas, backgroundColor, recentBounds, "last tool area");
  const diffContext = diffCanvas.getContext("2d");

  if (diffContext) {
    await drawCollaborationMarks(diffContext, marks, {
      overrideColor: "#ff4fa3",
      alphaScale: 1.15,
      pressureResponse: 70,
    });
    drawFeedbackLabel(diffContext, "hot pink ghost = latest AI marks", 12, CANVAS_HEIGHT - 38);
  }

  return {
    updatedImageDataUrl: updatedCanvas.toDataURL("image/png"),
    focusCropDataUrl: createCropDataUrl(updatedCanvas, focusBounds, "focus crop"),
    diffCropDataUrl: createCropDataUrl(diffCanvas, focusBounds, "latest marks"),
    focusBounds,
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

export function createCropDataUrl(sourceCanvas: HTMLCanvasElement, bounds: NormalizedBounds, label: string) {
  const rect = normalizedBoundsToCanvasRect(bounds);
  const maxOutputSize = 720;
  const minOutputSize = 360;
  const largestSide = Math.max(rect.width, rect.height);
  const smallestSide = Math.min(rect.width, rect.height);
  const scale = Math.min(2, maxOutputSize / largestSide);
  const minScale = smallestSide > 0 ? Math.min(2, minOutputSize / smallestSide) : scale;
  const outputScale = Math.max(scale, minScale);
  const outputWidth = Math.round(clamp(rect.width * outputScale, 1, maxOutputSize));
  const outputHeight = Math.round(clamp(rect.height * outputScale, 1, maxOutputSize));
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = outputWidth;
  cropCanvas.height = outputHeight;
  const cropContext = cropCanvas.getContext("2d");

  if (!cropContext) return sourceCanvas.toDataURL("image/png");

  cropContext.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, outputWidth, outputHeight);
  cropContext.strokeStyle = "rgba(255, 79, 163, 0.92)";
  cropContext.lineWidth = 4;
  cropContext.strokeRect(2, 2, outputWidth - 4, outputHeight - 4);
  drawFeedbackLabel(
    cropContext,
    `${label}: x ${Math.round(bounds.minX)}-${Math.round(bounds.maxX)} / y ${Math.round(bounds.minY)}-${Math.round(bounds.maxY)}`,
    12,
    12,
  );

  return cropCanvas.toDataURL("image/png");
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
