import { normalizeMaxCompletionTokens } from "./settings";
import { extractModelText, parseJsonFromText } from "./parse";
import type { ApiSettings } from "../types";

export async function requestOpenAiJson<T>(
  settings: ApiSettings,
  prompt: string,
  imageDataUrl: string,
): Promise<T> {
  const json = await requestOpenAiRaw(settings, buildRequestBody(settings, prompt, imageDataUrl));
  const text = extractModelText(json);
  return parseJsonFromText(text) as T;
}

export async function requestOpenAiRaw(settings: ApiSettings, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(buildEndpoint(settings), {
    method: "POST",
    headers: buildHeaders(settings),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `OpenAI request failed with ${response.status}`);
  }

  return (await response.json()) as unknown;
}

export function buildEndpoint(settings: ApiSettings) {
  const base = settings.baseUrl.trim().replace(/\/+$/, "");
  const path = settings.endpointPath.trim().replace(/^\/+/, "");
  return `${base}/${path}`;
}

export function buildHeaders(settings: ApiSettings) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  return headers;
}

export function completionBudget(settings: ApiSettings, tokenBudget: number): Record<string, unknown> {
  const budget = completionTokenBudget(settings, tokenBudget);

  if (usesReasoningBudget(settings.model)) {
    return {
      max_completion_tokens: budget,
      reasoning_effort: reasoningEffortForSettings(settings),
    };
  }

  return {
    max_tokens: budget,
  };
}

export function completionTokenBudget(settings: ApiSettings, fallbackTokenBudget: number) {
  return normalizeMaxCompletionTokens(settings.maxCompletionTokens, fallbackTokenBudget);
}

export function usesReasoningBudget(model: string) {
  return /^(gpt-5|o\d|o[34]-|gpt-5\.)/i.test(model.trim());
}

export function reasoningEffortForModel(model: string) {
  const normalized = model.trim().toLowerCase();

  // This proxy's gpt-5.5 deployment rejects "minimal"; "low" is the smallest accepted effort.
  if (normalized.startsWith("gpt-5.5")) {
    return "low";
  }

  return "minimal";
}

export function reasoningEffortForSettings(settings: ApiSettings) {
  return settings.reasoningEffort === "auto"
    ? reasoningEffortForModel(settings.model)
    : settings.reasoningEffort;
}

export function buildRequestBody(settings: ApiSettings, prompt: string, imageDataUrl: string) {
  const systemPrompt =
    "You are DrawAssistant, a concise AI art critic and drawing collaborator. Return valid JSON only.";

  return {
    model: settings.model.trim(),
    temperature: 0.78,
    ...completionBudget(settings, 1600),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };
}
