import { MODEL_COORDINATE_MAX } from "../constants";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../lib/canvas-size";
import { summarizeStats } from "./prompts";
import type { DrawingToolResult } from "../types";

export function chatDrawStrokesTool() {
  return {
    type: "function",
    function: {
      name: "draw_strokes",
      description:
        "Draw native vector marks using normalized 0-1000 canvas coordinates. Supports strokes, lines, curves, ellipses, rectangles, dots, hatching, highlights, smudges, and stars. The app applies the marks and returns updated full/crop/diff images as the tool result.",
      parameters: drawStrokesParameters(),
    },
  };
}

export function responsesDrawStrokesTool() {
  return {
    type: "function",
    name: "draw_strokes",
    description:
      "Draw native vector marks using normalized 0-1000 canvas coordinates. Supports strokes, lines, curves, ellipses, rectangles, dots, hatching, highlights, smudges, and stars. The app applies the marks and returns updated full/crop/diff images as the tool result.",
    parameters: drawStrokesParameters(),
    strict: true,
  };
}

export function drawStrokesParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      note: {
        type: "string",
        description: "Short reason for this focused drawing pass.",
      },
      intent: {
        type: "string",
        description: "The concrete visual intention for this pass, such as 'add two eyes and a rocket fin'.",
      },
      marks: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        description: "Native drawing marks for one focused pass.",
        items: markSchema(),
      },
    },
    required: ["note", "intent", "marks"],
  };
}

export function markSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: {
        type: "string",
        enum: ["stroke", "line", "curve", "ellipse", "rectangle", "dot", "hatch", "highlight", "smudge", "star"],
        description:
          "Native mark kind. stroke/curve follow all points; line uses first two; ellipse/rectangle/hatch use first two as opposing box corners; dot/star use first point as center and second as radius; highlight/smudge follow points.",
      },
      tool: {
        type: "string",
        enum: ["pencil", "brush", "marker"],
        description: "Drawing style for this mark. Use pencil for sketch texture, brush for clean color, marker for translucent broad accents.",
      },
      color: {
        type: "string",
        description: "Six-digit hex color, for example #64d8c8.",
      },
      width: {
        type: "number",
        minimum: 2,
        maximum: 36,
      },
      alpha: {
        type: "number",
        minimum: 0.08,
        maximum: 0.98,
      },
      fill: {
        type: "boolean",
        description: "Whether to fill closed marks such as ellipse, rectangle, dot, or star. Use false for open marks.",
      },
      rotation: {
        type: "number",
        minimum: -180,
        maximum: 180,
        description: "Rotation in degrees for ellipse, rectangle, hatch, and star. Use 0 when irrelevant.",
      },
      spacing: {
        type: "number",
        minimum: 8,
        maximum: 160,
        description: "Normalized spacing for hatch marks. Use 24 when irrelevant.",
      },
      points: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        description: "Normalized points. x=0 is left, x=1000 is right, y=0 is top, y=1000 is bottom.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            x: { type: "number", minimum: 0, maximum: MODEL_COORDINATE_MAX },
            y: { type: "number", minimum: 0, maximum: MODEL_COORDINATE_MAX },
          },
          required: ["x", "y"],
        },
      },
    },
    required: ["kind", "tool", "color", "width", "alpha", "fill", "rotation", "spacing", "points"],
  };
}

export function buildDrawingToolOutput(result: DrawingToolResult) {
  return {
    type: "updated_image",
    updated_image: "attached as the next full current canvas image",
    focus_crop_image: "attached as the next zoomed focus crop image",
    diff_crop_image: "attached as the next hot-pink latest-mark diff crop image",
    pass: result.pass,
    applied_mark_count: result.appliedMarkCount,
    canvas: {
      width: MODEL_COORDINATE_MAX,
      height: MODEL_COORDINATE_MAX,
      coordinate_system: "normalized 0-1000, origin top-left, x right, y down",
      rendered_pixel_size: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
      },
    },
    focus_crop: result.focusBounds,
    recent_change_bounds: result.recentBounds,
    feedback_notes: [
      "updated_image is the full grid-stamped current canvas",
      "focus_crop_image zooms into the latest edit area with normalized bounds in its label",
      "diff_crop_image repeats the latest tool marks in hot pink so placement can be checked",
    ],
    stats: summarizeStats(result.stats),
  };
}
