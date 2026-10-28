import { createDeps } from "./deps";
import { billingEnabled, loadEnv } from "./env";
import { startServer } from "./server";

const env = loadEnv();
const { deps, pool } = createDeps(env);
await deps.jobs.start();

// "::" listens on IPv6 + IPv4, which Railway's private network needs; fall back to IPv4-only hosts.
const running = await startServer(deps, { port: env.PORT, hostname: "::" }).catch((err: NodeJS.ErrnoException) => {
  if (err.code === "EAFNOSUPPORT") return startServer(deps, { port: env.PORT, hostname: "0.0.0.0" });
  throw err;
});
deps.logger.info({ port: running.port, billing: billingEnabled(env) }, "api listening");

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    deps.logger.info({ signal }, "shutting down");
    deps.apns.close();
    void running
      .close()
      .then(() => Promise.allSettled([deps.jobs.stop(), pool.end()]))
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
