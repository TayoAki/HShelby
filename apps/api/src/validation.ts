import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./errors";

export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
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
