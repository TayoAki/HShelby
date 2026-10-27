import { CheckIcon, StarFilledIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { AppIcon, showcaseApps } from "@/components/art/Avatars";

const sectionShell = "flex min-h-svh flex-col justify-center py-[calc(var(--landing-section-gap)/2)]";

function Card({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      className={`relative flex flex-col justify-between gap-8 overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] p-5 transition-transform duration-500 ease-out hover:-translate-y-1 motion-reduce:transition-none min-[400px]:p-7 sm:p-10 ${className}`}
    >
      {children}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[clamp(38px,11vw,44px)] leading-none tracking-[-.055em] sm:text-[clamp(44px,5vw,76px)]">{value}</p>
      <p className="mt-2 text-sm text-[var(--landing-secondary)] sm:text-[15px]">{label}</p>
    </div>
  );
}

const bars = [28, 38, 34, 52, 60, 78, 100];

export function StatsProof() {
  return (
    <section className={sectionShell}>
      <h2 className="mb-[var(--landing-heading-gap)] text-center text-[clamp(34px,4vw,60px)] leading-[1.12]">
        don&apos;t take our word
        <span className="block text-[var(--landing-secondary)]">take theirs</span>
      </h2>
      <div className="grid grid-cols-2 gap-[var(--landing-card-gap)] lg:grid-cols-3 lg:grid-rows-2">
        <Card className="col-span-2 min-h-[300px] sm:min-h-[380px] lg:col-span-1 lg:row-span-2">
          <div className="grid grid-cols-[repeat(6,minmax(0,38px))] gap-3">
            {showcaseApps.map((app) => (
              <button
                key={app.name}
                type="button"
                aria-label={app.label}
                title={app.name}
                className="relative aspect-square w-full cursor-pointer rounded-[22%] transition-[scale] duration-[160ms] ease-[cubic-bezier(.19,1,.22,1)] hover:scale-[1.08] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-foreground)]"
              >
                <AppIcon app={app} className="size-full" />
              </button>
            ))}
          </div>
          <h3 className="text-[clamp(32px,3.1vw,46px)] leading-[1.08] tracking-[-.045em]">
            39 apps
            <span className="block text-[var(--landing-secondary)]">use reception</span>
          </h3>
        </Card>
        <Card className="col-span-2 min-h-[220px] sm:min-h-[260px]">
          <span className="flex w-fit rounded-full bg-[image:var(--pill-3d-rim)] p-[1.5px] shadow-[var(--pill-3d-depth)]">
            <span className="flex items-center gap-2 rounded-full bg-[image:var(--pill-3d-surface)] px-4 py-2 text-[13px] text-[var(--landing-foreground)] shadow-[var(--pill-3d-light)]">
              <CheckIcon aria-hidden="true" className="text-[var(--stat-green)]" />
              Issue resolved
            </span>
          </span>
          <Stat value="2,456" label="issues resolved" />
        </Card>
        <Card className="min-h-[200px] sm:min-h-[260px]">
          <span aria-hidden="true" className="flex gap-1 text-[var(--stat-yellow)] [&>svg]:size-[18px] min-[400px]:[&>svg]:size-[22px]">
            {Array.from({ length: 5 }, (_, i) => (
              <StarFilledIcon key={i} />
            ))}
          </span>
          <Stat value="563" label="extra reviews" />
        </Card>
        <Card className="min-h-[200px] sm:min-h-[260px]">
          <span aria-hidden="true" className="flex h-16 items-end gap-1.5">
            {bars.map((h, i) => (
              <span
                key={i}
                className="w-3 rounded-full bg-[var(--stat-green)]"
                style={{ height: `${h}%`, opacity: 0.35 + i * 0.1 }}
              />
            ))}
          </span>
          <Stat value="$7.9k" label="additional revenue" />
        </Card>
      </div>
    </section>
  );
}
