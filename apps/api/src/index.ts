import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app";
import { createDeps } from "./deps";
import { billingEnabled, loadEnv } from "./env";

const env = loadEnv();
const { deps, pool } = createDeps(env);
const app = createApp(deps);

let server: ServerType;

// "::" listens on IPv6 + IPv4, which Railway's private network needs; fall back to IPv4-only hosts.
function listen(hostname: string) {
  server = serve({ fetch: app.fetch, port: env.PORT, hostname }, (info) => {
    deps.logger.info({ port: info.port, hostname, billing: billingEnabled(env) }, "api listening");
  });
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EAFNOSUPPORT" && hostname === "::") return listen("0.0.0.0");
    throw err;
  });
}
listen("::");

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    deps.logger.info({ signal }, "shutting down");
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
