import type { Db, Tx } from "@hshelby/db";
import { sql } from "drizzle-orm";

/** The Postgres channel every API instance listens on. */
export const LIVE_CHANNEL = "rt";

/**
 * What changed, published with NOTIFY and fanned out by every API instance to its sockets: to dashboards by
 * organization, to the SDK by device. Kept small (NOTIFY payloads are capped at 8 KB): clients fetch the data.
 */
export type LiveEvent =
  | { type: "message"; organizationId: string; conversationId: string; deviceId: string; seq: number; sender: "user" | "agent" }
  | { type: "read"; organizationId: string; conversationId: string; deviceId: string; side: "user" | "team"; seq: number }
  | { type: "conversation"; organizationId: string; conversationId: string; deviceId: string }
  | {
      type: "typing";
      organizationId: string;
      conversationId: string;
      deviceId: string;
      sender: "user" | "agent";
      name: string | null;
      userId: string | null;
    }
  | { type: "presence"; organizationId: string; conversationId: string; deviceId: string; inChat: boolean }
  /** The first tap on a card's button (phase B7). */
  | { type: "action"; organizationId: string; conversationId: string; deviceId: string; messageId: string };

/** Publishes an event. Inside a transaction it goes out on commit, so a rolled-back change is never announced. */
export async function publishLive(db: Db | Tx, event: LiveEvent) {
  await db.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify(event)})`);
}
