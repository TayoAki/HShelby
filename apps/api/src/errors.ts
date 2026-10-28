import type { ErrorCode } from "@hshelby/contracts";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);

/** Walks a driver error's cause chain for a unique violation, optionally on one constraint. */
export function isUniqueViolation(err: unknown, constraint?: string) {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const pgError = e as { code?: string; constraint?: string };
    if (pgError.code === "23505" && (!constraint || pgError.constraint === constraint)) return true;
  }
  return false;
}
