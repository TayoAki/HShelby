import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./errors";

/** Parses and validates a JSON body. With `optional`, an empty body counts as `{}`. */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T, options: { optional?: boolean } = {}): Promise<z.infer<T>> {
  let body: unknown;
  try {
    const text = await c.req.text();
    body = options.optional && text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    throw new ApiError(400, "validation_failed", "Request body must be JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new ApiError(400, "validation_failed", message);
  }
  return result.data;
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; ");
    throw new ApiError(400, "validation_failed", message);
  }
  return result.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);
