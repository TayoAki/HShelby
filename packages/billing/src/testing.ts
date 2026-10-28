import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";

/* eslint-disable @typescript-eslint/no-explicit-any -- a loose model of Stripe's JSON objects */
type Obj = Record<string, any>;

export type FakePrice = { amount: number; interval: "month" | "year"; currency?: string };

const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("hex")}`;

/** Stripe's form encoding (`a[b][0][c]=v`) into nested objects and arrays. */
function parseForm(params: URLSearchParams): Obj {
  const out: Obj = {};
  for (const [key, value] of params) {
    const path = key.replace(/\]/g, "").split("[");
    let node: Obj = out;
    path.forEach((part, i) => {
      if (i === path.length - 1) node[part] = value;
      else node = node[part] ??= /^\d*$/.test(path[i + 1]!) ? [] : {};
    });
  }
  return out;
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => resolve(body));
  });

class StripeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const money = (p: FakePrice) => `${(p.amount / 100).toFixed(2)} ${(p.currency ?? "usd").toUpperCase()} / ${p.interval}`;
const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body style="font-family:system-ui;max-width:420px;margin:60px auto;line-height:1.5"><p style="color:#888">Fake Stripe (test)</p>${body}</body></html>`;

/**
 * A local stand-in for the parts of Stripe the app uses: customers, prices, Checkout, the billing portal and
 * subscriptions, with webhooks signed like Stripe's. Checkout and the portal also have small HTML pages, so a
 * browser can subscribe, cancel and fail a payment. Webhooks go to `webhookUrl`, or to `deliver` for tests that
 * call the app in-process.
 */
export async function startFakeStripe(options: {
  prices: Record<string, FakePrice>;
  webhookSecret: string;
  webhookUrl?: string;
  deliver?: (payload: string, signature: string) => Promise<void>;
}) {
  const customers = new Map<string, Obj>();
  const subscriptions = new Map<string, Obj>();
  const sessions = new Map<string, Obj>();
  const portals = new Map<string, Obj>();
  const events: { type: string; object: Obj; delivered: boolean }[] = [];
  const signer = new Stripe("sk_test_signer");
  let base = "";

  const priceObject = (id: string): Obj => {
    const p = options.prices[id];
    if (!p) throw new StripeError(404, `No such price: '${id}'`);
    return {
      id,
      object: "price",
      active: true,
      type: "recurring",
      currency: p.currency ?? "usd",
      unit_amount: p.amount,
      lookup_key: null,
      recurring: { interval: p.interval, interval_count: 1, usage_type: "licensed" },
    };
  };
  const find = (map: Map<string, Obj>, id: string, kind: string) => {
    const found = map.get(id);
    if (!found) throw new StripeError(404, `No such ${kind}: '${id}'`);
    return found;
  };

  async function send(type: string, object: Obj, previous?: Obj) {
    const payload = JSON.stringify({
      id: newId("evt"),
      object: "event",
      api_version: Stripe.API_VERSION,
      created: now(),
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      data: { object: structuredClone(object), ...(previous && { previous_attributes: previous }) },
    });
    const signature = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret: options.webhookSecret });
    const event = { type, object: structuredClone(object), delivered: false };
    events.push(event);
    if (options.deliver) await options.deliver(payload, signature);
    else if (options.webhookUrl) {
      const res = await fetch(options.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        body: payload,
      });
      if (!res.ok) throw new Error(`webhook ${type} answered ${res.status}`);
    } else return;
    event.delivered = true;
  }

  function newPeriod(sub: Obj) {
    const item = sub.items.data[0];
    const start = item.current_period_end ?? now();
    item.current_period_start = start;
    item.current_period_end = start + (item.price.recurring.interval === "year" ? 365 : 30) * DAY;
  }

  /** Changes a subscription and sends `customer.subscription.updated` with what changed, unless `silent`. */
  async function update(id: string, patch: Obj, { silent = false } = {}) {
    const sub = find(subscriptions, id, "subscription");
    const previous = Object.fromEntries(Object.keys(patch).map((k) => [k, sub[k]]));
    Object.assign(sub, patch);
    if (!silent) await send("customer.subscription.updated", sub, previous);
    return sub;
  }

  const controls = {
    /** Pays for a Checkout session: creates the subscription and sends the webhooks Stripe sends. */
    async completeCheckout(sessionId: string) {
      const session = find(sessions, sessionId, "checkout session");
      if (session.status === "complete") return find(subscriptions, session.subscription, "subscription");
      const line = session._line_items[0];
      const sub: Obj = {
        id: newId("sub"),
        object: "subscription",
        customer: session.customer,
        status: "active",
        metadata: session._subscription_metadata ?? {},
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: null,
        ended_at: null,
        trial_start: null,
        trial_end: null,
        schedule: null,
        cancellation_details: null,
        created: now(),
        items: {
          object: "list",
          data: [{ id: newId("si"), object: "subscription_item", price: priceObject(line.price), quantity: Number(line.quantity ?? 1) }],
        },
      };
      newPeriod(sub);
      subscriptions.set(sub.id, sub);
      Object.assign(session, { status: "complete", payment_status: "paid", subscription: sub.id });
      await send("customer.subscription.created", sub);
      await send("checkout.session.completed", publicSession(session));
      return sub;
    },
    /** The customer cancels in the portal: the subscription runs to the end of the period. */
    cancelAtPeriodEnd: (id: string) =>
      update(id, { cancel_at_period_end: true, cancel_at: find(subscriptions, id, "subscription").items.data[0].current_period_end, canceled_at: now() }),
    resume: (id: string) => update(id, { cancel_at_period_end: false, cancel_at: null, canceled_at: null }),
    /** A renewal payment fails and Stripe starts retrying. */
    failPayment: (id: string) => update(id, { status: "past_due" }),
    /** The subscription ends now (cancelled immediately, or the period of a cancelled one ran out). */
    async end(id: string) {
      const sub = find(subscriptions, id, "subscription");
      Object.assign(sub, { status: "canceled", ended_at: now(), canceled_at: sub.canceled_at ?? now() });
      await send("customer.subscription.deleted", sub);
      return sub;
    },
    /** Sets fields without sending a webhook, like a webhook that never arrived. */
    quietly: (id: string, patch: Obj) => update(id, patch, { silent: true }),
    send,
  };

  const publicSession = (s: Obj) => Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith("_")));
  const list = (data: Obj[], url: string) => ({ object: "list", data, has_more: false, url });

  async function api(method: string, path: string, params: Obj): Promise<Obj> {
    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "/v1/customers/search") {
      const wanted = [...String(params.query ?? "").matchAll(/(?<!-)metadata\["([^"]+)"\]:"([^"]*)"/g)];
      const data = [...customers.values()].filter((c) => wanted.every(([, k, v]) => c.metadata?.[k!] === v));
      return { object: "search_result", data: data.slice(0, Number(params.limit ?? 10)), has_more: false };
    }
    if (method === "GET" && path === "/v1/customers") return list([...customers.values()], path);
    if (method === "POST" && path === "/v1/customers") {
      const customer = { id: newId("cus"), object: "customer", name: params.name ?? null, email: params.email ?? null, metadata: params.metadata ?? {} };
      customers.set(customer.id, customer);
      return customer;
    }
    if ((m = path.match(/^\/v1\/customers\/([^/]+)$/))) {
      const customer = find(customers, m[1]!, "customer");
      if (method === "POST") Object.assign(customer, params, { metadata: { ...customer.metadata, ...params.metadata } });
      return customer;
    }
    if (method === "GET" && (m = path.match(/^\/v1\/prices\/([^/]+)$/))) return priceObject(m[1]!);
    if (method === "GET" && path === "/v1/prices") return list([], path);
    if (method === "POST" && path === "/v1/checkout/sessions") {
      const id = newId("cs_test");
      const session = {
        id,
        object: "checkout.session",
        url: `${base}/checkout/${id}`,
        mode: params.mode,
        customer: params.customer ?? null,
        client_reference_id: params.client_reference_id ?? null,
        metadata: params.metadata ?? {},
        success_url: params.success_url,
        cancel_url: params.cancel_url ?? null,
        status: "open",
        payment_status: "unpaid",
        subscription: null,
        _line_items: params.line_items ?? [],
        _subscription_metadata: params.subscription_data?.metadata,
      };
      for (const line of session._line_items) priceObject(line.price);
      sessions.set(id, session);
      return publicSession(session);
    }
    if (method === "GET" && (m = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) return publicSession(find(sessions, m[1]!, "checkout session"));
    if (method === "POST" && path === "/v1/billing_portal/sessions") {
      find(customers, params.customer, "customer");
      const portal = { id: newId("bps"), object: "billing_portal.session", customer: params.customer, return_url: params.return_url ?? null };
      portals.set(portal.id, portal);
      return { ...portal, url: `${base}/portal/${portal.id}` };
    }
    if (method === "GET" && path === "/v1/subscriptions") {
      return list([...subscriptions.values()].filter((s) => !params.customer || s.customer === params.customer), path);
    }
    if ((m = path.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
      const id = m[1]!;
      if (method === "GET") return find(subscriptions, id, "subscription");
      if (method === "DELETE") return controls.end(id);
      if (method === "POST" && params.cancel_at_period_end !== undefined) {
        return params.cancel_at_period_end === "true" ? controls.cancelAtPeriodEnd(id) : controls.resume(id);
      }
    }
    throw new StripeError(404, `Unrecognized request URL (${method}: ${path})`);
  }

  /** The browser pages Stripe would host: Checkout and the billing portal. */
  async function html(method: string, path: string, res: ServerResponse) {
    const redirect = (to: string) => res.writeHead(303, { location: to }).end();
    const ok = (body: string) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/checkout\/([^/]+)(\/pay)?$/))) {
      const session = find(sessions, m[1]!, "checkout session");
      if (method === "POST" && m[2]) {
        await controls.completeCheckout(session.id);
        return redirect(String(session.success_url).replace("{CHECKOUT_SESSION_ID}", session.id));
      }
      const price = options.prices[session._line_items[0].price]!;
      return ok(
        page(
          "Checkout",
          `<h1>Subscribe</h1><p>${money(price)}</p>` +
            `<form method="post" action="/checkout/${session.id}/pay"><button type="submit">Subscribe</button></form>` +
            (session.cancel_url ? `<p><a href="${session.cancel_url}">Back</a></p>` : ""),
        ),
      );
    }
    if ((m = path.match(/^\/portal\/([^/]+)(?:\/([a-z-]+))?$/))) {
      const portal = find(portals, m[1]!, "portal session");
      const sub = [...subscriptions.values()].filter((s) => s.customer === portal.customer).at(-1);
      if (method === "POST" && sub && m[2]) {
        const actions: Record<string, (id: string) => Promise<Obj>> = {
          cancel: controls.cancelAtPeriodEnd,
          renew: controls.resume,
          "fail-payment": controls.failPayment,
          end: controls.end,
        };
        await actions[m[2]]?.(sub.id);
        return redirect(`/portal/${portal.id}`);
      }
      const button = (action: string, label: string) =>
        `<form method="post" action="/portal/${portal.id}/${action}" style="display:inline"><button type="submit">${label}</button></form> `;
      const state = sub
        ? `<p>Status: <b>${sub.status}</b>${sub.cancel_at_period_end ? " (cancels at period end)" : ""}</p>` +
          (sub.status === "canceled"
            ? ""
            : (sub.cancel_at_period_end ? button("renew", "Renew plan") : button("cancel", "Cancel plan")) +
              button("fail-payment", "Fail next payment") +
              button("end", "End now"))
        : "<p>No subscription.</p>";
      return ok(page("Billing", `<h1>Billing</h1>${state}${portal.return_url ? `<p><a href="${portal.return_url}">Return</a></p>` : ""}`));
    }
    throw new StripeError(404, "Not found");
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", base);
    try {
      const body = await readBody(req);
      if (!url.pathname.startsWith("/v1/")) return await html(req.method ?? "GET", url.pathname, res);
      const params = parseForm(req.method === "GET" || req.method === "DELETE" ? url.searchParams : new URLSearchParams(body));
      const result = await api(req.method ?? "GET", url.pathname, params);
      res.writeHead(200, { "content-type": "application/json", "request-id": newId("req") }).end(JSON.stringify(result));
    } catch (err) {
      const status = err instanceof StripeError ? err.status : 500;
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { type: "invalid_request_error", code: status === 404 ? "resource_missing" : undefined, message: String((err as Error).message) } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;

  return {
    url: base,
    /** A Stripe client that talks to this fake. */
    client: () => new Stripe("sk_test_fake", { host: "127.0.0.1", port, protocol: "http", maxNetworkRetries: 0 }),
    customers,
    subscriptions,
    sessions,
    events,
    ...controls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeStripe = Awaited<ReturnType<typeof startFakeStripe>>;
