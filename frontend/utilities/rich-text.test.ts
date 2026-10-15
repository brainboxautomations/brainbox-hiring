import { describe, expect, it } from "vitest";

import { buildMergeContext, resolveMergeVariables } from "@/utilities/merge-variables";
import {
  applyRichTextMark,
  richTextToHtml,
  richTextToPlainText,
  safeLinkUrl,
} from "@/utilities/rich-text";

describe("links are an allowlist, not free-form", () => {
  it("accepts http, https and mailto", () => {
    expect(safeLinkUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeLinkUrl("http://example.com")).toBe("http://example.com");
    expect(safeLinkUrl("mailto:careers@example.com")).toBe("mailto:careers@example.com");
  });

  it("rejects every scripting scheme", () => {
    expect(safeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(safeLinkUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeLinkUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeLinkUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeLinkUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects protocol-relative and quote-bearing urls", () => {
    expect(safeLinkUrl("//evil.example")).toBeNull();
    expect(safeLinkUrl('https://example.com" onmouseover="alert(1)')).toBeNull();
    expect(safeLinkUrl("https://exa mple.com")).toBeNull();
  });

  it("upgrades a bare domain to https rather than guessing http", () => {
    expect(safeLinkUrl("example.com/careers")).toBe("https://example.com/careers");
  });

  it("rejects anything that is not a url at all", () => {
    expect(safeLinkUrl("")).toBeNull();
    expect(safeLinkUrl("   ")).toBeNull();
    expect(safeLinkUrl("not a url")).toBeNull();
  });

  it("drops the anchor but keeps the label when the url is unsafe", () => {
    expect(richTextToHtml("[Click me](javascript:alert(1))")).toBe("<p>Click me</p>");
  });

  it("renders a safe link as an anchor", () => {
    expect(richTextToHtml("[Careers](https://example.com/jobs)")).toBe(
      '<p><a href="https://example.com/jobs">Careers</a></p>',
    );
  });
});

describe("rendering never emits author-supplied markup", () => {
  it("escapes html in the body", () => {
    expect(richTextToHtml("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });

  it("escapes an img onerror payload", () => {
    expect(richTextToHtml('"><img src=x onerror=alert(1)>')).toBe(
      "<p>&quot;&gt;&lt;img src=x onerror=alert(1)&gt;</p>",
    );
  });

  it("escapes markup that arrives through a merge variable", () => {
    const context = buildMergeContext({
      candidate: { firstName: "<script>alert(1)</script>" },
    });
    const resolved = resolveMergeVariables("Hi {{candidate.first_name}}", context);
    expect(richTextToHtml(resolved)).toBe("<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("cannot be tricked into a javascript link through a merge variable", () => {
    const context = buildMergeContext({
      candidate: { customAttributes: { link: "javascript:alert(1)" } },
    });
    const resolved = resolveMergeVariables("[Portal]({{custom.link}})", context);
    expect(richTextToHtml(resolved)).toBe("<p>Portal</p>");
  });
});

describe("block rendering", () => {
  it("wraps a single line in a paragraph", () => {
    expect(richTextToHtml("Hello")).toBe("<p>Hello</p>");
  });

  it("keeps a soft line break inside one paragraph", () => {
    expect(richTextToHtml("Line one\nLine two")).toBe("<p>Line one<br />Line two</p>");
  });

  it("splits on a blank line", () => {
    expect(richTextToHtml("First\n\nSecond")).toBe("<p>First</p><p>Second</p>");
  });

  it("renders a heading", () => {
    expect(richTextToHtml("## Next steps")).toBe("<h2>Next steps</h2>");
  });

  it("groups consecutive bullets into one list", () => {
    expect(richTextToHtml("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("normalises carriage returns", () => {
    expect(richTextToHtml("a\r\n\r\nb")).toBe("<p>a</p><p>b</p>");
  });

  it("returns nothing for an empty body", () => {
    expect(richTextToHtml("")).toBe("");
    expect(richTextToHtml("   \n  ")).toBe("");
    expect(richTextToHtml(null)).toBe("");
    expect(richTextToHtml(undefined)).toBe("");
  });
});

describe("inline marks", () => {
  it("renders bold, italic and underline", () => {
    expect(richTextToHtml("**bold**")).toBe("<p><strong>bold</strong></p>");
    expect(richTextToHtml("*italic*")).toBe("<p><em>italic</em></p>");
    expect(richTextToHtml("__underline__")).toBe("<p><u>underline</u></p>");
  });

  it("leaves a snake_case word alone", () => {
    expect(richTextToHtml("first_name and last_name")).toBe("<p>first_name and last_name</p>");
  });

  it("does not treat an unmatched asterisk as a mark", () => {
    expect(richTextToHtml("5 * 3 = 15")).toBe("<p>5 * 3 = 15</p>");
  });
});

describe("the plain-text alternative", () => {
  it("strips marks and keeps the url beside the label", () => {
    expect(richTextToPlainText("## Hi\n**bold** *it* __u__ [Careers](https://x.example)")).toBe(
      "Hi\nbold it u Careers (https://x.example)",
    );
  });

  it("keeps bullets readable", () => {
    expect(richTextToPlainText("- one\n- two")).toBe("- one\n- two");
  });

  it("drops an unsafe url from the plain part too", () => {
    expect(richTextToPlainText("[Click](javascript:alert(1))")).toBe("Click");
  });
});

describe("toolbar mark insertion", () => {
  it("wraps the selection in bold markers and reselects the text", () => {
    expect(applyRichTextMark("hello world", "bold", 6, 11)).toEqual({
      value: "hello **world**",
      selectionStart: 8,
      selectionEnd: 13,
    });
  });

  it("inserts empty markers at the caret when nothing is selected", () => {
    expect(applyRichTextMark("hi ", "italic", 3, 3)).toEqual({
      value: "hi **",
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it("prefixes the current line for a heading", () => {
    expect(applyRichTextMark("one\ntwo", "heading", 5, 5)).toEqual({
      value: "one\n## two",
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it("prefixes the current line for a bullet", () => {
    expect(applyRichTextMark("item", "list", 0, 0)).toEqual({
      value: "- item",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("clamps a selection that runs past the end of the value", () => {
    expect(applyRichTextMark("hi", "bold", 0, 99).value).toBe("**hi**");
  });
});
