"use client";

import { useRef, useState } from "react";

import { Tooltip } from "@/components/atoms/tooltip";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import { MERGE_VARIABLE_CATALOG, mergeTokenFor } from "@/utilities/merge-variables";
import { Braces } from "lucide-react";

function BracketsIcon({ size = 13 }: { size?: number }) {
  return <Braces size={size} aria-hidden="true" />;
}

/** A group of variables only some editors offer, such as the questionnaire's link. */
export type ExtraMergeVariableGroup = {
  label: string;
  fields: { token: string; label: string }[];
};

type MergeVariableMenuProps = {
  open: boolean;
  onToggle: () => void;
  onInsert: (token: string) => void;
  customAttributeKeys?: string[];
  align?: "left" | "right";
  trigger?: "labelled" | "icon";
  extraGroups?: ExtraMergeVariableGroup[];
};

export function MergeVariableMenu({
  open,
  onToggle,
  onInsert,
  customAttributeKeys = [],
  align = "right",
  trigger = "labelled",
  extraGroups = [],
}: MergeVariableMenuProps) {
  const [customKey, setCustomKey] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);

  function insert(token: string) {
    onInsert(token);
  }

  function insertCustom() {
    const key = customKey.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key) return;
    setCustomKey("");
    insert(mergeTokenFor("custom", key));
  }

  const triggerButton = (
    <button
      ref={anchorRef}
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label="Insert variable"
      className={
        trigger === "labelled"
          ? "inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-slate-300 bg-white px-2.5 text-xs font-medium text-accent-11 transition-colors hover:bg-slate-50"
          : "flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100"
      }
    >
      <BracketsIcon size={trigger === "labelled" ? 13 : 16} />
      {trigger === "labelled" ? "Insert variable" : null}
    </button>
  );

  return (
    <div>
      {trigger === "icon" ? (
        <Tooltip label="Insert variable">{triggerButton}</Tooltip>
      ) : (
        triggerButton
      )}

      <FloatingMenu
        open={open}
        onClose={onToggle}
        anchorRef={anchorRef}
        align={align === "right" ? "end" : "start"}
      >
        <div
          role="menu"
          className="max-h-85 w-66 overflow-y-auto rounded-[9px] border border-slate-200 bg-white p-1.25 shadow-popover"
        >
          {extraGroups.map((group) => (
            <div key={group.label}>
              <div className="px-2.25 pb-1 pt-2 font-mono text-[10px] tracking-[0.08em] text-slate-400">
                {group.label}
              </div>
              {group.fields.map((field) => (
                <button
                  key={field.token}
                  type="button"
                  role="menuitem"
                  onClick={() => insert(field.token)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.25 py-1.5 text-left transition-colors hover:bg-slate-100"
                >
                  <span className="text-xs text-slate-700">{field.label}</span>
                  <span className="font-mono text-[10px] text-slate-400">{field.token}</span>
                </button>
              ))}
            </div>
          ))}

          {MERGE_VARIABLE_CATALOG.map((group) => (
            <div key={group.group}>
              <div className="px-2.25 pb-1 pt-2 font-mono text-[10px] tracking-[0.08em] text-slate-400">
                {group.label}
              </div>
              {group.fields.map((field) => {
                const token = mergeTokenFor(group.group, field.field);
                return (
                  <button
                    key={field.field}
                    type="button"
                    role="menuitem"
                    onClick={() => insert(token)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2.25 py-1.5 text-left transition-colors hover:bg-slate-100"
                  >
                    <span className="text-xs text-slate-700">{field.label}</span>
                    <span className="font-mono text-[10px] text-slate-400">{token}</span>
                  </button>
                );
              })}
            </div>
          ))}

          <div className="px-2.25 pb-1 pt-2 font-mono text-[10px] tracking-[0.08em] text-slate-400">
            CUSTOM ATTRIBUTES
          </div>
          {customAttributeKeys.map((key) => {
            const token = mergeTokenFor("custom", key);
            return (
              <button
                key={key}
                type="button"
                role="menuitem"
                onClick={() => insert(token)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2.25 py-1.5 text-left transition-colors hover:bg-slate-100"
              >
                <span className="text-xs text-slate-700">{key.replace(/_/g, " ")}</span>
                <span className="font-mono text-[10px] text-slate-400">{token}</span>
              </button>
            );
          })}

          <div className="flex items-center gap-1.5 px-2.25 pb-1.5 pt-1">
            <input
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  insertCustom();
                }
              }}
              placeholder="attribute key"
              aria-label="Custom attribute key"
              className="h-7 min-w-0 flex-1 rounded-md border border-slate-300 px-2 font-mono text-[11px] text-slate-700 outline-none focus:border-accent-9"
            />
            <button
              type="button"
              onClick={insertCustom}
              className="h-7 shrink-0 rounded-md border border-slate-300 px-2 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Insert
            </button>
          </div>
        </div>
      </FloatingMenu>
    </div>
  );
}
