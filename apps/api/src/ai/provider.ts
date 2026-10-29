import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";

/*
 * Where AI replies are answered. Claude directly with ANTHROPIC_API_KEY, or Claude through OpenRouter's
 * Anthropic-compatible Messages API with OPENROUTER_API_KEY (only when there's no Anthropic key, so adding one
 * switches over). Both speak the same API, so one client and one tool runner serve either. AI_MODEL overrides
 * the model.
 *
 * OpenRouter can serve a Claude model from Anthropic, Amazon Bedrock, Google Vertex or Azure. Requests are pinned
 * to the providers in OPENROUTER_PROVIDERS (default: Anthropic only, no fallback) and to providers that neither
 * keep nor train on the data, so the subprocessor list stays true (docs/SUBPROCESSORS.md).
 */

export type AiProviderName = "anthropic" | "openrouter";

export type AiProvider = {
  name: AiProviderName;
  client: Anthropic;
  model: string;
  /** Anthropic's server-side fallback (another model answers when Claude declines); OpenRouter rejects the request. */
  serverFallback: boolean;
  /** Fields added to every request: OpenRouter's routing preferences. */
  extraBody: Record<string, unknown>;
};

export const DEFAULT_MODEL: Record<AiProviderName, string> = {
  anthropic: "claude-opus-5-5",
  openrouter: "anthropic/claude-opus-5.5",
};

/** OpenRouter's provider slugs; empty lets OpenRouter pick among providers that don't keep or train on data. */
export function openRouterRouting(providers: string[]) {
  return { provider: { ...(providers.length ? { only: providers, allow_fallbacks: false } : {}), data_collection: "deny" } };
}

export function aiProvider(name: AiProviderName, client: Anthropic, model = DEFAULT_MODEL[name], openRouterProviders = ["anthropic"]): AiProvider {
  return { name, client, model, serverFallback: name === "anthropic", extraBody: name === "openrouter" ? openRouterRouting(openRouterProviders) : {} };
}

type AiEnv = Pick<Env, "ANTHROPIC_API_KEY" | "ANTHROPIC_BASE_URL" | "OPENROUTER_API_KEY" | "OPENROUTER_BASE_URL" | "OPENROUTER_PROVIDERS" | "AI_MODEL">;

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
      env.OPENROUTER_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean),
    );
  }
  return null;
}
