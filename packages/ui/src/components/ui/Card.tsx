import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Remove default padding */
  noPadding?: boolean;
}

export function Card({ noPadding, className = "", style, children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-lg border ${noPadding ? "" : "p-4"} ${className}`}
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--border-default)",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 border-b ${className}`}
      style={{ borderColor: "var(--border-default)" }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={`text-ui-sm font-semibold m-0 ${className}`}
      style={{ color: "var(--text-high)" }}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardBody({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-4 ${className}`} {...props}>
      {children}
    </div>
  );
}
