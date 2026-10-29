"use client";

import type { App, AppearanceDocument, AppearanceImage, AppearanceState, Asset, AssetLibrary, ModeColor } from "@hshelby/contracts";
import { Bubble, ChatScreen, PhoneFrame, TeamBubble, Timestamp } from "@hshelby/ui";
import { ArrowLeftIcon, ChatBubbleIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { secondaryButton, SettingsCard, SwitchRow } from "@/components/settings";
import { AppIcon, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import { isAdmin, useMe } from "@/lib/use-me";

type Doc = AppearanceDocument;
type Mode = "light" | "dark";
type ColorKey = keyof NonNullable<Doc["colors"]>;

const COLORS: { key: ColorKey; label: string; fallback: Record<Mode, string> }[] = [
  { key: "accent", label: "Accent (your messages, buttons)", fallback: { light: "#0088FF", dark: "#0091FF" } },
  { key: "onAccent", label: "Text on accent", fallback: { light: "#FFFFFF", dark: "#FFFFFF" } },
  { key: "chatBackground", label: "Chat background", fallback: { light: "#FFFFFF", dark: "#1C1C1E" } },
  { key: "incomingBackground", label: "Team bubbles", fallback: { light: "#F2F2F7", dark: "#2C2C2E" } },
  { key: "incomingForeground", label: "Text in team bubbles", fallback: { light: "#000000", dark: "#FFFFFF" } },
  { key: "welcomeIcon", label: "Welcome icon", fallback: { light: "#0088FF", dark: "#0091FF" } },
];

const FONTS: Record<NonNullable<Doc["fontDesign"]>, string> = {
  default: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, sans-serif',
  serif: 'ui-serif, "New York", Georgia, serif',
  monospaced: 'ui-monospace, "SF Mono", Menlo, monospace',
};

/** Drops empty objects and undefined values, so "use app default" means the key is absent. */
function prune<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value)
    .map(([k, v]) => [k, prune(v)] as const)
    .filter(([, v]) => v !== undefined && !(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0));
  return Object.fromEntries(entries) as T;
}

/** The app's reported design without what can't be published (bundled images stay in the app). */
function fromLocal(local: Doc | null): Doc {
  if (!local) return {};
  const copy = structuredClone(local) as Record<string, { type?: string }>;
  for (const key of ["welcomeIcon", "closeIcon"]) if (copy[key]?.type === "bundled") delete copy[key];
  return prune(copy as Doc);
}

const field = "h-9 rounded-xl border border-[var(--field)] bg-white px-3 text-[14px] text-fg outline-none focus:border-fg/60";

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div>
        <p className="text-fg">{label}</p>
        {hint && <p className="text-[12px] text-secondary">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function ColorInput({ value, fallback, onChange }: { value: string | undefined; fallback: string; onChange: (v: string | undefined) => void }) {
  return (
    <span className="flex items-center gap-1">
      <input type="color" value={value ?? fallback} onChange={(e) => onChange(e.target.value.toUpperCase())} className={`size-8 rounded-lg ${value ? "" : "opacity-40"}`} />
      {value ? (
        <button type="button" onClick={() => onChange(undefined)} className="text-[12px] text-secondary hover:text-fg" title="Use the app's color">
          ×
        </button>
      ) : (
        <span className="w-[9px]" />
      )}
    </span>
  );
}

function ImagePicker({
  value,
  onChange,
  assets,
  allowHidden,
}: {
  value: AppearanceImage | { type: "hidden" } | undefined;
  onChange: (v: AppearanceImage | { type: "hidden" } | undefined) => void;
  assets: Asset[];
  allowHidden?: boolean;
}) {
  const type = value?.type ?? "";
  return (
    <span className="flex items-center gap-2">
      <select
        value={type}
        onChange={(e) => {
          const t = e.target.value;
          onChange(t === "symbol" ? { type: "symbol", name: "bubble.left.fill" } : t === "asset" && assets[0] ? { type: "asset", assetId: assets[0].id } : t === "hidden" ? { type: "hidden" } : undefined);
        }}
        className={field}
      >
        <option value="">App default</option>
        <option value="symbol">SF Symbol</option>
        <option value="asset" disabled={assets.length === 0}>
          Library image
        </option>
        {allowHidden && <option value="hidden">Hidden</option>}
      </select>
      {value?.type === "symbol" && (
        <input value={value.name} onChange={(e) => onChange({ type: "symbol", name: e.target.value.trim() })} className={`${field} w-44 font-mono text-[12px]`} aria-label="SF Symbol name" />
      )}
      {value?.type === "asset" && (
        <select value={value.assetId} onChange={(e) => onChange({ type: "asset", assetId: e.target.value })} className={`${field} w-44`} aria-label="Library image">
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

/** The chat as the app will draw it with this design, in light or dark mode. */
function Preview({ doc, mode, lang, assets, appName, team }: { doc: Doc; mode: Mode; lang: string; assets: Asset[]; appName: string; team: AppearanceState["team"] }) {
  const color = (key: ColorKey) => doc.colors?.[key]?.[mode] ?? COLORS.find((c) => c.key === key)!.fallback[mode];
  const text = (t: Record<string, string> | undefined, fallback: string) => t?.[lang] ?? t?.[lang.split("-")[0]!] ?? fallback;
  const dark = (doc.colorScheme === "dark" || mode === "dark") && doc.colorScheme !== "light";
  const style = {
    "--website-chat-background": color("chatBackground"),
    "--website-chat-foreground": dark ? "#FFFFFF" : "#000000",
    "--website-chat-secondary": dark ? "#EBEBF599" : "#3C3C4399",
    "--website-chat-incoming": color("incomingBackground"),
    "--website-chat-outgoing": color("accent"),
    "--website-chat-on-outgoing": color("onAccent"),
    "--website-chat-font": FONTS[doc.fontDesign ?? "default"],
  } as CSSProperties;
  const icon = doc.welcomeIcon;
  const iconSize = doc.welcomeIconSize ?? 56;
  const asset = icon?.type === "asset" ? assets.find((a) => a.id === icon.assetId) : undefined;
  const opacityOf = (i: number) => (doc.fadesOlderMessages ? 0.55 + i * 0.15 : 1);
  return (
    <PhoneFrame className="w-[300px] [filter:drop-shadow(0_18px_24px_rgb(0_0_0/14%))]">
      <ChatScreen title={doc.hidesTitle ? "" : text(doc.title, "Support")} style={style} fixed>
        <div className="flex flex-col items-center gap-[2cqw] pb-[4cqw] text-center">
          {icon?.type !== "hidden" && (
            <span
              className="flex items-center justify-center overflow-hidden"
              style={{
                width: `${iconSize / 3.9}cqw`,
                height: `${iconSize / 3.9}cqw`,
                borderRadius: `${(doc.welcomeIconCornerRadius ?? 12) / 3.9}cqw`,
                color: color("welcomeIcon"),
                transform: `translate(${(doc.welcomeIconOffset?.x ?? 0) / 3.9}cqw, ${(doc.welcomeIconOffset?.y ?? 0) / 3.9}cqw)`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed library URL */}
              {asset ? <img src={asset.url} alt="" className="size-full object-contain" /> : <ChatBubbleIcon width="70%" height="70%" />}
            </span>
          )}
          {!doc.hidesWelcomeTitle && <p className="text-[5cqw] font-semibold">{text(doc.welcomeTitle, `${appName} support`)}</p>}
          {!doc.hidesWelcomeText && <p className="px-[6cqw] text-[3.4cqw] text-[var(--website-chat-secondary)]">{text(doc.welcomeText, "Ask us anything. We usually reply within a few hours.")}</p>}
        </div>
        <Timestamp />
        <div style={{ opacity: opacityOf(0) }} className="flex justify-end">
          <Bubble outgoing>My lists stopped syncing</Bubble>
        </div>
        {team.showNames || team.showPhotos ? (
          <TeamBubble name={team.showNames ? "Ada" : ""}>
            <span style={{ color: color("incomingForeground") }}>Pull down on the list to refresh.</span>
          </TeamBubble>
        ) : (
          <Bubble>
            <span style={{ color: color("incomingForeground") }}>Pull down on the list to refresh.</span>
          </Bubble>
        )}
        <div style={{ opacity: opacityOf(2) }} className="flex justify-end">
          <Bubble outgoing>That worked, thanks!</Bubble>
        </div>
      </ChatScreen>
    </PhoneFrame>
  );
}

export default function AppearancePage() {
  const { appId } = useParams<{ appId: string }>();
  const admin = isAdmin(useMe());
  const [app, setApp] = useState<App | null>(null);
  const [state, setState] = useState<AppearanceState | null>(null);
  const [doc, setDoc] = useState<Doc>({});
  const [assets, setAssets] = useState<Asset[]>([]);
  const [lang, setLang] = useState("en");
  const [mode, setMode] = useState<Mode>("light");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const base = `/apps/${appId}/appearance`;

  const fetchAll = () => Promise.all([api<{ app: App }>(`/apps/${appId}`), api<AppearanceState>(base), api<AssetLibrary>("/assets")]);
  function apply([a, s, l]: Awaited<ReturnType<typeof fetchAll>>) {
    setApp(a.app);
    setState(s);
    setDoc(s.draft);
    setAssets(l.assets);
    setConflict(false);
  }
  const load = () => fetchAll().then(apply);
  useEffect(() => {
    fetchAll()
      .then(apply)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the design"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per app
  }, [appId]);

  const update = (next: Doc) => setDoc(prune(next));
  const setColor = (key: ColorKey, m: Mode, value: string | undefined) =>
    update({ ...doc, colors: { ...doc.colors, [key]: { ...doc.colors?.[key], [m]: value } as ModeColor } });
  const setText = (key: "title" | "welcomeTitle" | "welcomeText", value: string) =>
    update({ ...doc, [key]: { ...doc[key], [lang]: value.trim() ? value : undefined } });
  const languages = [...new Set(["en", ...Object.keys(doc.title ?? {}), ...Object.keys(doc.welcomeTitle ?? {}), ...Object.keys(doc.welcomeText ?? {})])];

  async function run(action: () => Promise<AppearanceState>, done: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await action();
      setState(next);
      setDoc(next.draft);
      setNote(done);
    } catch (e) {
      if (e instanceof ApiError && e.code === "appearance_conflict") setConflict(true);
      else setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const save = () => api<AppearanceState>(`${base}/draft`, { method: "PUT", body: JSON.stringify({ document: doc, baseVersion: state!.draftVersion }) });
  const saveDraft = () => run(save, "Draft saved");
  const publish = () =>
    run(async () => {
      const saved = dirty ? await save() : state!;
      return api<AppearanceState>(`${base}/publish`, { method: "POST", body: JSON.stringify({ draftVersion: saved.draftVersion }) });
    }, "Published: apps switch to it the next time their chat opens");
  const discard = () => {
    if (!window.confirm("Discard the draft and go back to what's published?")) return;
    return run(() => api<AppearanceState>(`${base}/discard`, { method: "POST" }), "Draft discarded");
  };
  const setTeam = (body: { showPhotos?: boolean; showNames?: boolean }) =>
    run(() => api<AppearanceState>(`/apps/${appId}/team-display`, { method: "PATCH", body: JSON.stringify(body) }), "Saved");

  if (!state || !app) {
    return (
      <div className="mx-auto max-w-6xl px-5">
        <AppHeader className="h-20" />
        {error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}
      </div>
    );
  }
  const dirty = JSON.stringify(doc) !== JSON.stringify(prune(state.draft));
  const canPublish = dirty || state.unpublishedChanges;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <AppHeader className="h-20" />
      <Link href={`/apps/${appId}/settings`} className="inline-flex items-center gap-1.5 text-[14px] text-secondary hover:text-fg">
        <ArrowLeftIcon /> {app.name} settings
      </Link>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <AppIcon app={app} size={48} />
        <div className="flex-1">
          <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">Chat design</h1>
          <p className="text-[13px] text-secondary">
            {state.publishedAt ? `Version ${state.publishedVersion}, published ${relativeTime(state.publishedAt)}` : "Not published yet: apps use their own design"}
            {canPublish && " · unpublished changes"}
          </p>
        </div>
        {admin && (
          <div className="flex gap-2">
            {state.unpublishedChanges && (
              <button type="button" onClick={discard} disabled={busy} className={secondaryButton}>
                Discard draft
              </button>
            )}
            <button type="button" onClick={saveDraft} disabled={busy || !dirty} className={secondaryButton}>
              Save draft
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={busy || !canPublish}
              className="h-10 rounded-full bg-[var(--accent)] px-5 text-[14px] text-white hover:bg-[var(--accent-hover)] disabled:bg-[var(--accent-disabled)]"
            >
              Publish changes
            </button>
          </div>
        )}
      </div>
      {conflict && (
        <div className="mt-4 rounded-2xl bg-[#fff8e6] px-4 py-3 text-[14px]">
          Someone else changed this design since you opened it.{" "}
          <button type="button" onClick={() => void load()} className="underline underline-offset-2">
            Reload their version
          </button>{" "}
          (your unsaved edits are lost).
        </div>
      )}
      {note && <p className="mt-3 text-[13px] text-[#14773a]">{note}.</p>}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <fieldset disabled={!admin || busy} className="min-w-0 space-y-6 text-[14px]">
          {state.reportedLocal && (
            <p className="rounded-2xl bg-panel px-4 py-3 text-secondary">
              Your app reported its own design {state.reportedAt && relativeTime(state.reportedAt)}.{" "}
              <button type="button" onClick={() => update(fromLocal(state.reportedLocal))} className="text-fg underline underline-offset-2">
                Start from it
              </button>
            </p>
          )}
          <SettingsCard title="Colors">
            <p>Each color can differ in light and dark mode. Unset colors keep the app&apos;s own.</p>
            <div className="divide-y divide-line">
              <div className="flex justify-end gap-6 pb-1 text-[12px] text-secondary">
                <span>Light</span>
                <span className="pr-2">Dark</span>
              </div>
              {COLORS.map((c) => (
                <Row key={c.key} label={c.label}>
                  <ColorInput value={doc.colors?.[c.key]?.light} fallback={c.fallback.light} onChange={(v) => setColor(c.key, "light", v)} />
                  <ColorInput value={doc.colors?.[c.key]?.dark} fallback={c.fallback.dark} onChange={(v) => setColor(c.key, "dark", v)} />
                </Row>
              ))}
              <Row label="Color scheme">
                <select value={doc.colorScheme ?? ""} onChange={(e) => update({ ...doc, colorScheme: (e.target.value || undefined) as Doc["colorScheme"] })} className={field}>
                  <option value="">App default</option>
                  <option value="app">Follow app</option>
                  <option value="light">Always light</option>
                  <option value="dark">Always dark</option>
                </select>
              </Row>
            </div>
          </SettingsCard>

          <SettingsCard title="Text">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-secondary">Language</span>
              {languages.map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} className={`rounded-full px-3 py-1 text-[13px] ${lang === l ? "bg-fg text-white" : "bg-white"}`}>
                  {l}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const tag = window.prompt("Language tag (e.g. de, pt-BR, zh-Hans)")?.trim();
                  if (tag && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag)) setLang(tag);
                }}
                className="rounded-full px-3 py-1 text-[13px] text-secondary hover:text-fg"
              >
                + Language
              </button>
            </div>
            <p>Users see their language, then its base language (pt for pt-BR), then the app&apos;s own text.</p>
            {(
              [
                ["title", "Title", "hidesTitle", 40],
                ["welcomeTitle", "Welcome title", "hidesWelcomeTitle", 80],
                ["welcomeText", "Welcome text", "hidesWelcomeText", 300],
              ] as const
            ).map(([key, label, hideKey, max]) => (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-fg">{label}</span>
                  <label className="flex items-center gap-1.5 text-[13px] text-secondary">
                    <input type="checkbox" checked={doc[hideKey] ?? false} onChange={(e) => update({ ...doc, [hideKey]: e.target.checked || undefined })} />
                    Hide
                  </label>
                </div>
                <input value={doc[key]?.[lang] ?? ""} onChange={(e) => setText(key, e.target.value)} maxLength={max} placeholder="App default" className={`${field} w-full`} />
              </div>
            ))}
          </SettingsCard>

          <SettingsCard title="Welcome icon, font and buttons">
            <div className="divide-y divide-line">
              <Row label="Welcome icon">
                <ImagePicker value={doc.welcomeIcon} onChange={(welcomeIcon) => update({ ...doc, welcomeIcon })} assets={assets} allowHidden />
              </Row>
              {(
                [
                  ["welcomeIconSize", "Icon size (pt)", 16, 120],
                  ["welcomeIconCornerRadius", "Icon corner radius (pt)", 0, 60],
                ] as const
              ).map(([key, label, min, max]) => (
                <Row key={key} label={label}>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={doc[key] ?? ""}
                    placeholder="Default"
                    onChange={(e) => update({ ...doc, [key]: e.target.value === "" ? undefined : Math.min(max, Math.max(min, Number(e.target.value))) })}
                    className={`${field} w-24`}
                  />
                </Row>
              ))}
              <Row label="Font design" hint="The font family itself ships with the app.">
                <select value={doc.fontDesign ?? ""} onChange={(e) => update({ ...doc, fontDesign: (e.target.value || undefined) as Doc["fontDesign"] })} className={field}>
                  <option value="">App default</option>
                  <option value="default">System</option>
                  <option value="rounded">Rounded</option>
                  <option value="serif">Serif</option>
                  <option value="monospaced">Monospaced</option>
                </select>
              </Row>
              <Row label="Close button">
                <select
                  value={doc.showsCloseButton === undefined ? "" : String(doc.showsCloseButton)}
                  onChange={(e) => update({ ...doc, showsCloseButton: e.target.value === "" ? undefined : e.target.value === "true" })}
                  className={field}
                >
                  <option value="">App default</option>
                  <option value="true">Show</option>
                  <option value="false">Hide</option>
                </select>
              </Row>
              <Row label="Close icon">
                <ImagePicker value={doc.closeIcon} onChange={(closeIcon) => update({ ...doc, closeIcon: closeIcon as AppearanceImage | undefined })} assets={assets} />
              </Row>
              <Row label="Fade older messages">
                <input type="checkbox" checked={doc.fadesOlderMessages ?? false} onChange={(e) => update({ ...doc, fadesOlderMessages: e.target.checked || undefined })} />
              </Row>
            </div>
          </SettingsCard>

          <SettingsCard title="Review and offer cards">
            <div className="divide-y divide-line">
              <Row label="Button icon">
                <ImagePicker value={doc.cards?.buttonIcon} onChange={(buttonIcon) => update({ ...doc, cards: { ...doc.cards, buttonIcon: buttonIcon as AppearanceImage | undefined } })} assets={assets} />
              </Row>
              <Row label="Trailing icon">
                <ImagePicker value={doc.cards?.trailingIcon} onChange={(trailingIcon) => update({ ...doc, cards: { ...doc.cards, trailingIcon } })} assets={assets} allowHidden />
              </Row>
              <Row label="Icon size (8–28 pt)">
                <input
                  type="number"
                  min={8}
                  max={28}
                  value={doc.cards?.iconSize ?? ""}
                  placeholder="Default"
                  onChange={(e) => update({ ...doc, cards: { ...doc.cards, iconSize: e.target.value === "" ? undefined : Math.min(28, Math.max(8, Number(e.target.value))) } })}
                  className={`${field} w-24`}
                />
              </Row>
              {(
                [
                  ["buttonColor", "Button color", "#0088FF"],
                  ["buttonTextColor", "Button text", "#FFFFFF"],
                ] as const
              ).map(([key, label, fallback]) => (
                <Row key={key} label={label}>
                  {(["light", "dark"] as const).map((m) => (
                    <ColorInput
                      key={m}
                      value={doc.cards?.[key]?.[m]}
                      fallback={fallback}
                      onChange={(v) => update({ ...doc, cards: { ...doc.cards, [key]: { ...doc.cards?.[key], [m]: v } as ModeColor } })}
                    />
                  ))}
                </Row>
              ))}
            </div>
          </SettingsCard>

          <SettingsCard title="Team photos and names">
            <p>These apply right away, without publishing.</p>
            <SwitchRow
              label="Show team photos"
              description="Your photo beside your last reply in a group (your initial without one). Set your photo on your account page."
              checked={state.team.showPhotos}
              onChange={(showPhotos) => setTeam({ showPhotos })}
              disabled={!admin || busy}
            />
            <SwitchRow
              label="Show team names"
              description="Your first name above a group of your replies."
              checked={state.team.showNames}
              onChange={(showNames) => setTeam({ showNames })}
              disabled={!admin || busy}
            />
          </SettingsCard>
        </fieldset>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex justify-center gap-1">
            {(["light", "dark"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full px-3 py-1 text-[13px] ${mode === m ? "bg-fg text-white" : "bg-panel"}`}>
                {m === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
          <div className="flex justify-center">
            <Preview doc={doc} mode={mode} lang={lang} assets={assets} appName={app.name} team={state.team} />
          </div>
          <p className="mt-3 text-center text-[12px] text-secondary">
            Preview of {dirty ? "your unsaved edits" : "the draft"}.{" "}
            <Link href="/assets" className="underline underline-offset-2">
              Asset library
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
