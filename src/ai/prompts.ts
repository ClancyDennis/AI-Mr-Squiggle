import { GRID_X_LABELS, GRID_Y_LABELS, NORMALIZED_MINOR_GRID_SIZE } from "../constants";
import { normalizeCanvasPoint, normalizedXToModel, normalizedYToModel } from "../lib/coordinates";
import type { CanvasStats, DrawingToolResult, SquiggleCommitment } from "../types";

export function collaborationSystemPrompt(useVision: boolean, seeds: string[] = []) {
  // Spark words live here in the system prompt (background), not in the user message,
  // so they gently nudge variety without strongly steering the specific drawing.
  // Vision models only: small local models can't hold a seed loosely — they obsess
  // over the word and draw it regardless of the squiggle — so the compact path gets
  // its variety from the separate ideation step instead (see ai/ideation.ts).
  const seedLine =
    useVision && seeds.length
      ? `For a little variety, some random spark words: ${seeds.join(", ")}. Lean on one only if it genuinely fits the squiggle; otherwise ignore them. The squiggle's own shape always leads.`
      : "";

  if (!useVision) {
    // Compact prompt for tiny-context local models (e.g. Apple's on-device ~3B).
    return [
      "You are Mr Squiggle, a playful AI that finishes a person's squiggle into one small, recognizable drawing.",
      "You draw by calling draw_strokes with marks on a 0-1000 grid (x right, y down; center 500,500).",
      "The canvas is given to you as a text description plus SVG. After each draw_strokes call, the tool result is the updated canvas as SVG.",
      "Never draw a separate picture beside the squiggle: the person's line must become part of your drawing.",
      "Add only a few clean marks that build ONE clear subject, keep the person's strokes as the star, and stop early once it reads.",
      "When done, do NOT call a tool. Reply with JSON only: {headline, body, coverage, composition, palette}. The headline names what the squiggle became. Keep body under 120 characters.",
    ].join("\n");
  }

  return [
    "You are DrawAssistant, a playful AI Mr Squiggle-style drawing collaborator.",
    "Your job is to discover what the user's squiggle could become, then complete the drawing to reveal or improve the character, object, creature, scene, or joke.",
    "Be whimsical, warm, and lightly theatrical, but keep the drawing help concrete and visually useful.",
    ...(seedLine ? [seedLine] : []),
    "You have one native tool: draw_strokes. It can draw freehand strokes plus higher-level native marks: line, curve, ellipse, rectangle, dot, hatch, highlight, smudge, and star.",
    "After each draw_strokes call, the tool result is the updated canvas as SVG text, and the updated image is attached too.",
    "Inspect the updated image and SVG, and decide whether another draw_strokes call is needed.",
    "Before every tool call, form a simple reveal plan internally, then put the visual intent in the tool's intent field.",
    "Think in playful reveal steps: first find the thing hiding in the marks, then add one focused squiggle-improving detail at a time.",
    "Choose pencil, brush, or marker styles to suit the user's drawing texture. Pencil is best for sketchy Apple Pencil marks, marker for translucent emphasis, brush for confident colorful lines.",
    "Use the native mark kinds deliberately: dots for eyes, ellipses for wheels or cheeks, curves for contours, hatching for texture, highlights for glow, smudges for soft shadow, stars for sparkle.",
    "Favor expressive faces, limbs, props, scenery, motion lines, and little finishing details when they help the idea land.",
    "Do not erase or dominate the user's marks. Preserve the original squiggle as the star and build around it.",
    "Be restrained: add only a few clean, deliberate marks. Keep line widths modest (roughly 4 to 12) so additions read as crisp linework, never fat blobs. Do not scribble, do not stack many overlapping strokes, and do not densely hatch or smudge over the existing drawing into a tangle. A handful of well-placed marks reads far better than many.",
    "Every mark must serve the ONE subject you committed to. Skip decorative extras that don't help it read as that thing.",
    "Stop early. As soon as the drawing reads as a recognizable playful idea, finish — do not keep adding passes. Another stroke that would overwork or clutter it is worse than stopping.",
    "When finished, do not call a tool. Return JSON only with headline, body, coverage, composition, and palette. Keep body under 180 characters and make it playful.",
  ].join("\n");
}

export function collaborationInitialPrompt(
  stats: CanvasStats,
  maxPasses: number,
  useVision = true,
  gestalt = "",
  commitment: SquiggleCommitment | null = null,
) {
  if (!useVision) {
    // Compact variant for tiny-context local models. The canvas SVG is appended by the
    // loop, but a small model can't spatially parse SVG — the computed gestalt line is
    // its real view of the squiggle, and the committed subject is its one concrete job.
    return [
      ...(gestalt ? [gestalt] : []),
      commitment
        ? `Finish the squiggle as ${commitment.subject}. The person's line becomes its ${commitment.part}. Every mark you add must help it read as ${commitment.subject}.`
        : "Decide what the squiggle already looks like, then finish it as that ONE thing.",
      "Coordinates are 0-1000: x=0 left, x=1000 right, y=0 top, y=1000 bottom. Center is 500,500.",
      `Call draw_strokes up to ${maxPasses} time${maxPasses === 1 ? "" : "s"}, 1-3 small marks each, placed touching or right next to the existing strokes.`,
    ].join("\n");
  }

  return [
    "Turn this squiggle into something delightful through native tool calls.",
    ...(gestalt ? [`Stroke summary (computed from the person's actual strokes): ${gestalt}`] : []),
    "The image includes a translucent coordinate grid and edge labels. The grid is only a placement guide; do not treat it as artwork.",
    "Use normalized coordinates only: origin (0,0) is the upper-left inside the canvas, x increases right to 1000, and y increases down to 1000.",
    "Quick placement examples: center is (500,500), upper-right is near (850,150), lower-left is near (150,850).",
    `Major vertical labels are x=${GRID_X_LABELS.join(", ")}. Major horizontal labels are y=${GRID_Y_LABELS.join(", ")}. Minor grid spacing is ${NORMALIZED_MINOR_GRID_SIZE} normalized units.`,
    `The actual rendered image may be any iPad size; ignore its pixel dimensions and place strokes by the 0-1000 grid labels corresponsing to the fractional length of the image.`,
    `You may call draw_strokes up to ${maxPasses} time${maxPasses === 1 ? "" : "s"}. Each tool result is the updated image for the next decision.`,
    "Use draw_strokes for one focused playful reveal at a time. Prefer 1 to 3 marks per call, and keep widths modest so the marks stay clean rather than heavy.",
    "Each mark must include kind, tool, color, width, alpha, fill, rotation, spacing, and points. For irrelevant fill/rotation/spacing values use fill=false, rotation=0, spacing=24.",
    "Set each mark tool to pencil, brush, or marker. Match the user's hand: sketchy lines should get pencil, bold colorful additions can use brush, translucent accents can use marker.",
    "Mark point semantics: stroke/curve use a path through all points; line uses the first two points; ellipse/rectangle/hatch use first two points as opposing box corners; dot/star use first point as center and second as radius; highlight/smudge use a path through points.",
    "Each pass should contirbute to your final picture.",
    "Be creative and create a fun frendly sketch to animate at the end.",
    `Canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");
}

export function followUpPrompt(pass: number, maxPasses: number, stats: CanvasStats) {
  const remaining = maxPasses - pass;

  if (remaining <= 0) {
    return [
      "The attached updated_image is now the current canvas.",
      "Check whether your latest marks landed at the intended normalized coordinates.",
      "The pass limit has been reached. Return final playful JSON only with headline, body, coverage, composition, and palette.",
      `Updated canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
    ].join("\n");
  }

  return [
    "The attached updated_image is now the current canvas.",
    `You have ${remaining} remaining tool call${remaining === 1 ? "" : "s"}.`,
    "Inspect the updated image and check whether your latest marks landed at the intended normalized coordinates. Either call draw_strokes again for one focused playful reveal, or stop and return final JSON only.",
    `Updated canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");
}

export function finalCollaborationPrompt() {
  return "Return final playful JSON only with headline, body, coverage, composition, and palette. Keep body under 180 characters. Do not call any tool.";
}

export function chatToolResultContent(
  pass: number,
  maxPasses: number,
  result: DrawingToolResult,
  useVision: boolean,
) {
  const text = [
    toolResultFollowUpText(pass, maxPasses, result),
    "Current canvas (SVG, 0-1000):",
    result.canvasText,
  ].join("\n");

  const content: Array<Record<string, unknown>> = [{ type: "text", text }];

  if (useVision && result.updatedImageDataUrl) {
    content.push({ type: "image_url", image_url: { url: result.updatedImageDataUrl } });
  }

  return content;
}

export function toolResultFollowUpText(pass: number, maxPasses: number, result: DrawingToolResult) {
  const boundsLine = result.recentBounds
    ? [
        `Your latest marks are around x ${Math.round(result.recentBounds.minX)}-${Math.round(result.recentBounds.maxX)}, y ${Math.round(result.recentBounds.minY)}-${Math.round(result.recentBounds.maxY)} (dashed box in the image).`,
      ]
    : [];

  return [followUpPrompt(pass, maxPasses, result.stats), ...boundsLine].join("\n");
}

export function summarizeStats(stats: CanvasStats) {
  const centroid = normalizeCanvasPoint(stats.centroid);
  const bounds = stats.bounds
    ? {
        minX: Math.round(normalizedXToModel(stats.bounds.minX)),
        minY: Math.round(normalizedYToModel(stats.bounds.minY)),
        maxX: Math.round(normalizedXToModel(stats.bounds.maxX)),
        maxY: Math.round(normalizedYToModel(stats.bounds.maxY)),
      }
    : null;

  return {
    coverage: stats.coverage,
    composition: stats.lean,
    vertical: stats.vertical,
    dominantColor: stats.dominant,
    bounds,
    centroid: {
      x: Math.round(centroid.x),
      y: Math.round(centroid.y),
    },
  };
}
