import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { processInboundEmail } from "@/app/api/webhooks/resend/inbound/_receive";
import type { EmailTransport, InboundEmail } from "@/configurations/email-transport";
import type { Database } from "@/types/database.types";

const REPLY: InboundEmail = {
  emailId: "email-1",
  from: "Amara Okafor <amara@example.com>",
  to: ["talent@hiring.example.com"],
  cc: [],
  subject: "Re: Next steps",
  html: null,
  text: "Thursday works for me.",
  headers: {},
  rfcMessageId: "<reply-1@example.com>",
  receivedAt: "2026-09-29T08:00:00.000Z",
  attachments: [],
};

type Result = { data: unknown; error: { message: string; code?: string } | null };

/**
 * A stand-in for the Supabase client. Reads of each table answer with a fixed
 * result, writes with the `writes` result, and the tables written to are
 * recorded.
 */
function fakeSupabase(reads: Record<string, Result>, writes: Record<string, Result> = {}) {
  const inserts: string[] = [];
  const from = (table: string) => {
    let result = reads[table] ?? { data: null, error: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => result,
      insert: () => {
        inserts.push(table);
        result = writes[table] ?? { data: null, error: null };
        return chain;
      },
    };
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient<Database>, inserts };
}

const transport = {
  fetchInbound: vi.fn(async () => REPLY),
} as unknown as EmailTransport;

describe("processInboundEmail", () => {
  // A failed lookup used to read as "nobody has this address": the candidate's
  // real reply was filed as unmatched and the webhook answered 200, so Resend
  // never retried it.
  it("reports an error when the sender lookup fails, instead of filing the reply as unmatched", async () => {
    const { client, inserts } = fakeSupabase({
      people: { data: null, error: { message: "canceling statement due to statement timeout" } },
    });

    const outcome = await processInboundEmail(client, transport, "email-1");

    expect(outcome).toEqual({
      kind: "error",
      error: "canceling statement due to statement timeout",
    });
    expect(inserts).not.toContain("unmatched_inbound_emails");
  });

  it("still files a reply from an address nobody has as unmatched", async () => {
    const { client, inserts } = fakeSupabase(
      { people: { data: null, error: null } },
      { unmatched_inbound_emails: { data: { id: "unmatched-1" }, error: null } },
    );

    const outcome = await processInboundEmail(client, transport, "email-1");

    expect(outcome).toMatchObject({ kind: "unmatched", reason: "no_matching_person" });
    expect(inserts).toContain("unmatched_inbound_emails");
  });
});
