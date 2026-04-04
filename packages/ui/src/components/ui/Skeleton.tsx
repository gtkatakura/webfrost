import type { HTMLAttributes } from "react";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ width, height, className = "", style, ...props }: SkeletonProps) {
  return (
    <div
      className={`rounded animate-pulse ${className}`}
      style={{
        background: "var(--bg-overlay)",
        width,
        height: height ?? "1em",
        ...style,
      }}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonText({
  lines = 1,
  className = "",
}: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          key={i}
          height={12}
          style={{ width: i === lines - 1 && lines > 1 ? "65%" : "100%" }}
        />
      ))}
    </div>
  );
}
