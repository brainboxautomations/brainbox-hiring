import { cn } from "@/utilities/cn";

export type AvatarColor = "accent" | "green" | "amber" | "red" | "slate";

const colorStyles: Record<AvatarColor, string> = {
  accent: "bg-accent-3 text-accent-10",
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  slate: "bg-slate-100 text-slate-600",
};

const palette: AvatarColor[] = ["accent", "green", "amber", "red", "slate"];

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1]!;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

function colorFor(name: string): AvatarColor {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length]!;
}

type AvatarProps = {
  name: string;
  size?: number;
  color?: AvatarColor;
  className?: string;
};

export function Avatar({ name, size = 28, color, className }: AvatarProps) {
  const resolved = color ?? colorFor(name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        colorStyles[resolved],
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
    >
      {initialsFrom(name)}
    </span>
  );
}
