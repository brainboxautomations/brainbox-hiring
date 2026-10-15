import { cn } from "@/utilities/cn";
import { richTextToHtml } from "@/utilities/rich-text";

/**
 * Shows text written in the rich text editor (bold, italic, lists, links).
 * richTextToHtml escapes every character before it adds its own tags, so text
 * a user typed can never inject markup.
 */
export function RichTextView({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  const html = richTextToHtml(text);
  if (!html) return null;
  return <div className={cn("email-body", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
