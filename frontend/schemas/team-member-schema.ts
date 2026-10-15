import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt, which Supabase Auth hashes with, ignores anything past 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;

export const createTeamMemberSchema = z.object({
  fullName: z.string().trim().min(1, "Enter their name").max(100, "That name is too long"),
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `The password needs at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH, `The password can be at most ${MAX_PASSWORD_LENGTH} characters`),
});

export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>;
