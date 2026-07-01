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

export async function requestOpenAiRaw(
  settings: ApiSettings,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(buildEndpoint(settings), {
    method: "POST",
    headers: buildHeaders(settings),
    body: JSON.stringify(body),
    signal,
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

export function completionBudget(
  settings: ApiSettings,
  tokenBudget: number,
  options?: { omitReasoningEffort?: boolean },
): Record<string, unknown> {
  const budget = completionTokenBudget(settings, tokenBudget);

  if (usesReasoningBudget(settings.model)) {
    // gpt-5.x on /chat/completions rejects reasoning_effort alongside function
    // tools ("use /v1/responses instead"), so tool-calling callers omit it.
    if (options?.omitReasoningEffort) {
      return { max_completion_tokens: budget };
    }
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

// OpenRouter namespaces models as "provider/model" (e.g. "openai/gpt-5.5").
// Strip the prefix so the reasoning-model checks work for both direct and
// OpenRouter-routed model names.
function bareModelName(model: string): string {
  return model.trim().toLowerCase().replace(/^[a-z0-9._-]+\//, "");
}

export function usesReasoningBudget(model: string) {
  return /^(gpt-5|o\d|o[34]-)/i.test(bareModelName(model));
}

export function reasoningEffortForModel(model: string) {
  const normalized = bareModelName(model);

  // Original GPT-5 / GPT-5-mini / GPT-5-nano accept "minimal" (the cheapest tier).
  // Newer deployments (gpt-5.4-nano, gpt-5.5, …) reject it; "low" is the smallest
  // effort tier they accept.
  if (normalized === "gpt-5" || normalized.startsWith("gpt-5-")) {
    return "minimal";
  }

  return "low";
}

// Reasoning models (gpt-5 family, o-series) reject a custom temperature; they only
// accept the default. Omit the parameter entirely for those models.
export function temperatureParams(settings: ApiSettings, value: number): Record<string, number> {
  return usesReasoningBudget(settings.model) ? {} : { temperature: value };
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
    ...temperatureParams(settings, 0.78),
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
