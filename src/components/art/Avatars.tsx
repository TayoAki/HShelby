/* Placeholder avatars and app icons. The original uses real founder photos and
   customer app icons; this clone draws neutral stand-ins instead (SITE_SPEC.md §7). */

const founderGradients: Record<string, string> = {
  Andi: "linear-gradient(150deg,#f7b267,#d9603b)",
  Frederick: "linear-gradient(150deg,#7aa7d9,#3d5a80)",
};

export function Avatar({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none text-white ${className}`}
      style={{ background: founderGradients[name] ?? "linear-gradient(#a9adb6,#868a93)" }}
    >
      {name[0]}
    </span>
  );
}

export type ShowcaseApp = {
  name: string;
  label: string;
  stealth?: boolean;
  glyph: string;
  background: string;
  ink?: string;
};

export const showcaseApps: ShowcaseApp[] = [
  { name: "Clucky", label: "Clucky links", glyph: "🐓", background: "linear-gradient(160deg,#fff,#f1efe9)" },
  { name: "75 Days: Her Challenge", label: "75 Days links", glyph: "75", background: "#fff", ink: "#8e8e93" },
  { name: "Calorie Tracker", label: "Calorie Tracker, in stealth", glyph: "C", stealth: true, background: "" },
  { name: "Aesty", label: "Aesty links", glyph: "æ", background: "linear-gradient(160deg,#e9e3d6,#cfc6b4)", ink: "#6f6656" },
  { name: "StepKey", label: "StepKey links", glyph: "🔓", background: "linear-gradient(160deg,#36b3f5,#0a84d6)" },
  { name: "Acadeller Spark", label: "Acadeller Spark links", glyph: "🐥", background: "linear-gradient(160deg,#fff6c9,#ffd84d)" },
  { name: "Peptide App", label: "Peptide App, in stealth", glyph: "P", stealth: true, background: "" },
  { name: "Loomi", label: "Loomi links", glyph: "🫶", background: "linear-gradient(160deg,#c7b4ff,#8b6cf0)" },
  { name: "ekto", label: "ekto links", glyph: "e", background: "linear-gradient(160deg,#2f7bff,#0b4fd1)", ink: "#fff" },
  { name: "Superlife", label: "Superlife links", glyph: "🧘", background: "linear-gradient(160deg,#2a2a2e,#0d0d0f)" },
  { name: "Marker", label: "Marker links", glyph: "■", background: "#111", ink: "#ff453a" },
  { name: "Grove", label: "Grove links", glyph: "🌳", background: "linear-gradient(180deg,#bfe6ff,#9ad08a)" },
];

export function AppIcon({ app, className = "", radius = "22%" }: { app: ShowcaseApp; className?: string; radius?: string }) {
  if (app.stealth) {
    return (
      <span
        aria-hidden="true"
        className={`@container flex items-center justify-center overflow-hidden bg-[image:var(--stealth-icon-surface)] shadow-[var(--stealth-icon-edge)] ${className}`}
        style={{ borderRadius: radius }}
      >
        <span className="text-[62cqw] font-semibold leading-none text-[var(--stealth-icon-ink)] blur-[7cqw]">{app.glyph}</span>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`@container flex items-center justify-center overflow-hidden outline outline-1 -outline-offset-1 outline-black/5 ${className}`}
      style={{ background: app.background, borderRadius: radius }}
    >
      <span className="text-[56cqw] font-semibold leading-none tracking-[-.04em]" style={{ color: app.ink }}>
        {app.glyph}
      </span>
    </span>
  );
}

export const appByName = (name: string) => showcaseApps.find((a) => a.name === name) ?? showcaseApps[0];
