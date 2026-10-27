export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-[.16em] leading-none tracking-[-.05em] ${className}`}>
      <span aria-hidden="true" className="inline-block size-[1ex] shrink-0 rounded-full bg-[var(--brand-mark)]" />
      reception
    </span>
  );
}
