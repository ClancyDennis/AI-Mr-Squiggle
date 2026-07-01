import {
  API_SETTINGS_STORAGE_KEY,
  COMPLETION_TOKEN_STEP,
  DEFAULT_MAX_COMPLETION_TOKENS,
  MAX_COMPLETION_TOKENS,
  MIN_COMPLETION_TOKENS,
  reasoningEffortOptions,
} from "../constants";
import type { ReasoningEffortSetting } from "../constants";
import { clamp } from "../lib/coordinates";
import type { ApiSettings } from "../types";

export function normalizeReasoningEffort(value: unknown): ReasoningEffortSetting {
  return reasoningEffortOptions.some((option) => option.value === value)
    ? (value as ReasoningEffortSetting)
    : "auto";
}

export function normalizeMaxCompletionTokens(value: unknown, fallback = DEFAULT_MAX_COMPLETION_TOKENS) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const stepped = Math.round(numeric / COMPLETION_TOKEN_STEP) * COMPLETION_TOKEN_STEP;
  return clamp(stepped, MIN_COMPLETION_TOKENS, MAX_COMPLETION_TOKENS);
}

export function loadApiSettings(): ApiSettings {
  const defaults: ApiSettings = {
    baseUrl: import.meta.env.VITE_OPENAI_BASE_URL || "",
    apiKey: import.meta.env.VITE_OPENAI_API_KEY || "",
    model: import.meta.env.VITE_OPENAI_MODEL || "gpt-5.5",
    endpointPath: import.meta.env.VITE_OPENAI_ENDPOINT_PATH || "chat/completions",
    reasoningEffort: normalizeReasoningEffort(import.meta.env.VITE_OPENAI_REASONING_EFFORT ?? "medium"),
    maxCompletionTokens: normalizeMaxCompletionTokens(import.meta.env.VITE_OPENAI_MAX_COMPLETION_TOKENS),
    useVision: import.meta.env.VITE_OPENAI_USE_VISION
      ? import.meta.env.VITE_OPENAI_USE_VISION !== "false"
      : true,
  };

  const rawStored = window.localStorage.getItem(API_SETTINGS_STORAGE_KEY);
  if (!rawStored) return defaults;

  try {
    const stored = JSON.parse(rawStored) as Partial<ApiSettings>;
    return {
      baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : defaults.baseUrl,
      apiKey: typeof stored.apiKey === "string" ? stored.apiKey : defaults.apiKey,
      model: typeof stored.model === "string" ? stored.model : defaults.model,
      endpointPath: typeof stored.endpointPath === "string" ? stored.endpointPath : defaults.endpointPath,
      reasoningEffort: normalizeReasoningEffort(stored.reasoningEffort ?? defaults.reasoningEffort),
      maxCompletionTokens: normalizeMaxCompletionTokens(stored.maxCompletionTokens, defaults.maxCompletionTokens),
      useVision: typeof stored.useVision === "boolean" ? stored.useVision : defaults.useVision,
    };
  } catch {
    return defaults;
  }
}

export function isApiConfigured(settings: ApiSettings) {
  return Boolean(settings.baseUrl.trim() && settings.model.trim() && settings.endpointPath.trim());
}
