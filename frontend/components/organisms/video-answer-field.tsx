"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/utilities/cn";
import { CameraIcon, ExternalLinkIcon, LinkIcon, UploadIcon } from "@/components/atoms/icons";
import { VideoRecorder } from "@/components/organisms/video-recorder";
import { useRecordingSupported } from "@/hooks/use-video-recorder";
import { parseVideoLink, type ParsedVideoLink } from "@/utilities/video-link";
import { MAX_VIDEO_BYTES } from "@/utilities/candidate-uploads";
import { uploadCandidateFile, type UploadScope } from "@/utilities/upload-candidate-file";
import { exceedsMaxDuration, formatDuration, readVideoDuration } from "@/utilities/video-duration";

export type VideoAnswer =
  | {
      source: "upload";
      status: "uploading" | "ready" | "error";
      /** Chosen by the server; empty until the upload has finished. */
      storagePath: string;
      filename: string;
      mimeType: string;

      previewUrl: string;
      error?: string;
    }
  | { source: "link"; url: string; parsed: ParsedVideoLink };

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Mode = "upload" | "record" | "link";

type VideoAnswerFieldProps = {
  /** The form the video belongs to; the server checks it is open before issuing the upload. */
  uploadScope: UploadScope;
  value: VideoAnswer | null;
  onChange: (next: VideoAnswer | null) => void;
  maxDurationSeconds?: number | null;
  videoAllowRetakes?: boolean | null;
};

export function VideoAnswerField({
  uploadScope,
  value,
  onChange,
  maxDurationSeconds,
  videoAllowRetakes,
}: VideoAnswerFieldProps) {
  const [mode, setMode] = useState<Mode>("upload");

  const canRecord = useRecordingSupported();
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // Reading a large file's metadata is quick but not instant, and the click
  // that started it has no other visible effect until it finishes.
  const [checkingDuration, setCheckingDuration] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs this field created, and only once nothing is using them.
  //
  // Keying the cleanup on the current preview URL meant any render that swapped
  // in a new URL revoked the previous one immediately — even when the `<video>`
  // was still bound to it — leaving a black player that would not replay. The
  // URLs are tracked in a ref and released together on unmount instead, which
  // is the only moment none of them can still be on screen.
  const createdUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    const created = createdUrlsRef.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.length = 0;
    };
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      setFileError(null);

      if (!file.type.startsWith("video/")) {
        setFileError("That file isn't a video. Choose an MP4, WebM, or MOV file.");
        return;
      }
      if (file.size > MAX_VIDEO_BYTES) {
        setFileError(
          `That video is ${formatBytes(file.size)} — the limit is 50 MB. Record a shorter clip, or upload it to Loom or Google Drive and paste the link instead.`,
        );
        return;
      }

      // Check the length the question actually asks for, before spending the
      // candidate's bandwidth uploading a file that breaks it. The recorder
      // enforces this by stopping itself; an uploaded file has to be measured.
      if (maxDurationSeconds) {
        setCheckingDuration(true);
        const duration = await readVideoDuration(file);
        setCheckingDuration(false);

        // An unreadable duration is allowed through: some containers do not
        // expose one, and blocking a candidate over a file the browser cannot
        // measure would be worse than accepting a clip that may run long.
        if (duration.ok && exceedsMaxDuration(duration.seconds, maxDurationSeconds)) {
          setFileError(
            `That video is ${formatDuration(duration.seconds)} — the limit is ${formatDuration(maxDurationSeconds)}. Trim it, record a shorter clip, or paste a Loom or Google Drive link instead.`,
          );
          return;
        }
      }

      const objectUrl = URL.createObjectURL(file);
      createdUrlsRef.current.push(objectUrl);

      onChange({
        source: "upload",
        status: "uploading",
        storagePath: "",
        filename: file.name,
        mimeType: file.type,
        previewUrl: objectUrl,
      });

      const result = await uploadCandidateFile("videos", uploadScope, file);

      onChange({
        source: "upload",
        status: "error" in result ? "error" : "ready",
        storagePath: "error" in result ? "" : result.storagePath,
        filename: file.name,
        mimeType: file.type,
        previewUrl: objectUrl,
        ...("error" in result ? { error: result.error } : {}),
      });
    },
    [onChange, uploadScope, maxDurationSeconds],
  );

  function applyLink() {
    const parsed = parseVideoLink(linkDraft);
    if (!parsed) {
      setLinkError(
        "Paste a Loom, Google Drive, YouTube, or Vimeo link (it must start with https://).",
      );
      return;
    }
    setLinkError(null);
    onChange({ source: "link", url: parsed.watchUrl, parsed });
  }

  function clearAnswer() {
    onChange(null);
    setLinkDraft("");
    setLinkError(null);
    setFileError(null);

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const tabs: Array<{ id: Mode; label: string; icon: typeof UploadIcon }> = [
    { id: "upload", label: "Upload", icon: UploadIcon },
    ...(canRecord ? [{ id: "record" as const, label: "Record", icon: CameraIcon }] : []),
    { id: "link", label: "Paste link", icon: LinkIcon },
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const active = mode === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] transition-colors",
                active
                  ? "border-accent-9 font-medium text-accent-11"
                  : "border-transparent text-slate-500 hover:text-slate-700",
              )}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {value?.source === "upload" && (
        <div className="overflow-hidden rounded-xl border border-slate-300">
          <video
            controls
            playsInline
            src={value.previewUrl}
            className="aspect-video w-full bg-slate-900"
          />
          <div className="flex items-center justify-between gap-3 bg-white px-3.5 py-2.5">
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {value.status === "uploading" && "Uploading…"}
              {value.status === "ready" && value.filename}
              {value.status === "error" && (
                <span className="text-red-600">{value.error ?? "Upload failed."}</span>
              )}
            </span>
            {value.status === "ready" && videoAllowRetakes === false ? (
              <span className="shrink-0 text-xs text-slate-400">Retakes disabled</span>
            ) : (
              <button
                type="button"
                onClick={clearAnswer}
                className="shrink-0 text-xs text-slate-500 hover:text-slate-700"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {value?.source === "link" && (
        <div className="overflow-hidden rounded-xl border border-slate-300">
          {value.parsed.embedUrl ? (
            <iframe
              src={value.parsed.embedUrl}
              title="Video preview"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="aspect-video w-full bg-slate-900"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center bg-slate-900 text-xs text-white/70">
              No inline preview for this link.
            </div>
          )}
          <div className="flex items-center justify-between gap-3 bg-white px-3.5 py-2.5">
            <a
              href={value.parsed.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-1.5 text-xs text-accent-11 hover:underline"
            >
              <ExternalLinkIcon size={13} className="shrink-0" />
              <span className="truncate">Open in new tab</span>
            </a>
            <button
              type="button"
              onClick={clearAnswer}
              className="shrink-0 text-xs text-slate-500 hover:text-slate-700"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {value?.source === "link" && value.parsed.provider === "drive" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          Make sure this Drive file is shared with <strong>Anyone with the link</strong> — otherwise
          we won&apos;t be able to open it.
        </p>
      )}

      {!value && mode === "upload" && (
        <label className="block cursor-pointer overflow-hidden rounded-xl border border-slate-300">
          <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-slate-900">
            <span className="flex h-13 w-13 items-center justify-center rounded-full bg-white/[0.14]">
              <UploadIcon size={20} className="text-white/80" />
            </span>
            <span className="max-w-[80%] truncate px-4 text-center text-xs text-white/70">
              {checkingDuration ? "Checking your video…" : "Click to upload a short video"}
            </span>
          </div>
          <div className="flex items-center justify-between bg-white px-3.5 py-2.5">
            <span className="text-xs text-slate-500">
              MP4, WebM or MOV · up to 50 MB
              {/* Rounding to whole minutes reported a 30-second limit as "1 min". */}
              {maxDurationSeconds ? ` · max ${formatDuration(maxDurationSeconds)}` : ""}
            </span>
            <span className="text-xs text-accent-11">Choose video</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
        </label>
      )}

      {!value && mode === "record" && (
        <VideoRecorder
          maxDurationSeconds={maxDurationSeconds}
          onComplete={(file) => void uploadFile(file)}
        />
      )}

      {!value && fileError && mode !== "link" && (
        <p className="text-[12px] text-red-600">{fileError}</p>
      )}

      {!value && mode === "link" && (
        <div>
          <div className="flex gap-2">
            <input
              type="url"
              inputMode="url"
              value={linkDraft}
              onChange={(e) => {
                setLinkDraft(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
              }}
              onBlur={() => {
                if (linkDraft.trim()) applyLink();
              }}
              placeholder="https://www.loom.com/share/…"
              className={cn(
                "h-10.5 min-w-0 flex-1 rounded-lg border bg-white px-3.25 text-sm text-slate-900 outline-none",
                linkError ? "border-red-400" : "border-slate-300 focus:border-accent-9",
              )}
            />
            <button
              type="button"
              onClick={applyLink}
              className="h-10.5 shrink-0 rounded-lg bg-accent-9 px-4 text-[13px] font-medium text-white hover:bg-accent-10"
            >
              Add
            </button>
          </div>
          <p className={cn("mt-1.5 text-[12px]", linkError ? "text-red-600" : "text-slate-500")}>
            {linkError ?? "Works with Loom, Google Drive, YouTube and Vimeo."}
          </p>
        </div>
      )}
    </div>
  );
}
