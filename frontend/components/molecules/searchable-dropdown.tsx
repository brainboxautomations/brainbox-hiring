"use client";

import { useId, useRef, useState } from "react";

import { cn } from "@/utilities/cn";
import { ChevronDownIcon, CheckIcon } from "@/components/atoms/icons";
import { FloatingMenu } from "@/components/molecules/floating-menu";

export type SearchableDropdownOption = { label: string; value: string };

type SearchableDropdownProps = {
  options: string[] | SearchableDropdownOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
};

function normalizeOptions(
  options: string[] | SearchableDropdownOption[],
): SearchableDropdownOption[] {
  return options.map((option) =>
    typeof option === "string" ? { label: option, value: option } : option,
  );
}

export function SearchableDropdown({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No results",
  disabled,
  invalid,
  className,
  id,
  "aria-label": ariaLabel,
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const listboxId = useId();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const normalized = normalizeOptions(options);
  const filtered = normalized.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selected = normalized.find((option) => option.value === value) ?? null;

  function openDropdown() {
    if (disabled || open) return;
    setOpen(true);
    setQuery("");
    const selectedIndex = normalized.findIndex((option) => option.value === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : normalized.length > 0 ? 0 : -1);
  }

  function close() {
    setOpen(false);
    setQuery("");
    setHighlightedIndex(-1);
  }

  function select(option: SearchableDropdownOption) {
    onChange(option.value);
    close();
    inputRef.current?.focus();
  }

  function highlight(index: number) {
    setHighlightedIndex(index);
    const node = listRef.current?.children[index] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }

  function onQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const nextQuery = e.target.value;
    setQuery(nextQuery);
    if (!open) setOpen(true);
    const nextFiltered = normalized.filter((option) =>
      option.label.toLowerCase().includes(nextQuery.trim().toLowerCase()),
    );
    setHighlightedIndex(nextFiltered.length > 0 ? 0 : -1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openDropdown();
      highlight(Math.min(highlightedIndex + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openDropdown();
      highlight(Math.max(highlightedIndex - 1, 0));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const option = filtered[highlightedIndex];
      if (option) select(option);
    } else if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  }

  const displayValue = open ? query : (selected?.label ?? "");

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        data-invalid={invalid || undefined}
        disabled={disabled}
        value={displayValue}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={onQueryChange}
        onKeyDown={onKeyDown}
        placeholder={open ? searchPlaceholder : placeholder}
        autoComplete="off"
        className={cn(
          "h-8 w-full rounded-md border border-slate-300 bg-white pl-2.5 pr-8 text-[13px] text-slate-900 transition-shadow placeholder:text-slate-400 focus:border-accent-9 focus:outline-none focus:ring-3 focus:ring-accent-9/20 disabled:bg-slate-50 disabled:text-slate-400 data-[invalid=true]:border-red-600 data-[invalid=true]:ring-red-600/15",
        )}
      />
      <ChevronDownIcon
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
      />

      <FloatingMenu open={open} onClose={close} anchorRef={inputRef} matchWidth>
        <div
          className="overflow-hidden rounded-[9px] border border-slate-200 bg-white shadow-popover"
          role="presentation"
        >
          <div
            id={listboxId}
            ref={listRef}
            role="listbox"
            className="max-h-56 overflow-y-auto p-1.25"
          >
            {filtered.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-[11px] text-slate-400">{emptyMessage}</p>
            ) : (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => select(option)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-slate-700 transition-colors",
                    index === highlightedIndex ? "bg-slate-100" : "hover:bg-slate-100",
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value && (
                    <CheckIcon size={13} className="shrink-0 text-accent-9" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </FloatingMenu>
    </div>
  );
}
