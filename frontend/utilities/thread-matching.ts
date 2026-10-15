export type ReferencedMessage = {
  rfcMessageId: string;
  threadId: string | null;
  personId: string;
};

export type HeaderMatch =
  | { kind: "matched"; threadId: string; personId: string }
  | { kind: "foreign"; personId: string }
  | { kind: "none" };

export function matchThreadByReferences(
  references: string[],
  known: ReferencedMessage[],
  expectedPersonId?: string | null,
): HeaderMatch {
  const byId = new Map(known.map((message) => [message.rfcMessageId, message]));
  let sawForeign: string | null = null;

  for (const reference of references) {
    const message = byId.get(reference);
    if (!message || !message.threadId) continue;

    if (expectedPersonId && message.personId !== expectedPersonId) {
      sawForeign = message.personId;
      continue;
    }

    return { kind: "matched", threadId: message.threadId, personId: message.personId };
  }

  return sawForeign ? { kind: "foreign", personId: sawForeign } : { kind: "none" };
}
