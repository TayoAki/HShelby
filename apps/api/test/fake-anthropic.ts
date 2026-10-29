/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are whatever the SDK sent */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * A stand-in for the Claude Messages API: the SDK's real requests, scripted answers. Each request is recorded;
 * a test sets `respond` to decide what the model "says" next.
 */

export type FakeReply = {
  content: any[];
  stop_reason: "end_turn" | "tool_use" | "refusal" | "max_tokens";
  /** Answered by the fallback model after a decline. */
  fallback?: boolean;
};

export type SeenRequest = { body: any; headers: IncomingHttpHeaders; url: string };

export const toolUse = (name: string, input: Record<string, unknown>, ...more: [string, Record<string, unknown>][]): FakeReply => ({
  content: [[name, input] as const, ...more].map(([n, i]) => ({ type: "tool_use", id: `toolu_${randomUUID().replaceAll("-", "")}`, name: n, input: i })),
  stop_reason: "tool_use",
});
export const say = (text: string): FakeReply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
export const refusal = (): FakeReply => ({ content: [], stop_reason: "refusal" });

/** The latest tool results the SDK sent back, by tool name. */
export function lastToolResults(body: any): { name: string; content: string; isError: boolean }[] {
  const messages: any[] = body.messages;
  const results = messages.at(-1)?.content;
  if (!Array.isArray(results)) return [];
  const calls = new Map<string, string>();
  for (const m of messages) if (m.role === "assistant" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_use") calls.set(b.id, b.name);
  return results
    .filter((b: any) => b.type === "tool_result")
    .map((b: any) => ({
      name: calls.get(b.tool_use_id) ?? "?",
      content: typeof b.content === "string" ? b.content : b.content.map((c: any) => c.text ?? "").join(""),
      isError: b.is_error === true,
    }));
}

export async function startFakeAnthropic() {
  const requests: SeenRequest[] = [];
  let failStatus: number | null = null;
  const state = {
    respond: (async () => say("")) as (body: any, request: SeenRequest) => FakeReply | Promise<FakeReply>,
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json", "request-id": `req_${randomUUID()}` });
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "Not found" } });
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const seen = { body, headers: req.headers, url: req.url };
      requests.push(seen);
      if (failStatus) return send(failStatus, { type: "error", error: { type: "api_error", message: "Internal server error" } });
      try {
        const reply = await state.respond(body, seen);
        send(200, {
          id: `msg_${randomUUID().replaceAll("-", "")}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: reply.content,
          stop_reason: reply.stop_reason,
          stop_sequence: null,
          usage: {
            input_tokens: 900,
            output_tokens: 120,
            cache_read_input_tokens: 3000,
            cache_creation_input_tokens: 0,
            iterations: reply.fallback ? [{ type: "message", input_tokens: 900, output_tokens: 0 }, { type: "fallback_message", input_tokens: 900, output_tokens: 120 }] : null,
          },
        });
      } catch (err) {
        send(500, { type: "error", error: { type: "api_error", message: String(err) } });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    /** Sets what the model answers to each request. */
    respond(fn: (body: any, request: SeenRequest) => FakeReply | Promise<FakeReply>) {
      state.respond = fn;
    },
    /** Answers every request with this HTTP status until cleared with null. */
    fail(status: number | null) {
      failStatus = status;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
