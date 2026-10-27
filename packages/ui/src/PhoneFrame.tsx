import type { CSSProperties, ReactNode } from "react";

/**
 * CSS-drawn iPhone (stands in for reception's `iphone-17-pro-silver.png`).
 * Geometry matches the original overlay: bezel at 4.3% / 1.5%, screen at 5.33% / 2.5%.
 * The screen is an inline-size container, so children size themselves in `cqw`.
 */
export function PhoneFrame({
  children,
  className = "",
  screenClassName = "",
  style,
}: {
  children?: ReactNode;
  className?: string;
  screenClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`relative aspect-[450/920] ${className}`} style={style}>
      <span aria-hidden="true" className="absolute left-[2.6%] top-[18%] h-[3.6%] w-[1.6%] rounded-l-sm bg-[linear-gradient(90deg,#8e8e93,#d8d8dc)]" />
      <span aria-hidden="true" className="absolute left-[2.6%] top-[24%] h-[6.2%] w-[1.6%] rounded-l-sm bg-[linear-gradient(90deg,#8e8e93,#d8d8dc)]" />
      <span aria-hidden="true" className="absolute left-[2.6%] top-[31.5%] h-[6.2%] w-[1.6%] rounded-l-sm bg-[linear-gradient(90deg,#8e8e93,#d8d8dc)]" />
      <span aria-hidden="true" className="absolute right-[2.6%] top-[26%] h-[9.6%] w-[1.6%] rounded-r-sm bg-[linear-gradient(270deg,#8e8e93,#d8d8dc)]" />
      <span
        aria-hidden="true"
        className="absolute inset-x-[3.5%] inset-y-[1.1%] rounded-[21%/10.2%] bg-[linear-gradient(135deg,#f1f1f3_0%,#a9a9ae_28%,#ececef_52%,#9d9da2_78%,#dcdce0_100%)] shadow-[inset_0_0_0_1px_#00000014]"
      />
      <span aria-hidden="true" className="absolute inset-x-[4.3%] inset-y-[1.5%] rounded-[19.7%/9.1%] bg-black" />
      <div
        className={`absolute inset-x-[5.33%] inset-y-[2.5%] isolate overflow-hidden rounded-[14%/6.4%] bg-black [container-type:inline-size] ${screenClassName}`}
      >
        {children}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[3cqw] z-50 h-[8.6cqw] w-[30cqw] -translate-x-1/2 rounded-full bg-black"
        />
      </div>
    </div>
  );
}
