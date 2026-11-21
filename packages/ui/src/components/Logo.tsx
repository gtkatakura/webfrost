import { useId } from "react";
import mascotUrl from "../assets/mascot.webp";

/** The brand mark: a snowflake inside a hexagon, stroked in the Frost gradient. */
export function Mark({ size = 24 }: { size?: number }) {
  const id = `frost-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id={id} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--frost-from)" />
          <stop offset="1" stopColor="var(--frost-to)" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25Z"
        stroke={`url(#${id})`}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <g stroke={`url(#${id})`} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 9v14M9.94 12.5l12.12 7M9.94 19.5l12.12-7" />
        <path d="M13.9 10.4 16 12.2l2.1-1.8M13.9 21.6 16 19.8l2.1 1.8" />
      </g>
    </svg>
  );
}

/** Mark plus wordmark: "Web" in the text color, "Frost" in the Frost gradient. */
export function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
      <Mark size={size} />
      <span className="text-high">
        Web<span className="text-frost">Frost</span>
      </span>
    </span>
  );
}

/** The arctic fox asleep on a frozen archive box. Decorative: the text next to it says it all. */
export function Mascot({ className = "", width = 240 }: { className?: string; width?: number }) {
  return (
    <img
      src={mascotUrl}
      alt=""
      width={width}
      height={Math.round((width * 205) / 360)}
      loading="lazy"
      decoding="async"
      className={`h-auto max-w-full select-none rounded-2xl border border-border shadow-sm ${className}`}
    />
  );
}
