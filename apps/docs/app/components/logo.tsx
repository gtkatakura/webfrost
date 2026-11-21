/** The mark: a snowflake (frost) inside a page frame (the archive). Drawn in the accent color. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-fd-primary"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M12 7v10M7.7 9.5l8.6 5M7.7 14.5l8.6-5" />
      <path d="M10.5 7.6 12 9l1.5-1.4M10.5 16.4 12 15l1.5 1.4" />
    </svg>
  );
}

export function Logo({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
      <Mark />
      <span>{name}</span>
      <span className="font-normal text-fd-muted-foreground">docs</span>
    </span>
  );
}
