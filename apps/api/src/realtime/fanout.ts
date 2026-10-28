import pg from "pg";
import type { Logger } from "pino";
import { LIVE_CHANNEL, type LiveEvent } from "./events";

/*
 * Cross-instance fan-out: every API instance keeps one connection that LISTENs on the live channel, so an
 * event published by any instance (inside its transaction) reaches every instance's sockets on commit.
 * When one connection per instance becomes a limit, Redis pub/sub replaces this file and nothing else.
 */

export type Fanout = ReturnType<typeof createFanout>;

export function createFanout(connectionString: string, logger: Logger) {
  const onEventHandlers = new Set<(event: LiveEvent) => void>();
  const onResyncHandlers = new Set<() => void>();
  let client: pg.Client | null = null;
  let stopped = false;
  let everConnected = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | undefined;

  async function connect() {
    const c = new pg.Client({ connectionString });
    c.on("notification", (msg) => {
      if (msg.channel !== LIVE_CHANNEL || !msg.payload) return;
      let event: LiveEvent;
      try {
        event = JSON.parse(msg.payload) as LiveEvent;
      } catch {
        return;
      }
      for (const handler of onEventHandlers) handler(event);
    });
    const lost = (err?: Error) => {
      if (client !== c) return;
      client = null;
      if (err) logger.warn({ err }, "live listener lost its connection");
      c.end().catch(() => {});
      schedule();
    };
    c.on("error", lost);
    c.on("end", () => lost());
    await c.connect();
    await c.query(`LISTEN ${LIVE_CHANNEL}`);
    client = c;
    attempt = 0;
    // events published while we were away were missed: tell every socket to catch up
    if (everConnected) for (const handler of onResyncHandlers) handler();
    everConnected = true;
  }

  function schedule() {
    if (stopped) return;
    const delay = Math.min(30_000, 500 * 2 ** attempt++);
    timer = setTimeout(() => {
      connect().catch((err: unknown) => {
        logger.warn({ err, attempt }, "live listener couldn't reconnect");
        schedule();
      });
    }, delay);
  }

  return {
    onEvent: (handler: (event: LiveEvent) => void) => onEventHandlers.add(handler),
    onResync: (handler: () => void) => onResyncHandlers.add(handler),
    start: connect,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      const c = client;
      client = null;
      await c?.end();
    },
    /** For tests: drop the connection as a network failure would. */
    simulateDrop: () => client?.emit("error", new Error("simulated drop")),
  };
}
