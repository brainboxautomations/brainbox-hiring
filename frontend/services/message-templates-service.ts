import { HttpClient } from "@/services/http-client";
import type { MessageTemplate, MessageTemplateInput } from "@/types/api";

export const MessageTemplatesService = {
  list: () =>
    HttpClient.get<{ templates: MessageTemplate[] }>("/message-templates").then((r) => r.templates),

  get: (id: string) =>
    HttpClient.get<{ template: MessageTemplate }>(`/message-templates/${id}`).then(
      (r) => r.template,
    ),

  create: (input: MessageTemplateInput) =>
    HttpClient.post<{ template: MessageTemplate }, MessageTemplateInput>(
      "/message-templates",
      input,
    ).then((r) => r.template),

  update: (id: string, input: MessageTemplateInput) =>
    HttpClient.patch<{ template: MessageTemplate }, MessageTemplateInput>(
      `/message-templates/${id}`,
      input,
    ).then((r) => r.template),

  remove: (id: string) => HttpClient.delete<{ ok: boolean }>(`/message-templates/${id}`),
};
