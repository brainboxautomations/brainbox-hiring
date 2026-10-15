import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "@/utilities/cn";

const fieldBase =
  "w-full rounded-md border border-slate-300 bg-white text-[13px] text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-accent-9 focus:outline-none focus:ring-3 focus:ring-accent-9/20 disabled:bg-slate-50 disabled:text-slate-400 aria-[invalid=true]:border-red-600 aria-[invalid=true]:ring-red-600/15";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "h-8 px-2.5", className)}
      {...props}
    />
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "min-h-19 px-2.5 py-2 leading-relaxed", className)}
      {...props}
    />
  );
});

type LabelProps = {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
};

export function Label({ children, htmlFor, className }: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("mb-1.5 block text-xs font-medium text-slate-700", className)}
    >
      {children}
    </label>
  );
}

type FieldProps = {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
};

export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={className}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="mt-1.5 text-[11px] text-red-700">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
