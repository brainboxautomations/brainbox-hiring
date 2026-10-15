import { HttpClient } from "@/services/http-client";
import type { Message, SendMessageInput } from "@/types/api";

export type SendMessageRequest = SendMessageInput & {
  attachments?: File[];
};

function toFormData(input: SendMessageRequest): FormData {
  const { attachments = [], ...payload } = input;
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  for (const file of attachments) form.append("attachments", file);
  return form;
}

export const MessagesService = {
  listForPerson: (personId: string) =>
    HttpClient.get<{ messages: Message[] }>(`/messages?personId=${personId}`).then(
      (r) => r.messages,
    ),

  send: (input: SendMessageRequest) =>
    HttpClient.post<{ message: Message }, FormData>("/messages", toFormData(input), {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.message),

  cancelScheduled: (messageId: string) =>
    HttpClient.post<{ message: Message }>(`/messages/${messageId}/cancel`).then((r) => r.message),

  sendNow: (messageId: string) =>
    HttpClient.post<{ message: Message }>(`/messages/${messageId}/send-now`).then((r) => r.message),

  cancelBatch: (messageIds: string[]) =>
    HttpClient.post<{ cancelled: number; alreadyGone: number }, { messageIds: string[] }>(
      "/messages/cancel-batch",
      { messageIds },
    ),
};
