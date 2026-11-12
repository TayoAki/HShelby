/*
 * What AI replies cost at the model provider, for the partner API's usage report (App Builder charges its users
 * credits for them). Dollars per million tokens: input, output, cache reads and cache writes. Keep it in step with
 * the providers' price lists when the default model changes.
 */

export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** The model AI replies use when AI_MODEL doesn't say otherwise (apps/api/src/ai/provider.ts). */
export const DEFAULT_PRICED_MODEL = "claude-opus-5-5";

/** "anthropic/claude-opus-5.5" (OpenRouter's name) → "claude-opus-5-5". */
export function canonicalModel(model: string): string {
  return model.replace(/^anthropic\//, "").replace(/\./g, "-");
}

export function modelPrice(model: string | null | undefined): ModelPrice {
  return MODEL_PRICES[canonicalModel(model ?? DEFAULT_PRICED_MODEL)] ?? MODEL_PRICES[DEFAULT_PRICED_MODEL]!;
}

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** A run's cost in US dollars, to the millionth of a dollar. */
export function tokenCostUsd(usage: TokenUsage, model: string | null | undefined): number {
  const p = modelPrice(model);
  const cost =
    (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
