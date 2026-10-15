import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RichTextView } from "@/components/molecules/rich-text-view";

describe("RichTextView", () => {
  it("shows bold, italic and lists from the editor", () => {
    const { container } = render(
      <RichTextView text={"Use **bold** and *italic*\n\n- one\n- two"} />,
    );

    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("never turns typed markup into real HTML", () => {
    const { container } = render(
      <RichTextView text={'<img src=x onerror="alert(1)"> <script>alert(1)</script>'} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("renders nothing for empty help text", () => {
    const { container } = render(<RichTextView text="   " />);
    expect(container.firstChild).toBeNull();
  });
});
