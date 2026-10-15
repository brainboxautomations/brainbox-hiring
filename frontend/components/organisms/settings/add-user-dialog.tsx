"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/atoms/button";
import { CloseIcon } from "@/components/atoms/icons";
import { Field, Input } from "@/components/atoms/input";
import { useCreateTeamMember } from "@/hooks/use-settings";
import { MIN_PASSWORD_LENGTH, createTeamMemberSchema } from "@/schemas/team-member-schema";
import { apiErrorMessage } from "@/utilities/api-error";
import { generatePassword } from "@/utilities/generate-password";

type AddUserDialogProps = {
  onClose: () => void;
};

type Created = { fullName: string; email: string; password: string };

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds a team member with a password set here, typed or generated, which the
 * person adding them passes on. There is no invite email: these are employees
 * set up by a colleague.
 *
 * After saving, the sign-in details are shown once to be copied. The password
 * is not stored anywhere readable, so this is the only chance to see it.
 */
export function AddUserDialog({ onClose }: AddUserDialogProps) {
  const createUser = useCreateTeamMember();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !createUser.isPending) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, createUser.isPending]);

  function submit() {
    setFormError(null);
    const parsed = createTeamMemberSchema.safeParse({ fullName, email, password });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check the details and try again.");
      return;
    }
    createUser.mutate(parsed.data, {
      onSuccess: () => setCreated(parsed.data),
      onError: (error) => setFormError(apiErrorMessage(error, "Could not add the user.")),
    });
  }

  async function copyDetails() {
    if (!created) return;
    const ok = await copy(`Email: ${created.email}\nPassword: ${created.password}`);
    setCopied(ok);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/30"
        onClick={() => !createUser.isPending && onClose()}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add user"
        className="relative w-110 max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-modal"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {created ? "User added" : "Add user"}
            </div>
            <div className="mt-1 text-[13px] leading-relaxed text-slate-500">
              {created
                ? "Share these sign-in details with them. The password won’t be shown again."
                : "They sign in with this email and the password you set. Share it with them directly."}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        {created ? (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 font-mono text-[13px] leading-relaxed text-slate-800">
              <div>
                <span className="text-slate-400">Email: </span>
                {created.email}
              </div>
              <div>
                <span className="text-slate-400">Password: </span>
                {created.password}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={copyDetails}>
                {copied ? "Copied" : "Copy details"}
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Field label="Name" htmlFor="new-user-name">
              <Input
                id="new-user-name"
                autoFocus
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="e.g. Hamna Bakhsh"
              />
            </Field>
            <Field label="Email" htmlFor="new-user-email">
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
              />
            </Field>
            <Field label="Password" htmlFor="new-user-password">
              <div className="flex items-center gap-2">
                <Input
                  id="new-user-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  autoComplete="new-password"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setPassword(generatePassword());
                    setShowPassword(true);
                  }}
                >
                  Generate
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  {showPassword ? "Hide" : "Show"}
                </Button>
              </div>
            </Field>

            {formError && <p className="text-xs text-red-700">{formError}</p>}

            <div className="mt-1 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={createUser.isPending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={createUser.isPending}>
                Add user
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
