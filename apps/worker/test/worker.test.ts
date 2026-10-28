import { PUSH_QUEUE } from "@hshelby/push";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { afterAll, expect, it } from "vitest";
import { startWorker } from "../src/worker";
import { pushFixture } from "./push-fixture";

const connectionString = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test";
const fx = await pushFixture();
// its own pg-boss schema, so jobs left by other test files don't run here
const schema = "pgboss_worker_test";
await fx.db.execute(sql.raw(`drop schema if exists ${schema} cascade`));
const boss = new PgBoss({ connectionString, schema, useListenNotify: true });
await startWorker({ db: fx.db, boss, apns: fx.apns, keyring: fx.keyring, storage: null, logger: pino({ level: "silent" }) });
afterAll(async () => {
  await boss.stop({ graceful: false });
  await fx.close();
});

async function until<T>(check: () => Promise<T | undefined> | T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

it("delivers a queued reply through the worker loop", async () => {
  const s = await fx.scenario();
  await boss.send(PUSH_QUEUE, { messageId: s.replyId }, { singletonKey: s.replyId });
  const request = await until(() => fx.production.requests.find((r) => r.deviceToken === s.token));
  expect(request.payload.aps).toMatchObject({ "thread-id": s.conversationId, badge: 1 });
});

it("leaves a job that APNs answered with a server error waiting for a retry", async () => {
  const s = await fx.scenario();
  fx.production.answer(s.token, 503, "ServiceUnavailable");
  const jobId = (await boss.send(PUSH_QUEUE, { messageId: s.replyId }, { singletonKey: s.replyId }))!;
  const job = await until(async () => {
    const found = await boss.getJobById(PUSH_QUEUE, jobId);
    return found?.state === "retry" ? found : undefined;
  });
  // retryCount goes up when the job is claimed again, so attempt N runs with retryCount N - 1
  expect(job.retryCount).toBe(0);
  // not the last attempt, so nothing is recorded on the device yet
  expect((await s.device()).pushIssue).toBeNull();
});
