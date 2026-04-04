import type { HTMLAttributes } from "react";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "pending" | "accent";

const variantStyles: Record<BadgeVariant, { background: string; color: string; border: string }> = {
  default: {
    background: "var(--bg-overlay)",
    color: "var(--text-mid)",
    border: "var(--border-default)",
  },
  success: {
    background: "color-mix(in srgb, var(--status-success) 15%, transparent)",
    color: "var(--status-success)",
    border: "color-mix(in srgb, var(--status-success) 30%, transparent)",
  },
  warning: {
    background: "color-mix(in srgb, var(--status-warning) 15%, transparent)",
    color: "var(--status-warning)",
    border: "color-mix(in srgb, var(--status-warning) 30%, transparent)",
  },
  danger: {
    background: "color-mix(in srgb, var(--status-danger) 15%, transparent)",
    color: "var(--status-danger)",
    border: "color-mix(in srgb, var(--status-danger) 30%, transparent)",
  },
  pending: {
    background: "var(--bg-overlay)",
    color: "var(--status-pending)",
    border: "var(--border-default)",
  },
  accent: {
    background: "color-mix(in srgb, var(--accent) 15%, transparent)",
    color: "var(--accent)",
    border: "color-mix(in srgb, var(--accent) 30%, transparent)",
  },
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  variant = "default",
  className = "",
  style,
  children,
  ...props
}: BadgeProps) {
  const s = variantStyles[variant];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium border text-ui-xs ${className}`}
      style={{
        background: s.background,
        color: s.color,
        borderColor: s.border,
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}
