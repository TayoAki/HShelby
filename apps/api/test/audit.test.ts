/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { afterAll, describe, expect, it } from "vitest";
import { joinAsMember, makeTestApp, ORIGIN, registerDevice, workspaceWithApp, type TeamCall } from "./helpers";

const { app, deps, close } = await makeTestApp();
afterAll(close);

const log = async (call: TeamCall, query = "") =>
  (await (await call(`/api/audit${query}`)).json()) as any;

describe("audit log", () => {
  it("lists the workspace's changes newest first, with who did them and to what, a page at a time", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId, { identity: { name: "Alex Rivera" } });
    const deviceId = JSON.parse(Buffer.from(device.session.accessToken.split(".")[1], "base64url").toString()).sub as string;

    await team.call(`/api/devices/${deviceId}/block`, { method: "POST" });
    const automation = await team.call(`/api/apps/${team.appId}/automations`, {
      method: "POST",
      body: JSON.stringify({ name: "Win back", enabled: false, trigger: { event: "paywall_declined" }, steps: [{ type: "message", text: "Hi" }] }),
    });
    expect(automation.status).toBe(201);
    const invite = await team.call("/api/auth/organization/invite-member", {
      method: "POST",
      headers: { origin: ORIGIN },
      body: JSON.stringify({ email: "grace@example.com", role: "member" }),
    });
    expect(invite.status).toBe(200);

    const { events, nextCursor } = await log(team.call);
    expect(nextCursor).toBeNull();
    expect(events.map((e: any) => [e.action, e.target?.label ?? null])).toEqual([
      ["invitation.created", null],
      ["automation.created", "Ada Lovelace's app"],
      ["device.blocked", "Alex Rivera"],
    ]);
    expect(events[0]).toMatchObject({ actor: { name: "Ada Lovelace" }, metadata: { email: "grace@example.com", role: "member" } });
    expect(events[1].metadata).toMatchObject({ name: "Win back" });

    const first = await log(team.call, "?limit=2");
    expect(first.events).toHaveLength(2);
    const second = await log(team.call, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.events.map((e: any) => e.action)).toEqual(["device.blocked"]);
    expect(second.nextCursor).toBeNull();
    expect((await team.call("/api/audit?cursor=nonsense")).status).toBe(400);

    // members can't read it; other workspaces see only their own
    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call("/api/audit")).status).toBe(403);
    const other = await workspaceWithApp(app, "Grace Hopper");
    expect((await log(other.call)).events).toEqual([]);
  });
});
