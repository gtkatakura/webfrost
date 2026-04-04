import type { ButtonHTMLAttributes, CSSProperties } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, CSSProperties> = {
  primary: {
    background: "var(--accent)",
    color: "var(--accent-fg)",
    borderColor: "transparent",
  },
  secondary: {
    background: "var(--bg-overlay)",
    color: "var(--text-high)",
    borderColor: "var(--border-default)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-mid)",
    borderColor: "transparent",
  },
  danger: {
    background: "var(--status-danger)",
    color: "#ffffff",
    borderColor: "transparent",
  },
};

const sizeCls: Record<Size, string> = {
  sm: "py-1 px-3 text-ui-xs",
  md: "py-1.5 px-3.5 text-ui-sm",
  lg: "py-2 px-5 text-ui-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  style,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 font-medium rounded border transition-colors cursor-pointer
        ${sizeCls[size]}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        ${className}`}
      style={{ ...variantStyles[variant], ...style }}
      {...props}
    >
      {children}
    </button>
  );
}
