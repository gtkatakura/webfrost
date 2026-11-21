import { useId } from "react";

/** The mark from the mascot art: a snowflake inside a hexagon, stroked in the Frost gradient. */
export function Mark({ size = 24 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id={`f${id}`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--frost-to)" />
          <stop offset="1" stopColor="var(--frost-from)" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25Z"
        stroke={`url(#f${id})`}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <g stroke={`url(#f${id})`} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 9v14M9.94 12.5l12.12 7M9.94 19.5l12.12-7" />
        <path d="M13.9 10.4 16 12.2l2.1-1.8M13.9 21.6 16 19.8l2.1 1.8" />
        <path d="M10.3 15.1l2.65.95.5 2.7M21.7 16.9l-2.65-.95-.5-2.7" />
        <path d="M10.3 16.9l2.65-.95.5-2.7M21.7 15.1l-2.65.95-.5 2.7" />
      </g>
    </svg>
  );
}

/** The wordmark: "Web" in the text color, "Frost" in the Frost gradient. */
export function Logo({ name: _name }: { name?: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight">
      <Mark />
      <span>
        Web<span className="text-frost">Frost</span>
      </span>
      <span className="font-normal text-fd-muted-foreground">docs</span>
    </span>
  );
}
