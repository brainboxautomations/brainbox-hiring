"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronRight, Upload } from "lucide-react";

import { cn } from "@/utilities/cn";
import { Input, Textarea } from "@/components/atoms/input";
import { Button } from "@/components/atoms/button";
import { CalendarIcon } from "@/components/atoms/icons";
import { VideoAnswerField, type VideoAnswer } from "@/components/organisms/video-answer-field";
import {
  useCandidateFileUploads,
  type CandidateFileUpload,
} from "@/hooks/use-candidate-file-uploads";
import type { Position, Question } from "@/types/api";
import {
  APPLY_FIELD_DEFS,
  isFieldRequired,
  isFieldShown,
  type ApplyFieldKey,
} from "@/utilities/application-form-fields";
import { numericAnswerProblem, numericRangeHint } from "@/utilities/numeric-question";
import { MAX_RESUME_BYTES } from "@/utilities/candidate-uploads";
import { MAX_FORM_ANSWER_LENGTH } from "@/schemas/apply-schema";
import { formatFileSize } from "@/utilities/message-attachments";
import { CAPTCHA_ENABLED, TurnstileWidget } from "@/components/molecules/turnstile-widget";
import { RichTextView } from "@/components/molecules/rich-text-view";

function validEmail(value: string): boolean {
  return /.+@.+\..+/.test(value);
}

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-[13px] font-medium text-slate-700">
      {children}
      {required && <span className="text-red-600"> *</span>}
    </label>
  );
}

const fieldTweak = "h-10.5 rounded-lg px-3.25 text-sm";
const areaTweak = "min-h-22.5 rounded-lg px-3.25 py-2.75 text-sm leading-relaxed";

const TEXT_FIELD_KEYS: ApplyFieldKey[] = [
  "address",
  "desired_salary",
  "experience_summary",
  "work_history",
  "education",
  "cover_letter",
];

type ApplyFormProps = {
  position: Position;
  questions: Question[];
  meta: string;
};

export function ApplyForm({ position, questions, meta }: ApplyFormProps) {
  const config = position.applicationFormConfig;

  const showPhone = isFieldShown(config, "phone");
  const showResume = isFieldShown(config, "resume");
  const resumeRequired = isFieldRequired(config, "resume");
  const shownTextFields = useMemo(
    () =>
      APPLY_FIELD_DEFS.filter(
        (f) => TEXT_FIELD_KEYS.includes(f.key) && isFieldShown(config, f.key),
      ),
    [config],
  );

  const [view, setView] = useState<"form" | "done">("form");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  const [values, setValues] = useState<Partial<Record<ApplyFieldKey, string>>>({});
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>({});
  const [questionFiles, setQuestionFiles] = useState<Record<string, File | null>>({});

  const [videoAnswers, setVideoAnswers] = useState<Record<string, VideoAnswer | null>>({});

  const [triedSubmit, setTriedSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [questionFileErrors, setQuestionFileErrors] = useState<Record<string, string | null>>({});

  // A token is used up by one submission, so a failed attempt asks for a new one.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const resumeInputRef = useRef<HTMLInputElement>(null);
  // The resume and file answers upload straight to Storage the moment they
  // are picked, so the submit request carries only their paths. Sending the
  // files themselves hit the host's ~6 MB request limit and failed with no
  // usable message.
  const fileUploads = useCandidateFileUploads({ positionId: position.id });
  const resumeUpload = fileUploads.uploads.resume;
  const answerUploadKey = (questionId: string) => `question:${questionId}`;

  const setValue = (key: ApplyFieldKey, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const firstError = triedSubmit && !firstName.trim();
  const emailError = triedSubmit && !validEmail(email);

  function textFieldError(key: ApplyFieldKey): boolean {
    return triedSubmit && isFieldRequired(config, key) && !(values[key] ?? "").trim();
  }

  function questionAnswered(q: Question): boolean {
    if (q.type === "video") {
      const a = videoAnswers[q.id];
      if (!a) return false;
      return a.source === "link" || a.status === "ready";
    }
    if (q.type === "file") return Boolean(questionFiles[q.id]);
    if (q.type === "multi_choice") return (multiAnswers[q.id] ?? []).length > 0;
    return Boolean((answers[q.id] ?? "").trim());
  }

  function validate(): string | null {
    if (!firstName.trim()) return "Enter your first name.";
    if (!validEmail(email)) return "Enter a valid email address.";
    for (const f of shownTextFields) {
      if (isFieldRequired(config, f.key) && !(values[f.key] ?? "").trim()) {
        return `${f.label} is required.`;
      }
    }
    if (showPhone && isFieldRequired(config, "phone") && !(values.phone ?? "").trim()) {
      return "Phone is required.";
    }
    if (showResume && resumeRequired && !resumeFile) return "Please attach your resume.";
    if (resumeError) return resumeError;
    if (resumeUpload?.status === "uploading")
      return "Your resume is still uploading. Give it a moment.";
    if (resumeUpload?.status === "error")
      return `${resumeUpload.message} Remove the file and try again.`;

    const questionFileError = Object.values(questionFileErrors).find(Boolean);
    if (questionFileError) return questionFileError;
    for (const q of questions) {
      const upload = fileUploads.uploads[answerUploadKey(q.id)];
      if (upload?.status === "uploading") return "Your file is still uploading. Give it a moment.";
      if (upload?.status === "error") {
        return `${upload.message} Remove the file and try again: ${q.prompt}`;
      }
    }

    for (const q of questions) {
      const a = videoAnswers[q.id];
      if (a?.source === "upload" && a.status === "uploading") {
        return "Your video is still uploading. Give it a moment.";
      }
      if (a?.source === "upload" && a.status === "error") {
        return `Your video didn't upload. Remove it and try again: ${q.prompt}`;
      }
    }
    for (const q of questions) {
      const problem = numericAnswerProblem(q, answers[q.id] ?? "");
      if (problem) return problem;
    }
    for (const q of questions) {
      if (q.required && !questionAnswered(q)) return `Please answer: ${q.prompt}`;
    }
    if (CAPTCHA_ENABLED && !captchaToken) {
      return "Please complete the security check just above the submit button.";
    }
    return null;
  }

  const videoUploading = Object.values(videoAnswers).some(
    (a) => a?.source === "upload" && a.status === "uploading",
  );

  function pickResume(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_RESUME_BYTES) {
      setResumeError(`${file.name} is larger than ${formatFileSize(MAX_RESUME_BYTES)}.`);
      e.target.value = "";
      return;
    }
    setResumeError(null);
    setResumeFile(file);
    if (file) void fileUploads.start("resume", file);
    else fileUploads.clear("resume");
    // Lets the same file be picked again after a failed upload.
    e.target.value = "";
  }

  function handleQuestionFile(questionId: string, file: File | null) {
    if (file && file.size > MAX_RESUME_BYTES) {
      setQuestionFileErrors((prev) => ({
        ...prev,
        [questionId]: `${file.name} is larger than ${formatFileSize(MAX_RESUME_BYTES)}.`,
      }));
      return;
    }
    setQuestionFileErrors((prev) => ({ ...prev, [questionId]: null }));
    setQuestionFiles((prev) => ({ ...prev, [questionId]: file }));
    if (file) void fileUploads.start(answerUploadKey(questionId), file);
    else fileUploads.clear(answerUploadKey(questionId));
  }

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
      const fd = new FormData();
      const uploads: Array<Record<string, string>> = [];

      if (showResume && resumeFile && resumeUpload?.status === "ready") {
        uploads.push({
          slot: "resume",
          storagePath: resumeUpload.storagePath,
          filename: resumeUpload.filename,
          ...(resumeUpload.mimeType ? { mimeType: resumeUpload.mimeType } : {}),
        });
      }

      const questionnaireTextAnswers: Array<{ questionId: string; value: string | string[] }> = [];

      const videoAnswerPayload: Array<Record<string, string>> = [];

      for (const q of questions) {
        if (q.type === "video") {
          const a = videoAnswers[q.id];
          if (a?.source === "link") {
            videoAnswerPayload.push({ source: "link", questionId: q.id, url: a.url });
          } else if (a?.source === "upload" && a.status === "ready") {
            videoAnswerPayload.push({
              source: "upload",
              questionId: q.id,
              storagePath: a.storagePath,
              filename: a.filename,
              mimeType: a.mimeType,
            });
          }
          continue;
        }
        if (q.type === "file") {
          const upload = fileUploads.uploads[answerUploadKey(q.id)];
          if (questionFiles[q.id] && upload?.status === "ready") {
            uploads.push({
              slot: "question",
              questionId: q.id,
              storagePath: upload.storagePath,
              filename: upload.filename,
              ...(upload.mimeType ? { mimeType: upload.mimeType } : {}),
            });
          }
          continue;
        }
        if (q.type === "multi_choice") {
          const vals = multiAnswers[q.id] ?? [];
          if (vals.length) questionnaireTextAnswers.push({ questionId: q.id, value: vals });
          continue;
        }
        const val = (answers[q.id] ?? "").trim();
        if (val) questionnaireTextAnswers.push({ questionId: q.id, value: val });
      }

      const formAnswers: Record<string, string> = {};
      for (const f of shownTextFields) {
        const val = (values[f.key] ?? "").trim();
        if (val) formAnswers[f.key] = val;
      }

      fd.append(
        "payload",
        JSON.stringify({
          positionId: position.id,
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim(),
          phone: showPhone ? (values.phone ?? "").trim() || undefined : undefined,
          formAnswers,
          questionnaireTextAnswers,
          uploads,
          videoAnswers: videoAnswerPayload,
        }),
      );

      fd.append("captchaToken", captchaToken ?? "");

      const res = await fetch("/api/apply", { method: "POST", body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (data?.error) throw new Error(data.error);

        // No JSON body means the request never reached the route: a host or
        // proxy rejected it first, and those replies are HTML or empty. A body
        // too large is much the commonest reason, and the old catch-all told
        // the candidate nothing they could act on — they had filled every
        // field, so "something went wrong" read as our fault to wait out
        // rather than a file to swap.
        throw new Error(
          res.status === 413
            ? "Your application is too large to send. Try a smaller resume or video, or paste a video link instead."
            : `We couldn't submit your application (error ${res.status}). Please try again, and if it keeps happening try a smaller resume or video.`,
        );
      }
      setView("done");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
      setCaptchaReset((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  }

  if (view === "done") {
    return (
      <div className="mx-auto max-w-140 px-8 py-20">
        <div className="rounded-[18px] border border-slate-200 bg-white px-9 py-11 text-center shadow-card">
          <div className="mx-auto mb-5.5 flex h-15 w-15 items-center justify-center rounded-2xl bg-green-50">
            <Check size={30} aria-hidden="true" />
          </div>
          <h1 className="mb-2.5 text-[26px] font-semibold tracking-[-0.02em] text-slate-900">
            Application received
          </h1>
          <p className="mx-auto mb-6.5 max-w-100 text-[15px] leading-relaxed text-slate-500">
            Thanks for applying to the <strong className="text-slate-700">{position.title}</strong>{" "}
            role. We review every application and will be in touch by email about next steps.
          </p>

          <div className="mb-6.5 rounded-xl border border-slate-100 bg-slate-50 px-5 py-4.5 text-left">
            <div className="mb-3 font-mono text-xs uppercase tracking-[0.06em] text-slate-400">
              What happens next
            </div>
            <div className="flex flex-col gap-3">
              {[
                "We review your application and questionnaire answers.",
                "If it's a fit, we'll email you to schedule a first conversation.",
                "You can reply to any of our emails with questions anytime.",
              ].map((step, i) => (
                <div key={i} className="flex gap-2.75">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-3 text-[11px] font-semibold text-accent-11">
                    {i + 1}
                  </span>
                  <span className="text-[13px] leading-normal text-slate-600">{step}</span>
                </div>
              ))}
            </div>
          </div>

          <Link
            href="/careers"
            className="inline-flex h-10.5 items-center gap-1.75 rounded-[10px] border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Browse other openings
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-180 px-8 pb-20 pt-10">
      <div className="mb-2">
        <Link
          href={`/careers/${position.slug}`}
          className="text-[13px] text-slate-500 no-underline hover:text-slate-700"
        >
          {position.title}
        </Link>
      </div>
      <h1 className="mb-1.5 text-[28px] font-semibold tracking-[-0.02em] text-slate-900">Apply</h1>
      <p className="mb-7 text-sm text-slate-500">
        {meta}. Fields marked <span className="text-red-600">*</span> are required.
      </p>

      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-card">
        {showResume && (
          <div
            className={cn(
              "mb-6.5 rounded-xl border border-dashed bg-slate-50 p-5 text-center",
              triedSubmit && resumeRequired && !resumeFile ? "border-red-600" : "border-slate-300",
            )}
          >
            {resumeUpload?.status === "ready" ? (
              <Check size={22} color="#16A34A" className="mx-auto" aria-hidden />
            ) : (
              <Upload size={22} color="#3d63dd" className="mx-auto" aria-hidden />
            )}
            {resumeFile ? (
              <>
                <div className="mt-2 truncate text-sm font-medium text-slate-900">
                  {resumeFile.name}
                </div>
                <div
                  className={cn(
                    "mt-0.75 text-xs",
                    resumeUpload?.status === "error" ? "text-red-700" : "text-slate-400",
                  )}
                >
                  {resumeUpload?.status === "uploading"
                    ? "Uploading…"
                    : resumeUpload?.status === "error"
                      ? resumeUpload.message
                      : "Resume attached."}
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  Attach your resume{resumeRequired && <span className="text-red-600"> *</span>}
                </div>
                <div className="mt-0.75 text-xs text-slate-400">
                  PDF or Word — we&apos;ll store it with your application.
                </div>
              </>
            )}
            <input
              ref={resumeInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={pickResume}
            />
            <div className="mt-3.5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => resumeInputRef.current?.click()}
                className="press inline-flex h-8.5 items-center rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white transition-colors hover:bg-slate-800"
              >
                {resumeFile ? "Change file" : "Upload resume"}
              </button>
              {resumeFile && (
                <button
                  type="button"
                  onClick={() => {
                    setResumeFile(null);
                    fileUploads.clear("resume");
                  }}
                  className="text-[13px] text-slate-500 hover:text-slate-700"
                >
                  Remove
                </button>
              )}
            </div>
            {triedSubmit && resumeRequired && !resumeFile && (
              <p className="mt-3 text-xs text-red-700">Please attach your resume.</p>
            )}
            {resumeError && <p className="mt-3 text-xs text-red-700">{resumeError}</p>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-3.5 gap-y-4">
          <div>
            <FieldLabel required>First name</FieldLabel>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              invalid={firstError}
              className={fieldTweak}
            />
            {firstError && <p className="mt-1.5 text-xs text-red-700">First name is required.</p>}
          </div>
          <div>
            <FieldLabel>Last name</FieldLabel>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={fieldTweak}
            />
          </div>
          <div className={showPhone ? undefined : "col-span-2"}>
            <FieldLabel required>Email</FieldLabel>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              invalid={emailError}
              className={fieldTweak}
            />
            {emailError && (
              <p className="mt-1.5 text-xs text-red-700">Enter a valid email address.</p>
            )}
          </div>
          {showPhone && (
            <div>
              <FieldLabel required={isFieldRequired(config, "phone")}>Phone</FieldLabel>
              <Input
                value={values.phone ?? ""}
                onChange={(e) => setValue("phone", e.target.value)}
                placeholder={isFieldRequired(config, "phone") ? "+92 …" : "Optional"}
                invalid={textFieldError("phone")}
                className={fieldTweak}
              />
              {textFieldError("phone") && (
                <p className="mt-1.5 text-xs text-red-700">Phone is required.</p>
              )}
            </div>
          )}
        </div>

        {shownTextFields.map((f) => {
          const required = isFieldRequired(config, f.key);
          const invalid = textFieldError(f.key);
          // Ask for the salary in the currency this role actually pays in,
          // rather than a fixed example the candidate has to convert from.
          const placeholder =
            f.key === "desired_salary" && position.salaryCurrency
              ? `Amount in ${position.salaryCurrency}${position.salaryPeriod ? ` per ${position.salaryPeriod}` : ""}`
              : f.placeholder;
          return (
            <div key={f.key} className="mt-4">
              <FieldLabel required={required}>{f.label}</FieldLabel>
              {f.control === "textarea" ? (
                <Textarea
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  placeholder={placeholder}
                  invalid={invalid}
                  // The server rejects anything longer. Capping here stops a
                  // long cover letter being typed out in full and then refused
                  // on submit.
                  maxLength={MAX_FORM_ANSWER_LENGTH}
                  className={areaTweak}
                />
              ) : (
                <Input
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  placeholder={placeholder}
                  invalid={invalid}
                  className={fieldTweak}
                />
              )}
              {invalid && <p className="mt-1.5 text-xs text-red-700">{f.label} is required.</p>}
            </div>
          );
        })}

        {questions.length > 0 && (
          <div className="mt-7 border-t border-slate-100 pt-6">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-[-0.01em] text-slate-900">
                A few questions
              </h2>
              <span className="font-mono text-[11px] text-slate-400">FROM THIS ROLE</span>
            </div>
            <p className="mb-5 text-[13px] text-slate-500">
              These come from the position&apos;s application questionnaire.
            </p>

            <div className="flex flex-col gap-5.5">
              {questions.map((q) => {
                const missing = triedSubmit && q.required && !questionAnswered(q);
                return (
                  <div key={q.id}>
                    <div className="mb-2 text-sm font-medium text-slate-900">
                      {q.prompt}
                      {q.required && <span className="text-red-600"> *</span>}
                    </div>
                    <RichTextView
                      text={q.helpText}
                      className="mb-2 text-xs leading-relaxed text-slate-500"
                    />
                    <QuestionControl
                      question={q}
                      value={answers[q.id] ?? ""}
                      multiValue={multiAnswers[q.id] ?? []}
                      file={questionFiles[q.id] ?? null}
                      fileUpload={fileUploads.uploads[answerUploadKey(q.id)]}
                      onChange={(value) => setAnswers((prev) => ({ ...prev, [q.id]: value }))}
                      onToggleMulti={(value) =>
                        setMultiAnswers((prev) => {
                          const current = prev[q.id] ?? [];
                          const next = current.includes(value)
                            ? current.filter((v) => v !== value)
                            : [...current, value];
                          return { ...prev, [q.id]: next };
                        })
                      }
                      onFile={(f) => handleQuestionFile(q.id, f)}
                      positionId={position.id}
                      videoAnswer={videoAnswers[q.id] ?? null}
                      onVideoAnswer={(next) =>
                        setVideoAnswers((prev) => ({ ...prev, [q.id]: next }))
                      }
                    />
                    {missing && (
                      <p className="mt-1.5 text-xs text-red-700">This question is required.</p>
                    )}
                    {questionFileErrors[q.id] && (
                      <p className="mt-1.5 text-xs text-red-700">{questionFileErrors[q.id]}</p>
                    )}
                  </div>
                );
              })}
            </div>
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
        <div className="mt-7 flex items-center justify-between gap-4 border-t border-slate-100 pt-5.5">
          <span className="text-xs text-slate-400">
            By applying you agree to our privacy policy.
          </span>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={submitting}
            disabled={submitting || videoUploading || fileUploads.anyUploading}
            className="h-11 shrink-0 rounded-[10px] px-6.5 text-[15px]"
          >
            {submitting
              ? "Submitting…"
              : videoUploading
                ? "Uploading video…"
                : fileUploads.anyUploading
                  ? "Uploading file…"
                  : "Submit application"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type ControlProps = {
  question: Question;
  value: string;
  multiValue: string[];
  file: File | null;
  fileUpload?: CandidateFileUpload;
  onChange: (value: string) => void;
  onToggleMulti: (value: string) => void;
  onFile: (file: File | null) => void;

  positionId: string;
  videoAnswer: VideoAnswer | null;
  onVideoAnswer: (next: VideoAnswer | null) => void;
};

function QuestionControl({
  question,
  value,
  multiValue,
  file,
  fileUpload,
  onChange,
  onToggleMulti,
  onFile,
  positionId,
  videoAnswer,
  onVideoAnswer,
}: ControlProps) {
  switch (question.type) {
    case "short_text":
      return (
        <Input
          placeholder="Your answer"
          className={fieldTweak}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "long_text":
      return (
        <Textarea
          placeholder="Your answer…"
          className={areaTweak}
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
            onChange={(e) => onChange(e.target.value)}
          />
          {numericRangeHint(question) && (
            <div className="mt-1.5 text-xs text-slate-400">{numericRangeHint(question)}</div>
          )}
        </div>
      );

    case "single_choice":
      return (
        <div className="flex flex-col gap-2.25">
          {question.options.map((opt) => {
            const on = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                className={cn(
                  "flex items-center gap-2.75 rounded-lg border px-3.25 py-2.75 text-left transition-colors",
                  on
                    ? "border-accent-9 bg-accent-2"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <span
                  className={cn(
                    "flex h-4.25 w-4.25 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                    on ? "border-accent-9" : "border-slate-300",
                  )}
                >
                  <span
                    className={cn("h-2 w-2 rounded-full", on ? "bg-accent-9" : "bg-transparent")}
                  />
                </span>
                <span className="text-sm text-slate-700">{opt.label}</span>
              </button>
            );
          })}
        </div>
      );

    case "multi_choice":
      return (
        <div className="flex flex-col gap-2.25">
          {question.options.map((opt) => {
            const on = multiValue.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onToggleMulti(opt.value)}
                className={cn(
                  "flex items-center gap-2.75 rounded-lg border px-3.25 py-2.75 text-left transition-colors",
                  on
                    ? "border-accent-9 bg-accent-2"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <span
                  className={cn(
                    "flex h-4.25 w-4.25 shrink-0 items-center justify-center rounded-[5px] border-[1.5px]",
                    on ? "border-accent-9 bg-accent-9 text-white" : "border-slate-300",
                  )}
                >
                  {on && <Check size={11} aria-hidden />}
                </span>
                <span className="text-sm text-slate-700">{opt.label}</span>
              </button>
            );
          })}
        </div>
      );

    case "dropdown":
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10.5 w-full max-w-80 rounded-lg border border-slate-300 bg-white px-3.25 text-sm text-slate-900 outline-none focus:border-accent-9"
        >
          <option value="">Select…</option>
          {question.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case "yes_no":
      return (
        <div className="flex gap-2.5">
          {["Yes", "No"].map((opt) => {
            const on = value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt)}
                className={cn(
                  "flex h-10.5 items-center rounded-lg border px-6.5 text-sm font-medium transition-colors",
                  on
                    ? "border-accent-9 bg-accent-2 text-accent-11"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
                )}
              >
                {opt}
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
            onChange={(e) => onChange(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
          />
        </div>
      );

    case "file":
      return (
        <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5.5 text-center">
          {fileUpload?.status === "ready" ? (
            <Check size={20} color="#16A34A" className="mx-auto" aria-hidden />
          ) : (
            <Upload size={20} className="mx-auto text-slate-400" aria-hidden />
          )}
          <div className="mt-1.75 text-[13px] text-slate-400">
            {file?.name || "Drag a file or click to upload"}
          </div>
          {fileUpload?.status === "uploading" && (
            <div className="mt-0.75 text-xs text-slate-400">Uploading…</div>
          )}
          {fileUpload?.status === "error" && (
            <div className="mt-0.75 text-xs text-red-700">{fileUpload.message}</div>
          )}
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
      );

    case "video":
      return (
        <VideoAnswerField
          uploadScope={{ positionId }}
          value={videoAnswer}
          onChange={onVideoAnswer}
          maxDurationSeconds={question.videoMaxDuration}
          videoAllowRetakes={question.videoAllowRetakes}
        />
      );

    default:
      return null;
  }
}
