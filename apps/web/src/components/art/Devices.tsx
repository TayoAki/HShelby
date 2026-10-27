import type { ReactNode } from "react";

/** External display (bezel + stand), standing in for `mac-display-stand-generated.webp`. */
export function DisplayStand() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[calc(100%-4px)] w-[35%] -translate-x-1/2 [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]">
      <div className="mx-auto h-[1.4cqw] w-[30%] bg-[linear-gradient(#c8c8cd,#a1a1a6)]" />
      <div className="mx-auto aspect-[1416/1111] w-full [clip-path:polygon(28%_0,72%_0,100%_100%,0_100%)] bg-[linear-gradient(180deg,#d9d9dd,#b9b9bd_45%,#e8e8eb)]" />
    </div>
  );
}

/** Laptop outline used in the retention scene (stands in for `macbook-neo-silver.webp`). */
export function Laptop({ children }: { children: ReactNode }) {
  return (
    <div className="relative aspect-[2000/1220] [container-type:inline-size]">
      <div className="absolute left-[8.6%] top-[2.6%] h-[86.6%] w-[82.8%] rounded-t-[2.2cqw] bg-[#1c1c1e] shadow-[inset_0_0_0_.25cqw_#b9b9bd]" />
      <div className="absolute left-[9.763%] top-[4.441%] h-[82.566%] w-[80.508%] overflow-hidden rounded-t-[1.04cqw] bg-[var(--preview-white)] [container-type:inline-size]">
        {children}
      </div>
      <div className="absolute bottom-[4%] left-0 h-[4%] w-full rounded-b-[3cqw] bg-[linear-gradient(#e4e4e7,#b9b9bd_60%,#8e8e93)] shadow-[0_2cqw_3cqw_-1cqw_#0000003d]" />
      <div className="absolute bottom-[6.6%] left-1/2 h-[1.4%] w-[14%] -translate-x-1/2 rounded-b-[1cqw] bg-[#a1a1a6]" />
    </div>
  );
}

const homeApps = [
  { label: "Health", glyph: "❤️", bg: "#fff" },
  { label: "Wallet", glyph: "💳", bg: "#1c1c1e" },
  { label: "Calendar", glyph: "20", bg: "#fff", ink: "#1c1c1e" },
  { label: "Photos", glyph: "🌸", bg: "#fff" },
  { label: "Settings", glyph: "⚙️", bg: "linear-gradient(#a1a1a6,#6e6e73)" },
  { label: "Maps", glyph: "🧭", bg: "linear-gradient(135deg,#9be59b,#f6e58d)" },
  { label: "Reminders", glyph: "☑️", bg: "#fff" },
  { label: "News", glyph: "📰", bg: "#fff" },
];

/** iOS home screen (stands in for `ios-home-screen.png`). */
export function HomeScreen() {
  return (
    <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(120%_80%_at_80%_10%,#7fb4ff_0%,#2f6fe0_38%,#0b2a7a_75%,#061641_100%)]">
      <div className="flex h-[13cqw] items-center justify-between px-[9cqw] pt-[1cqw] text-[3.8cqw] font-semibold text-white">
        <span>09:41</span>
        <span className="text-[3cqw]">●●● ◔ ▮</span>
      </div>
      <div className="mt-[9cqw] grid grid-cols-4 gap-x-[5cqw] gap-y-[4cqw] px-[6cqw]">
        {homeApps.map((app) => (
          <div key={app.label} className="flex flex-col items-center gap-[1.2cqw]">
            <span
              className="flex aspect-square w-full items-center justify-center rounded-[22%] text-[8cqw] font-semibold shadow-[0_1cqw_2cqw_#0000002e]"
              style={{ background: app.bg, color: app.ink }}
            >
              {app.glyph}
            </span>
            <span className="text-[2.6cqw] text-white/90">{app.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-[5cqw] grid grid-cols-2 gap-[5cqw] px-[6cqw]">
        <span className="aspect-square rounded-[5cqw] bg-[linear-gradient(160deg,#9fd3ff,#5aa9e6)]" />
        <span className="flex aspect-square flex-col rounded-[5cqw] bg-white p-[3cqw] text-[#1c1c1e]">
          <span className="text-[2.8cqw] font-semibold text-[#ff3b30]">SUNDAY</span>
          <span className="text-[9cqw] leading-none">20</span>
        </span>
      </div>
    </div>
  );
}
