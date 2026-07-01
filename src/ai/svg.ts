import { MAX_COMPLETION_TOKENS } from "../constants";
import { completionBudget, responsesCompletionBudget, requestOpenAiRaw } from "./request";
import { asRecord, extractModelText, parseJsonFromText } from "./parse";
import type { ApiSettings, RefinedSvg } from "../types";

// Ask the model to redraw the canvas as a single, self-contained, animated SVG.
// Reuses the existing image-in / text-out plumbing; the only differences from the
// critique path are a vector-focused system prompt and a roomier token budget.
export async function requestOpenAiSvg(
  settings: ApiSettings,
  imageDataUrl: string,
  description = "",
): Promise<RefinedSvg> {
  const json = await requestOpenAiRaw(settings, buildSvgRequestBody(settings, imageDataUrl, description));
  const parsed = asRecord(parseJsonFromText(extractModelText(json)));
  const svg = typeof parsed?.svg === "string" ? parsed.svg : "";

  if (!/<svg[\s\S]*<\/svg>/i.test(svg)) {
    throw new Error("Model did not return SVG markup");
  }

  return {
    svg,
    title: typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Refined sketch",
    summary: typeof parsed?.summary === "string" ? parsed.summary.trim() : "",
  };
}

export function buildSvgRequestBody(settings: ApiSettings, imageDataUrl: string, description = "") {
  const isChatCompletions = settings.endpointPath.includes("chat/completions");
  // Give SVG room to breathe even if the user's slider is low, without overriding a
  // higher manual setting.
  const svgSettings: ApiSettings = {
    ...settings,
    maxCompletionTokens: Math.min(MAX_COMPLETION_TOKENS, Math.max(5000, settings.maxCompletionTokens)),
  };

  if (isChatCompletions) {
    return {
      model: settings.model.trim(),
      temperature: 0.6,
      ...completionBudget(svgSettings, 5000),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: svgSystemPrompt() },
        {
          role: "user",
          content: [
            { type: "text", text: svgUserPrompt(description) },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    };
  }

  return {
    model: settings.model.trim(),
    instructions: svgSystemPrompt(),
    temperature: 0.6,
    ...responsesCompletionBudget(svgSettings, 5000),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: svgUserPrompt(description) },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "refined_svg",
        strict: true,
        schema: refineSvgSchema(),
      },
    },
  };
}

export function svgSystemPrompt() {
  return "You are DrawAssistant's vector studio. You turn rough sketches into clean, charming, animated SVG illustrations. Return valid JSON only.";
}

export function svgUserPrompt(description = "") {
  const descriptionLines = description.trim()
    ? [
        `The collaborator who worked on this sketch described it as: "${description.trim()}".`,
        "Treat that description as the intended subject: make the refined illustration clearly read as that thing. If the raw marks are ambiguous, let the description settle what it depicts.",
      ]
    : [];

  return [
    "Here is a hand-drawn sketch. Redraw it as one refined, self-contained, animated SVG that captures what the sketch wants to be: cleaner and more characterful than the original, but clearly the same idea and composition.",
    ...descriptionLines,
    "Hard requirements for the svg string:",
    '- Root must be <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"> with NO width or height attributes.',
    "- Fully self-contained: inline shapes, paths, and gradients only, plus a single inline <style> block.",
    "- Forbidden: <script>, <foreignObject>, <image>, <use>, any on* event handlers, and any external URL, font, or href (internal #id references for gradients/filters are fine).",
    "- Animate the FINISHED illustration, not the act of drawing it. The complete illustration must be fully drawn and visible from the very first frame. Do NOT do a 'draw-on' reveal: no stroke-dashoffset drawing-on, no fading or wiping the outlines in. Every shape stays present the whole time.",
    "- Put CSS @keyframes in the <style> block and/or use SMIL <animate>/<animateTransform> to give the fully-drawn figure a gentle, continuously looping idle motion such as a bob, sway, pulse, breathe, blink, or sparkle. Prefer animating transform/opacity of whole parts over animating stroke-dashoffset.",
    "- Keep it tasteful and light: aim for fewer than ~40 elements and a loop of about 4-8 seconds. Reuse the sketch's colors where it makes sense.",
    "Respond with JSON only in the shape { \"title\": string, \"summary\": string, \"svg\": string }. title is 2-4 words. summary is one playful sentence under 120 characters. svg is the complete <svg>...</svg> markup.",
  ].join("\n");
}

export function refineSvgSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      svg: { type: "string" },
    },
    required: ["title", "summary", "svg"],
  };
}

// Defense in depth: even though we render the SVG inside a locked-down sandboxed
// iframe (no scripts, CSP default-src 'none'), strip the obvious injection vectors
// before it ever touches the DOM.
export function sanitizeSvgMarkup(raw: string): string {
  const match = raw.match(/<svg[\s\S]*<\/svg>/i);
  let svg = match ? match[0] : raw;

  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    // Drop external references but keep internal "#id" refs (gradients, filters).
    .replace(/\s(?:xlink:)?href\s*=\s*"(?!#)[^"]*"/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*'(?!#)[^']*'/gi, "");

  return svg;
}

export function svgPreviewDocument(svg: string): string {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:;">',
    "<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:transparent;overflow:hidden}svg{max-width:100%;max-height:100%;width:auto;height:auto;display:block}</style>",
    "</head><body>",
    svg,
    "</body></html>",
  ].join("");
}
