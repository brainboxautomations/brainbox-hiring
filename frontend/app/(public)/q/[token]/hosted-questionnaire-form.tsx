"use client";

import { useState } from "react";

import { cn } from "@/utilities/cn";
import { Button } from "@/components/atoms/button";
import { Input, Textarea } from "@/components/atoms/input";
import { CalendarIcon } from "@/components/atoms/icons";
import { VideoAnswerField, type VideoAnswer } from "@/components/organisms/video-answer-field";
import type { UploadScope } from "@/utilities/upload-candidate-file";
import { CAPTCHA_ENABLED, TurnstileWidget } from "@/components/molecules/turnstile-widget";
import type { HostedQuestionnaire, Question } from "@/types/api";
import { numericAnswerProblem, numericRangeHint } from "@/utilities/numeric-question";
import { QuestionnaireNotice } from "./questionnaire-notice";
import { RichTextView } from "@/components/molecules/rich-text-view";
import { Check, Upload } from "lucide-react";

const fieldTweak = "h-10.5 rounded-lg px-3.25 text-sm";
const areaTweak = "min-h-25 rounded-lg px-3.25 py-2.75 text-sm leading-relaxed";

type HostedQuestionnaireFormProps = {
  token: string;
  questionnaire: HostedQuestionnaire;
};

export function HostedQuestionnaireForm({ token, questionnaire }: HostedQuestionnaireFormProps) {
  const { questions } = questionnaire;

  const [view, setView] = useState<"form" | "done">("form");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [videoAnswers, setVideoAnswers] = useState<Record<string, VideoAnswer | null>>({});

  const [triedSubmit, setTriedSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // A token is used up by one submission, so a failed attempt asks for a new one.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  function isAnswered(question: Question): boolean {
    if (question.type === "video") {
      const answer = videoAnswers[question.id];
      if (!answer) return false;
      return answer.source === "link" || answer.status === "ready";
    }
    if (question.type === "file") return Boolean(files[question.id]);
    if (question.type === "multi_choice") return (multiAnswers[question.id] ?? []).length > 0;
    return Boolean((answers[question.id] ?? "").trim());
  }

  function validate(): string | null {
    for (const question of questions) {
      const answer = videoAnswers[question.id];
      if (answer?.source === "upload" && answer.status === "uploading") {
        return "Your video is still uploading. Give it a moment.";
      }
      if (answer?.source === "upload" && answer.status === "error") {
        return `Your video didn't upload. Remove it and try again: ${question.prompt}`;
      }
    }
    for (const question of questions) {
      const problem = numericAnswerProblem(question, answers[question.id] ?? "");
      if (problem) return problem;
    }
    for (const question of questions) {
      if (question.required && !isAnswered(question)) return `Please answer: ${question.prompt}`;
    }
    if (CAPTCHA_ENABLED && !captchaToken) {
      return "Please complete the security check just above the submit button.";
    }
    return null;
  }

  const answered = questions.filter(isAnswered).length;
  const progressPercent =
    questions.length > 0 ? Math.round((answered / questions.length) * 100) : 100;

  const videoUploading = Object.values(videoAnswers).some(
    (answer) => answer?.source === "upload" && answer.status === "uploading",
  );

  async function handleSubmit() {
    setTriedSubmit(true);
    const problem = validate();
    if (problem) {
      setSubmitError(problem);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);

    try {
      const form = new FormData();
      const textAnswers: Array<{ questionId: string; value: string | string[] }> = [];
      const uploads: Array<{ questionId: string; fileKey: string }> = [];
      const videoPayload: Array<Record<string, string>> = [];

      for (const question of questions) {
        if (question.type === "video") {
          const answer = videoAnswers[question.id];
          if (answer?.source === "link") {
            videoPayload.push({ source: "link", questionId: question.id, url: answer.url });
          } else if (answer?.source === "upload" && answer.status === "ready") {
            videoPayload.push({
              source: "upload",
              questionId: question.id,
              storagePath: answer.storagePath,
              filename: answer.filename,
              mimeType: answer.mimeType,
            });
          }
          continue;
        }
        if (question.type === "file") {
          const file = files[question.id];
          if (file) {
            const fileKey = `file_q_${question.id}`;
            form.append(fileKey, file);
            uploads.push({ questionId: question.id, fileKey });
          }
          continue;
        }
        if (question.type === "multi_choice") {
          const values = multiAnswers[question.id] ?? [];
          if (values.length) textAnswers.push({ questionId: question.id, value: values });
          continue;
        }
        const value = (answers[question.id] ?? "").trim();
        if (value) textAnswers.push({ questionId: question.id, value });
      }

      form.append(
        "payload",
        JSON.stringify({ token, textAnswers, uploads, videoAnswers: videoPayload }),
      );
      form.append("captchaToken", captchaToken ?? "");

      const response = await fetch("/api/questionnaire-submissions", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Something went wrong submitting your answers.");
      }
      setView("done");
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Something went wrong. Please try again.",
      );
      setCaptchaReset((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  }

  if (view === "done") {
    return (
      <QuestionnaireNotice tone="success" title="All done — thank you!">
        Your answers to{" "}
        <strong className="font-semibold text-slate-700">{questionnaire.name}</strong> have been
        submitted, and this link is now closed. You can close this page.
      </QuestionnaireNotice>
    );
  }

  return (
    <div className="min-h-full">
      <div className="sticky top-16 z-10 border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-170 items-center justify-end px-8 py-3">
          <span className="text-xs text-slate-400">
            {answered} of {questions.length} answered
          </span>
        </div>
        <div className="h-0.75 bg-slate-100">
          <div
            className="h-0.75 bg-accent-9 transition-[width] duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-170 px-8 pb-20 pt-10">
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.08em] text-slate-400">
          Questionnaire
        </div>
        <h1 className="mb-1.5 text-[26px] font-semibold tracking-[-0.02em] text-slate-900">
          {questionnaire.name}
        </h1>
        <p className="mb-7.5 text-sm text-slate-500">
          For your application to {questionnaire.positionTitle}. Answer everything, then submit —
          this link works once.
        </p>

        {questions.length === 0 ? (
          <div className="rounded-[14px] border border-slate-200 bg-white px-6 py-8 text-center shadow-card">
            <div className="text-[13px] font-medium text-slate-600">
              There are no questions to answer
            </div>
            <p className="mx-auto mt-1 max-w-90 text-xs leading-relaxed text-slate-400">
              This questionnaire is empty. Submitting closes it off so nobody chases you about it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {questions.map((question, index) => {
              const missing = triedSubmit && question.required && !isAnswered(question);
              return (
                <div
                  key={question.id}
                  className="rounded-[14px] border border-slate-200 bg-white px-6 py-5.5 shadow-card"
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-slate-300">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="text-[15px] font-medium text-slate-900">
                      {question.prompt}
                      {question.required && <span className="text-red-600"> *</span>}
                    </div>
                  </div>
                  <RichTextView
                    text={question.helpText}
                    className="mb-3 text-xs leading-relaxed text-slate-500"
                  />
                  <div className="mt-3">
                    <QuestionControl
                      question={question}
                      uploadScope={{ questionnaireToken: token }}
                      value={answers[question.id] ?? ""}
                      multiValue={multiAnswers[question.id] ?? []}
                      file={files[question.id] ?? null}
                      videoAnswer={videoAnswers[question.id] ?? null}
                      onChange={(value) =>
                        setAnswers((prev) => ({ ...prev, [question.id]: value }))
                      }
                      onToggleMulti={(value) =>
                        setMultiAnswers((prev) => {
                          const current = prev[question.id] ?? [];
                          const next = current.includes(value)
                            ? current.filter((entry) => entry !== value)
                            : [...current, value];
                          return { ...prev, [question.id]: next };
                        })
                      }
                      onFile={(file) => setFiles((prev) => ({ ...prev, [question.id]: file }))}
                      onVideoAnswer={(next) =>
                        setVideoAnswers((prev) => ({ ...prev, [question.id]: next }))
                      }
                    />
                  </div>
                  {missing && (
                    <p className="mt-1.5 text-xs text-red-700">This question is required.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {submitError && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {submitError}
          </div>
        )}

        <div className="mt-6">
          <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaReset} />
        </div>

        <div className="mt-6 flex items-center justify-end">
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={submitting}
            disabled={submitting || videoUploading}
            className="h-11.5 rounded-[11px] px-7 text-[15px]"
          >
            {submitting
              ? "Submitting…"
              : videoUploading
                ? "Uploading video…"
                : "Submit questionnaire"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type ControlProps = {
  question: Question;
  uploadScope: UploadScope;
  value: string;
  multiValue: string[];
  file: File | null;
  videoAnswer: VideoAnswer | null;
  onChange: (value: string) => void;
  onToggleMulti: (value: string) => void;
  onFile: (file: File | null) => void;
  onVideoAnswer: (next: VideoAnswer | null) => void;
};

function QuestionControl({
  question,
  uploadScope,
  value,
  multiValue,
  file,
  videoAnswer,
  onChange,
  onToggleMulti,
  onFile,
  onVideoAnswer,
}: ControlProps) {
  switch (question.type) {
    case "short_text":
      return (
        <Input
          placeholder="Your answer"
          className={fieldTweak}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "long_text":
      return (
        <Textarea
          placeholder="Your answer…"
          className={areaTweak}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "numeric":
      return (
        <div>
          <Input
            inputMode="decimal"
            placeholder="0"
            className="h-10.5 w-40 rounded-lg px-3.25 text-sm"
            value={value}
            min={question.numericMin ?? undefined}
            max={question.numericMax ?? undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          {numericRangeHint(question) && (
            <div className="mt-1.5 text-xs text-slate-400">{numericRangeHint(question)}</div>
          )}
        </div>
      );

    case "single_choice":
      return (
        <div className="flex flex-col gap-2.25">
          {question.options.map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={cn(
                  "flex items-center gap-2.75 rounded-lg border px-3.25 py-2.75 text-left transition-colors",
                  selected
                    ? "border-accent-9 bg-accent-2"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <span
                  className={cn(
                    "flex h-4.25 w-4.25 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                    selected ? "border-accent-9" : "border-slate-300",
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      selected ? "bg-accent-9" : "bg-transparent",
                    )}
                  />
                </span>
                <span className="text-sm text-slate-700">{option.label}</span>
              </button>
            );
          })}
        </div>
      );

    case "multi_choice":
      return (
        <div className="flex flex-col gap-2.25">
          {question.options.map((option) => {
            const selected = multiValue.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onToggleMulti(option.value)}
                className={cn(
                  "flex items-center gap-2.75 rounded-lg border px-3.25 py-2.75 text-left transition-colors",
                  selected
                    ? "border-accent-9 bg-accent-2"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <span
                  className={cn(
                    "flex h-4.25 w-4.25 shrink-0 items-center justify-center rounded-[5px] border-[1.5px]",
                    selected ? "border-accent-9 bg-accent-9 text-white" : "border-slate-300",
                  )}
                >
                  {selected && <Check size={11} aria-hidden />}
                </span>
                <span className="text-sm text-slate-700">{option.label}</span>
              </button>
            );
          })}
        </div>
      );

    case "dropdown":
      return (
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10.5 w-full max-w-80 rounded-lg border border-slate-300 bg-white px-3.25 text-sm text-slate-900 outline-none focus:border-accent-9"
        >
          <option value="">Select…</option>
          {question.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case "yes_no":
      return (
        <div className="flex gap-2.5">
          {["Yes", "No"].map((option) => {
            const selected = value === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(option)}
                className={cn(
                  "flex h-10.5 items-center rounded-lg border px-6.5 text-sm font-medium transition-colors",
                  selected
                    ? "border-accent-9 bg-accent-2 text-accent-11"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      );

    case "date":
      return (
        <div className="flex h-10.5 w-50 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.25">
          <CalendarIcon size={15} className="shrink-0 text-slate-400" />
          <input
            type="date"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
          />
        </div>
      );

    case "file":
      return (
        <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5.5 text-center">
          <Upload size={20} className="mx-auto text-slate-400" aria-hidden />
          <div className="mt-1.75 text-[13px] text-slate-400">
            {file?.name || "Drag a file or click to upload"}
          </div>
          <input
            type="file"
            className="hidden"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          />
        </label>
      );

    case "video":
      return (
        <div>
          <VideoAnswerField
            uploadScope={uploadScope}
            value={videoAnswer}
            onChange={onVideoAnswer}
            maxDurationSeconds={question.videoMaxDuration}
            videoAllowRetakes={question.videoAllowRetakes}
          />
          {question.videoAllowRetakes === false && (
            <div className="mt-1.5 text-xs text-slate-400">
              Please record this one in a single take.
            </div>
          )}
        </div>
      );

    default:
      return null;
  }
}
