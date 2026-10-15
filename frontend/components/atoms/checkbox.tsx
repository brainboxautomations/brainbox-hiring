import { cn } from "@/utilities/cn";
import { CheckIcon } from "@/components/atoms/icons";

type CheckboxVisualProps = {
  checked?: boolean;
  size?: number;
  className?: string;
};

type CheckboxProps = CheckboxVisualProps & {
  onChange?: (checked: boolean) => void;
  "aria-label"?: string;
};

function boxClassName(checked: boolean, className?: string): string {
  return cn(
    "flex shrink-0 items-center justify-center rounded-sm border transition-colors",
    checked
      ? "border-accent-9 bg-accent-9 text-white"
      : "border-slate-300 bg-white hover:border-slate-400",
    className,
  );
}

export function CheckboxIndicator({ checked = false, size = 15, className }: CheckboxVisualProps) {
  return (
    <span
      aria-hidden="true"
      className={boxClassName(checked, className)}
      style={{ width: size, height: size }}
    >
      {checked && <CheckIcon size={Math.round(size * 0.7)} />}
    </span>
  );
}

export function Checkbox({
  checked = false,
  onChange,
  size = 15,
  className,
  ...aria
}: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      onClick={() => onChange?.(!checked)}
      className={boxClassName(checked, className)}
      style={{ width: size, height: size }}
    >
      {checked && <CheckIcon size={Math.round(size * 0.7)} />}
    </button>
  );
}
