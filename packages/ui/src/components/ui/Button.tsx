import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantCls: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg border-transparent hover:bg-accent-hover",
  secondary: "bg-overlay text-high border-border hover:bg-subtle hover:border-border-strong",
  ghost: "bg-transparent text-mid border-transparent hover:bg-subtle hover:text-high",
  danger: "bg-danger text-danger-fg border-transparent hover:opacity-90",
};

// Fixed heights so a button and a field (2rem, or 2.25rem with field-lg) line up in a row.
const sizeCls: Record<Size, string> = {
  sm: "h-7 px-2.5 text-ui-xs",
  md: "h-8 px-3 text-ui-sm",
  lg: "h-9 px-4 text-ui-base",
};

/** Class string for anything that should look like a button (a Link, for instance). */
export function buttonClasses(variant: Variant = "primary", size: Size = "md"): string {
  return `inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium rounded-md border no-underline transition-colors hover:no-underline disabled:opacity-50 disabled:cursor-not-allowed ${sizeCls[size]} ${variantCls[variant]}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={`${buttonClasses(variant, size)} ${className}`} {...props} />
  );
}
