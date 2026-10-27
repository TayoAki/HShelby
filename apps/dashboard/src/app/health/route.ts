// Railway healthcheck: the Next server is up and serving.
export function GET() {
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}
