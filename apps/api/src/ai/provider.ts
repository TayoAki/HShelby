import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";

/*
 * Where AI replies are answered. Claude directly with ANTHROPIC_API_KEY, or Claude through OpenRouter's
 * Anthropic-compatible Messages API with OPENROUTER_API_KEY (only when there's no Anthropic key, so adding one
 * switches over). Both speak the same API, so one client and one tool runner serve either. AI_MODEL overrides
 * the model.
 */

export type AiProviderName = "anthropic" | "openrouter";

export type AiProvider = {
  name: AiProviderName;
  client: Anthropic;
  model: string;
  /** Anthropic's server-side fallback (another model answers when Claude declines); OpenRouter rejects the request. */
  serverFallback: boolean;
};

export const DEFAULT_MODEL: Record<AiProviderName, string> = {
  anthropic: "claude-opus-5-5",
  openrouter: "anthropic/claude-opus-5.5",
};

export function aiProvider(name: AiProviderName, client: Anthropic, model = DEFAULT_MODEL[name]): AiProvider {
  return { name, client, model, serverFallback: name === "anthropic" };
}

type AiEnv = Pick<Env, "ANTHROPIC_API_KEY" | "ANTHROPIC_BASE_URL" | "OPENROUTER_API_KEY" | "OPENROUTER_BASE_URL" | "AI_MODEL">;

export function aiProviderFromEnv(env: AiEnv, options: { maxRetries?: number } = {}): AiProvider | null {
  const common = { maxRetries: options.maxRetries ?? 3, timeout: 90_000 };
  if (env.ANTHROPIC_API_KEY) {
    return aiProvider("anthropic", new Anthropic({ ...common, apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL }), env.AI_MODEL);
  }
  if (env.OPENROUTER_API_KEY) {
    // OpenRouter takes the key as a bearer token, not Anthropic's x-api-key header
    return aiProvider(
      "openrouter",
      new Anthropic({ ...common, apiKey: null, authToken: env.OPENROUTER_API_KEY, baseURL: env.OPENROUTER_BASE_URL }),
      env.AI_MODEL,
    );
  }
  return null;
}
