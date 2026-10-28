import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app";
import type { Deps } from "./context";
import { createLiveGateway } from "./realtime/gateway";

/** The HTTP API plus its WebSocket gateway on one port; resolves once listening. */
export async function startServer(deps: Deps, options: { port: number; hostname: string }) {
  const gateway = createLiveGateway(deps);
  await gateway.start();
  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: createApp(deps).fetch, ...options }, () => resolve(s));
    s.once("error", reject);
  }).catch(async (err: unknown) => {
    await gateway.stop();
    throw err;
  });
  server.on("upgrade", gateway.handleUpgrade);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    server,
    gateway,
    port,
    /** Stops taking connections, closes the sockets (clients reconnect elsewhere), then the server. */
    async close() {
      await gateway.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
