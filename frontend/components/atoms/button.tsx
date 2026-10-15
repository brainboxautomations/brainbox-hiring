import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/utilities/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "reject";
type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
};

// `active:scale` gives every button an instant, visible press, so a click reads
// as registered even before any spinner or navigation has had time to appear.
// Disabled buttons (including loading ones) stay still.
const base =
  "inline-flex items-center justify-center gap-1.75 rounded-md font-medium whitespace-nowrap transition-[color,background-color,border-color,opacity,transform] duration-100 active:scale-[0.97] disabled:active:scale-100 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-9/40";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent-9 text-white hover:bg-accent-10 disabled:opacity-60",
  secondary:
    "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-60",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 disabled:opacity-50",
  reject: "bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-60",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.75 text-xs",
  md: "h-8 px-3.5 text-[13px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading,
    leadingIcon,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {loading && (
        <span className="inline-block h-3.25 w-3.25 animate-[ds-spin_0.7s_linear_infinite] rounded-full border-2 border-current/30 border-t-current" />
      )}
      {!loading && leadingIcon}
      {children}
    </button>
  );
});
