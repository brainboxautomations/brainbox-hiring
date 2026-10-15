"use client";

import { useState } from "react";

import { splitQuotedReply } from "@/utilities/quoted-reply";

type MessageBodyProps = {
  body: string;
  collapseQuotedText: boolean;
};

export function MessageBody({ body, collapseQuotedText }: MessageBodyProps) {
  const [quotedShown, setQuotedShown] = useState(false);
  const split = splitQuotedReply(body);

  if (!collapseQuotedText || split.quoted.length === 0) return <>{body}</>;

  return (
    <>
      {split.visible}
      <button
        type="button"
        onClick={() => setQuotedShown(!quotedShown)}
        className="mt-2 block rounded border border-slate-200 px-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
      >
        {quotedShown ? "Hide quoted text" : "Show quoted text"}
      </button>
      {quotedShown && (
        <span className="mt-2 block border-t border-slate-200 pt-2 text-slate-400">
          {split.quoted}
        </span>
      )}
    </>
  );
}
