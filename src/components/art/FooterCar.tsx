/* Stands in for footer-{gold,orange}-car(-lights).webp: a car hood with a chrome
   "reception" badge whose headlights blink on the original's `car-lights` cycle. */

function Headlight({ lit }: { lit?: boolean }) {
  return (
    <span
      className={`relative block aspect-[1.35] w-[32%] rounded-[10%] border-[.6cqw] border-[#2a2418] ${
        lit
          ? "bg-[radial-gradient(circle_at_50%_45%,#fffbe8_0%,#ffe7a0_32%,#f2b84b_62%,#8a5a12_100%)] shadow-[0_0_8cqw_3cqw_#ffd77a99]"
          : "bg-[radial-gradient(circle_at_50%_40%,#f3eedf_0%,#c9bfa4_45%,#6f6450_100%)]"
      }`}
    >
      <span className="absolute inset-[12%] rounded-[8%] bg-[repeating-linear-gradient(100deg,#ffffff26_0_2px,transparent_2px_9px)]" />
    </span>
  );
}

function Car({ lit = false }: { lit?: boolean }) {
  return (
    <div className="absolute inset-0 [container-type:inline-size]">
      <div className="absolute inset-0 bg-[linear-gradient(170deg,var(--car-hi)_0%,var(--car-mid)_38%,var(--car-lo)_58%,#120d05_64%,#050505_100%)]" />
      <div className="absolute left-[-10%] top-[8%] h-[40%] w-[90%] rotate-[-14deg] rounded-[50%] bg-[radial-gradient(closest-side,#ffffff59,transparent)]" />
      <span className="absolute right-[13%] top-[19%] rotate-[8deg] bg-[linear-gradient(180deg,#fff_0%,#a1a1a6_45%,#f5f5f7_55%,#6e6e73_100%)] bg-clip-text font-[Georgia,serif] text-[9cqw] font-bold italic tracking-[-.02em] text-transparent [filter:drop-shadow(0_.4cqw_.3cqw_#00000080)]">
        reception
      </span>
      <div className="absolute left-[6%] top-[51%] flex w-[64%] rotate-[-6deg] justify-between">
        <Headlight lit={lit} />
        <Headlight lit={lit} />
      </div>
    </div>
  );
}

export function FooterCar() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 -z-20 [--car-hi:#e6c35a] [--car-mid:#b8901f] [--car-lo:#6e520c] group-data-[theme=dark]/landing:[--car-hi:#ff9a4d] group-data-[theme=dark]/landing:[--car-mid:#e0611c] group-data-[theme=dark]/landing:[--car-lo:#7a2e06]"
    >
      <Car />
      <div className="absolute inset-0 animate-[car-lights_9s_ease-in-out_infinite] opacity-0 motion-reduce:hidden">
        <Car lit />
      </div>
    </div>
  );
}
