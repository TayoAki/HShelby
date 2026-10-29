/*
 * Load test (phase B12): devices that poll their badge like the SDK does with the chat closed, plus a steady
 * stream of messages from random devices. Prints latency percentiles per endpoint as this machine saw them
 * (network included); the server's own numbers are in the hosting provider's HTTP metrics.
 *
 *   npx tsx apps/api/scripts/load-test.ts --api https://api.example --dashboard https://dashboard.example \
 *     [--devices 1000] [--poll 5] [--rate 50] [--duration 180]
 *
 * With --dashboard it signs up a throwaway workspace and app; --app app_… uses an existing app instead.
 * Registering 1,000 devices from one address needs the API's RATE_LIMIT_SCALE raised for the run.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    api: { type: "string" },
    dashboard: { type: "string" },
    app: { type: "string" },
    devices: { type: "string", default: "1000" },
    poll: { type: "string", default: "5" },
    rate: { type: "string", default: "50" },
    duration: { type: "string", default: "180" },
  },
});
if (!args.api || (!args.dashboard && !args.app)) {
  console.error("Usage: load-test.ts --api <url> (--dashboard <url> | --app app_…) [--devices 1000] [--poll 5] [--rate 50] [--duration 180]");
  process.exit(2);
}
const api = args.api.replace(/\/$/, "");
const DEVICES = Number(args.devices);
const POLL_MS = Number(args.poll) * 1000;
const RATE = Number(args.rate);
const DURATION_MS = Number(args.duration) * 1000;

type Sample = { ms: number; status: number };
const samples = new Map<string, Sample[]>();

async function timed(name: string, url: string, init: RequestInit = {}) {
  const started = performance.now();
  let status = 0;
  try {
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers } });
    status = res.status;
    const body = await res.text();
    return { status, body };
  } finally {
    const list = samples.get(name) ?? [];
    list.push({ ms: performance.now() - started, status });
    samples.set(name, list);
  }
}

async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: concurrency }, async () => { for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item); }));
}

/** A throwaway workspace with one app, through the dashboard's API (the auth cookie is first-party there). */
async function throwawayApp(dashboard: string) {
  const base = dashboard.replace(/\/$/, "");
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ name: "Load Test", email: `load-${randomBytes(4).toString("hex")}@example.com`, password: randomBytes(16).toString("hex") }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const created = await fetch(`${base}/api/apps`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ name: "Load test" }),
  });
  if (!created.ok) throw new Error(`creating the app failed: ${created.status} ${await created.text()}`);
  const { app } = (await created.json()) as { app: { id: string; publicId: string } };
  return { publicId: app.publicId, remove: () => fetch(`${base}/api/apps/${app.id}`, { method: "DELETE", headers: { origin: base, cookie } }) };
}

function percentiles(list: Sample[]) {
  const ms = list.map((s) => s.ms).sort((a, b) => a - b);
  const at = (p: number) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))] ?? 0;
  const failed = list.filter((s) => s.status < 200 || s.status >= 300).length;
  return { n: list.length, p50: at(50), p95: at(95), p99: at(99), max: ms.at(-1) ?? 0, failed };
}

function report(title: string) {
  console.log(`\n${title}`);
  for (const [name, list] of samples) {
    const p = percentiles(list);
    const statuses = [...new Set(list.filter((s) => s.status >= 300 || s.status === 0).map((s) => s.status))].join(", ");
    console.log(
      `  ${name.padEnd(10)} n=${String(p.n).padStart(6)}  p50 ${p.p50.toFixed(0).padStart(4)} ms  p95 ${p.p95.toFixed(0).padStart(4)} ms  p99 ${p.p99.toFixed(0).padStart(4)} ms  max ${p.max.toFixed(0).padStart(5)} ms  failed ${p.failed}${statuses ? ` (${statuses})` : ""}`,
    );
  }
  samples.clear();
}

const target = args.app ? { publicId: args.app, remove: null } : await throwawayApp(args.dashboard!);

// the network's share: the fastest of a few health checks
for (let i = 0; i < 10; i++) await timed("health", `${api}/health`);
report("Baseline (GET /health)");

console.log(`\nRegistering ${DEVICES} devices…`);
const tokens: string[] = [];
await pool(
  Array.from({ length: DEVICES }, (_, i) => i),
  50,
  async (i) => {
    const res = await timed("register", `${api}/v1/devices`, {
      method: "POST",
      body: JSON.stringify({ appId: target.publicId, device: { model: "iPhone16,1", osVersion: "18.2", appVersion: "1.0" }, identity: { name: `Load ${i}` } }),
    });
    if (res.status === 201) tokens.push((JSON.parse(res.body) as { accessToken: string }).accessToken);
  },
);
report(`Registered ${tokens.length} of ${DEVICES}`);
if (tokens.length === 0) process.exit(1);

console.log(`\n${tokens.length} devices polling every ${POLL_MS / 1000} s (≈${Math.round(tokens.length / (POLL_MS / 1000))}/s) and ${RATE} messages/s for ${DURATION_MS / 1000} s…`);
const end = Date.now() + DURATION_MS;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inflight = new Set<Promise<unknown>>();
const track = (p: Promise<unknown>) => {
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
};

const pollers = tokens.map(async (token) => {
  await sleep(Math.random() * POLL_MS);
  while (Date.now() < end) {
    track(timed("unread", `${api}/v1/unread`, { headers: { authorization: `Bearer ${token}` } }));
    await sleep(POLL_MS);
  }
});
const sender = (async () => {
  const gap = 1000 / RATE;
  for (let next = Date.now(); next < end; next += gap) {
    const token = tokens[Math.floor(Math.random() * tokens.length)]!;
    track(timed("send", `${api}/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ clientId: randomUUID(), text: "Load test message" }) }));
    await sleep(Math.max(0, next + gap - Date.now()));
  }
})();
await Promise.all([...pollers, sender]);
await Promise.allSettled([...inflight]);
report("Under load");

if (target.remove) {
  const res = await target.remove();
  console.log(`\nThrowaway app ${res.ok ? "deleted (its devices and messages are purged in the background)" : `not deleted (${res.status})`}`);
}
