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
  extractChatMessage,
  extractChatToolCalls,
  getMessageText,
  parseFinalCollaborationCritique,
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

