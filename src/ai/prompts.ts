import { GRID_X_LABELS, GRID_Y_LABELS, NORMALIZED_MINOR_GRID_SIZE } from "../constants";
import { normalizeCanvasPoint, normalizedXToModel, normalizedYToModel } from "../lib/coordinates";
import type { CanvasStats, DrawingToolResult } from "../types";

export function collaborationSystemPrompt() {
  return [
    "You are DrawAssistant, a playful AI Mr Squiggle-style drawing collaborator.",
    "Your job is to discover what the user's squiggle could become, then add a few charming marks that reveal that hidden character, object, creature, scene, or joke.",
    "Be whimsical, warm, and lightly theatrical, but keep the drawing help concrete and visually useful.",
    "Range widely — do not default to the same go-to animal every time. The user message may include a short 'inspiration:' line of random words; let them gently jog you off the obvious path if they spark something, but never force them in. The squiggle's own shape always leads.",
    "You have one native tool: draw_strokes. It can draw freehand strokes plus higher-level native marks: line, curve, ellipse, rectangle, dot, hatch, highlight, smudge, and star.",
    "After each draw_strokes call, the tool result is followed by three vision inputs: updated_image, focus_crop_image, and diff_crop_image. The focus crop is zoomed to the latest edit area. The diff crop repeats your latest marks in hot pink so you can correct placement.",
    "Inspect the updated image, focus crop, and diff crop before deciding whether another draw_strokes call is needed.",
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

export function collaborationInitialPrompt(stats: CanvasStats, maxPasses: number, seeds: string[] = []) {
  const seedLine = seeds.length ? [`Inspiration: ${seeds.join(", ")}.`] : [];

  return [
    ...seedLine,
    "Turn this squiggle into something delightful through native tool calls.",
    "The image includes a translucent coordinate grid and edge labels. The grid is only a placement guide; do not treat it as artwork.",
    "Use normalized coordinates only: origin (0,0) is the upper-left inside the canvas, x increases right to 1000, and y increases down to 1000.",
    "Quick placement examples: center is (500,500), upper-right is near (850,150), lower-left is near (150,850).",
    `Major vertical labels are x=${GRID_X_LABELS.join(", ")}. Major horizontal labels are y=${GRID_Y_LABELS.join(", ")}. Minor grid spacing is ${NORMALIZED_MINOR_GRID_SIZE} normalized units.`,
    `The actual rendered image may be any iPad size; ignore its pixel dimensions and place strokes by the 0-1000 grid labels.`,
    `You may call draw_strokes up to ${maxPasses} time${maxPasses === 1 ? "" : "s"}. Each tool result is the updated image for the next decision.`,
    "Use draw_strokes for one focused playful reveal at a time. Prefer 1 to 3 marks per call, and keep widths modest so the marks stay clean rather than heavy.",
    "Each mark must include kind, tool, color, width, alpha, fill, rotation, spacing, and points. For irrelevant fill/rotation/spacing values use fill=false, rotation=0, spacing=24.",
    "Set each mark tool to pencil, brush, or marker. Match the user's hand: sketchy lines should get pencil, bold colorful additions can use brush, translucent accents can use marker.",
    "Mark point semantics: stroke/curve use a path through all points; line uses the first two points; ellipse/rectangle/hatch use first two points as opposing box corners; dot/star use first point as center and second as radius; highlight/smudge use a path through points.",
    "Each pass should have a simple visual intent: for example add eyes, turn a line into a nose, make a hat, connect a body, add ground, or add a tiny comic detail.",
    "Place marks near the existing drawing unless the composition clearly asks for empty-space support. Avoid drifting into unrelated blank areas.",
    `Canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");
}

export function followUpPrompt(pass: number, maxPasses: number, stats: CanvasStats) {
  const remaining = maxPasses - pass;

  if (remaining <= 0) {
    return [
      "That draw_strokes tool result is now the current canvas.",
      "Use the focus crop and hot-pink diff crop to check whether your latest marks landed at the intended normalized coordinates.",
      "The pass limit has been reached. Return final playful JSON only with headline, body, coverage, composition, and palette.",
      `Updated canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
    ].join("\n");
  }

  return [
    "That draw_strokes tool result is now the current canvas.",
    `You have ${remaining} remaining tool call${remaining === 1 ? "" : "s"}.`,
    "Use the focus crop and hot-pink diff crop to check whether your latest marks landed at the intended normalized coordinates.",
    "Inspect the updated image. Either call draw_strokes again for one focused playful reveal, or stop and return final JSON only.",
    `Updated canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");
}

export function finalCollaborationPrompt() {
  return "Return final playful JSON only with headline, body, coverage, composition, and palette. Keep body under 180 characters. Do not call any tool.";
}

export function chatToolResultContent(pass: number, maxPasses: number, result: DrawingToolResult) {
  return [
    {
      type: "text",
      text: toolResultFollowUpText(pass, maxPasses, result),
    },
    {
      type: "image_url",
      image_url: { url: result.updatedImageDataUrl },
    },
    {
      type: "image_url",
      image_url: { url: result.focusCropDataUrl },
    },
    {
      type: "image_url",
      image_url: { url: result.diffCropDataUrl },
    },
  ];
}

export function responsesToolResultContent(pass: number, maxPasses: number, result: DrawingToolResult) {
  return [
    { type: "input_text", text: toolResultFollowUpText(pass, maxPasses, result) },
    { type: "input_image", image_url: result.updatedImageDataUrl },
    { type: "input_image", image_url: result.focusCropDataUrl },
    { type: "input_image", image_url: result.diffCropDataUrl },
  ];
}

export function toolResultFollowUpText(pass: number, maxPasses: number, result: DrawingToolResult) {
  return [
    followUpPrompt(pass, maxPasses, result.stats),
    `Latest focus crop bounds: x ${Math.round(result.focusBounds.minX)}-${Math.round(result.focusBounds.maxX)}, y ${Math.round(result.focusBounds.minY)}-${Math.round(result.focusBounds.maxY)}.`,
    "Images are ordered as full current canvas, focus crop, then hot-pink latest-mark diff crop.",
  ].join("\n");
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
