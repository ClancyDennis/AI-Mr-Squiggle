import type { ReasoningEffortSetting } from "./constants";

export type Tool = "pencil" | "brush" | "marker" | "eraser";
export type Point = {
  x: number;
  y: number;
};

export type CanvasSize = {
  width: number;
  height: number;
};

export type NormalizedBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type StrokePoint = Point & {
  pressure: number;
  tiltX: number;
  tiltY: number;
  pointerType: string;
  time: number;
};

export type CanvasStats = {
  coverage: number;
  centroid: Point;
  bounds: null | {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  dominant: string;
  energy: "quiet" | "balanced" | "maximal";
  lean: "left" | "right" | "centered";
  vertical: "high" | "low" | "centered";
};

export type Critique = {
  headline: string;
  body: string;
  coverage: string;
  composition: string;
  palette: string;
};

export type ResultNotice = {
  kind: "critique" | "reveal";
  label: string;
  headline: string;
  body: string;
};

export type ApiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  endpointPath: string;
  reasoningEffort: ReasoningEffortSetting;
  maxCompletionTokens: number;
  // When true, attach the canvas image alongside the SVG text (vision-capable models).
  // Turn off for text-only local models (e.g. Apple's on-device ~3B).
  useVision: boolean;
};

// A finished freehand stroke captured as vectors (normalized 0-1000 coords) so the
// canvas can be described to the model as text/SVG, not just a raster image.
export type CapturedStroke = {
  tool: DrawingTool;
  color: string;
  points: Point[];
};

export type CollaborationMarkKind =
  | "stroke"
  | "line"
  | "curve"
  | "ellipse"
  | "rectangle"
  | "dot"
  | "hatch"
  | "highlight"
  | "smudge"
  | "star";

export type DrawingTool = Exclude<Tool, "eraser">;

export type CollaborationMark = {
  kind: CollaborationMarkKind;
  tool: DrawingTool;
  color: string;
  width: number;
  alpha: number;
  fill: boolean;
  rotation: number;
  spacing: number;
  points: Point[];
};

export type DrawingToolCall = {
  id: string;
  name: "draw_strokes";
  arguments: DrawingToolArguments;
};

export type DrawingToolArguments = {
  note: string;
  intent: string;
  marks: CollaborationMark[];
};

export type DrawingToolResult = {
  pass: number;
  appliedMarkCount: number;
  // Textual (SVG) representation of the whole canvas after this pass — the primary
  // feedback channel. The image is optional and only present when vision is enabled.
  canvasText: string;
  updatedImageDataUrl?: string;
  recentBounds: NormalizedBounds | null;
  stats: CanvasStats;
};

export type NativeCollaborationResult = {
  appliedMarkCount: number;
  note: string;
  critique?: Partial<Critique>;
};

export type InstrumentSegmentOptions = {
  from: StrokePoint;
  to: StrokePoint;
  tool: Tool;
  color: string;
  size: number;
  pressureResponse: number;
  alphaScale?: number;
};

export type CollaborationMarkRenderOptions = {
  delayMs?: number;
  overrideColor?: string;
  alphaScale?: number;
  pressureResponse?: number;
};

export type CanvasFeedbackImages = {
  updatedImageDataUrl: string;
  recentBounds: NormalizedBounds | null;
};

export type RefinedSvg = {
  svg: string;
  title: string;
  summary: string;
};
