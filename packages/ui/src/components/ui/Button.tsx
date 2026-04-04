import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const variantCls: Record<Variant, string> = {
  primary: "bg-primary text-white hover:opacity-90 border-transparent",
  secondary:
    "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 border-transparent",
  danger: "bg-red-600 text-white hover:bg-red-700 border-transparent",
  ghost:
    "bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border-gray-300 dark:border-gray-600",
};

const sizeCls: Record<Size, string> = {
  sm: "py-1 px-3 text-xs",
  md: "py-2 px-4 text-sm",
  lg: "py-2.5 px-6 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 font-semibold rounded border transition-colors cursor-pointer
        ${variantCls[variant]} ${sizeCls[size]}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
