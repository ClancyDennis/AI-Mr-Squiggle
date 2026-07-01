import { MODEL_COORDINATE_MAX } from "../constants";
import { clamp } from "../lib/coordinates";
import { buildCritique } from "./critique";
import type {
  CanvasStats,
  CollaborationMark,
  CollaborationMarkKind,
  Critique,
  DrawingTool,
  DrawingToolArguments,
  DrawingToolCall,
  Point,
} from "../types";

export function extractChatMessage(response: unknown): Record<string, unknown> {
  const record = asRecord(response);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);

  if (!message) {
    throw new Error("Chat response did not include a message");
  }

  return message;
}

export function extractChatToolCalls(message: Record<string, unknown>): DrawingToolCall[] {
  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  return rawToolCalls
    .map((rawToolCall, index) => {
      const toolCall = asRecord(rawToolCall);
      const fn = asRecord(toolCall?.function);
      if (!toolCall || fn?.name !== "draw_strokes") return null;

      return {
        id: safeString(toolCall.id, `draw_strokes_${index}`, 80),
        name: "draw_strokes" as const,
        arguments: sanitizeDrawingToolArguments(parseToolArguments(fn.arguments)),
      };
    })
    .filter((toolCall): toolCall is DrawingToolCall => Boolean(toolCall));
}

export function parseToolArguments(value: unknown): unknown {
  if (typeof value === "string") {
    return parseJsonFromText(value);
  }

  return value;
}

export function sanitizeDrawingToolArguments(value: unknown): DrawingToolArguments {
  const record = asRecord(value);
  const rawMarks = Array.isArray(record?.marks) ? record.marks : Array.isArray(record?.strokes) ? record.strokes : [];
  const marks = rawMarks
    .map((mark) => sanitizeMark(mark))
    .filter((mark): mark is CollaborationMark => Boolean(mark))
    .slice(0, 5);
  const note = safeString(record?.note, "Applied a focused drawing tool pass.", 180);

  return {
    note,
    intent: safeString(record?.intent, note, 180),
    marks,
  };
}

export function getMessageText(message: Record<string, unknown>): string {
  const content = message.content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const partRecord = asRecord(part);
        return typeof partRecord?.text === "string" ? partRecord.text : "";
      })
      .join("");
  }

  return "";
}

export function parseFinalCollaborationCritique(text: string): Partial<Critique> | undefined {
  if (!text.trim()) return undefined;

  try {
    const parsed = parseJsonFromText(text);
    const record = asRecord(parsed);
    const critique = asRecord(record?.critique) ?? record;
    return critique ? sanitizePartialCritique(critique) : undefined;
  } catch {
    return {
      headline: "Collaboration complete",
      body: text.slice(0, 300),
    };
  }
}

export function sanitizePartialCritique(record: Record<string, unknown>): Partial<Critique> {
  return {
    headline: safeOptionalString(record.headline, 58),
    body: safeOptionalString(record.body, 300),
    coverage: safeOptionalString(record.coverage, 14),
    composition: safeOptionalString(record.composition, 18),
    palette: safeOptionalString(record.palette, 18),
  };
}

export function extractModelText(value: unknown): string {
  const record = asRecord(value);
  if (!record) throw new Error("OpenAI response was not an object");

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        const partRecord = asRecord(part);
        return typeof partRecord?.text === "string" ? partRecord.text : "";
      })
      .join("");
    if (text) return text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const itemContent = Array.isArray(itemRecord?.content) ? itemRecord.content : [];

    for (const part of itemContent) {
      const partRecord = asRecord(part);
      if (typeof partRecord?.text === "string") return partRecord.text;
    }
  }

  throw new Error("OpenAI response did not include text");
}

export function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1]);

    const object = trimmed.match(/\{[\s\S]*\}/);
    if (object?.[0]) return JSON.parse(object[0]);

    throw new Error("Model response was not JSON");
  }
}

export function sanitizeCritique(value: unknown, stats: CanvasStats): Critique {
  const fallback = buildCritique(stats);
  const record = asRecord(value);

  if (!record) return fallback;

  return {
    headline: safeString(record.headline, fallback.headline, 58),
    body: safeString(record.body, fallback.body, 300),
    coverage: safeString(record.coverage, fallback.coverage, 14),
    composition: safeString(record.composition, fallback.composition, 18),
    palette: safeString(record.palette, fallback.palette, 18),
  };
}

export function sanitizeMark(value: unknown): CollaborationMark | null {
  const record = asRecord(value);
  if (!record) return null;

  const rawPoints = Array.isArray(record.points) ? record.points : [];
  const points = rawPoints
    .map((point) => {
      const pointRecord = asRecord(point);
      if (!pointRecord) return null;

      const x = readNumber(pointRecord.x);
      const y = readNumber(pointRecord.y);
      if (x === null || y === null) return null;

      return {
        x: clamp(x, 0, MODEL_COORDINATE_MAX),
        y: clamp(y, 0, MODEL_COORDINATE_MAX),
      };
    })
    .filter((point): point is Point => Boolean(point))
    .slice(0, 10);

  const kind = sanitizeMarkKind(record.kind, points.length > 2 ? "stroke" : "line");
  const minimumPoints = kind === "dot" || kind === "star" ? 1 : 2;
  if (points.length < minimumPoints) return null;

  const color = typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color) ? record.color : "#64d8c8";
  const width = clamp(readNumber(record.width) ?? 6, 2, 36);
  const alpha = clamp(readNumber(record.alpha) ?? 0.78, 0.08, 0.98);
  const tool = sanitizeDrawingTool(record.tool);
  const fill = typeof record.fill === "boolean" ? record.fill : kind === "dot";
  const rotation = clamp(readNumber(record.rotation) ?? 0, -180, 180);
  const spacing = clamp(readNumber(record.spacing) ?? 24, 8, 160);

  return { kind, tool, color, width, alpha, fill, rotation, spacing, points };
}

export function sanitizeMarkKind(value: unknown, fallback: CollaborationMarkKind): CollaborationMarkKind {
  const allowed: CollaborationMarkKind[] = [
    "stroke",
    "line",
    "curve",
    "ellipse",
    "rectangle",
    "dot",
    "hatch",
    "highlight",
    "smudge",
    "star",
  ];

  return allowed.includes(value as CollaborationMarkKind) ? (value as CollaborationMarkKind) : fallback;
}

export function sanitizeDrawingTool(value: unknown): DrawingTool {
  return value === "pencil" || value === "brush" || value === "marker" ? value : "pencil";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function safeString(value: unknown, fallback: string, maxLength: number) {
  return typeof value === "string" && value.trim() ? truncateText(value.trim(), maxLength) : fallback;
}

export function safeOptionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? truncateText(value.trim(), maxLength) : undefined;
}

export function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;

  const clipped = value.slice(0, maxLength);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (sentenceEnd > maxLength * 0.55) return clipped.slice(0, sentenceEnd + 1);

  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.55 ? lastSpace : maxLength).trim()}...`;
}
