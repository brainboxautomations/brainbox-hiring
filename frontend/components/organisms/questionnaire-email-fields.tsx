"use client";

import { useRef, useState } from "react";

import {
  MergeVariableMenu,
  type ExtraMergeVariableGroup,
} from "@/components/organisms/merge-variable-menu";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/organisms/rich-text-editor";
import type { QuestionnaireEmailText } from "@/types/api";
import {
  QUESTIONNAIRE_LINK_LABEL,
  QUESTIONNAIRE_LINK_TOKEN,
  QUESTIONNAIRE_NAME_TOKEN,
  questionnaireEmailLeavesOutLink,
} from "@/utilities/questionnaire-email";

const QUESTIONNAIRE_VARIABLES: ExtraMergeVariableGroup[] = [
  {
    label: "QUESTIONNAIRE",
    fields: [
      { token: QUESTIONNAIRE_LINK_TOKEN, label: "Link (Open the questionnaire)" },
      { token: QUESTIONNAIRE_NAME_TOKEN, label: "Name" },
    ],
  },
];

const SUBJECT_INPUT =
  "h-8.5 w-full rounded-[7px] border border-slate-300 bg-white px-2.75 text-[13px] text-slate-900 outline-none transition-shadow focus:border-accent-9 focus:ring-3 focus:ring-accent-9/20 read-only:bg-slate-50 read-only:text-slate-600";

/**
 * Subject and body for a questionnaire invite or reminder. Read-only shows the
 * wording that will be used without letting it be changed here (a
 * questionnaire set to the default shows the Settings text).
 */
export function QuestionnaireEmailFields({
  idPrefix,
  value,
  onChange,
  readOnly = false,
}: {
  idPrefix: string;
  value: QuestionnaireEmailText;
  onChange: (value: QuestionnaireEmailText) => void;
  readOnly?: boolean;
}) {
  const bodyRef = useRef<RichTextEditorHandle>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function insertVariable(token: string) {
    bodyRef.current?.insertAtCursor(token);
    setMenuOpen(false);
  }

  if (readOnly) {
    return (
      <div className="flex flex-col gap-2">
        <input readOnly aria-label="Subject" value={value.subject} className={SUBJECT_INPUT} />
        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[9px] border border-slate-200 bg-slate-50 px-3 py-2.5 font-sans text-xs leading-relaxed text-slate-600">
          {value.body}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label
          htmlFor={`${idPrefix}-subject`}
          className="mb-1.5 block text-[11px] font-medium text-slate-500"
        >
          Subject
        </label>
        <input
          id={`${idPrefix}-subject`}
          value={value.subject}
          onChange={(e) => onChange({ ...value, subject: e.target.value })}
          className={SUBJECT_INPUT}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-500">Email</span>
          <MergeVariableMenu
            open={menuOpen}
            onToggle={() => setMenuOpen((open) => !open)}
            onInsert={insertVariable}
            extraGroups={QUESTIONNAIRE_VARIABLES}
          />
        </div>
        <RichTextEditor
          handleRef={bodyRef}
          value={value.body}
          onChange={(body) => onChange({ ...value, body })}
          ariaLabel="Email"
          minHeightClassName="min-h-44"
        />
      </div>

      {questionnaireEmailLeavesOutLink(value.body) ? (
        <p className="text-[11px] leading-relaxed text-amber-700">
          This email has no<span className="mx-1 font-mono">{QUESTIONNAIRE_LINK_TOKEN}</span>, so
          the &ldquo;{QUESTIONNAIRE_LINK_LABEL}&rdquo; link will be added at the end.
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed text-slate-400">
          <span className="mr-1 font-mono text-slate-500">{QUESTIONNAIRE_LINK_TOKEN}</span>becomes
          the candidate&rsquo;s own &ldquo;{QUESTIONNAIRE_LINK_LABEL}&rdquo; link.
        </p>
      )}
    </div>
  );
}
