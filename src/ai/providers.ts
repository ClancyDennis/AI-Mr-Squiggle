// Known providers, keyed by API-key prefix. Detecting one lets us auto-fill the
// base URL + endpoint and offer the right model list, so BYOK is "paste one thing."

export const CUSTOM_MODEL_OPTION = "__custom__";

export type ProviderId = "openrouter" | "openai";
export type ProviderInfo = {
  id: ProviderId;
  label: string;
  baseUrl: string;
  endpointPath: string;
  defaultModel: string;
  keysUrl: string;
  models: string[];
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    endpointPath: "chat/completions",
    defaultModel: "openai/gpt-4o-mini",
    keysUrl: "https://openrouter.ai/settings/keys",
    models: [
      "openai/gpt-5.5",
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
      "anthropic/claude-sonnet-4.5",
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    endpointPath: "chat/completions",
    defaultModel: "gpt-4o-mini",
    keysUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.4-nano", "gpt-5.5"],
  },
};

export const defaultModelPresets = PROVIDERS.openai.models;

export function detectProviderFromKey(key: string): ProviderInfo | null {
  const trimmed = key.trim();
  if (trimmed.startsWith("sk-or-")) return PROVIDERS.openrouter;
  if (trimmed.startsWith("sk-")) return PROVIDERS.openai;
  return null;
}

export function detectProviderFromBaseUrl(baseUrl: string): ProviderInfo | null {
  const normalized = baseUrl.trim().toLowerCase();
  if (normalized.includes("openrouter.ai")) return PROVIDERS.openrouter;
  if (normalized.includes("api.openai.com")) return PROVIDERS.openai;
  return null;
}
