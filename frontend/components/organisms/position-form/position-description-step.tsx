"use client";

import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import dynamic from "next/dynamic";

import type { PositionFormValues } from "./position-form-values";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

type PositionDescriptionStepProps = {
  values: PositionFormValues;
  onChange: (patch: Partial<PositionFormValues>) => void;
};

export function PositionDescriptionStep({ values, onChange }: PositionDescriptionStepProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-300" data-color-mode="light">
      <MDEditor
        value={values.description}
        onChange={(value) => onChange({ description: value ?? "" })}
        height={440}
        preview="live"
        visibleDragbar={false}
        textareaProps={{
          "aria-label": "Job description",
          placeholder:
            "Describe the role, the team, and what a great candidate looks like… (Markdown supported)",
        }}
      />
    </div>
  );
}
