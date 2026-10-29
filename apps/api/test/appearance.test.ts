/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomUUID } from "node:crypto";
import { testStorage } from "@hshelby/storage/testing";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { joinAsMember, makeTestApp, ORIGIN, registerDevice, reply, workspaceWithApp } from "./helpers";

const { storage } = await testStorage();
const { app, deps, close } = await makeTestApp({ storage });
afterAll(async () => {
  storage.close();
  await close();
});

type Team = Awaited<ReturnType<typeof workspaceWithApp>>;

const image = (width: number, height: number, format: "png" | "jpeg" | "webp") =>
  sharp({ create: { width, height, channels: 4, background: { r: 255, g: 75, b: 43, alpha: 0.8 } } })[format]().toBuffer();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ff4b2b"/></svg>');

/** Multipart upload with the session cookie (the JSON helper sets a JSON content type). */
const upload = (team: Team, path: string, file: Buffer, filename: string, method = "POST") => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(file)], filename));
  return app.request(path, { method, body: form, headers: { cookie: team.cookie, origin: ORIGIN } });
};

const state = async (team: Team) => (await (await team.call(`/api/apps/${team.appId}/appearance`)).json()) as any;
const saveDraft = (team: Team, document: unknown, baseVersion: number) =>
  team.call(`/api/apps/${team.appId}/appearance/draft`, { method: "PUT", body: JSON.stringify({ document, baseVersion }) });
const publish = (team: Team, draftVersion: number) =>
  team.call(`/api/apps/${team.appId}/appearance/publish`, { method: "POST", body: JSON.stringify({ draftVersion }) });
const publicAppearance = (team: Team, headers: Record<string, string> = {}) => app.request(`/v1/apps/${team.publicId}/appearance`, { headers });

const ORANGE = { colors: { accent: { light: "#FF4B2B", dark: "#FF6A4D" } }, title: { en: "Help", de: "Hilfe" }, fontDesign: "rounded" };

describe("draft and publish", () => {
  it("serves only the published document, never the draft", async () => {
    const team = await workspaceWithApp(app);
    // before anything is published, apps get nothing to apply
    const before = await publicAppearance(team);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ version: 0, appearance: null, team: { showPhotos: false, showNames: false } });

    expect((await saveDraft(team, ORANGE, 0)).status).toBe(200);
    expect(((await (await publicAppearance(team)).json()) as any).appearance).toBeNull();

    expect((await publish(team, 1)).status).toBe(200);
    const published = (await (await publicAppearance(team)).json()) as any;
    expect(published).toMatchObject({ version: 1, appearance: ORANGE });

    // editing the draft again changes nothing for apps until the next publish
    await saveDraft(team, { ...ORANGE, colors: { accent: { light: "#000000" } }, hidesTitle: true }, 1);
    expect(((await (await publicAppearance(team)).json()) as any).appearance).toEqual(ORANGE);
    expect(await state(team)).toMatchObject({ draftVersion: 2, publishedVersion: 1, unpublishedChanges: true });

    // discarding puts the draft back to what's published
    await team.call(`/api/apps/${team.appId}/appearance/discard`, { method: "POST" });
    expect(await state(team)).toMatchObject({ draft: ORANGE, unpublishedChanges: false });
  });

  it("refuses a save or publish that started from an older version", async () => {
    const team = await workspaceWithApp(app);
    expect((await saveDraft(team, ORANGE, 0)).status).toBe(200);
    // a second editor who opened the empty design
    const stale = await saveDraft(team, { fontDesign: "serif" }, 0);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as any).error.code).toBe("appearance_conflict");
    expect((await saveDraft(team, { fontDesign: "serif" }, 5)).status).toBe(409);
    // publishing changes you haven't seen is refused too
    await saveDraft(team, { fontDesign: "serif" }, 1);
    expect((await publish(team, 1)).status).toBe(409);
    expect((await publish(team, 2)).status).toBe(200);
  });

  it("answers 304 to a cached copy and changes the ETag with each publish or team switch", async () => {
    const team = await workspaceWithApp(app);
    await saveDraft(team, ORANGE, 0);
    await publish(team, 1);
    const first = await publicAppearance(team);
    const etag = first.headers.get("etag")!;
    expect(first.headers.get("cache-control")).toBe("public, max-age=60");
    expect((await publicAppearance(team, { "if-none-match": etag })).status).toBe(304);

    await team.call(`/api/apps/${team.appId}/team-display`, { method: "PATCH", body: JSON.stringify({ showNames: true }) });
    const changed = await publicAppearance(team, { "if-none-match": etag });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as any).team).toEqual({ showPhotos: false, showNames: true });
  });

  it("validates documents, and only admins edit", async () => {
    const team = await workspaceWithApp(app);
    expect((await saveDraft(team, { colors: { accent: { light: "red" } } }, 0)).status).toBe(400);
    expect((await saveDraft(team, { fontFamily: "Avenir" }, 0)).status).toBe(400);
    expect((await saveDraft(team, { cards: { iconSize: 40 } }, 0)).status).toBe(400);
    expect((await saveDraft(team, { welcomeIcon: { type: "asset", assetId: randomUUID() } }, 0)).status).toBe(400);
    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call(`/api/apps/${team.appId}/appearance`)).status).toBe(200);
    expect((await member.call(`/api/apps/${team.appId}/appearance/draft`, { method: "PUT", body: JSON.stringify({ document: {}, baseVersion: 0 }) })).status).toBe(403);
  });

  it("is unknown for a deleted app", async () => {
    const team = await workspaceWithApp(app);
    await team.call(`/api/apps/${team.appId}`, { method: "DELETE" });
    expect((await publicAppearance(team)).status).toBe(404);
  });

  it("keeps what the app's SDK reports about its own design", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId);
    const local = { colors: { accent: { light: "#5856D6" } }, welcomeIcon: { type: "bundled" }, title: { en: "Support" } };
    expect((await device.sdk("/v1/device", { method: "PATCH", json: { appearance: local } })).status).toBe(200);
    expect(await state(team)).toMatchObject({ reportedLocal: local, draftVersion: 0 });
  });
});

describe("asset library", () => {
  it("converts uploads to a transparent PNG of at most 512 px", async () => {
    const team = await workspaceWithApp(app);
    const res = await upload(team, "/api/assets", await image(2000, 1000, "jpeg"), "banner.jpg");
    expect(res.status).toBe(201);
    const { asset } = (await res.json()) as any;
    expect(asset).toMatchObject({ name: "banner.jpg", width: 512, height: 256, usedBy: [] });
    const stored = await (await fetch(asset.url)).arrayBuffer();
    const meta = await sharp(Buffer.from(stored)).metadata();
    expect(meta).toMatchObject({ format: "png", width: 512, height: 256 });

    const svg = (await (await upload(team, "/api/assets", SVG, "logo.svg")).json()) as any;
    expect(svg.asset).toMatchObject({ width: 512, height: 512 });
    const small = (await (await upload(team, "/api/assets", await image(64, 32, "webp"), "dot.webp")).json()) as any;
    // bitmaps are never enlarged
    expect(small.asset).toMatchObject({ width: 64, height: 32 });

    const library = (await (await team.call("/api/assets")).json()) as any;
    expect(library.assets).toHaveLength(3);
    expect(library.usedBytes).toBe(library.assets.reduce((n: number, a: any) => n + a.bytes, 0));
    expect(library.quotaBytes).toBe(50 * 1024 * 1024);
  });

  it("refuses what isn't an image, unsafe SVG, and files over 2 MB", async () => {
    const team = await workspaceWithApp(app);
    const code = async (res: Response) => [res.status, ((await res.json()) as any).error.code];
    expect(await code(await upload(team, "/api/assets", Buffer.from("not an image"), "x.png"))).toEqual([422, "invalid_image"]);
    const script = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(await code(await upload(team, "/api/assets", script, "x.svg"))).toEqual([422, "invalid_image"]);
    const external = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>');
    expect(await code(await upload(team, "/api/assets", external, "x.svg"))).toEqual([422, "invalid_image"]);
    expect((await upload(team, "/api/assets", Buffer.alloc(2 * 1024 * 1024 + 10, 1), "big.png")).status).toBe(413);
  });

  it("serves an image publicly only once a published design uses it, and won't delete images in use", async () => {
    const team = await workspaceWithApp(app);
    const { asset } = (await (await upload(team, "/api/assets", await image(100, 100, "png"), "icon.png")).json()) as any;
    const publicImage = () => app.request(`/v1/assets/${asset.id}.png`);

    await saveDraft(team, { welcomeIcon: { type: "asset", assetId: asset.id } }, 0);
    expect((await publicImage()).status).toBe(404);
    const inDraft = await team.call(`/api/assets/${asset.id}`, { method: "DELETE" });
    expect(inDraft.status).toBe(409);
    expect(((await inDraft.json()) as any).error.code).toBe("asset_in_use");
    expect(((await (await team.call("/api/assets")).json()) as any).assets[0].usedBy).toEqual([{ appId: team.appId, appName: expect.any(String) }]);

    await publish(team, 1);
    const served = await publicImage();
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    const { appearance } = (await (await publicAppearance(team)).json()) as any;
    expect(appearance.welcomeIcon).toEqual({ type: "asset", assetId: asset.id, url: `https://api.test/v1/assets/${asset.id}.png` });

    // another workspace can't use it
    const other = await workspaceWithApp(app, "Grace Hopper");
    expect((await saveDraft(other, { closeIcon: { type: "asset", assetId: asset.id } }, 0)).status).toBe(400);

    // out of every design (and published), it can go
    await saveDraft(team, {}, 1);
    await publish(team, 2);
    expect((await team.call(`/api/assets/${asset.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await publicImage()).status).toBe(404);
  });
});

describe("team photos and names", () => {
  it("shows the teammate's first name and photo on replies only when the app turns them on", async () => {
    const team = await workspaceWithApp(app);
    const res = await upload(team, "/api/me/photo", await image(800, 600, "jpeg"), "me.jpg", "PUT");
    expect(res.status).toBe(200);
    const { photoUrl } = (await res.json()) as any;
    expect((await sharp(Buffer.from(await (await fetch(photoUrl)).arrayBuffer())).metadata())).toMatchObject({ width: 256, height: 256, format: "jpeg" });
    expect(((await (await team.call("/api/me")).json()) as any).user.photoUrl).toEqual(expect.any(String));

    const device = await registerDevice(app, team.publicId);
    const { conversation } = (await (await device.send("Hi")).json()) as any;
    await reply(team.call, conversation.id, "Hello!");
    const lastAuthor = async () => ((await (await device.sdk("/v1/conversation")).json()) as any).messages.at(-1).author;

    expect(await lastAuthor()).toBeNull();
    await team.call(`/api/apps/${team.appId}/team-display`, { method: "PATCH", body: JSON.stringify({ showNames: true }) });
    expect(await lastAuthor()).toEqual({ name: "Ada", initial: null, photoUrl: null });
    await team.call(`/api/apps/${team.appId}/team-display`, { method: "PATCH", body: JSON.stringify({ showPhotos: true }) });
    expect(await lastAuthor()).toEqual({ name: "Ada", initial: "A", photoUrl: expect.stringContaining("photo-") });

    // without a photo, the app shows the initial
    expect((await team.call("/api/me/photo", { method: "DELETE" })).status).toBe(204);
    expect(await lastAuthor()).toEqual({ name: "Ada", initial: "A", photoUrl: null });
  });
});
