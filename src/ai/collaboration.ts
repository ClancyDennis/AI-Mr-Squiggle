import {
  chatToolResultContent,
  collaborationInitialPrompt,
  collaborationSystemPrompt,
  finalCollaborationPrompt,
  summarizeStats,
} from "./prompts";
import { buildDrawingToolOutput, chatDrawStrokesTool } from "./schemas";
import { completionBudget, requestOpenAiJson, requestOpenAiRaw } from "./request";
import {
  asRecord,
  extractChatMessage,
  extractChatToolCalls,
  getMessageText,
  parseFinalCollaborationCritique,
  safeString,
} from "./parse";
import type {
  ApiSettings,
  CanvasStats,
  DrawingToolCall,
  Critique,
  DrawingToolResult,
  NativeCollaborationResult,
} from "../types";

export async function requestOpenAiCritique(settings: ApiSettings, imageDataUrl: string, stats: CanvasStats) {
  const prompt = [
    "Analyze the drawing in the image as a witty but useful art critic.",
    "Return JSON only with headline, body, coverage, composition, and palette.",
    "Keep the headline under 42 characters and body under 260 characters.",
    "Coordinates, if referenced, use the same normalized 0-1000 grid shown in the app.",
    `Canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");

  return requestOpenAiJson<Partial<Critique>>(settings, prompt, imageDataUrl);
}

// After the reveal, the human guesses what the drawing became. This judges the guess
// against what the AI actually drew and returns a playful verdict for the comparison card.
export async function requestGuessVerdict(
  settings: ApiSettings,
  imageDataUrl: string,
  aiAnswer: string,
  guess: string,
): Promise<{ match: boolean; verdict: string }> {
  const prompt = [
    "This finished drawing was just revealed by an AI drawing partner.",
    `The AI's own description of what it drew: "${aiAnswer}".`,
    `A human then guessed what the drawing is: "${guess}".`,
    "Decide whether the guess essentially matches what the AI drew — the same thing or a clearly related reading counts as a match.",
    'Return JSON only: { "match": boolean, "verdict": string }.',
    "verdict is one or two warm, playful sentences (under 160 characters) telling the human whether they nailed it and naming what it actually was.",
  ].join("\n");

  const raw = asRecord(await requestOpenAiJson<unknown>(settings, prompt, imageDataUrl));

  return {
    match: typeof raw?.match === "boolean" ? raw.match : false,
    verdict: safeString(raw?.verdict, "A creative read — let's call it a win.", 200),
  };
}

export async function requestOpenAiCollaborationToolLoop({
  settings,
  initialImageDataUrl,
  initialStats,
  maxPasses,
  seeds,
  onPassStart,
  applyDrawingTool,
}: {
  settings: ApiSettings;
  initialImageDataUrl: string;
  initialStats: CanvasStats;
  maxPasses: number;
  seeds: string[];
  onPassStart: (pass: number) => void;
  applyDrawingTool: (toolCall: DrawingToolCall, pass: number) => Promise<DrawingToolResult>;
}): Promise<NativeCollaborationResult> {
  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: collaborationSystemPrompt(),
    },
    {
      role: "user",
      content: [
        { type: "text", text: collaborationInitialPrompt(initialStats, maxPasses, seeds) },
        { type: "image_url", image_url: { url: initialImageDataUrl } },
      ],
    },
  ];
  let appliedMarkCount = 0;
  let note = "The native tool loop finished without adding marks.";

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    onPassStart(pass);
    const response = await requestOpenAiRaw(settings, {
      model: settings.model.trim(),
      temperature: 0.58,
      ...completionBudget(settings, 2200),
      messages,
      tools: [chatDrawStrokesTool()],
      tool_choice: "auto",
    });
    const message = extractChatMessage(response);
    const toolCalls = extractChatToolCalls(message);
    messages.push(message);

    if (!toolCalls.length) {
      return {
        appliedMarkCount,
        note,
        critique: parseFinalCollaborationCritique(getMessageText(message)),
      };
    }

    let latestResult: DrawingToolResult | null = null;

    for (const toolCall of toolCalls) {
      if (toolCall.name !== "draw_strokes") continue;

      const result = await applyDrawingTool(toolCall, pass);
      latestResult = result;
      appliedMarkCount += result.appliedMarkCount;
      note = toolCall.arguments.intent || toolCall.arguments.note || note;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(buildDrawingToolOutput(result)),
      });
    }

    if (latestResult) {
      messages.push({
        role: "user",
        content: chatToolResultContent(pass, maxPasses, latestResult),
      });
    }
  }

  const finalResponse = await requestOpenAiRaw(settings, {
    model: settings.model.trim(),
    temperature: 0.45,
    ...completionBudget(settings, 1400),
    response_format: { type: "json_object" },
    messages: [
      ...messages,
      {
        role: "user",
        content: finalCollaborationPrompt(),
      },
    ],
  });
  const finalMessage = extractChatMessage(finalResponse);

  return {
    appliedMarkCount,
    note,
    critique: parseFinalCollaborationCritique(getMessageText(finalMessage)),
  };
}

