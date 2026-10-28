import type { IncomingMessage } from "node:http";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import { SdkLiveCommand, TeamLiveCommand, type SdkLiveEvent, type TeamLiveEvent } from "@hshelby/contracts";
import { conversations, devices } from "@hshelby/db";
import { and, eq, isNull } from "drizzle-orm";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { z } from "zod";
import type { Deps } from "../context";
import { ApiError } from "../errors";
import { activeOrganization, authenticateDevice } from "../middleware";
import { publishLive, type LiveEvent } from "./events";
import { createFanout } from "./fanout";

/*
 * WebSockets for live updates: `/v1/live` for the SDK while its chat is on screen, `/api/live` for dashboard
 * tabs. Sockets live on whichever instance accepted them; events reach them through the fan-out. Sockets
 * are closed with 4001 when their credentials are due for a recheck, and clients reconnect with fresh ones.
 */

const PING_MS = 15_000;
/** Heartbeats refresh "In chat" in the database at most this often. */
const PRESENCE_WRITE_MS = 20_000;
const TYPING_THROTTLE_MS = 2_000;
const RATE = { windowMs: 10_000, max: 40 };
/** An SDK access token lasts 15 minutes; a dashboard session is rechecked hourly. */
const MAX_AGE_MS = { sdk: 15 * 60_000, team: 60 * 60_000 };
export const CLOSE = { goingAway: 1001, policy: 1008, reauthenticate: 4001 } as const;

type Base = { ws: WebSocket; alive: boolean; expiresAt: number; window: { start: number; count: number } };
type SdkClient = Base & {
  kind: "sdk";
  deviceId: string;
  organizationId: string;
  conversationId: string | null;
  name: string | null;
  blocked: boolean;
  lastTypingAt: number;
  lastPresenceAt: number;
};
type TeamClient = Base & { kind: "team"; organizationId: string; userId: string; name: string; lastTypingAt: Map<string, number> };
type Client = SdkClient | TeamClient;

function teamEvent(event: LiveEvent, client: TeamClient): TeamLiveEvent | null {
  switch (event.type) {
    case "message":
      return { type: "message", conversationId: event.conversationId, seq: event.seq, sender: event.sender };
    case "read":
    case "conversation":
      return { type: "conversation", conversationId: event.conversationId };
    case "typing":
      // a teammate doesn't need their own typing echoed back
      return event.userId && event.userId === client.userId
        ? null
        : { type: "typing", conversationId: event.conversationId, sender: event.sender, name: event.name, userId: event.userId };
    case "presence":
      return { type: "presence", conversationId: event.conversationId, inChat: event.inChat };
  }
}

function sdkEvent(event: LiveEvent): SdkLiveEvent | null {
  if (event.type === "message") return { type: "message", seq: event.seq };
  if (event.type === "read" && event.side === "team") return { type: "read", seq: event.seq };
  if (event.type === "typing" && event.sender === "agent") return { type: "typing", name: event.name };
  return null;
}

function parse<T>(schema: z.ZodType<T>, data: RawData, isBinary: boolean): T | null {
  if (isBinary) return null;
  try {
    const result = schema.safeParse(JSON.parse(data.toString()));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const add = <C>(map: Map<string, Set<C>>, key: string, client: C) => {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(client);
};
const remove = <C>(map: Map<string, Set<C>>, key: string, client: C) => {
  const set = map.get(key);
  set?.delete(client);
  if (set?.size === 0) map.delete(key);
};

export type LiveGateway = ReturnType<typeof createLiveGateway>;

export function createLiveGateway(deps: Deps) {
  const { db, logger } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const fanout = createFanout(deps.env.DATABASE_URL, logger);
  const clients = new Map<WebSocket, Client>();
  const byDevice = new Map<string, Set<SdkClient>>();
  const byOrg = new Map<string, Set<TeamClient>>();
  const trustedOrigins = new Set(
    [deps.env.BETTER_AUTH_URL, ...(deps.env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()) ?? [])].map((o) => new URL(o).origin),
  );
  const warn = (msg: string) => (err: unknown) => logger.warn({ err }, msg);

  const send = (ws: WebSocket, event: SdkLiveEvent | TeamLiveEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };

  fanout.onEvent((event) => {
    for (const client of byOrg.get(event.organizationId) ?? []) {
      const out = teamEvent(event, client);
      if (out) send(client.ws, out);
    }
    for (const client of byDevice.get(event.deviceId) ?? []) {
      // a device's first message creates its conversation while the socket is open
      if (event.type === "message") client.conversationId = event.conversationId;
      const out = sdkEvent(event);
      if (out) send(client.ws, out);
    }
  });
  fanout.onResync(() => {
    for (const client of clients.values()) send(client.ws, { type: "resync" });
  });

  /** A socket may send this many messages per window; more closes it. */
  function allow(client: Client) {
    const now = Date.now();
    if (now - client.window.start > RATE.windowMs) client.window = { start: now, count: 0 };
    if (++client.window.count <= RATE.max) return true;
    client.ws.close(CLOSE.policy, "Too many messages");
    return false;
  }

  async function setPresence(client: SdkClient, open: boolean) {
    client.lastPresenceAt = Date.now();
    await db.update(devices).set({ chatOpen: open, lastSeenInChatAt: new Date() }).where(eq(devices.id, client.deviceId));
    if (client.conversationId) {
      await publishLive(db, {
        type: "presence",
        organizationId: client.organizationId,
        conversationId: client.conversationId,
        deviceId: client.deviceId,
        inChat: open,
      });
    }
  }

  function refreshPresence(client: SdkClient) {
    if (Date.now() - client.lastPresenceAt < PRESENCE_WRITE_MS) return;
    client.lastPresenceAt = Date.now();
    db.update(devices)
      .set({ chatOpen: true, lastSeenInChatAt: new Date() })
      .where(eq(devices.id, client.deviceId))
      .catch(warn("presence write failed"));
  }

  function onSdkMessage(client: SdkClient, data: RawData, isBinary: boolean) {
    if (!allow(client)) return;
    const command = parse(SdkLiveCommand, data, isBinary);
    if (!command) return;
    if (command.type === "heartbeat") return refreshPresence(client);
    const now = Date.now();
    if (client.blocked || !client.conversationId || now - client.lastTypingAt < TYPING_THROTTLE_MS) return;
    client.lastTypingAt = now;
    publishLive(db, {
      type: "typing",
      organizationId: client.organizationId,
      conversationId: client.conversationId,
      deviceId: client.deviceId,
      sender: "user",
      name: client.name,
      userId: null,
    }).catch(warn("typing publish failed"));
  }

  async function onTeamMessage(client: TeamClient, data: RawData, isBinary: boolean) {
    if (!allow(client)) return;
    const command = parse(TeamLiveCommand, data, isBinary);
    if (!command) return;
    const now = Date.now();
    if (now - (client.lastTypingAt.get(command.conversationId) ?? 0) < TYPING_THROTTLE_MS) return;
    client.lastTypingAt.set(command.conversationId, now);
    const [conversation] = await db
      .select({ deviceId: conversations.deviceId })
      .from(conversations)
      .where(and(eq(conversations.id, command.conversationId), eq(conversations.organizationId, client.organizationId)))
      .limit(1);
    if (!conversation) return;
    await publishLive(db, {
      type: "typing",
      organizationId: client.organizationId,
      conversationId: command.conversationId,
      deviceId: conversation.deviceId,
      sender: "agent",
      name: client.name,
      userId: client.userId,
    });
  }

  function register(ws: WebSocket, client: Client) {
    clients.set(ws, client);
    ws.on("pong", () => {
      client.alive = true;
      if (client.kind === "sdk") refreshPresence(client);
    });
    ws.on("error", warn("live socket error"));
    send(ws, { type: "ready" });
  }

  function acceptSdk(ws: WebSocket, init: Omit<SdkClient, keyof Base | "kind" | "lastTypingAt" | "lastPresenceAt">) {
    const client: SdkClient = {
      ...init,
      kind: "sdk",
      ws,
      alive: true,
      expiresAt: Date.now() + MAX_AGE_MS.sdk,
      window: { start: Date.now(), count: 0 },
      lastTypingAt: 0,
      lastPresenceAt: 0,
    };
    add(byDevice, client.deviceId, client);
    ws.on("message", (data, isBinary) => onSdkMessage(client, data, isBinary));
    ws.on("close", () => {
      clients.delete(ws);
      remove(byDevice, client.deviceId, client);
      // the chat closed on this device, unless another of its sockets is still here
      if (!byDevice.has(client.deviceId)) setPresence(client, false).catch(warn("presence write failed"));
    });
    register(ws, client);
    setPresence(client, true).catch(warn("presence write failed"));
  }

  function acceptTeam(ws: WebSocket, init: Pick<TeamClient, "organizationId" | "userId" | "name">) {
    const client: TeamClient = {
      ...init,
      kind: "team",
      ws,
      alive: true,
      expiresAt: Date.now() + MAX_AGE_MS.team,
      window: { start: Date.now(), count: 0 },
      lastTypingAt: new Map(),
    };
    add(byOrg, client.organizationId, client);
    ws.on("message", (data, isBinary) => onTeamMessage(client, data, isBinary).catch(warn("typing publish failed")));
    ws.on("close", () => {
      clients.delete(ws);
      remove(byOrg, client.organizationId, client);
    });
    register(ws, client);
  }

  /** Node's `upgrade` event: authenticates, then hands the socket over. Anything else is refused. */
  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (path === "/v1/live") {
        const { device, app } = await authenticateDevice(deps, req.headers.authorization);
        const [conversation] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.deviceId, device.id), isNull(conversations.supersededAt)))
          .limit(1);
        wss.handleUpgrade(req, socket, head, (ws) =>
          acceptSdk(ws, {
            deviceId: device.id,
            organizationId: app.organizationId,
            conversationId: conversation?.id ?? null,
            name: device.name,
            blocked: device.blocked,
          }),
        );
      } else if (path === "/api/live") {
        // cookies ride along on cross-site WebSocket handshakes, so only the dashboard's own pages may connect
        if (!req.headers.origin || !trustedOrigins.has(req.headers.origin)) throw new ApiError(403, "forbidden", "Origin not allowed");
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const session = await deps.auth.api.getSession({ headers });
        if (!session) throw new ApiError(401, "unauthorized", "Sign in to continue");
        const org = await activeOrganization(deps, session.user.id, session.session);
        wss.handleUpgrade(req, socket, head, (ws) =>
          acceptTeam(ws, { organizationId: org.id, userId: session.user.id, name: session.user.name.split(" ")[0] || session.user.name }),
        );
      } else {
        throw new ApiError(404, "not_found", "Route not found");
      }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status === 500) logger.error({ err }, "live upgrade failed");
      socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  }

  // Pings find dead connections (no pong by the next round) and close sockets due for a credential recheck.
  const pinger = setInterval(() => {
    const now = Date.now();
    for (const [ws, client] of clients) {
      if (!client.alive) ws.terminate();
      else if (now > client.expiresAt) ws.close(CLOSE.reauthenticate, "Reconnect with fresh credentials");
      else {
        client.alive = false;
        ws.ping();
      }
    }
  }, PING_MS);
  pinger.unref();

  return {
    handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void handleUpgrade(req, socket, head),
    start: () => fanout.start(),
    async stop() {
      clearInterval(pinger);
      for (const ws of clients.keys()) ws.close(CLOSE.goingAway, "Server shutting down");
      await fanout.stop();
      wss.close();
    },
    /** Open sockets on this instance, for logs and tests. */
    size: () => clients.size,
    fanout,
  };
}
